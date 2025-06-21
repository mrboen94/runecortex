import { db } from '../db';
import { errorLogs, mediaItems, NewErrorLog } from '../db/schema';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

interface ErrorContext {
  mediaId?: number;
  filePath?: string;
  [key: string]: any;
}

class ErrorLogger {
  private errorLogPath: string;
  
  constructor() {
    // Create error log directory
    this.errorLogPath = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(this.errorLogPath)) {
      fs.mkdirSync(this.errorLogPath, { recursive: true });
    }
  }
  
  async logError(
    service: string,
    operation: string,
    error: Error | string,
    context?: ErrorContext,
    severity: 'warning' | 'error' | 'critical' = 'error'
  ): Promise<void> {
    try {
      const errorMessage = error instanceof Error ? error.message : error;
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      // Log to database
      const errorLog: NewErrorLog = {
        service,
        operation,
        errorMessage,
        errorStack,
        severity,
        entityType: context?.mediaId ? 'media' : undefined,
        entityId: context?.mediaId,
        filePath: context?.filePath,
        contextJson: context ? JSON.stringify(context) : undefined,
        createdAt: new Date()
      };
      
      await db.insert(errorLogs).values(errorLog);
      
      // If it's a media error, update the media item
      if (context?.mediaId) {
        const media = await db.select().from(mediaItems).where(eq(mediaItems.id, context.mediaId)).get();
        if (media) {
          await db.update(mediaItems)
            .set({
              lastError: errorMessage,
              errorCount: (media.errorCount || 0) + 1,
              processingStatus: 'error'
            })
            .where(eq(mediaItems.id, context.mediaId));
        }
      }
      
      // Also log to file for manual review
      await this.logToFile(service, operation, errorMessage, context, severity);
      
    } catch (logError) {
      console.error('Failed to log error:', logError);
      console.error('Original error:', error);
    }
  }
  
  async logPlaybackError(
    mediaId: number,
    filePath: string,
    error: Error | string,
    browserInfo?: any
  ): Promise<void> {
    const context: ErrorContext = {
      mediaId,
      filePath,
      browserInfo,
      timestamp: new Date().toISOString(),
      userAgent: browserInfo?.userAgent
    };
    
    await this.logError('playback', 'play_media', error, context);
  }
  
  private async logToFile(
    service: string,
    operation: string,
    errorMessage: string,
    context?: ErrorContext,
    severity: string = 'error'
  ): Promise<void> {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const logFile = path.join(this.errorLogPath, `errors-${dateStr}.log`);
    
    const logEntry = {
      timestamp: date.toISOString(),
      service,
      operation,
      severity,
      error: errorMessage,
      ...context
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    await fs.promises.appendFile(logFile, logLine, 'utf8');
  }
  
  async getRecentErrors(limit: number = 100): Promise<any[]> {
    return await db.select()
      .from(errorLogs)
      .orderBy(errorLogs.createdAt)
      .limit(limit);
  }
  
  async getMediaErrors(mediaId: number): Promise<any[]> {
    return await db.select()
      .from(errorLogs)
      .where(eq(errorLogs.entityId, mediaId))
      .orderBy(errorLogs.createdAt);
  }
  
  async clearResolvedErrors(olderThanDays: number = 30): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    await db.delete(errorLogs)
      .where(errorLogs.resolvedAt < cutoffDate);
  }
}

export const errorLogger = new ErrorLogger();