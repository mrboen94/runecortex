import { db, schema } from '../db';
import { between, eq, and, gte, lt, desc, inArray } from 'drizzle-orm';
import { MediaScanner } from '../services/scanner';
import { ThumbnailGenerator } from '../services/thumbnail';
import { MediaWatcher } from '../services/watcher';
import { thumbnailQueue } from '../services/thumbnailQueue';
import { errorLogger } from '../services/errorLogger';
import { scanProgress } from '../services/scanProgress';
import { unlink, readdir, rename, access, stat } from 'fs/promises';
import { join, basename, extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { constants } from 'fs';
import type { StreamingServer } from '../services/streamingServer';
import { getLocalIpAddress } from '../utils/network';

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
let currentWatchPath: string = process.env.WATCH_PATHS || '/Users/mathiasboe/Projects/runecortex/images-and-video-folder-for-testing';
let watchPathHistory: string[] = [currentWatchPath];

// Initialize path history from environment or default
function initializePathHistory() {
  // You could load this from a file or database if needed
  // For now, just ensure the current path is in history
  if (!watchPathHistory.includes(currentWatchPath)) {
    watchPathHistory.unshift(currentWatchPath);
  }
}

export const resolvers = {
  Query: {
    mediaByDateRange: async (_: any, { start, end, sourcePath }: { start: Date; end: Date; sourcePath?: string }) => {
      const conditions = [between(schema.mediaItems.createdAt, start, end)];
      if (sourcePath) {
        conditions.push(eq(schema.mediaItems.sourcePath, sourcePath));
      }
      
      return await db.select()
        .from(schema.mediaItems)
        .where(and(...conditions))
        .orderBy(desc(schema.mediaItems.createdAt));
    },

    mediaByYear: async (_: any, { year, sourcePath }: { year: number; sourcePath?: string }) => {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);
      
      const conditions = [
        gte(schema.mediaItems.createdAt, startDate),
        lt(schema.mediaItems.createdAt, endDate)
      ];
      if (sourcePath) {
        conditions.push(eq(schema.mediaItems.sourcePath, sourcePath));
      }
      
      return await db.select()
        .from(schema.mediaItems)
        .where(and(...conditions))
        .orderBy(desc(schema.mediaItems.createdAt));
    },

    mediaByYearMonth: async (_: any, { year, month, sourcePath }: { year: number; month: number; sourcePath?: string }) => {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 1);
      
      const conditions = [
        gte(schema.mediaItems.createdAt, startDate),
        lt(schema.mediaItems.createdAt, endDate)
      ];
      if (sourcePath) {
        conditions.push(eq(schema.mediaItems.sourcePath, sourcePath));
      }
      
      return await db.select()
        .from(schema.mediaItems)
        .where(and(...conditions))
        .orderBy(desc(schema.mediaItems.createdAt));
    },

    allMedia: async (_: any, { limit = 100, offset = 0, sourcePath }: { limit?: number; offset?: number; sourcePath?: string }) => {
      const query = db.select()
        .from(schema.mediaItems);
      
      if (sourcePath) {
        query.where(eq(schema.mediaItems.sourcePath, sourcePath));
      }
      
      return await query
        .orderBy(desc(schema.mediaItems.createdAt))
        .limit(limit)
        .offset(offset);
    },

    allMediaUnfiltered: async (_: any, { limit = 1000, offset = 0 }: { limit?: number; offset?: number }) => {
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
        watchPaths: globalWatcher ? [currentWatchPath] : [],
        lastProcessed: lastProcessedTime,
        scanProgress: scanProgress.getProgress()
      };
    },

    thumbnailQueueStatus: async () => {
      return thumbnailQueue.getStatus();
    },

    getCurrentWatchPath: async () => {
      return currentWatchPath;
    },

    getWatchPathHistory: async () => {
      return watchPathHistory;
    },

    validatePath: async (_: any, { path }: { path: string }) => {
      try {
        // Check if path exists and is accessible
        await access(path, constants.R_OK);
        
        // Check if it's a directory
        const stats = await stat(path);
        if (!stats.isDirectory()) {
          return {
            isValid: false,
            exists: true,
            isDirectory: false,
            hasMediaFiles: false,
            mediaFileCount: 0,
            error: 'Path is not a directory'
          };
        }

        // Check for media files
        const files = await readdir(path, { recursive: true });
        const mediaExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const mediaFiles = files.filter(file => {
          const ext = extname(file).toLowerCase();
          return mediaExtensions.includes(ext);
        });

        return {
          isValid: true,
          exists: true,
          isDirectory: true,
          hasMediaFiles: mediaFiles.length > 0,
          mediaFileCount: mediaFiles.length,
          error: null
        };
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          return {
            isValid: false,
            exists: false,
            isDirectory: false,
            hasMediaFiles: false,
            mediaFileCount: 0,
            error: 'Path does not exist'
          };
        } else if (error.code === 'EACCES') {
          return {
            isValid: false,
            exists: true,
            isDirectory: false,
            hasMediaFiles: false,
            mediaFileCount: 0,
            error: 'Permission denied'
          };
        } else {
          return {
            isValid: false,
            exists: false,
            isDirectory: false,
            hasMediaFiles: false,
            mediaFileCount: 0,
            error: error.message || 'Unknown error'
          };
        }
      }
    },

    streamingServerStatus: () => {
      const streamingServer = (resolvers as any).streamingServer;
      const localIp = getLocalIpAddress();
      
      if (!streamingServer) {
        return {
          isRunning: false,
          port: 4001,
          host: '0.0.0.0',
          name: 'RuneCortex Media Server',
          url: `http://${localIp}:4001`,
          totalItems: 0,
          currentlyPlaying: null,
          localIp
        };
      }
      
      // Since streaming is integrated into main server, always report as running
      const folderStatus = streamingServer.getStreamingFolderStatus();
      return {
        isRunning: true,
        port: 4001, // Same as main server
        host: '0.0.0.0',
        name: 'RuneCortex Media Server',
        url: `http://${localIp}:4001`,
        totalItems: folderStatus.totalItems,
        currentlyPlaying: folderStatus.currentlyPlaying,
        localIp
      };
    },

    streamingFolderStatus: () => {
      const streamingServer = (resolvers as any).streamingServer;
      if (!streamingServer) {
        return {
          totalItems: 0,
          currentlyPlaying: null,
          items: []
        };
      }
      return streamingServer.getStreamingFolderStatus();
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
      
      // Update current watch path if paths provided
      if (paths.length > 0) {
        currentWatchPath = paths[0];
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

    changeWatchPath: async (_: any, { path }: { path: string }) => {
      // Update the current watch path
      currentWatchPath = path;
      
      // Add to history if not already there
      if (!watchPathHistory.includes(path)) {
        watchPathHistory.unshift(path); // Add to beginning
        // Keep only last 50 paths
        if (watchPathHistory.length > 50) {
          watchPathHistory = watchPathHistory.slice(0, 50);
        }
      } else {
        // Move to front if already in history
        watchPathHistory = watchPathHistory.filter(p => p !== path);
        watchPathHistory.unshift(path);
      }
      
      // Stop existing watcher if any
      if (globalWatcher) {
        globalWatcher.stop();
      }

      // Start new watcher with the new path
      globalWatcher = new MediaWatcher({
        paths: [path],
        debounceMs: parseInt(process.env.WATCHER_DEBOUNCE || '5') * 1000
      });

      // Update the emitUpdate method to track last processed time
      const originalEmit = globalWatcher['emitUpdate'].bind(globalWatcher);
      globalWatcher['emitUpdate'] = (update: any) => {
        lastProcessedTime = new Date();
        originalEmit(update);
      };

      // Start the watcher (initial scan happens automatically)
      await globalWatcher.start();

      console.log(`Changed watch path to: ${path}`);

      // Return immediately with scanning status
      return {
        isActive: true,
        watchPaths: [path],
        lastProcessed: lastProcessedTime,
        scanProgress: scanProgress.getProgress()
      };
    },

    startStreamingServer: async () => {
      const streamingServer = (resolvers as any).streamingServer;
      if (!streamingServer) {
        throw new Error('Streaming server not initialized');
      }
      
      // Since we're handling streaming endpoints in the main Bun server,
      // just return the status as "running"
      return {
        isRunning: true,
        port: 4001, // Same as main server
        host: '0.0.0.0',
        name: 'RuneCortex Media Server',
        url: `http://localhost:4001`,
        totalItems: streamingServer.currentStreamingItems.size,
        currentlyPlaying: streamingServer.currentlyPlayingId
      };
    },

    stopStreamingServer: async () => {
      // Since streaming is integrated into main server, we can't really "stop" it
      // Just return true to indicate the operation was successful
      return true;
    },

    updateStreamingFolder: async (_: any, { mediaItems, currentlyPlayingId, forceRefresh }: { 
      mediaItems: Array<{
        id: number;
        filename: string;
        filepath: string;
        fileType: string;
        createdAt: string;
        fileSize: number;
        duration?: number;
        width: number;
        height: number;
      }>;
      currentlyPlayingId?: number;
      forceRefresh?: boolean;
    }) => {
      const streamingServer = (resolvers as any).streamingServer;
      if (!streamingServer) {
        throw new Error('Streaming server not initialized');
      }

      try {
        // Fetch complete media information from database for the given IDs
        const mediaIds = mediaItems.map(item => item.id);
        console.log(`Updating streaming folder with ${mediaIds.length} media IDs:`, mediaIds);
        
        if (mediaIds.length === 0) {
          console.log('No media items provided, clearing streaming folder');
          const result = streamingServer.updateStreamingFolderFromExternal([], currentlyPlayingId, forceRefresh || false);
          return result;
        }
        
        const completeMediaItems = await db
          .select()
          .from(schema.mediaItems)
          .where(inArray(schema.mediaItems.id, mediaIds));

        // Create a map for quick lookup
        const itemsMap = new Map(completeMediaItems.map(item => [item.id, item]));

        // Map the complete data to the streaming format, preserving the order from mediaIds
        const streamingMediaItems = mediaIds
          .map(id => itemsMap.get(id))
          .filter(item => item !== undefined)
          .map(dbItem => ({
            id: dbItem!.id,
            filename: dbItem!.filename,
            filepath: dbItem!.filepath,
            fileType: dbItem!.fileType,
            createdAt: dbItem!.createdAt.toISOString(),
            fileSize: dbItem!.fileSize,
            duration: dbItem!.duration || undefined,
            width: dbItem!.width,
            height: dbItem!.height,
            thumbnailId: dbItem!.thumbnailId || undefined
          }));

        console.log(`Found ${completeMediaItems.length} complete media items in database`);
        console.log(`Streaming items order: ${streamingMediaItems.map(i => i.id).join(', ')}`);
        
        const result = streamingServer.updateStreamingFolderFromExternal(streamingMediaItems, currentlyPlayingId, forceRefresh || false);
        console.log(`Updated streaming folder with ${streamingMediaItems.length} items. Server status:`, result);
        return result;
      } catch (error) {
        console.error('Failed to update streaming folder:', error);
        throw new Error(`Failed to update streaming folder: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    },
    
    forceVLCRefresh: async () => {
      const streamingServer = (resolvers as any).streamingServer;
      if (!streamingServer) {
        throw new Error('Streaming server not initialized');
      }
      
      streamingServer.forceVLCRefresh();
      return { success: true };
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