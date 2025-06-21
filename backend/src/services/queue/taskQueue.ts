import { EventEmitter } from 'events';
import { 
  Task, 
  TaskProcessor, 
  TaskResult, 
  QueueConfig, 
  QueueStats, 
  QueueStatus,
  QueueEventEmitter,
  TaskPriority
} from './types';

export class TaskQueue extends EventEmitter implements QueueEventEmitter {
  private queue: Map<string, Task> = new Map();
  private processors: Map<string, TaskProcessor> = new Map();
  private status: QueueStatus = 'idle';
  private isProcessing = false;
  private lastPingTime: Date | null = null;
  private lastRunTime: Date | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private stats: QueueStats = {
    totalQueued: 0,
    processed: 0,
    failed: 0,
    skipped: 0,
    processing: 0
  };

  constructor(private config: QueueConfig) {
    super();
  }

  /**
   * Register a task processor
   */
  registerProcessor(processor: TaskProcessor): void {
    this.processors.set(processor.taskType, processor);
  }

  /**
   * Add a task to the queue
   */
  async addTask(task: Task): Promise<void> {
    // Check if we have a processor for this task type
    if (!this.processors.has(task.type)) {
      throw new Error(`No processor registered for task type: ${task.type}`);
    }

    // Validate payload if validator exists
    const processor = this.processors.get(task.type)!;
    if (processor.validatePayload && !processor.validatePayload(task.payload)) {
      throw new Error(`Invalid payload for task type: ${task.type}`);
    }

    // Add to queue
    this.queue.set(task.id, task);
    this.stats.totalQueued++;
    
    this.emit('task:added', task);
    
    // Schedule processing
    this.scheduleProcessing();
  }

  /**
   * Add multiple tasks at once
   */
  async addTasks(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      await this.addTask(task);
    }
  }

  /**
   * Get current queue status
   */
  getStatus(): {
    status: QueueStatus;
    queueSize: number;
    stats: QueueStats;
    lastPing: Date | null;
    lastRun: Date | null;
    nextRun: Date | null;
  } {
    let nextRun: Date | null = null;
    
    if (this.status === 'waiting' && this.lastPingTime) {
      nextRun = new Date(this.lastPingTime.getTime() + this.config.debounceMs);
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
    this.setStatus('idle');
  }

  /**
   * Process queue immediately (bypass debounce)
   */
  async processNow(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    await this.processQueue();
  }

  private scheduleProcessing(): void {
    this.lastPingTime = new Date();
    
    if (this.isProcessing) {
      return;
    }

    if (this.queue.size === 0) {
      this.setStatus('idle');
      return;
    }

    // Check cooldown
    if (this.lastRunTime) {
      const timeSinceLastRun = Date.now() - this.lastRunTime.getTime();
      if (timeSinceLastRun < this.config.cooldownMs) {
        this.setStatus('cooldown');
        
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          this.scheduleProcessing();
        }, this.config.cooldownMs - timeSinceLastRun);
        return;
      }
    }

    // Set up debounce
    this.setStatus('waiting');
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processQueue();
    }, this.config.debounceMs);
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.size === 0) {
      return;
    }

    this.isProcessing = true;
    this.setStatus('processing');
    this.lastRunTime = new Date();

    try {
      // Get tasks sorted by priority and creation time
      const tasks = Array.from(this.queue.values())
        .sort((a, b) => {
          if (a.priority !== b.priority) {
            return b.priority - a.priority; // Higher priority first
          }
          return a.createdAt.getTime() - b.createdAt.getTime(); // Older first
        })
        .slice(0, this.config.batchSize);

      this.emit('batch:start', tasks);

      // Process in chunks for concurrency control
      const chunks = this.chunkArray(tasks, this.config.maxConcurrent);
      const allResults: TaskResult[] = [];

      for (const chunk of chunks) {
        this.stats.processing = chunk.length;
        
        const results = await Promise.all(
          chunk.map(task => this.processTask(task))
        );
        
        allResults.push(...results);
        this.stats.processing = 0;
      }

      this.emit('batch:complete', allResults);

    } catch (error) {
      this.emit('error', error as Error);
    } finally {
      this.isProcessing = false;
      
      if (this.queue.size > 0) {
        this.scheduleProcessing();
      } else {
        this.setStatus('idle');
      }
    }
  }

  private async processTask(task: Task): Promise<TaskResult> {
    this.queue.delete(task.id);
    
    const processor = this.processors.get(task.type);
    if (!processor) {
      const result: TaskResult = {
        taskId: task.id,
        success: false,
        error: `No processor for task type: ${task.type}`,
        skipped: true
      };
      this.stats.skipped++;
      this.emit('task:skipped', task, result.error);
      return result;
    }

    try {
      this.emit('task:started', task);
      
      const result = await processor.process(task);
      
      if (result.success) {
        this.stats.processed++;
        this.emit('task:completed', result);
      } else if (result.skipped) {
        this.stats.skipped++;
        this.emit('task:skipped', task, result.error || 'Unknown reason');
      } else {
        this.stats.failed++;
        this.emit('task:failed', task, new Error(result.error || 'Unknown error'));
      }
      
      return result;
      
    } catch (error) {
      this.stats.failed++;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.emit('task:failed', task, error as Error);
      
      // Handle retry logic
      if (task.attempts && task.attempts < (this.config.maxRetries || 3)) {
        task.attempts++;
        task.lastError = errorMessage;
        this.queue.set(task.id, task); // Re-add to queue
      }
      
      return {
        taskId: task.id,
        success: false,
        error: errorMessage
      };
    }
  }

  private setStatus(newStatus: QueueStatus): void {
    if (this.status !== newStatus) {
      const oldStatus = this.status;
      this.status = newStatus;
      this.emit('status:change', oldStatus, newStatus);
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