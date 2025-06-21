import './test-env'; // Must be first import
import { beforeAll, afterAll, beforeEach } from 'bun:test';
import { db, schema } from '../src/db';
import { sql } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';
import { $ } from 'bun';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

export const TEST_DB_PATH = './test.db';
export const TEST_MEDIA_DIR = './test-media';
export const TEST_THUMBNAILS_DIR = './test-thumbnails';

// Ensure database is migrated before tests
export async function ensureDatabase() {
  // Skip migration - database should already be migrated
  // If tests fail with missing columns, run: rm -f test.db && DATABASE_PATH=./test.db bun run src/db/migrate.ts
}

// Reset test counter
export function resetTestCounters() {
  testMediaCounter = 0;
}

// Clean up test database
export async function cleanDatabase() {
  await ensureDatabase();
  
  // Reset test counters
  resetTestCounters();
  
  // Direct SQL approach to ensure complete cleanup
  try {
    // Get the underlying SQLite database connection
    const sqlite = (db as any).session.client;
    
    // Disable foreign keys temporarily for cleanup
    sqlite.exec('PRAGMA foreign_keys = OFF');
    
    // Delete all data from tables in reverse order of dependencies
    sqlite.exec('DELETE FROM media_tags');
    sqlite.exec('DELETE FROM collection_media');
    sqlite.exec('DELETE FROM custom_fields');
    sqlite.exec('DELETE FROM saved_filters');
    sqlite.exec('DELETE FROM media_items');
    sqlite.exec('DELETE FROM scan_sessions');
    sqlite.exec('DELETE FROM tags');
    sqlite.exec('DELETE FROM collections');
    
    // Re-enable foreign keys
    sqlite.exec('PRAGMA foreign_keys = ON');
  } catch (err) {
    console.error('Failed to clean database:', err);
    // If that fails, try with Drizzle's sql template
    await cleanDatabaseWithDrizzle();
  }
}

// Fallback cleanup method using Drizzle
async function cleanDatabaseWithDrizzle() {
  try {
    // Use Drizzle's SQL template with proper syntax
    await db.run(sql`PRAGMA foreign_keys = OFF`);
    
    // Delete all records
    await db.delete(schema.mediaTags).execute();
    await db.delete(schema.collectionMedia).execute();
    await db.delete(schema.customFields).execute();
    await db.delete(schema.savedFilters).execute();
    await db.delete(schema.mediaItems).execute();
    await db.delete(schema.scanSessions).execute();
    await db.delete(schema.tags).execute();
    await db.delete(schema.collections).execute();
    
    await db.run(sql`PRAGMA foreign_keys = ON`);
  } catch (e) {
    console.error('Failed to clean database with Drizzle:', e);
  }
}

// Create test directories
export async function setupTestDirs() {
  await fs.mkdir(TEST_MEDIA_DIR, { recursive: true });
  await fs.mkdir(TEST_THUMBNAILS_DIR, { recursive: true });
}

// Clean up test directories
export async function cleanupTestDirs() {
  try {
    await fs.rm(TEST_MEDIA_DIR, { recursive: true, force: true });
    await fs.rm(TEST_THUMBNAILS_DIR, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directories don't exist
  }
}

// Create test media files
export async function createTestMediaFile(
  filename: string,
  content: string = 'test content',
  dir: string = TEST_MEDIA_DIR
): Promise<string> {
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, content);
  return filepath;
}

// Create test image with metadata using ffmpeg
export async function createTestImage(filename: string, options?: {
  width?: number;
  height?: number;
  color?: string;
}): Promise<string> {
  const filepath = path.join(TEST_MEDIA_DIR, filename);
  const { width = 1920, height = 1080, color = 'blue' } = options || {};
  
  // Use ffmpeg to create a real image with metadata
  await $`ffmpeg -f lavfi -i color=c=${color}:s=${width}x${height}:d=1 -frames:v 1 -y ${filepath}`.quiet();
  
  return filepath;
}

