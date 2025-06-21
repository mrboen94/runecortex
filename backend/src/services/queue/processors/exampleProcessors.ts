import { Task, TaskProcessor, TaskResult, TaskType } from '../types';

/**
 * Example: Video Preview Processor
 * Shows how easy it is to add new task types
 */
export class VideoPreviewProcessor implements TaskProcessor {
  readonly taskType = TaskType.VIDEO_PREVIEW;

  canProcess(task: Task): boolean {
    return task.type === TaskType.VIDEO_PREVIEW;
  }

  validatePayload(payload: any): boolean {
    return (
      typeof payload === 'object' &&
      typeof payload.mediaId === 'number' &&
      typeof payload.duration === 'number'
    );
  }

  async process(task: Task): Promise<TaskResult> {
    const { mediaId, duration } = task.payload;
    
    try {
      // TODO: Implement actual video preview generation
      console.log(`Generating ${duration}s preview for media ${mediaId}`);
      
      // Simulate processing
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      return {
        taskId: task.id,
        success: true,
        data: { 
          previewPath: `/previews/media-${mediaId}-preview.mp4`,
          duration 
        }
      };
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

/**
 * Example: Metadata Extraction Processor
 */
export class MetadataExtractionProcessor implements TaskProcessor {
  readonly taskType = TaskType.METADATA_EXTRACTION;

  canProcess(task: Task): boolean {
    return task.type === TaskType.METADATA_EXTRACTION;
  }

  validatePayload(payload: any): boolean {
    return (
      typeof payload === 'object' &&
      typeof payload.filepath === 'string'
    );
  }

  async process(task: Task): Promise<TaskResult> {
    const { filepath } = task.payload;
    
    try {
      // TODO: Implement actual metadata extraction
      console.log(`Extracting metadata from ${filepath}`);
      
      return {
        taskId: task.id,
        success: true,
        data: { 
          exif: {},
          dimensions: { width: 1920, height: 1080 },
          duration: 0
        }
      };
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

/**
 * Example: AI Tagging Processor
 */
export class AITaggingProcessor implements TaskProcessor {
  readonly taskType = TaskType.AI_TAGGING;

  canProcess(task: Task): boolean {
    return task.type === TaskType.AI_TAGGING;
  }

  validatePayload(payload: any): boolean {
    return (
      typeof payload === 'object' &&
      typeof payload.mediaId === 'number' &&
      typeof payload.model === 'string'
    );
  }

  async process(task: Task): Promise<TaskResult> {
    const { mediaId, model } = task.payload;
    
    try {
      // TODO: Implement actual AI tagging
      console.log(`Running AI tagging on media ${mediaId} with model ${model}`);
      
      return {
        taskId: task.id,
        success: true,
        data: { 
          tags: ['sunset', 'beach', 'ocean'],
          confidence: 0.95
        }
      };
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}