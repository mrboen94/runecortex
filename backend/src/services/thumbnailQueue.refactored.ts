import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { TaskQueue } from './queue/taskQueue';
import { Task, TaskType, TaskPriority, QueueConfig } from './queue/types';
import { ThumbnailProcessor } from './queue/processors/thumbnailProcessor';
import { v4 as uuidv4 } from 'uuid';

/**
 * Refactored ThumbnailQueueService that uses the generic TaskQueue
 * This maintains the same public API but uses the new extensible architecture
 */
export class ThumbnailQueueService {
  private taskQueue: TaskQueue;
  private thumbnailProcessor: ThumbnailProcessor;

  constructor() {
    // Configure the queue
    const config: QueueConfig = {
      maxConcurrent: parseInt(process.env.THUMBNAIL_MAX_CONCURRENT || '4'),
      batchSize: parseInt(process.env.THUMBNAIL_BATCH_SIZE || '20'),
      debounceMs: parseInt(process.env.THUMBNAIL_DEBOUNCE_MINUTES || '1') * 60 * 1000,
      cooldownMs: parseInt(process.env.THUMBNAIL_COOLDOWN_MINUTES || '5') * 60 * 1000,
      maxRetries: 3
    };

    // Create queue and processor
    this.taskQueue = new TaskQueue(config);
    this.thumbnailProcessor = new ThumbnailProcessor();
    
    // Register the processor
    this.taskQueue.registerProcessor(this.thumbnailProcessor);

    // Set up event listeners for backwards compatibility
    this.setupEventListeners();
    
    console.log('ThumbnailQueue initialized with config:', config);
  }

  /**
   * Add items to the queue - maintains original API
   */
  async ping(mediaIds?: number[]): Promise<{ status: string; queued: number; queueSize: number }> {
    // If no specific IDs, find all items needing thumbnails
    if (!mediaIds || mediaIds.length === 0) {
      const itemsNeedingThumbnails = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.thumbnailGenerated, false))
        .limit(1000);
      
      mediaIds = itemsNeedingThumbnails.map(item => item.id);
    }

    // Convert to tasks
    const tasks: Task[] = mediaIds.map(mediaId => ({
      id: `thumbnail-${mediaId}-${uuidv4()}`,
      type: TaskType.THUMBNAIL,
      priority: TaskPriority.NORMAL,
      payload: { mediaId },
      createdAt: new Date(),
      attempts: 0
    }));

    // Add to queue
    await this.taskQueue.addTasks(tasks);

    const status = this.taskQueue.getStatus();
    return {
      status: status.status,
      queued: tasks.length,
      queueSize: status.queueSize
    };
  }

  /**
   * Get current queue status - maintains original API
   */
  getStatus() {
    return this.taskQueue.getStatus();
  }

  /**
   * Clear the queue - maintains original API
   */
  clear(): void {
    this.taskQueue.clear();
  }

  /**
   * Clear the queue (alias for compatibility)
   */
  clearQueue(): boolean {
    this.clear();
    return true;
  }

  /**
   * Process queue immediately (useful for testing)
   */
  async processNow(): Promise<void> {
    await this.taskQueue.processNow();
  }

  /**
   * Get the underlying task queue for advanced usage
   */
  getTaskQueue(): TaskQueue {
    return this.taskQueue;
  }

  private setupEventListeners(): void {
    // Log events for debugging
    this.taskQueue.on('task:completed', (result) => {
      console.log(`Thumbnail generated successfully: ${result.taskId}`);
    });

    this.taskQueue.on('task:failed', (task, error) => {
      console.error(`Thumbnail generation failed for ${task.id}:`, error.message);
    });

    this.taskQueue.on('task:skipped', (task, reason) => {
      console.log(`Thumbnail skipped for ${task.id}: ${reason}`);
    });

    this.taskQueue.on('batch:complete', (results) => {
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      
      console.log(`ThumbnailQueue: Batch complete. Processed: ${successful}, Skipped: ${skipped}, Failed: ${failed}`);
    });

    this.taskQueue.on('status:change', (oldStatus, newStatus) => {
      console.log(`ThumbnailQueue: Status changed from ${oldStatus} to ${newStatus}`);
    });
  }
}

// Export singleton instance for backwards compatibility
export const thumbnailQueue = new ThumbnailQueueService();