// Create test video file using ffmpeg
export async function createTestVideo(filename: string, options?: {
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
}): Promise<string> {
  const filepath = path.join(TEST_MEDIA_DIR, filename);
  const { width = 1920, height = 1080, duration = 5, fps = 30 } = options || {};
  
  // Use ffmpeg to create a real video with proper metadata
  await $`ffmpeg -f lavfi -i testsrc=duration=${duration}:size=${width}x${height}:rate=${fps} -c:v libx264 -pix_fmt yuv420p -y ${filepath}`.quiet();
  
  return filepath;
}

// Counter for unique test media items
let testMediaCounter = 0;

// Insert test media item
export async function insertTestMedia(overrides: Partial<schema.NewMediaItem> = {}, options: { createFile?: boolean } = {}): Promise<schema.MediaItem> {
  // Generate unique defaults if not provided
  const filename = overrides.filename || `test-${++testMediaCounter}.jpg`;
  const filepath = overrides.filepath || path.join(TEST_MEDIA_DIR, filename);
  
  // Create the actual file if requested
  if (options.createFile) {
    await setupTestDirs(); // Ensure directory exists
    if (filename.endsWith('.jpg') || filename.endsWith('.png')) {
      await createTestImage(filename);
    } else if (filename.endsWith('.mp4') || filename.endsWith('.mov')) {
      await createTestVideo(filename);
    } else {
      await createTestMediaFile(filename, 'test content');
    }
  }
  
  const [item] = await db.insert(schema.mediaItems).values({
    filepath,
    filename,
    createdAt: new Date('2024-01-01'),
    fileType: 'image',
    fileSize: 1024,
    lastModified: new Date(),
    thumbnailGenerated: false,
    ...overrides
  }).returning();
  
  return item;
}

// Insert test tag
export async function insertTestTag(overrides: Partial<schema.NewTag> = {}): Promise<schema.Tag> {
  const name = overrides.name || 'test-tag';
  const slug = overrides.slug || (overrides.name || name).toLowerCase().replace(/\s+/g, '-');
  
  const [tag] = await db.insert(schema.tags).values({
    path: '', // Will be set by service
    ...overrides,
    name,
    slug
  }).returning();
  
  return tag;
}

// Insert test collection
export async function insertTestCollection(overrides: Partial<schema.NewCollection> = {}): Promise<schema.Collection> {
  const [collection] = await db.insert(schema.collections).values({
    title: 'Test Collection',
    ...overrides
  }).returning();
  
  return collection;
}

// Wait for async operations
export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error('Timeout waiting for condition');
}


// Test data generators
export async function generateMediaItems(count: number, overrides: Partial<schema.NewMediaItem> = {}): Promise<schema.MediaItem[]> {
  const items: schema.MediaItem[] = [];
  
  for (let i = 0; i < count; i++) {
    const [item] = await db.insert(schema.mediaItems).values({
      filepath: `/test/media/file${i}.jpg`,
      filename: `file${i}.jpg`,
      createdAt: new Date(2024, 0, 1 + i),
      fileType: i % 3 === 0 ? 'video' : 'image',
      fileSize: 1024 * (i + 1),
      lastModified: new Date(),
      width: 1920,
      height: 1080,
      duration: i % 3 === 0 ? 60 + i : undefined,
      thumbnailGenerated: false,
      checksum: `checksum${i}`,
      phash: i % 2 === 0 ? `phash${Math.floor(i / 2)}` : undefined, // Create some duplicates
      ...overrides
    }).returning();
    
    items.push(item);
  }
  
  return items;
}

// Note for immediate mode implementation
export const IMMEDIATE_MODE_NOTE = `
TODO: Implement immediate mode for thumbnail generation
- Add 'immediate' mode to ThumbnailQueue that bypasses debouncing
- Useful for tethered shooting where photographers want instant previews
- Should process thumbnails as soon as they're added to queue
- Can be enabled via environment variable: THUMBNAIL_IMMEDIATE_MODE=true
- Should still respect max concurrent workers to avoid system overload
`;

export { beforeAll, afterAll, beforeEach };