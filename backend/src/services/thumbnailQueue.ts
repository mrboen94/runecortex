import { db, schema } from '../db';
import { eq, isNull } from 'drizzle-orm';
import { ThumbnailGenerator } from './thumbnail';

interface QueueItem {
  mediaId: number;
  priority: number;
  addedAt: Date;
}

export type QueueStatus = 'idle' | 'waiting' | 'busy';

interface QueueConfig {
  debounceSeconds: number;      // Wait time after last ping before starting
  cooldownSeconds: number;      // Minimum time between runs
  maxConcurrent: number;        // Max parallel thumbnail generations
  batchSize: number;            // How many to process per batch
  batchWaitSeconds: number;     // Wait time between batches in seconds
}

export class ThumbnailQueueService {
  private queue: Map<number, QueueItem> = new Map();
  private generator = new ThumbnailGenerator();
  private status: QueueStatus = 'idle';
  private lastPingTime: Date | null = null;
  private lastRunTime: Date | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private config: QueueConfig;
  private stats = {
    totalQueued: 0,
    processed: 0,
    failed: 0,
    skipped: 0
  };

  constructor() {
    this.config = {
      debounceSeconds: parseInt(process.env.THUMBNAIL_DEBOUNCE_SECONDS || '5'),
      cooldownSeconds: parseInt(process.env.THUMBNAIL_COOLDOWN_SECONDS || '0'),
      maxConcurrent: parseInt(process.env.THUMBNAIL_MAX_CONCURRENT || '8'),
      batchSize: parseInt(process.env.THUMBNAIL_BATCH_SIZE || '50'),
      batchWaitSeconds: parseInt(process.env.THUMBNAIL_BATCH_WAIT_SECONDS || '0')
    };

    console.log('ThumbnailQueue initialized with config:', this.config);
  }

  /**
   * Add items to the queue - called by watcher or other services
   */
  async ping(mediaIds?: number[]): Promise<{ status: QueueStatus; queued: number }> {
    this.lastPingTime = new Date();

    // If no specific IDs, find all items needing thumbnails
    if (!mediaIds || mediaIds.length === 0) {
      const itemsNeedingThumbnails = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.thumbnailGenerated, false))
        .limit(1000);
      
