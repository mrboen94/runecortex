import { watch } from 'fs';
import { join, extname, relative } from 'path';
import { stat } from 'fs/promises';
import { MediaScanner } from './scanner';
import { thumbnailQueue } from './thumbnailQueue';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';

interface WatcherOptions {
  paths: string[];
  pollInterval?: number;
  debounceMs?: number;
}

interface QueuedFile {
  path: string;
  event: 'add' | 'change' | 'unlink';
  timestamp: number;
}

export class MediaWatcher {
  private watchers: Map<string, any> = new Map();
  private scanner = new MediaScanner();
  private fileQueue: Map<string, QueuedFile> = new Map();
  private processTimer: NodeJS.Timeout | null = null;
  private periodicCheckTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;
  private isProcessing = false;
  private lastPeriodicCheck = new Date();
  private newMediaIds: number[] = [];

  constructor(private options: WatcherOptions) {
    this.debounceMs = options.debounceMs || 1000;
  }

  async start() {
    console.log('Starting media watcher...');
    
    for (const watchPath of this.options.paths) {
      try {
        await stat(watchPath);
        this.watchDirectory(watchPath);
        console.log(`Watching directory: ${watchPath}`);
      } catch (error) {
        console.error(`Failed to watch directory ${watchPath}:`, error);
      }
    }

    // Initial scan
    await this.performInitialScan();

    // Start periodic check every 5 minutes to catch any missed files
    this.periodicCheckTimer = setInterval(() => {
      this.performPeriodicCheck();
    }, 5 * 60 * 1000); // 5 minutes
  }

  stop() {
    console.log('Stopping media watcher...');
    
    for (const [path, watcher] of this.watchers) {
      watcher.close();
    }
    
    this.watchers.clear();
    
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }

