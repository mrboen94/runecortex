# ThumbnailQueue Refactoring Requirements

## ⚠️ WARNING: Current Architecture Issues

The current ThumbnailQueue implementation has **tight coupling** and **mixed concerns** that will make future refactoring increasingly difficult as features are added.

## Why Tests Are Failing

The ThumbnailQueue tests are failing because they expect an internal architecture that doesn't match the current implementation. The tests are trying to:

1. **Mock private methods** (`runWorker`) that don't exist in the current implementation
2. **Access internal state** (`activeWorkers`, `queue` array) that isn't exposed
3. **Manipulate queue internals** directly (e.g., `this.queue.splice()`)
4. **Expect specific state transitions** that don't align with the actual state machine

## Current Architecture vs Test Expectations

### What Tests Expect:
```typescript
// Tests expect this internal structure:
class ThumbnailQueueService {
  private queue: number[]; // Simple array of IDs
  private activeWorkers: number;
  private runWorker(): Promise<void>; // Worker method that can be mocked
  // Direct manipulation of queue array
}
```

### What Actually Exists:
```typescript
// Current implementation uses:
class ThumbnailQueueService {
  private queue: Map<number, QueueItem>; // Map structure, not array
  private isProcessing: boolean; // Single flag, not worker count
  private processQueue(): Promise<void>; // Different processing model
  private processSingleItem(): Promise<void>; // Item-level processing
}
```

## Key Architectural Mismatches

### 1. Worker Model
- **Tests expect**: Multiple concurrent workers with tracking (`activeWorkers`)
- **Implementation has**: Single processing flag with batch chunking
- **Issue**: Tests try to mock `runWorker` which doesn't exist

### 2. Queue Structure
- **Tests expect**: Simple array that can be spliced
- **Implementation has**: Map structure for O(1) duplicate checking
- **Issue**: Tests try to directly manipulate queue internals

### 3. State Management
- **Tests expect**: Direct state manipulation and immediate state changes
- **Implementation has**: State managed through debouncing and timers
- **Issue**: Timing-based tests are fragile and race-prone

### 4. Processing Model
- **Tests expect**: Worker-based concurrent processing
- **Implementation has**: Sequential batch processing with Promise.all chunks

## Required Refactoring

### Option 1: Fix the Tests (Recommended for now)
Since ThumbnailQueue isn't needed in the current iteration, the simplest approach is to:

1. **Remove internal mocking** - Don't mock private methods
2. **Use public API only** - Test through `ping()`, `getStatus()`, etc.
3. **Remove timing dependencies** - Use completion callbacks or status polling
4. **Accept implementation details** - Don't test HOW it works, test WHAT it does

### Option 2: Refactor Implementation (Future work)
If the queue becomes important later:

1. **Expose worker abstraction**:
   ```typescript
   interface QueueWorker {
     process(items: QueueItem[]): Promise<ProcessResult>;
   }
   ```

2. **Make queue observable**:
   ```typescript
   class ThumbnailQueueService extends EventEmitter {
     on('item-processed', callback);
     on('batch-complete', callback);
   }
   ```

3. **Add test hooks**:
   ```typescript
   class ThumbnailQueueService {
     // Test-only methods
     _getQueueSize(): number;
     _getProcessingCount(): number;
     _waitForIdle(): Promise<void>;
   }
   ```

4. **Separate concerns**:
   - Queue management (add/remove/prioritize)
   - Processing orchestration (debounce/cooldown/concurrency)
   - Thumbnail generation (actual work)

## Why This Isn't Critical Now

1. **Feature not required**: Thumbnail queue is an optimization, not core functionality
2. **Manual generation works**: Thumbnails can be generated on-demand
3. **Background processing optional**: Can be added later when needed
4. **Tests are integration-heavy**: Testing timing and concurrency is inherently complex

## Current Architecture Problems That Will Get Worse

### 1. **Tight Coupling**
- Queue management is tightly coupled to thumbnail generation
- Database queries mixed with queue logic
- State management mixed with processing logic
- Timer management mixed with business logic

### 2. **No Abstraction Layers**
```typescript
// Current: Direct coupling
private async processSingleItem(item: QueueItem) {
  const result = await this.generator.generateForMediaItem(item.mediaId);
  // Direct DB access, direct generator access
}

// Future problem: What if we want to queue other tasks?
// Video transcoding? Metadata extraction? AI tagging?
```

### 3. **Hard-coded Assumptions**
- Assumes only thumbnail generation
- Assumes specific database schema
- Assumes single task type
- No plugin/extension points

### 4. **State Management Issues**
- Internal state not observable
- No event system
- Can't add middleware or hooks
- Testing requires mocking internals

## Impact of Adding Features Before Refactoring

### If we add features now:
1. **Video preview generation** → More coupling to ThumbnailQueue
2. **Metadata extraction queue** → Duplicate queue implementation
3. **AI tagging queue** → Another duplicate implementation
4. **Priority system** → Requires touching every method
5. **Progress reporting** → No clean way to add

Each feature will:
- Add more if/else branches
- Increase method complexity
- Make the class larger
- Create more test dependencies
- Make refactoring exponentially harder

## Recommended Solution: Refactor First

### 1. **Create Generic Task Queue** (BEFORE adding features)
```typescript
interface Task {
  id: string;
  type: 'thumbnail' | 'video-preview' | 'metadata';
  priority: number;
  payload: any;
}

interface TaskProcessor {
  canProcess(task: Task): boolean;
  process(task: Task): Promise<TaskResult>;
}

class TaskQueue {
  constructor(private processors: TaskProcessor[]) {}
  
  async add(task: Task): Promise<void> { }
  async process(): Promise<void> { }
}
```

### 2. **Separate Concerns**
```typescript
// Separate queue from processing
class QueueManager { /* Pure queue logic */ }
class ThumbnailProcessor { /* Only thumbnail logic */ }
class QueueScheduler { /* Only timing/debounce */ }
class QueuePersistence { /* Only DB operations */ }
```

### 3. **Make it Observable**
```typescript
class TaskQueue extends EventEmitter {
  // Allows extending without modifying
  emit('task:added', task);
  emit('task:completed', result);
  emit('task:failed', error);
}
```

## Recommended Action (REVISED)

### Option 1: Refactor NOW (Recommended)
- **Time**: 1-2 days
- **Benefit**: Clean architecture for all future features
- **Risk**: Low (tests already failing, so no regression)

### Option 2: Document and Freeze
- Mark ThumbnailQueue as "DO NOT EXTEND"
- Build new features separately
- Plan big refactor when multiple queues exist
- **Risk**: High (duplicate code, maintenance burden)

### Option 3: Minimal Abstraction
- At least extract interfaces now
- Make the processor pluggable
- Add basic event system
- **Time**: 4-6 hours
- **Benefit**: Easier future refactoring

## Why This Matters

The current implementation is a **monolith** that will become a **big ball of mud** if extended. Each feature added now will make refactoring harder because:

1. More code depends on the current structure
2. More tests need rewriting
3. More edge cases to handle
4. More risk of breaking changes

**Better to refactor now while it's still small and not in production use.**