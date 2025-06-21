import { db, schema } from '../db';
import { between, eq, and, gte, lt, desc } from 'drizzle-orm';
import { MediaScanner } from '../services/scanner';
import { ThumbnailGenerator } from '../services/thumbnail';
import { MediaWatcher } from '../services/watcher';
import { thumbnailQueue } from '../services/thumbnailQueue';
import { errorLogger } from '../services/errorLogger';
import { unlink, readdir, rename } from 'fs/promises';
import { join, basename, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';

const scanner = new MediaScanner();
const thumbnailGenerator = new ThumbnailGenerator();

// Helper function to fix thumbnails with special characters
async function fixThumbnailsWithSpecialChars(): Promise<number> {
  let fixedCount = 0;
  const thumbnailDir = './thumbnails';
  
  try {
    const files = await readdir(thumbnailDir);
    const problematicFiles = files.filter(file => 
      file.includes(' ') || file.includes('(') || file.includes(')') || file.includes('[') || file.includes(']')
    );
    
    for (const file of problematicFiles) {
      try {
        // Extract the UUID from the filename
        const parts = file.replace('.jpg', '').split('_');
        const uuid = parts[parts.length - 1];
        const originalName = parts.slice(0, -1).join('_');
        
        // Sanitize the original name
        const sanitizedName = originalName
          .replace(/[^\w\-_.]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        
        const newFilename = `${sanitizedName}_${uuid}.jpg`;
        
        if (newFilename !== file) {
          const oldPath = join(thumbnailDir, file);
          const newPath = join(thumbnailDir, newFilename);
          
          await rename(oldPath, newPath);
          
          // Update database with new thumbnailId
          const newThumbnailId = newFilename.replace('.jpg', '');
          await db.update(schema.mediaItems)
            .set({ thumbnailId: newThumbnailId })
            .where(eq(schema.mediaItems.thumbnailId, file.replace('.jpg', '')));
          
          console.log(`Renamed: ${file} -> ${newFilename}`);
          fixedCount++;
        }
      } catch (error) {
        console.error(`Failed to fix thumbnail ${file}:`, error);
      }
    }
  } catch (error) {
    console.error('Error reading thumbnail directory:', error);
    throw error;
  }
  
  return fixedCount;
}

// Global watcher instance
let globalWatcher: MediaWatcher | null = null;
let lastProcessedTime: Date | null = null;

export const resolvers = {
  Query: {
    mediaByDateRange: async (_: any, { start, end }: { start: Date; end: Date }) => {
      return await db.select()
        .from(schema.mediaItems)
        .where(between(schema.mediaItems.createdAt, start, end))
        .orderBy(desc(schema.mediaItems.createdAt));
    },

    mediaByYear: async (_: any, { year }: { year: number }) => {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);
      
      return await db.select()
        .from(schema.mediaItems)
        .where(and(
          gte(schema.mediaItems.createdAt, startDate),
          lt(schema.mediaItems.createdAt, endDate)
        ))
        .orderBy(desc(schema.mediaItems.createdAt));
    },

    mediaByYearMonth: async (_: any, { year, month }: { year: number; month: number }) => {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);
      
      return await db.select()
        .from(schema.mediaItems)
        .where(and(
          gte(schema.mediaItems.createdAt, startDate),
          lt(schema.mediaItems.createdAt, endDate)
        ))
        .orderBy(desc(schema.mediaItems.createdAt));
    },

    allMedia: async (_: any, { limit = 100, offset = 0 }: { limit?: number; offset?: number }) => {
      return await db.select()
        .from(schema.mediaItems)
        .orderBy(desc(schema.mediaItems.createdAt))
        .limit(limit)
        .offset(offset);
    },

    mediaItem: async (_: any, { id }: { id: number }) => {
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, id))
        .limit(1);
      
      return item || null;
    },

    recentScanSessions: async (_: any, { limit = 10 }: { limit?: number }) => {
      return await db.select()
        .from(schema.scanSessions)
        .orderBy(desc(schema.scanSessions.timestamp))
        .limit(limit);
    },

    watcherStatus: async () => {
      return {
        isActive: globalWatcher !== null,
        watchPaths: globalWatcher ? globalWatcher['options'].paths : [],
        lastProcessed: lastProcessedTime
      };
    },

    thumbnailQueueStatus: async () => {
      return thumbnailQueue.getStatus();
    },
  },

  Mutation: {
    triggerScan: async (_: any, { path }: { path: string }) => {
      const result = await scanner.scanDirectory(path);
      
      // Trigger thumbnail generation for new files
      if (result.newFiles > 0) {
        await thumbnailQueue.ping();
      }
      
      return result;
    },

    regenerateThumbnails: async () => {
      return await thumbnailGenerator.generateMissingThumbnails();
    },

    generateThumbnail: async (_: any, { mediaItemId }: { mediaItemId: number }) => {
      const result = await thumbnailGenerator.generateForMediaItem(mediaItemId);
      return !!result;
    },

    startWatcher: async (_: any, { paths }: { paths: string[] }) => {
      // Stop existing watcher if any
      if (globalWatcher) {
        globalWatcher.stop();
      }

      // Create and start new watcher
      globalWatcher = new MediaWatcher({
        paths,
        debounceMs: 2000
      });

      // Update the emitUpdate method to track last processed time
      const originalEmit = globalWatcher['emitUpdate'].bind(globalWatcher);
      globalWatcher['emitUpdate'] = (update: any) => {
        lastProcessedTime = new Date();
        originalEmit(update);
      };

      await globalWatcher.start();

      return {
        isActive: true,
        watchPaths: paths,
        lastProcessed: lastProcessedTime
      };
    },

    stopWatcher: async () => {
      if (globalWatcher) {
        globalWatcher.stop();
        globalWatcher = null;
        return true;
      }
      return false;
    },

    pingThumbnailQueue: async (_: any, { mediaIds }: { mediaIds?: number[] }) => {
      const result = await thumbnailQueue.ping(mediaIds);
      return thumbnailQueue.getStatus();
    },

    clearThumbnailQueue: async () => {
      thumbnailQueue.clear();
      return true;
    },

    reindexThumbnails: async () => {
      try {
        console.log('Starting thumbnail reindex...');
        const errors: string[] = [];
        let thumbnailsProcessed = 0;

        // First, fix existing thumbnails with special characters
        try {
          const fixedCount = await fixThumbnailsWithSpecialChars();
          thumbnailsProcessed += fixedCount;
          console.log(`Fixed ${fixedCount} thumbnails with special characters`);
        } catch (error) {
          const errorMsg = `Failed to fix special character thumbnails: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }

        // Then, regenerate missing thumbnails
        try {
          const generated = await thumbnailGenerator.generateMissingThumbnails(50);
          thumbnailsProcessed += generated;
          console.log(`Generated ${generated} missing thumbnails`);
        } catch (error) {
          const errorMsg = `Failed to generate missing thumbnails: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }

        // Finally, trigger the thumbnail queue to process any remaining items
        try {
          await thumbnailQueue.ping();
          console.log('Triggered thumbnail queue processing');
        } catch (error) {
          const errorMsg = `Failed to trigger thumbnail queue: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }

        const success = errors.length === 0;
        const message = success 
          ? `Successfully reindexed ${thumbnailsProcessed} thumbnails`
          : `Reindex completed with ${errors.length} error(s). Processed ${thumbnailsProcessed} thumbnails.`;

        return {
          success,
          message,
          thumbnailsProcessed,
          errors
        };
      } catch (error) {
        console.error('Fatal error during thumbnail reindex:', error);
        return {
          success: false,
          message: `Thumbnail reindex failed: ${error}`,
          thumbnailsProcessed: 0,
          errors: [String(error)]
        };
      }
    },

    clearAllThumbnails: async () => {
      try {
        console.log('Clearing all thumbnails...');
        const errors: string[] = [];
        let thumbnailsProcessed = 0;

        // Clear thumbnail queue first
        thumbnailQueue.clear();

        // Read all thumbnail files
        const thumbnailDir = './thumbnails';
        try {
          const files = await readdir(thumbnailDir);
          const jpgFiles = files.filter(file => file.endsWith('.jpg'));
          
          console.log(`Found ${jpgFiles.length} thumbnail files to delete`);

          // Delete all thumbnail files
          for (const file of jpgFiles) {
            try {
              await unlink(join(thumbnailDir, file));
              thumbnailsProcessed++;
            } catch (error) {
              errors.push(`Failed to delete ${file}: ${error}`);
            }
          }
        } catch (error) {
          const errorMsg = `Failed to read thumbnail directory: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }

        // Reset thumbnailGenerated flag for all media items
        try {
          const result = await db.update(schema.mediaItems)
            .set({ 
              thumbnailGenerated: false,
              thumbnailId: null 
            });
          console.log('Reset thumbnail flags in database');
        } catch (error) {
          const errorMsg = `Failed to reset database flags: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }

        // Trigger regeneration
        try {
          await thumbnailQueue.ping();
          console.log('Triggered thumbnail regeneration');
        } catch (error) {
          const errorMsg = `Failed to trigger regeneration: ${error}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }

        const success = errors.length === 0;
        const message = success 
          ? `Successfully cleared ${thumbnailsProcessed} thumbnails and triggered regeneration`
          : `Clear completed with ${errors.length} error(s). Cleared ${thumbnailsProcessed} thumbnails.`;

        return {
          success,
          message,
          thumbnailsProcessed,
          errors
        };
      } catch (error) {
        console.error('Fatal error during thumbnail clear:', error);
        return {
          success: false,
          message: `Thumbnail clear failed: ${error}`,
          thumbnailsProcessed: 0,
          errors: [String(error)]
        };
      }
    },

    logPlaybackError: async (_: any, { mediaId, error, browserInfo }: { mediaId: number; error: string; browserInfo?: string }) => {
      try {
        const media = await db.select().from(schema.mediaItems).where(eq(schema.mediaItems.id, mediaId)).get();
        if (!media) {
          console.error(`Media item ${mediaId} not found for error logging`);
          return false;
        }

        const parsedBrowserInfo = browserInfo ? JSON.parse(browserInfo) : undefined;
        await errorLogger.logPlaybackError(mediaId, media.filepath, error, parsedBrowserInfo);
        
        return true;
      } catch (logError) {
        console.error('Failed to log playback error:', logError);
        return false;
      }
    },
  },

  MediaItem: {
    thumbnailUrl: (parent: schema.MediaItem) => {
      // Return thumbnail URL if thumbnailId exists, otherwise fallback to ID-based naming
      // Frontend will handle missing thumbnails with placeholders
      if (parent.thumbnailId) {
        return `/thumbnails/${parent.thumbnailId}.jpg`;
      }
      return `/thumbnails/${parent.id}.jpg`; // Fallback for existing items
    },
  },
};