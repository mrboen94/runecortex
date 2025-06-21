# ThumbnailQueue Migration Guide

## Summary of Changes

The ThumbnailQueue has been refactored to use a generic, extensible task queue architecture. The public API remains the same, but the internal implementation is now modular and extensible.

## What Changed

1. **New generic TaskQueue system** in `src/services/queue/`
2. **Task processors** are now separate, pluggable components
3. **Event-driven architecture** for monitoring and extensibility
4. **Type-safe task definitions** with proper TypeScript support

## Migration Steps

### 1. Update Import Path (When Ready)

```typescript
// Old
import { thumbnailQueue } from './services/thumbnailQueue';

// New (when ready to switch)
import { thumbnailQueue } from './services/thumbnailQueue.refactored';
```

### 2. No API Changes Required

All existing code will continue to work:

```typescript
// These all work exactly the same
await thumbnailQueue.ping([123, 124, 125]);
const status = thumbnailQueue.getStatus();
thumbnailQueue.clear();
```

### 3. Optional: Use New Features

```typescript
// Access the underlying task queue for events
const taskQueue = thumbnailQueue.getTaskQueue();

taskQueue.on('task:completed', (result) => {
  console.log('Thumbnail done:', result);
});

taskQueue.on('status:change', (oldStatus, newStatus) => {
  console.log(`Status: ${oldStatus} → ${newStatus}`);
});
```

## Testing Changes

### Old Test Approach (Won't Work)
```typescript
// DON'T DO THIS - No longer possible
queue['runWorker'] = mockFunction; // Private method doesn't exist
queue['queue'].splice(0, 5); // Internal structure changed
```

### New Test Approach
```typescript
// DO THIS - Use public API and events
const queue = new ThumbnailQueueService();

// Listen for events
const completedTasks: TaskResult[] = [];
queue.getTaskQueue().on('task:completed', (result) => {
  completedTasks.push(result);
});

// Add tasks and process
await queue.ping([1, 2, 3]);
await queue.processNow(); // Process immediately for tests

// Assert on results
expect(completedTasks).toHaveLength(3);
```

## Benefits of Migration

1. **Extensibility**: Can now add video previews, metadata extraction, etc.
2. **Better Testing**: Event-based testing instead of mocking internals
3. **Monitoring**: Rich events for tracking progress and errors
4. **Type Safety**: Full TypeScript support throughout
5. **Modularity**: Each task type is independent

## Next Steps

1. **Keep using old version** until ready to migrate
2. **Test the refactored version** in development
3. **Update imports** when confident
4. **Remove old implementation** after migration

## Adding New Task Types

```typescript
// 1. Define the processor
class MyProcessor implements TaskProcessor {
  readonly taskType = TaskType.MY_TYPE;
  
  async process(task: Task): Promise<TaskResult> {
    // Your logic here
  }
}

// 2. Register it
const queue = new TaskQueue(config);
queue.registerProcessor(new MyProcessor());

// 3. Use it
await queue.addTask({
  id: 'my-task-1',
  type: TaskType.MY_TYPE,
  priority: TaskPriority.NORMAL,
  payload: { /* your data */ },
  createdAt: new Date()
});
```

## Timeline

1. **Now**: Both implementations co-exist
2. **Testing phase**: Validate refactored version
3. **Migration**: Update imports across codebase
4. **Cleanup**: Remove old implementation

The refactored version is ready to use but not required until you're ready to migrate.