import { EventEmitter } from 'events';

// Task types that can be processed
export enum TaskType {
  THUMBNAIL = 'thumbnail',
  VIDEO_PREVIEW = 'video-preview',
  METADATA_EXTRACTION = 'metadata-extraction',
  AI_TAGGING = 'ai-tagging'
}

// Priority levels for tasks
export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  URGENT = 3
}

// Generic task interface
export interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  payload: any;
  createdAt: Date;
  attempts?: number;
  lastError?: string;
}

// Result of processing a task
export interface TaskResult {
  taskId: string;
  success: boolean;
  error?: string;
  data?: any;
  skipped?: boolean;
}

// Interface for task processors
export interface TaskProcessor {
  readonly taskType: TaskType;
  
  // Check if this processor can handle the task
  canProcess(task: Task): boolean;
  
  // Process the task
  process(task: Task): Promise<TaskResult>;
  
  // Optional: validate task payload
  validatePayload?(payload: any): boolean;
}

// Queue configuration
export interface QueueConfig {
  maxConcurrent: number;
  batchSize: number;
  debounceMs: number;
  cooldownMs: number;
  maxRetries?: number;
}

// Queue statistics
export interface QueueStats {
  totalQueued: number;
  processed: number;
  failed: number;
  skipped: number;
  processing: number;
}

// Queue status
export type QueueStatus = 'idle' | 'waiting' | 'processing' | 'cooldown';

// Events emitted by the queue
export interface QueueEvents {
  'task:added': (task: Task) => void;
  'task:started': (task: Task) => void;
  'task:completed': (result: TaskResult) => void;
  'task:failed': (task: Task, error: Error) => void;
  'task:skipped': (task: Task, reason: string) => void;
  'batch:start': (tasks: Task[]) => void;
  'batch:complete': (results: TaskResult[]) => void;
  'status:change': (oldStatus: QueueStatus, newStatus: QueueStatus) => void;
  'error': (error: Error) => void;
}

// Type-safe event emitter for the queue
export interface QueueEventEmitter extends EventEmitter {
  on<K extends keyof QueueEvents>(event: K, listener: QueueEvents[K]): this;
  off<K extends keyof QueueEvents>(event: K, listener: QueueEvents[K]): this;
  emit<K extends keyof QueueEvents>(event: K, ...args: Parameters<QueueEvents[K]>): boolean;
}