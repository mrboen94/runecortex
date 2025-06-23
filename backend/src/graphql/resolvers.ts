import { db, schema } from '../db';
import { between, eq, and, gte, lt, desc, inArray, ne } from 'drizzle-orm';
import { MediaScanner } from '../services/scanner';
import { SmartScanner } from '../services/smartScanner';
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
import { playlistService } from '../services/playlistService';

const scanner = new MediaScanner();
const smartScanner = new SmartScanner();
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
let watcherEnabled: boolean = false; // Track if watcher is enabled

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
        scanProgress: scanProgress.getProgress(),
        watcherEnabled: watcherEnabled
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

    playlists: async () => {
      return await playlistService.getAllPlaylists();
    },

    playlist: async (_: any, { id }: { id: number }) => {
      return await playlistService.getPlaylistById(id);
    },

    activePlaylist: async () => {
      return await playlistService.getActivePlaylist();
    },

    indexedFolders: async () => {
      return await db.select()
        .from(schema.indexedFolders)
        .orderBy(desc(schema.indexedFolders.addedAt));
    },

    getSubfolders: async (_: any, { parentPath }: { parentPath: string }) => {
      try {
        const subfolders = [];
        
        // Read directory contents
        const entries = await readdir(parentPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const folderPath = join(parentPath, entry.name);
            
            try {
              // Get folder stats (only for lastModified)
              const stats = await stat(folderPath);
              
              // Check if folder has subfolders (quick check - only read directory entries, don't count files)
              let hasSubfolders = false;
              try {
                const folderContents = await readdir(folderPath, { withFileTypes: true });
                hasSubfolders = folderContents.some(item => item.isDirectory());
              } catch (error) {
                // If we can't read the folder, skip it
                console.warn(`Cannot read folder ${folderPath}:`, error);
                continue;
              }
              
              subfolders.push({
                path: folderPath,
                name: entry.name,
                fileCount: 0, // Don't count files - just set to 0
                hasSubfolders,
                lastModified: stats.mtime
              });
            } catch (error) {
              // If we can't stat the folder, skip it
              console.warn(`Cannot stat folder ${folderPath}:`, error);
              continue;
            }
          }
        }
        
        // Sort by name
        subfolders.sort((a, b) => a.name.localeCompare(b.name));
        
        return subfolders;
      } catch (error) {
        console.error(`Failed to get subfolders for ${parentPath}:`, error);
        return [];
      }
    },

    appConfig: async (_: any, { key }: { key: string }) => {
      const [config] = await db.select()
        .from(schema.appConfig)
        .where(eq(schema.appConfig.key, key))
        .limit(1);
      
      return config ? config.value : null;
    },

    duplicateGroups: async (_: any, { markedForReview }: { markedForReview?: boolean }) => {
      let query = db.select().from(schema.duplicateGroups);
      
      if (markedForReview !== undefined) {
        query = query.where(eq(schema.duplicateGroups.markedForReview, markedForReview));
      }
      
      return await query.orderBy(desc(schema.duplicateGroups.totalSize));
    },

    duplicateGroup: async (_: any, { id }: { id: number }) => {
      const [group] = await db.select()
        .from(schema.duplicateGroups)
        .where(eq(schema.duplicateGroups.id, id))
        .limit(1);
      
      return group;
    },

    exportDuplicates: async () => {
      const groups = await db.select()
        .from(schema.duplicateGroups)
        .orderBy(desc(schema.duplicateGroups.totalSize));
      
      const exports = [];
      
      for (const group of groups) {
        const files = await db.select()
          .from(schema.duplicateFiles)
          .where(eq(schema.duplicateFiles.groupId, group.id));
        
        exports.push({
          groupId: group.id,
          checksum: group.checksum,
          totalFiles: group.duplicateCount,
          totalSize: group.totalSize || 0,
          files: files.map(f => ({
            filepath: f.filepath,
            filename: f.filename,
            suggestedForDeletion: f.suggestedForDeletion,
            reason: f.reason
          }))
        });
      }
      
      return exports;
    },
  },

  Mutation: {
    triggerScan: async (_: any, { path, forceDeepScan }: { path: string; forceDeepScan?: boolean }) => {
      // Check if this path is an indexed folder
      const [indexedFolder] = await db.select()
        .from(schema.indexedFolders)
        .where(eq(schema.indexedFolders.path, path))
        .limit(1);

      let result;
      if (indexedFolder && !forceDeepScan) {
        // Use smart scanner for indexed folders
        result = await smartScanner.smartScan(indexedFolder.id, {
          forceDeepScan: false,
          scanStrategy: indexedFolder.scanStrategy as 'shallow' | 'deep' | 'auto' || 'auto'
        });
      } else {
        // Fall back to regular scanner
        result = await scanner.scanDirectory(path);
      }
      
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
      // Legacy mutation - redirect to toggleWatcher with enabled=true
      // But first migrate the paths to indexed folders if provided
      if (paths && paths.length > 0) {
        for (const path of paths) {
          await db.insert(schema.indexedFolders)
            .values({
              path,
              enabled: true,
              addedAt: new Date()
            })
            .onConflictDoNothing();
        }
      }

      // Now enable the watcher
      return await resolvers.Mutation.toggleWatcher(null, { enabled: true });
    },

    stopWatcher: async () => {
      // Legacy mutation - redirect to toggleWatcher with enabled=false
      await resolvers.Mutation.toggleWatcher(null, { enabled: false });
      return true;
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
      // Legacy mutation - add path to indexed folders and enable watcher
      
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
      
      // Add path to indexed folders
      await db.insert(schema.indexedFolders)
        .values({
          path,
          enabled: true,
          addedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.indexedFolders.path,
          set: { 
            enabled: true
          }
        });

      // Disable all other folders (to match legacy behavior of only watching one path)
      await db.update(schema.indexedFolders)
        .set({ enabled: false })
        .where(and(
          eq(schema.indexedFolders.enabled, true),
          ne(schema.indexedFolders.path, path)
        ));

      // Enable the watcher
      const result = await resolvers.Mutation.toggleWatcher(null, { enabled: true });

      console.log(`Changed watch path to: ${path}`);

      return result;
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

    createPlaylist: async (_: any, { input }: { input: {
      name: string;
      description?: string;
      mediaItemIds: number[];
    }}) => {
      return await playlistService.createPlaylist(input);
    },

    updatePlaylist: async (_: any, { input }: { input: {
      id: number;
      name?: string;
      description?: string;
      mediaItemIds?: number[];
    }}) => {
      return await playlistService.updatePlaylist(input);
    },

    deletePlaylist: async (_: any, { id }: { id: number }) => {
      return await playlistService.deletePlaylist(id);
    },

    activatePlaylist: async (_: any, { id }: { id: number }) => {
      const playlist = await playlistService.activatePlaylist(id);
      
      // Update streaming server with playlist items
      const streamingServer = (resolvers as any).streamingServer;
      if (streamingServer && playlist) {
        const streamingItems = await playlistService.getPlaylistAsStreamingItems(id);
        streamingServer.updateStreamingFolderFromExternal(streamingItems, null, false);
      }
      
      return playlist;
    },

    deactivatePlaylist: async () => {
      return await playlistService.deactivateAllPlaylists();
    },

    exportPlaylist: async (_: any, { id, format = 'm3u' }: { id: number; format?: string }) => {
      return await playlistService.exportPlaylist(id, format);
    },

    toggleWatcher: async (_: any, { enabled }: { enabled: boolean }) => {
      watcherEnabled = enabled;
      
      // Save state to appConfig
      await db.insert(schema.appConfig)
        .values({
          key: 'watcherEnabled',
          value: JSON.stringify(enabled),
          description: 'Whether the file watcher is enabled'
        })
        .onConflictDoUpdate({
          target: schema.appConfig.key,
          set: { 
            value: JSON.stringify(enabled),
            updatedAt: new Date()
          }
        });

      // If disabling, stop the watcher
      if (!enabled && globalWatcher) {
        globalWatcher.stop();
        globalWatcher = null;
      }

      // If enabling, start the watcher with indexed folders
      if (enabled && !globalWatcher) {
        const enabledFolders = await db.select()
          .from(schema.indexedFolders)
          .where(eq(schema.indexedFolders.enabled, true));

        if (enabledFolders.length > 0) {
          const paths = enabledFolders.map(f => f.path);
          globalWatcher = new MediaWatcher({
            paths,
            debounceMs: parseInt(process.env.WATCHER_DEBOUNCE || '5') * 1000
          });

          // Update the emitUpdate method to track last processed time
          const originalEmit = globalWatcher['emitUpdate'].bind(globalWatcher);
          globalWatcher['emitUpdate'] = (update: any) => {
            lastProcessedTime = new Date();
            originalEmit(update);
          };

          await globalWatcher.start();
        }
      }

      return {
        isActive: globalWatcher !== null,
        watchPaths: globalWatcher ? await db.select()
          .from(schema.indexedFolders)
          .where(eq(schema.indexedFolders.enabled, true))
          .then(folders => folders.map(f => f.path)) : [],
        lastProcessed: lastProcessedTime,
        scanProgress: scanProgress.getProgress(),
        watcherEnabled: watcherEnabled
      };
    },

    setAppConfig: async (_: any, { key, value }: { key: string; value: string }) => {
      await db.insert(schema.appConfig)
        .values({
          key,
          value,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.appConfig.key,
          set: { 
            value,
            updatedAt: new Date()
          }
        });
      
      return true;
    },

    addIndexedFolder: async (_: any, { path, scanStrategy }: { path: string; scanStrategy?: string }) => {
      const [newFolder] = await db.insert(schema.indexedFolders)
        .values({
          path,
          enabled: true,
          scanStrategy: scanStrategy || 'auto',
          addedAt: new Date()
        })
        .onConflictDoNothing()
        .returning();

      // If watcher is enabled and running, restart it with the new path
      if (watcherEnabled && globalWatcher) {
        globalWatcher.stop();
        
        const enabledFolders = await db.select()
          .from(schema.indexedFolders)
          .where(eq(schema.indexedFolders.enabled, true));

        const paths = enabledFolders.map(f => f.path);
        globalWatcher = new MediaWatcher({
          paths,
          debounceMs: parseInt(process.env.WATCHER_DEBOUNCE || '5') * 1000
        });

        // Update the emitUpdate method to track last processed time
        const originalEmit = globalWatcher['emitUpdate'].bind(globalWatcher);
        globalWatcher['emitUpdate'] = (update: any) => {
          lastProcessedTime = new Date();
          originalEmit(update);
        };

        await globalWatcher.start();
      }

      return newFolder;
    },

    removeIndexedFolder: async (_: any, { id }: { id: number }) => {
      await db.delete(schema.indexedFolders)
        .where(eq(schema.indexedFolders.id, id));

      // Restart watcher if it's enabled
      if (watcherEnabled && globalWatcher) {
        globalWatcher.stop();
        
        const enabledFolders = await db.select()
          .from(schema.indexedFolders)
          .where(eq(schema.indexedFolders.enabled, true));

        if (enabledFolders.length > 0) {
          const paths = enabledFolders.map(f => f.path);
          globalWatcher = new MediaWatcher({
            paths,
            debounceMs: parseInt(process.env.WATCHER_DEBOUNCE || '5') * 1000
          });

          // Update the emitUpdate method to track last processed time
          const originalEmit = globalWatcher['emitUpdate'].bind(globalWatcher);
          globalWatcher['emitUpdate'] = (update: any) => {
            lastProcessedTime = new Date();
            originalEmit(update);
          };

          await globalWatcher.start();
        } else {
          globalWatcher = null;
        }
      }

      return true;
    },

    toggleIndexedFolder: async (_: any, { id, enabled }: { id: number; enabled: boolean }) => {
      const [updatedFolder] = await db.update(schema.indexedFolders)
        .set({ 
          enabled
        })
        .where(eq(schema.indexedFolders.id, id))
        .returning();

      // Restart watcher if it's enabled
      if (watcherEnabled && globalWatcher) {
        globalWatcher.stop();
        
        const enabledFolders = await db.select()
          .from(schema.indexedFolders)
          .where(eq(schema.indexedFolders.enabled, true));

        if (enabledFolders.length > 0) {
          const paths = enabledFolders.map(f => f.path);
          globalWatcher = new MediaWatcher({
            paths,
            debounceMs: parseInt(process.env.WATCHER_DEBOUNCE || '5') * 1000
          });

          // Update the emitUpdate method to track last processed time
          const originalEmit = globalWatcher['emitUpdate'].bind(globalWatcher);
          globalWatcher['emitUpdate'] = (update: any) => {
            lastProcessedTime = new Date();
            originalEmit(update);
          };

          await globalWatcher.start();
        } else {
          globalWatcher = null;
        }
      }

      return updatedFolder;
    },

    setScanStrategy: async (_: any, { id, strategy }: { id: number; strategy: string }) => {
      // Validate strategy
      if (!['shallow', 'deep', 'auto'].includes(strategy)) {
        throw new Error('Invalid scan strategy. Must be one of: shallow, deep, auto');
      }

      const [updatedFolder] = await db.update(schema.indexedFolders)
        .set({ 
          scanStrategy: strategy
        })
        .where(eq(schema.indexedFolders.id, id))
        .returning();

      if (!updatedFolder) {
        throw new Error('Indexed folder not found');
      }

      return updatedFolder;
    },

    performDeepScan: async (_: any, { id }: { id: number }) => {
      // Get the indexed folder
      const [indexedFolder] = await db.select()
        .from(schema.indexedFolders)
        .where(eq(schema.indexedFolders.id, id))
        .limit(1);

      if (!indexedFolder) {
        throw new Error('Indexed folder not found');
      }

      // Perform a deep scan
      const result = await smartScanner.smartScan(id, {
        forceDeepScan: true,
        scanStrategy: 'deep'
      });

      // Update last deep scan timestamp
      await db.update(schema.indexedFolders)
        .set({ 
          lastDeepScan: new Date()
        })
        .where(eq(schema.indexedFolders.id, id));
      
      // Trigger thumbnail generation for new files
      if (result.newFiles > 0) {
        await thumbnailQueue.ping();
      }
      
      return {
        ...result,
        indexedFolder: {
          ...indexedFolder,
          lastDeepScan: new Date()
        }
      };
    },

    scanFolders: async (_: any, { folderIds }: { folderIds: number[] }) => {
      if (!folderIds || folderIds.length === 0) {
        return {
          success: false,
          message: 'No folders specified',
          scannedCount: 0
        };
      }

      try {
        // Get the indexed folders
        const indexedFolders = await db.select()
          .from(schema.indexedFolders)
          .where(inArray(schema.indexedFolders.id, folderIds));

        if (indexedFolders.length === 0) {
          return {
            success: false,
            message: 'No valid folders found',
            scannedCount: 0
          };
        }

        // Perform scanning for each folder
        let totalNewFiles = 0;
        let totalUpdated = 0;
        let totalProcessed = 0;
        const scanErrors: string[] = [];

        for (const folder of indexedFolders) {
          try {
            const result = await smartScanner.smartScan(folder.id, {
              forceDeepScan: false,
              scanStrategy: folder.scanStrategy as any
            });

            totalNewFiles += result.newFiles;
            totalUpdated += result.updated;
            totalProcessed += result.processed;

            // Update last scanned timestamp
            await db.update(schema.indexedFolders)
              .set({ 
                lastScanned: new Date()
              })
              .where(eq(schema.indexedFolders.id, folder.id));

          } catch (error) {
            console.error(`Failed to scan folder ${folder.path}:`, error);
            scanErrors.push(`${folder.path}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        // Trigger thumbnail generation for new files
        if (totalNewFiles > 0) {
          await thumbnailQueue.ping();
        }

        const message = scanErrors.length > 0 
          ? `Scanned ${indexedFolders.length} folders with ${scanErrors.length} errors. Processed: ${totalProcessed}, New: ${totalNewFiles}, Updated: ${totalUpdated}`
          : `Successfully scanned ${indexedFolders.length} folders. Processed: ${totalProcessed}, New: ${totalNewFiles}, Updated: ${totalUpdated}`;

        return {
          success: scanErrors.length === 0,
          message,
          scannedCount: indexedFolders.length
        };

      } catch (error) {
        console.error('Failed to scan folders:', error);
        return {
          success: false,
          message: `Failed to scan folders: ${error instanceof Error ? error.message : 'Unknown error'}`,
          scannedCount: 0
        };
      }
    },

    markDuplicateGroupForReview: async (_: any, { groupId, mark }: { groupId: number; mark: boolean }) => {
      const [updatedGroup] = await db.update(schema.duplicateGroups)
        .set({ markedForReview: mark })
        .where(eq(schema.duplicateGroups.id, groupId))
        .returning();
      
      if (!updatedGroup) {
        throw new Error('Duplicate group not found');
      }
      
      return updatedGroup;
    },

    exportDuplicatePaths: async (_: any, { format }: { format?: string }) => {
      const groups = await db.select()
        .from(schema.duplicateGroups)
        .orderBy(desc(schema.duplicateGroups.totalSize));
      
      const exportData = [];
      
      for (const group of groups) {
        const files = await db.select()
          .from(schema.duplicateFiles)
          .where(eq(schema.duplicateFiles.groupId, group.id))
          .orderBy(desc(schema.duplicateFiles.suggestedForDeletion));
        
        if (files.length > 1) { // Only export groups with actual duplicates
          const groupData = {
            checksum: group.checksum,
            totalSize: group.totalSize,
            duplicateCount: group.duplicateCount,
            files: files.map(f => ({
              path: f.filepath,
              suggestedForDeletion: f.suggestedForDeletion,
              reason: f.reason || ''
            }))
          };
          exportData.push(groupData);
        }
      }
      
      // Format the export based on requested format
      if (format === 'json') {
        return JSON.stringify(exportData, null, 2);
      } else if (format === 'csv') {
        // CSV format with one line per file
        const lines = ['filepath,checksum,suggested_for_deletion,reason'];
        for (const group of exportData) {
          for (const file of group.files) {
            lines.push(`"${file.path}","${group.checksum}",${file.suggestedForDeletion},"${file.reason}"`);
          }
        }
        return lines.join('\n');
      } else {
        // Default: simple text format with paths only
        const lines = ['# Duplicate Files Report', `# Generated: ${new Date().toISOString()}`, ''];
        
        for (const group of exportData) {
          lines.push(`# Group (checksum: ${group.checksum}, total size: ${(group.totalSize || 0) / 1024 / 1024}MB)`);
          
          // List files to keep first
          const toKeep = group.files.filter(f => !f.suggestedForDeletion);
          if (toKeep.length > 0) {
            lines.push('# Files to keep:');
            toKeep.forEach(f => lines.push(`# ${f.path}`));
          }
          
          // Then list files suggested for deletion
          const toDelete = group.files.filter(f => f.suggestedForDeletion);
          if (toDelete.length > 0) {
            lines.push('# Suggested for deletion:');
            toDelete.forEach(f => lines.push(f.path));
          }
          
          lines.push(''); // Empty line between groups
        }
        
        return lines.join('\n');
      }
    },

    clearDuplicateData: async () => {
      try {
        // Delete all duplicate files first (due to foreign key constraint)
        await db.delete(schema.duplicateFiles);
        
        // Then delete all duplicate groups
        await db.delete(schema.duplicateGroups);
        
        console.log('Successfully cleared all duplicate tracking data');
        
        return {
          success: true,
          message: 'All duplicate tracking data has been cleared successfully'
        };
      } catch (error) {
        console.error('Failed to clear duplicate data:', error);
        return {
          success: false,
          message: `Failed to clear duplicate data: ${error}`
        };
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

  DuplicateGroup: {
    files: async (parent: schema.DuplicateGroup) => {
      return await db.select()
        .from(schema.duplicateFiles)
        .where(eq(schema.duplicateFiles.groupId, parent.id))
        .orderBy(desc(schema.duplicateFiles.suggestedForDeletion));
    },
  },
};