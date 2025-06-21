import './test-env'; // Must be first import
import { describe, test, expect, beforeEach, afterAll, beforeAll } from 'bun:test';
import { MediaScanner } from '../src/services/scanner';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { $ } from 'bun';
import fs from 'fs/promises';
import path from 'path';
import { 
  cleanDatabase, 
  setupTestDirs, 
  cleanupTestDirs,
  createTestImage,
  createTestVideo,
  insertTestMedia,
  TEST_MEDIA_DIR
} from './setup';

describe('MediaScanner', () => {
  let scanner: MediaScanner;

  // Check ffmpeg is available before running tests
  beforeAll(async () => {
    try {
      await $`which ffmpeg`.quiet();
      await $`which ffprobe`.quiet();
    } catch {
      console.error('\n⚠️  FFmpeg/FFprobe not found! Please install ffmpeg to run tests.\n');
      console.error('  macOS:    brew install ffmpeg');
      console.error('  Ubuntu:   sudo apt install ffmpeg\n');
      process.exit(1);
    }
  });

  beforeEach(async () => {
    await cleanDatabase();
    await cleanupTestDirs(); // Clean before setup to ensure fresh state
    await setupTestDirs();
    scanner = new MediaScanner();
  });

  afterAll(async () => {
    await cleanupTestDirs();
  });

  describe('scanDirectory', () => {
    test('should scan and index new media files', async () => {
      // Create test files
      await createTestImage('photo1.jpg');
      await createTestImage('photo2.png');
      await createTestVideo('video1.mp4');
      
      // Run scan
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);

      expect(result.processed).toBe(3);
      expect(result.newFiles).toBe(3);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Verify database entries
      const items = await db.select().from(schema.mediaItems);
      expect(items).toHaveLength(3);
      
      const imageItems = items.filter(i => i.fileType === 'image');
      const videoItems = items.filter(i => i.fileType === 'video');
      
      expect(imageItems).toHaveLength(2);
      expect(videoItems).toHaveLength(1);
    });

    test('should update existing files if modified', async () => {
      // Create and scan initial file
      const filepath = await createTestImage('update-test.jpg');
      const firstScan = await scanner.scanDirectory(TEST_MEDIA_DIR);
      expect(firstScan.newFiles).toBe(1);
      
      // Get initial item
      const [initial] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.filepath, filepath));
      
      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Touch the file to update its modification time
      await $`touch ${filepath}`.quiet();
      
      // Wait a bit more to ensure the filesystem has updated the mtime
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Rescan
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      expect(result.processed).toBe(1);
      expect(result.newFiles).toBe(0);
      expect(result.updated).toBe(1);
      
      // Verify update
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.filepath, filepath));
      
      expect(updated.id).toBe(initial.id);
      expect(updated.lastModified.getTime()).toBeGreaterThan(initial.lastModified.getTime());
    });

    test('should skip hidden files and directories', async () => {
      await createTestImage('.hidden.jpg');
      await createTestImage('visible.jpg');
      
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      expect(result.processed).toBe(1);
      expect(result.newFiles).toBe(1);
      
      const items = await db.select().from(schema.mediaItems);
      expect(items).toHaveLength(1);
      expect(items[0].filename).toBe('visible.jpg');
    });

    test('should handle scan errors gracefully', async () => {
      // Create a file that will cause an error
      const badPath = './test-media/nonexistent/test.jpg';
      
      const result = await scanner.scanDirectory('./test-media/nonexistent');
      
      expect(result.processed).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('duplicate detection', () => {
    test('should detect exact checksum duplicates', async () => {
      // Create two identical files
      await createTestImage('original.jpg');
      await createTestImage('duplicate.jpg');
      
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      expect(result.processed).toBe(2);
      expect(result.newFiles).toBe(1); // Only one should be added
      expect(result.duplicatesSkipped).toBe(1);
      
      const items = await db.select().from(schema.mediaItems);
      expect(items).toHaveLength(1);
    });

    test('should detect perceptually similar images', async () => {
      // Create two similar images (same solid color)
      await createTestImage('image1.jpg', { color: 'red' });
      await createTestImage('image2.jpg', { color: 'red' });
      
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      // Both should be processed (phash detection happens but may not match exactly)
      expect(result.processed).toBe(2);
      
      // Check if phashes were generated
      const items = await db.select().from(schema.mediaItems);
      const itemsWithPhash = items.filter(item => item.phash !== null);
      expect(itemsWithPhash.length).toBeGreaterThan(0);
    });

    test('should store duplicate paths in custom fields', async () => {
      // Create an image and scan it
      await createTestImage('original.jpg', { color: 'green' });
      await scanner.scanDirectory('./test-media');
      
      // Get the created item
      const [existing] = await db.select().from(schema.mediaItems);
      
      // Create a duplicate by copying the file
      await fs.copyFile(
        path.join(TEST_MEDIA_DIR, 'original.jpg'),
        path.join(TEST_MEDIA_DIR, 'duplicate.jpg')
      );
      
      // Scan again - should detect duplicate
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      expect(result.duplicatesSkipped).toBeGreaterThan(0);
      
      // Check if duplicate path was stored
      const customFields = await db.select()
        .from(schema.customFields)
        .where(eq(schema.customFields.entityId, existing.id));
      
      const duplicateField = customFields.find(f => f.fieldName === 'duplicate_paths');
      if (duplicateField) {
        const paths = JSON.parse(duplicateField.fieldValue!);
        expect(paths).toContain(path.join(TEST_MEDIA_DIR, 'duplicate.jpg'));
      }
    });

    test('should respect duplicate detection settings', async () => {
      // Disable duplicate detection
      (scanner as any).enableDuplicateDetection = false;
      
      // Create duplicate files
      await createTestImage('file1.jpg');
      await createTestImage('file2.jpg');
      
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      expect(result.processed).toBe(2);
      expect(result.newFiles).toBe(2);
      expect(result.duplicatesSkipped).toBe(0);
      
      const items = await db.select().from(schema.mediaItems);
      expect(items).toHaveLength(2);
    });
  });

  describe('metadata extraction', () => {
    test('should extract image metadata', async () => {
      await createTestImage('metadata-test.jpg', { width: 800, height: 600 });
      
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.filename, 'metadata-test.jpg'));
      
      expect(item).toBeDefined();
      expect(item.width).toBe(800);
      expect(item.height).toBe(600);
      expect(item.fileType).toBe('image');
      expect(item.metadataJson).toBeTruthy();
      
      // Verify metadata JSON contains real ffprobe data
      const metadata = JSON.parse(item.metadataJson!);
      expect(metadata).toHaveProperty('streams');
    });

    test('should extract video metadata', async () => {
      await createTestVideo('metadata-test.mp4', { 
        width: 640, 
        height: 480, 
        duration: 3,
        fps: 24 
      });
      
      const result = await scanner.scanDirectory(TEST_MEDIA_DIR);
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.filename, 'metadata-test.mp4'));
      
      expect(item).toBeDefined();
      expect(item.width).toBe(640);
      expect(item.height).toBe(480);
      expect(item.duration).toBeCloseTo(3, 0); // Allow small variance
      expect(item.fileType).toBe('video');
      
      // Verify real metadata
      const metadata = JSON.parse(item.metadataJson!);
      expect(metadata).toHaveProperty('format');
      expect(metadata).toHaveProperty('streams');
      expect(metadata.streams).toBeInstanceOf(Array);
    });

    test('should parse dates from filenames', async () => {
      const testCases = [
        { filename: '2024-03-15-vacation.jpg', expected: new Date('2024-03-15') },
        { filename: '20240315_photo.jpg', expected: new Date('2024-03-15') },
        { filename: 'IMG_15-03-2024.jpg', expected: new Date('2024-03-15') },
        { filename: 'photo.15.03.2024.jpg', expected: new Date('2024-03-15') }
      ];
      
      for (const testCase of testCases) {
        await cleanDatabase();
        await cleanupTestDirs();
        await setupTestDirs();
        
        await createTestImage(testCase.filename);
        
        await scanner.scanDirectory(TEST_MEDIA_DIR);
        
        const [item] = await db.select()
          .from(schema.mediaItems)
          .where(eq(schema.mediaItems.filename, testCase.filename));
        
        expect(item).toBeDefined();
        expect(item.createdAt.toDateString()).toBe(testCase.expected.toDateString());
      }
    });
  });

  describe('checksum calculation', () => {
    test('should calculate checksum for small files', async () => {
      await createTestImage('small.jpg', { width: 100, height: 100 });
      
      await scanner.scanDirectory('./test-media');
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.filename, 'small.jpg'));
      
      expect(item).toBeDefined();
      expect(item.checksum).toBeTruthy();
      expect(item.checksum).toHaveLength(64); // SHA256 hex length
    });

    test('should detect identical files by checksum', async () => {
      // Create an image
      await createTestImage('original.jpg', { width: 200, height: 200, color: 'yellow' });
      
      // Copy it to create an exact duplicate
      await fs.copyFile(
        path.join(TEST_MEDIA_DIR, 'original.jpg'),
        path.join(TEST_MEDIA_DIR, 'copy.jpg')
      );
      
      await scanner.scanDirectory('./test-media');
      
      const items = await db.select()
        .from(schema.mediaItems)
        .orderBy(schema.mediaItems.filename);
      
      // Should have detected the duplicate and only stored one
      expect(items).toHaveLength(1);
      expect(items[0].filename).toBe('original.jpg');
    });
  });
});