    if (this.periodicCheckTimer) {
      clearInterval(this.periodicCheckTimer);
      this.periodicCheckTimer = null;
    }
  }

  private watchDirectory(dirPath: string) {
    const watcher = watch(dirPath, { recursive: true }, async (eventType, filename) => {
      if (!filename) return;
      
      const fullPath = join(dirPath, filename);
      
      // Filter for media files
      if (!this.isMediaFile(filename)) return;
      
      // Check if file exists to determine the actual event
      let actualEvent: 'add' | 'change' | 'unlink' = 'change';
      
      try {
        await stat(fullPath);
        // File exists - it's either new or changed
        actualEvent = eventType === 'rename' ? 'add' : 'change';
      } catch {
        // File doesn't exist - it was deleted
        actualEvent = 'unlink';
      }
      
      // Add to queue
      this.queueFile(fullPath, actualEvent);
    });

    this.watchers.set(dirPath, watcher);
  }

  private isMediaFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase();
    const videoExts = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp'];
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'];
    
    return videoExts.includes(ext) || imageExts.includes(ext);
  }

  private queueFile(path: string, event: 'add' | 'change' | 'unlink') {
    this.fileQueue.set(path, {
      path,
      event,
      timestamp: Date.now()
    });

    // Reset the debounce timer
    if (this.processTimer) {
      clearTimeout(this.processTimer);
    }

    this.processTimer = setTimeout(() => {
      this.processQueue();
    }, this.debounceMs);
  }

  private async processQueue() {
    if (this.isProcessing || this.fileQueue.size === 0) return;
    
    this.isProcessing = true;
    const files = Array.from(this.fileQueue.values());
    this.fileQueue.clear();

    console.log(`Processing ${files.length} file changes...`);

    const scanSession = await db.insert(schema.scanSessions).values({
      status: 'running'
    }).returning();

    const sessionId = scanSession[0].id;
    let processed = 0;
    let newFiles = 0;
    let errors = 0;

    for (const file of files) {
      try {
        if (file.event === 'unlink') {
          // Handle file deletion
          await this.handleFileDeleted(file.path);
        } else {
          // Handle file addition/change
          const result = await this.handleFileChanged(file.path);
          if (result.isNew) {
            newFiles++;
            // Collect new media IDs for thumbnail generation
            if (result.mediaId) {
              this.newMediaIds.push(result.mediaId);
            }
          }
        }
        processed++;
      } catch (error) {
        console.error(`Error processing file ${file.path}:`, error);
        errors++;
      }
    }

    await db.update(schema.scanSessions)
      .set({
        status: 'completed',
        filesProcessed: processed,
        newFiles: newFiles,
        errors: errors,
        completedAt: new Date()
      })
      .where(eq(schema.scanSessions.id, sessionId));

    console.log(`Processed ${processed} files, ${newFiles} new, ${errors} errors`);
    
    // Ping thumbnail queue with new media IDs
    if (this.newMediaIds.length > 0) {
      const queueResult = await thumbnailQueue.ping(this.newMediaIds);
      console.log(`Queued ${this.newMediaIds.length} items for thumbnail generation. Queue status: ${queueResult.status}`);
      this.newMediaIds = []; // Clear the array
    }
    
    // Emit update event (for future GraphQL subscriptions)
    this.emitUpdate({
      type: 'scan_complete',
      processed,
      newFiles,
      errors
    });

    this.isProcessing = false;
  }

  private async handleFileChanged(filepath: string): Promise<{ isNew: boolean; mediaId?: number }> {
    try {
      const stats = await stat(filepath);
      const ext = extname(filepath).toLowerCase();
      const fileType = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp']
        .includes(ext) ? 'video' : 'image';

      // Check if file already exists
      const existing = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.filepath, filepath))
        .limit(1);

      if (existing.length > 0) {
        // Update existing file
        console.log(`Updating existing file: ${filepath}`);
        // For now, just return - could update metadata here
        return { isNew: false, mediaId: existing[0].id };
      } else {
        // Add new file by processing just this file
        console.log(`Adding new file: ${filepath}`);
        
        // Use the scanner's processFile method directly
        const scannerInstance = new MediaScanner();
        await scannerInstance['processFile'](filepath);
        
        // Get the newly created media item
        const [newItem] = await db.select()
          .from(schema.mediaItems)
          .where(eq(schema.mediaItems.filepath, filepath))
          .limit(1);
          
        return { isNew: true, mediaId: newItem?.id };
      }
    } catch (error) {
      console.error(`Failed to process file ${filepath}:`, error);
      throw error;
    }
  }

  private async handleFileDeleted(filepath: string) {
    console.log(`File deleted from source: ${filepath}`);
    
    const deleted = await db.delete(schema.mediaItems)
      .where(eq(schema.mediaItems.filepath, filepath))
      .returning();

    if (deleted.length > 0) {
      // Note: We intentionally keep the thumbnail file
      // in case the same file is uploaded again later
      console.log(`Removed from database (thumbnail preserved): ${filepath}`);
      
      // Emit deletion event
      this.emitUpdate({
        type: 'file_deleted',
        filepath,
        mediaId: deleted[0].id
      });
    }
  }

  private async performInitialScan() {
    console.log('Performing initial scan of watch directories...');
    
    for (const watchPath of this.options.paths) {
      try {
        await this.scanner.scanDirectory(watchPath);
      } catch (error) {
        console.error(`Initial scan failed for ${watchPath}:`, error);
      }
    }
    
    // Ping thumbnail queue to generate any missing thumbnails
    const queueResult = await thumbnailQueue.ping();
    console.log(`Initial scan complete. Thumbnail queue status: ${queueResult.status}, queued: ${queueResult.queued}`);
  }

  private emitUpdate(update: any) {
    // This will be used for GraphQL subscriptions
    // For now, just log the update
    console.log('Media update:', update);
  }

  private async performPeriodicCheck() {
    if (this.isProcessing) {
      console.log('Skipping periodic check - already processing');
      return;
    }

    console.log('Performing periodic check for missed files...');
    
    try {
      let totalNewFiles = 0;
      
      for (const watchPath of this.options.paths) {
        // Just do a quick scan for new files, not a full scan
        const result = await this.scanner.scanDirectory(watchPath);
        
        if (result.newFiles > 0) {
          console.log(`Periodic check found ${result.newFiles} new files in ${watchPath}`);
          totalNewFiles += result.newFiles;
        }
      }
      
      // If new files were found, ping the thumbnail queue
      if (totalNewFiles > 0) {
        const queueResult = await thumbnailQueue.ping();
        console.log(`Periodic check: Queued items for thumbnail generation. Status: ${queueResult.status}`);
      }
      
      this.lastPeriodicCheck = new Date();
    } catch (error) {
      console.error('Periodic check failed:', error);
    }
  }
}