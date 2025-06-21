import './test-env'; // Must be first import
import { describe, test, expect, beforeEach, afterAll, beforeAll } from 'bun:test';
import { ThumbnailGenerator } from '../src/services/thumbnail';
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
  TEST_THUMBNAILS_DIR
} from './setup';

describe('ThumbnailGenerator', () => {
  let generator: ThumbnailGenerator;

  // Check ffmpeg is available
  beforeAll(async () => {
    try {
      await $`which ffmpeg`.quiet();
    } catch {
      console.error('\n⚠️  FFmpeg not found! Please install ffmpeg to run tests.\n');
      process.exit(1);
    }
  });

  beforeEach(async () => {
    await cleanDatabase();
    await cleanupTestDirs(); // Clean before setup to ensure fresh state
    await setupTestDirs();
    generator = new ThumbnailGenerator(TEST_THUMBNAILS_DIR);
  });

  afterAll(async () => {
    await cleanupTestDirs();
  });

  describe('image thumbnails', () => {
    test('should generate thumbnail for image', async () => {
      // Create a real test image
      const imagePath = await createTestImage('test-photo.jpg', { 
        width: 3000, 
        height: 2000,
        color: 'orange'
      });
      
      // Create media record
      const media = await insertTestMedia({
        filepath: imagePath,
        filename: 'test-photo.jpg',
        fileType: 'image',
        width: 3000,
        height: 2000
      });
      
      // Generate thumbnail
      const result = await generator.generateThumbnail(media.id);
      
      expect(result.success).toBe(true);
      expect(result.path).toContain(`${media.id}.jpg`);
      
      // Verify thumbnail file exists
      const thumbnailPath = path.join(TEST_THUMBNAILS_DIR, `${media.id}.jpg`);
      const exists = await fs.access(thumbnailPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      // Verify thumbnail dimensions using ffprobe
      const probeResult = await $`ffprobe -v quiet -print_format json -show_streams ${thumbnailPath}`.json();
      const stream = probeResult.streams[0];
      
      // Should be resized to max 300px on longest side
      expect(Math.max(stream.width, stream.height)).toBeLessThanOrEqual(300);
      
      // Verify database was updated
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      expect(updated.thumbnailGenerated).toBe(true);
    });

    test('should handle portrait images correctly', async () => {
      const imagePath = await createTestImage('portrait.jpg', { 
        width: 1080, 
        height: 1920,
        color: 'purple'
      });
      
      const media = await insertTestMedia({
        filepath: imagePath,
        filename: 'portrait.jpg',
        fileType: 'image',
        width: 1080,
        height: 1920
      });
      
      const result = await generator.generateThumbnail(media.id);
      expect(result.success).toBe(true);
      
      // Check thumbnail maintains aspect ratio
      const thumbnailPath = path.join(TEST_THUMBNAILS_DIR, `${media.id}.jpg`);
      const probeResult = await $`ffprobe -v quiet -print_format json -show_streams ${thumbnailPath}`.json();
      const stream = probeResult.streams[0];
      
      expect(stream.height).toBeGreaterThanOrEqual(stream.width);
      expect(Math.max(stream.width, stream.height)).toBeLessThanOrEqual(300);
    });
  });

  describe('video thumbnails', () => {
    test('should generate thumbnail for video at 10% duration', async () => {
      // Create a real test video
      const videoPath = await createTestVideo('test-video.mp4', { 
        duration: 10,
        width: 1920,
        height: 1080
      });
      
      const media = await insertTestMedia({
        filepath: videoPath,
        filename: 'test-video.mp4',
        fileType: 'video',
        width: 1920,
        height: 1080,
        duration: 10
      });
      
      const result = await generator.generateThumbnail(media.id);
      
      expect(result.success).toBe(true);
      
      // Verify thumbnail exists
      const thumbnailPath = path.join(TEST_THUMBNAILS_DIR, `${media.id}.jpg`);
      const exists = await fs.access(thumbnailPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      
      // Verify it's a valid image
      const probeResult = await $`ffprobe -v quiet -print_format json -show_streams ${thumbnailPath}`.json();
      expect(probeResult.streams).toHaveLength(1);
      expect(probeResult.streams[0].codec_type).toBe('video');
    });

    test('should handle short videos', async () => {
      const videoPath = await createTestVideo('short.mp4', { 
        duration: 1,
        width: 640,
        height: 480
      });
      
      const media = await insertTestMedia({
        filepath: videoPath,
        filename: 'short.mp4',
        fileType: 'video',
        duration: 1
      });
      
      const result = await generator.generateThumbnail(media.id);
      expect(result.success).toBe(true);
    });
  });

  describe('error handling', () => {
    test('should handle missing files gracefully', async () => {
      const media = await insertTestMedia({
        filepath: '/non/existent/file.jpg',
        fileType: 'image'
      });
      
      const result = await generator.generateThumbnail(media.id);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('should handle invalid media records', async () => {
      const result = await generator.generateThumbnail(99999);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('batch generation', () => {
    test('should generate missing thumbnails', async () => {
      // Create multiple media files
      const files = await Promise.all([
        createTestImage('batch1.jpg', { color: 'red' }),
        createTestImage('batch2.jpg', { color: 'green' }),
        createTestImage('batch3.jpg', { color: 'blue' })
      ]);
      
      // Insert media records
      for (const filepath of files) {
        await insertTestMedia({
          filepath,
          filename: path.basename(filepath),
          fileType: 'image',
          thumbnailGenerated: false
        });
      }
      
      // Generate all missing thumbnails
      const count = await generator.generateMissingThumbnails();
      
      expect(count).toBe(3);
      
      // Verify all thumbnails were created
      const items = await db.select().from(schema.mediaItems);
      const allGenerated = items.every(item => item.thumbnailGenerated);
      expect(allGenerated).toBe(true);
      
      // Verify files exist
      for (const item of items) {
        const thumbnailPath = path.join(TEST_THUMBNAILS_DIR, `${item.id}.jpg`);
        const exists = await fs.access(thumbnailPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      }
    });
  });
});