      mediaIds = itemsNeedingThumbnails.map(item => item.id);
    }

    // Add to queue
    let added = 0;
    for (const mediaId of mediaIds) {
      if (!this.queue.has(mediaId)) {
        this.queue.set(mediaId, {
          mediaId,
          priority: 1,
          addedAt: new Date()
        });
        added++;
      }
    }

    this.stats.totalQueued += added;
    console.log(`ThumbnailQueue: Added ${added} items to queue. Total in queue: ${this.queue.size}`);

    // Update status and schedule processing
    this.updateStatusAndSchedule();

    return {
      status: this.status,
      queued: this.queue.size,
      queueSize: this.queue.size
    };
  }

  /**
   * Get current queue status
   */
  getStatus(): { 
    status: QueueStatus; 
    queueSize: number; 
    stats: typeof this.stats;
    lastPing: Date | null;
    lastRun: Date | null;
    nextRun: Date | null;
  } {
    let nextRun: Date | null = null;
    
    if (this.status === 'waiting' && this.lastPingTime) {
      nextRun = new Date(this.lastPingTime.getTime() + this.config.debounceSeconds * 1000);
    }

    return {
      status: this.status,
      queueSize: this.queue.size,
      stats: { ...this.stats },
      lastPing: this.lastPingTime,
      lastRun: this.lastRunTime,
      nextRun
    };
  }

  /**
   * Clear the queue
   */
  clear(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.queue.clear();
    this.status = 'idle';
    console.log('ThumbnailQueue: Queue cleared');
  }

  /**
   * Clear the queue (alias for compatibility)
   */
  clearQueue(): boolean {
    this.clear();
    return true;
  }

  private updateStatusAndSchedule(): void {
    if (this.isProcessing) {
      this.status = 'busy';
      return;
    }

    if (this.queue.size === 0) {
      this.status = 'idle';
      return;
    }

    // Check cooldown
    if (this.lastRunTime) {
      const timeSinceLastRun = Date.now() - this.lastRunTime.getTime();
      const cooldownMs = this.config.cooldownSeconds * 1000;
      
      if (timeSinceLastRun < cooldownMs) {
        console.log(`ThumbnailQueue: In cooldown. ${Math.ceil((cooldownMs - timeSinceLastRun) / 1000)}s remaining`);
        this.status = 'waiting';
        
        // Schedule after cooldown
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.updateStatusAndSchedule();
        }, cooldownMs - timeSinceLastRun);
        return;
      }
    }

    // Set up debounce timer
    this.status = 'waiting';
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const debounceMs = this.config.debounceSeconds * 1000;
    console.log(`ThumbnailQueue: Waiting ${this.config.debounceSeconds} second(s) before processing...`);
    
    this.debounceTimer = setTimeout(() => {
      this.processQueue();
    }, debounceMs);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.size === 0) {
      return;
    }

    this.isProcessing = true;
    this.status = 'busy';
    this.lastRunTime = new Date();
    
    console.log(`ThumbnailQueue: Starting processing of ${this.queue.size} items`);
    
    // Reset batch stats
    const batchStats = {
      processed: 0,
      failed: 0,
      skipped: 0
    };

    try {
      // Process in batches
      const items = Array.from(this.queue.values())
        .sort((a, b) => b.priority - a.priority || a.addedAt.getTime() - b.addedAt.getTime())
        .slice(0, this.config.batchSize);

      // Create worker pool using Promise.all with concurrency limit
      const chunks = this.chunkArray(items, this.config.maxConcurrent);
      
      for (const chunk of chunks) {
        const results = await Promise.all(
          chunk.map(item => this.processSingleItem(item))
        );

        results.forEach(result => {
          if (result.success) {
            batchStats.processed++;
          } else if (result.skipped) {
            batchStats.skipped++;
          } else {
            batchStats.failed++;
          }
        });
      }

      // Update global stats
      this.stats.processed += batchStats.processed;
      this.stats.failed += batchStats.failed;
      this.stats.skipped += batchStats.skipped;

      console.log(`ThumbnailQueue: Batch complete. Processed: ${batchStats.processed}, Skipped: ${batchStats.skipped}, Failed: ${batchStats.failed}`);

    } catch (error) {
      console.error('ThumbnailQueue: Fatal error during processing:', error);
    } finally {
      this.isProcessing = false;
      
      // Check if there are more items to process
      if (this.queue.size > 0) {
        console.log(`ThumbnailQueue: ${this.queue.size} items remaining in queue, waiting ${this.config.batchWaitSeconds}s before next batch`);
        
        // Wait between batches to avoid overwhelming the system
        setTimeout(() => {
          this.updateStatusAndSchedule();
        }, this.config.batchWaitSeconds * 1000);
      } else {
        this.status = 'idle';
        console.log('ThumbnailQueue: Queue empty, returning to idle');
      }
    }
  }

  private async processSingleItem(item: QueueItem): Promise<{ success: boolean; skipped: boolean }> {
    try {
      // Remove from queue immediately
      this.queue.delete(item.mediaId);

      // Check if thumbnail already exists
      const [mediaItem] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, item.mediaId))
        .limit(1);

      if (!mediaItem) {
        console.log(`ThumbnailQueue: Media item ${item.mediaId} not found`);
        return { success: false, skipped: true };
      }

      if (mediaItem.thumbnailGenerated) {
        return { success: false, skipped: true };
      }

      // Generate thumbnail
      const result = await this.generator.generateForMediaItem(item.mediaId);
      
      if (result) {
        console.log(`ThumbnailQueue: Generated thumbnail for ${mediaItem.filename}`);
        return { success: true, skipped: false };
      } else {
        console.error(`ThumbnailQueue: Failed to generate thumbnail for ${mediaItem.filename}`);
        return { success: false, skipped: false };
      }

    } catch (error) {
      console.error(`ThumbnailQueue: Error processing item ${item.mediaId}:`, error);
      return { success: false, skipped: false };
    }
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

// Export singleton instance
export const thumbnailQueue = new ThumbnailQueueService();