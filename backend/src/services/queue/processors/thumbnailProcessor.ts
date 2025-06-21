import { Task, TaskProcessor, TaskResult, TaskType } from '../types';
import { ThumbnailGenerator } from '../../thumbnail';
import { db, schema } from '../../../db';
import { eq } from 'drizzle-orm';

export interface ThumbnailTaskPayload {
  mediaId: number;
  force?: boolean; // Force regeneration even if exists
}

export class ThumbnailProcessor implements TaskProcessor {
  readonly taskType = TaskType.THUMBNAIL;
  private generator = new ThumbnailGenerator();

  canProcess(task: Task): boolean {
    return task.type === TaskType.THUMBNAIL;
  }

  validatePayload(payload: any): boolean {
    return (
      typeof payload === 'object' &&
      typeof payload.mediaId === 'number' &&
      payload.mediaId > 0
    );
  }

  async process(task: Task): Promise<TaskResult> {
    const payload = task.payload as ThumbnailTaskPayload;
    
    try {
      // Check if media item exists
      const [mediaItem] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, payload.mediaId))
        .limit(1);

      if (!mediaItem) {
        return {
          taskId: task.id,
          success: false,
          error: `Media item ${payload.mediaId} not found`,
          skipped: true
        };
      }

      // Skip if already generated (unless forced)
      if (mediaItem.thumbnailGenerated && !payload.force) {
        return {
          taskId: task.id,
          success: false,
          skipped: true,
          error: 'Thumbnail already exists'
        };
      }

      // Generate thumbnail
      const result = await this.generator.generateThumbnail(payload.mediaId);
      
      if (result.success) {
        return {
          taskId: task.id,
          success: true,
          data: { path: result.path }
        };
      } else {
        return {
          taskId: task.id,
          success: false,
          error: result.error
        };
      }
      
    } catch (error) {
      return {
        taskId: task.id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}