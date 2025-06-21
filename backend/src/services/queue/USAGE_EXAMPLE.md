# Task Queue Usage Examples

## Basic Usage (Backwards Compatible)

```typescript
// Using the refactored ThumbnailQueueService (same API as before)
import { thumbnailQueue } from './services/thumbnailQueue.refactored';

// Add thumbnails to queue
await thumbnailQueue.ping([123, 124, 125]);

// Get status
const status = thumbnailQueue.getStatus();
console.log(`Queue has ${status.queueSize} items, status: ${status.status}`);
```

## Advanced Usage (New Features)

### 1. Creating a Multi-Purpose Queue

```typescript
import { TaskQueue } from './services/queue/taskQueue';
import { ThumbnailProcessor } from './services/queue/processors/thumbnailProcessor';
import { VideoPreviewProcessor } from './services/queue/processors/exampleProcessors';
import { Task, TaskType, TaskPriority } from './services/queue/types';

// Create a queue that handles multiple task types
const mediaQueue = new TaskQueue({
  maxConcurrent: 4,
  batchSize: 10,
  debounceMs: 5000,
  cooldownMs: 30000
});

// Register processors
mediaQueue.registerProcessor(new ThumbnailProcessor());
mediaQueue.registerProcessor(new VideoPreviewProcessor());

// Add different types of tasks
await mediaQueue.addTask({
  id: 'thumb-123',
  type: TaskType.THUMBNAIL,
  priority: TaskPriority.HIGH,
  payload: { mediaId: 123 },
  createdAt: new Date()
});

await mediaQueue.addTask({
  id: 'preview-456',
  type: TaskType.VIDEO_PREVIEW,
  priority: TaskPriority.NORMAL,
  payload: { mediaId: 456, duration: 10 },
  createdAt: new Date()
});
```

### 2. Listening to Events

```typescript
// Progress tracking
mediaQueue.on('task:started', (task) => {
  console.log(`Starting ${task.type} for ${task.id}`);
});

mediaQueue.on('task:completed', (result) => {
  console.log(`Completed ${result.taskId}`, result.data);
});

mediaQueue.on('task:failed', (task, error) => {
  console.error(`Failed ${task.type}: ${error.message}`);
  // Could send to error tracking service
});

// Batch monitoring
mediaQueue.on('batch:complete', (results) => {
  const stats = {
    total: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length
  };
  console.log('Batch stats:', stats);
});

// Status monitoring
mediaQueue.on('status:change', (oldStatus, newStatus) => {
  console.log(`Queue status: ${oldStatus} → ${newStatus}`);
  // Could update UI or send notifications
});
```

### 3. Custom Task Processor

```typescript
import { Task, TaskProcessor, TaskResult, TaskType } from './types';

// Create a custom processor for any task type
class CustomProcessor implements TaskProcessor {
  readonly taskType = TaskType.METADATA_EXTRACTION;

  canProcess(task: Task): boolean {
    return task.type === this.taskType;
  }

  validatePayload(payload: any): boolean {
    // Add your validation logic
    return true;
  }

  async process(task: Task): Promise<TaskResult> {
    try {
      // Your processing logic here
      const result = await doSomething(task.payload);
      
      return {
        taskId: task.id,
        success: true,
        data: result
      };
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error.message
      };
    }
  }
}

// Register it
mediaQueue.registerProcessor(new CustomProcessor());
```

### 4. Priority Management

```typescript
// High priority tasks get processed first
await mediaQueue.addTask({
  id: 'urgent-thumb-789',
  type: TaskType.THUMBNAIL,
  priority: TaskPriority.URGENT, // Will be processed before NORMAL priority
  payload: { mediaId: 789 },
  createdAt: new Date()
});
```

### 5. Testing

```typescript
// In tests, you can process immediately without waiting
await mediaQueue.processNow(); // Bypasses debounce/cooldown

// Or mock processors
class MockThumbnailProcessor implements TaskProcessor {
  readonly taskType = TaskType.THUMBNAIL;
  
  canProcess(task: Task): boolean {
    return task.type === TaskType.THUMBNAIL;
  }
  
  async process(task: Task): Promise<TaskResult> {
    return {
      taskId: task.id,
      success: true,
      data: { mocked: true }
    };
  }
}
```

## Benefits of This Architecture

1. **Extensible**: Add new task types without modifying core queue logic
2. **Testable**: Mock processors, test queue logic separately
3. **Observable**: Rich event system for monitoring and integration
4. **Type-safe**: Full TypeScript support with proper types
5. **Backwards compatible**: Existing code continues to work
6. **Modular**: Each processor is independent and focused