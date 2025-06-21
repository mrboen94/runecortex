import './test-env'; // Must be first import
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { ThumbnailQueueService } from '../src/services/thumbnailQueue';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { 
  cleanDatabase, 
  setupTestDirs, 
  cleanupTestDirs,
  insertTestMedia,
  waitForCondition,
  IMMEDIATE_MODE_NOTE
} from './setup';

describe('ThumbnailQueue', () => {
  let queue: ThumbnailQueueService;

  beforeEach(async () => {
    await cleanDatabase();
    await setupTestDirs();
    
    // Create queue with short timings for testing
    process.env.THUMBNAIL_DEBOUNCE_MINUTES = '0.01'; // 0.6 seconds
    process.env.THUMBNAIL_COOLDOWN_MINUTES = '0.02'; // 1.2 seconds
    process.env.THUMBNAIL_MAX_CONCURRENT = '2';
    process.env.THUMBNAIL_BATCH_SIZE = '5';
    
    queue = new ThumbnailQueueService();
  });

  afterAll(async () => {
    await cleanupTestDirs();
    // Clean up env vars
    delete process.env.THUMBNAIL_DEBOUNCE_MINUTES;
    delete process.env.THUMBNAIL_COOLDOWN_MINUTES;
    delete process.env.THUMBNAIL_MAX_CONCURRENT;
    delete process.env.THUMBNAIL_BATCH_SIZE;
  });

  describe('queue management', () => {
    test('should add items to queue', async () => {
      const media1 = await insertTestMedia({ filename: 'test1.jpg' });
      const media2 = await insertTestMedia({ filename: 'test2.jpg' });
      
      const status = await queue.ping([media1.id, media2.id]);
      
      expect(status.queueSize).toBe(2);
      expect(status.status).toBe('waiting');
    });

    test('should prevent duplicate items in queue', async () => {
      const media = await insertTestMedia();
      
      await queue.ping([media.id]);
      const status = await queue.ping([media.id]);
      
      expect(status.queueSize).toBe(1); // Should still be 1, not 2
    });

    test('should clear queue', async () => {
      const media1 = await insertTestMedia({ filename: 'test1.jpg' });
      const media2 = await insertTestMedia({ filename: 'test2.jpg' });
      
      await queue.ping([media1.id, media2.id]);
      const cleared = await queue.clearQueue();
      
      expect(cleared).toBe(true);
      
      const status = queue.getStatus();
      expect(status.queueSize).toBe(0);
    });

    test('should get queue status', () => {
      const status = queue.getStatus();
      
      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('queueSize');
      expect(status).toHaveProperty('stats');
      expect(status.stats).toHaveProperty('totalQueued');
      expect(status.stats).toHaveProperty('processed');
      expect(status.stats).toHaveProperty('failed');
      expect(status.stats).toHaveProperty('skipped');
    });
  });

  describe('debouncing and cooldown', () => {
    test('should debounce rapid pings', async () => {
      const media = await insertTestMedia();
      
      // Rapid pings
      await queue.ping([media.id]);
      await queue.ping([media.id]);
      await queue.ping([media.id]);
      
      const status = queue.getStatus();
      expect(status.status).toBe('waiting');
      expect(status.lastPing).toBeTruthy();
    });

    test('should wait for debounce period before processing', async () => {
      const media = await insertTestMedia();
      
      const beforeStatus = await queue.ping([media.id]);
      expect(beforeStatus.status).toBe('waiting');
      
      // Wait for debounce period
      await new Promise(resolve => setTimeout(resolve, 700));
      
      const afterStatus = queue.getStatus();
      expect(['busy', 'cooldown']).toContain(afterStatus.status);
    });

    test('should enter cooldown after processing', async () => {
      const media = await insertTestMedia();
      
      // Mock the worker to complete immediately
      const originalWorker = queue['runWorker'];
      queue['runWorker'] = async function(this: any) {
        this.stats.processed = 1;
        this.activeWorkers--;
      };
      
      await queue.ping([media.id]);
      
      // Wait for processing
      await waitForCondition(
        async () => queue.getStatus().status === 'cooldown',
        2000
      );
      
      const status = queue.getStatus();
      expect(status.status).toBe('cooldown');
      
      // Restore original worker
      queue['runWorker'] = originalWorker;
    });
  });

  describe('batch processing', () => {
    test('should process items in batches', async () => {
      // Create multiple media items
      const mediaIds = [];
      for (let i = 0; i < 10; i++) {
        const media = await insertTestMedia({ filename: `batch${i}.jpg` });
        mediaIds.push(media.id);
      }
      
      // Mock worker to track batches
      let batchCount = 0;
      const originalWorker = queue['runWorker'];
      queue['runWorker'] = async function(this: any) {
        batchCount++;
        const batch = this.queue.splice(0, this.config.batchSize);
        this.stats.processed += batch.length;
        this.activeWorkers--;
      };
      
      await queue.ping(mediaIds);
      
      // Wait for processing
      await waitForCondition(
        async () => queue.getStatus().stats.processed === 10,
        3000
      );
      
      expect(batchCount).toBe(2); // 10 items / 5 batch size = 2 batches
      
      // Restore original worker
      queue['runWorker'] = originalWorker;
    });

    test('should respect max concurrent workers', async () => {
      // Create media items
      const mediaIds = [];
      for (let i = 0; i < 20; i++) {
        const media = await insertTestMedia({ filename: `concurrent${i}.jpg` });
        mediaIds.push(media.id);
      }
      
      // Track max concurrent workers
      let maxConcurrent = 0;
      const originalWorker = queue['runWorker'];
      queue['runWorker'] = async function(this: any) {
        maxConcurrent = Math.max(maxConcurrent, this.activeWorkers);
        
        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const batch = this.queue.splice(0, this.config.batchSize);
        this.stats.processed += batch.length;
        this.activeWorkers--;
      };
      
      await queue.ping(mediaIds);
      
      // Wait for some processing
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      expect(maxConcurrent).toBeLessThanOrEqual(2); // Max concurrent = 2
      
      // Restore original worker
      queue['runWorker'] = originalWorker;
    });
  });

  describe('error handling', () => {
    test('should handle worker errors gracefully', async () => {
      const media = await insertTestMedia();
      
      // Mock worker to throw error
      const originalWorker = queue['runWorker'];
      queue['runWorker'] = async function(this: any) {
        const batch = this.queue.splice(0, 1);
        this.stats.failed += batch.length;
        this.activeWorkers--;
        throw new Error('Worker error');
      };
      
      await queue.ping([media.id]);
      
      // Wait for processing
      await waitForCondition(
        async () => queue.getStatus().stats.failed > 0,
        2000
      );
      
      const status = queue.getStatus();
      expect(status.stats.failed).toBe(1);
      
      // Restore original worker
      queue['runWorker'] = originalWorker;
    });

    test('should skip already processed items', async () => {
      const media = await insertTestMedia({ thumbnailGenerated: true });
      
      // Track skipped items
      const originalWorker = queue['runWorker'];
      queue['runWorker'] = async function(this: any) {
        const batch = this.queue.splice(0, this.config.batchSize);
        
        for (const id of batch) {
          const [item] = await db.select()
            .from(schema.mediaItems)
            .where(eq(schema.mediaItems.id, id));
          
          if (item?.thumbnailGenerated) {
            this.stats.skipped++;
          } else {
            this.stats.processed++;
          }
        }
        
        this.activeWorkers--;
      };
      
      await queue.ping([media.id]);
      
      // Wait for processing
      await waitForCondition(
        async () => queue.getStatus().stats.skipped > 0,
        2000
      );
      
      const status = queue.getStatus();
      expect(status.stats.skipped).toBe(1);
      
      // Restore original worker
      queue['runWorker'] = originalWorker;
    });
  });

  describe('immediate mode (TODO)', () => {
    test.skip('should process immediately when in immediate mode', async () => {
      // TODO: Implement immediate mode for tethered shooting
      console.log(IMMEDIATE_MODE_NOTE);
      
      process.env.THUMBNAIL_IMMEDIATE_MODE = 'true';
      const immediateQueue = new ThumbnailQueueService();
      
      const media = await insertTestMedia();
      await immediateQueue.ping([media.id]);
      
      // Should start processing immediately without debounce
      const status = immediateQueue.getStatus();
      expect(status.status).toBe('busy');
      
      delete process.env.THUMBNAIL_IMMEDIATE_MODE;
    });
  });

  describe('statistics', () => {
    test('should track processing statistics', async () => {
      const mediaIds = [];
      for (let i = 0; i < 5; i++) {
        const media = await insertTestMedia({ 
          filename: `stats${i}.jpg`,
          thumbnailGenerated: i % 2 === 0 // Some already have thumbnails
        });
        mediaIds.push(media.id);
      }
      
      // Mock worker
      const originalWorker = queue['runWorker'];
      queue['runWorker'] = async function(this: any) {
        const batch = this.queue.splice(0, this.config.batchSize);
        
        for (const id of batch) {
          const [item] = await db.select()
            .from(schema.mediaItems)
            .where(eq(schema.mediaItems.id, id));
          
          if (item?.thumbnailGenerated) {
            this.stats.skipped++;
          } else {
            this.stats.processed++;
            // Update database
            await db.update(schema.mediaItems)
              .set({ thumbnailGenerated: true })
              .where(eq(schema.mediaItems.id, id));
          }
        }
        
        this.activeWorkers--;
      };
      
      await queue.ping(mediaIds);
      
      // Wait for processing
      await waitForCondition(
        async () => {
          const stats = queue.getStatus().stats;
          return stats.processed + stats.skipped === 5;
        },
        3000
      );
      
      const finalStats = queue.getStatus().stats;
      expect(finalStats.totalQueued).toBe(5);
      expect(finalStats.processed).toBe(2); // Odd indexed items
      expect(finalStats.skipped).toBe(3); // Even indexed items
      expect(finalStats.failed).toBe(0);
      
      // Restore original worker
      queue['runWorker'] = originalWorker;
    });
  });
});