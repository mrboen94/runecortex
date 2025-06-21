import { db, schema } from '../db';
import { between, eq, and, gte, lt, desc } from 'drizzle-orm';
import { MediaScanner } from '../services/scanner';
import { ThumbnailGenerator } from '../services/thumbnail';
import { MediaWatcher } from '../services/watcher';
import { thumbnailQueue } from '../services/thumbnailQueue';

const scanner = new MediaScanner();
const thumbnailGenerator = new ThumbnailGenerator();

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
      return await scanner.scanDirectory(path);
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
  },

  MediaItem: {
    thumbnailUrl: (parent: schema.MediaItem) => {
      if (parent.thumbnailGenerated) {
        return `/thumbnails/${parent.id}.jpg`;
      }
      return null;
    },
  },
};