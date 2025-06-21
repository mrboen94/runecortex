import './test-env'; // Must be first import
import { describe, test, expect, beforeEach } from 'bun:test';
import { StatisticsService } from '../src/services/statisticsService';
import { db, schema } from '../src/db';
import { 
  cleanDatabase, 
  insertTestMedia, 
  insertTestTag,
  insertTestCollection,
  generateMediaItems 
} from './setup';

describe('StatisticsService', () => {
  let stats: StatisticsService;

  beforeEach(async () => {
    await cleanDatabase();
    stats = new StatisticsService();
  });

  describe('overview statistics', () => {
    test('should calculate total counts', async () => {
      // Create test data
      await generateMediaItems(5, { fileType: 'image' });
      await generateMediaItems(3, { fileType: 'video' });
      
      const overview = await stats.getOverviewStats();
      
      expect(overview.totalMedia).toBe(8);
      expect(overview.totalImages).toBe(5);
      expect(overview.totalVideos).toBe(3);
    });

    test('should calculate storage usage', async () => {
      await insertTestMedia({ fileSize: 1024 * 1024 }); // 1MB
      await insertTestMedia({ fileSize: 2 * 1024 * 1024 }); // 2MB
      await insertTestMedia({ fileSize: 512 * 1024 }); // 512KB
      
      const overview = await stats.getOverviewStats();
      
      expect(overview.totalSizeBytes).toBe(3.5 * 1024 * 1024);
      expect(overview.totalSizeGB).toBeCloseTo(0.00335, 5);
    });

    test('should count favorites and organized', async () => {
      await generateMediaItems(3, { favorite: true });
      await generateMediaItems(2, { favorite: false });
      await generateMediaItems(4, { organized: true });
      
      const overview = await stats.getOverviewStats();
      
      expect(overview.totalFavorites).toBe(3);
      expect(overview.totalOrganized).toBe(4);
    });

    test('should calculate average ratings', async () => {
      await insertTestMedia({ rating: 5 });
      await insertTestMedia({ rating: 4 });
      await insertTestMedia({ rating: 3 });
      await insertTestMedia({ rating: null });
      
      const overview = await stats.getOverviewStats();
      
      expect(overview.averageRating).toBe(4); // (5+4+3)/3
      expect(overview.totalRated).toBe(3);
    });

    test('should track recent additions', async () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      await insertTestMedia({ createdAt: now });
      await insertTestMedia({ createdAt: dayAgo });
      await insertTestMedia({ createdAt: weekAgo });
      await insertTestMedia({ createdAt: monthAgo });
      
      const overview = await stats.getOverviewStats();
      
      expect(overview.addedLast24h).toBe(1);
      expect(overview.addedLast7d).toBe(3);
      expect(overview.addedLast30d).toBe(4);
    });
  });

  describe('timeline statistics', () => {
    test('should group by year', async () => {
      await insertTestMedia({ createdAt: new Date('2022-06-15') });
      await insertTestMedia({ createdAt: new Date('2023-01-10') });
      await insertTestMedia({ createdAt: new Date('2023-12-25') });
      await insertTestMedia({ createdAt: new Date('2024-03-20') });
      
      const timeline = await stats.getTimelineStats();
      
      expect(timeline.byYear).toHaveLength(3);
      expect(timeline.byYear.find(y => y.year === 2022)?.count).toBe(1);
      expect(timeline.byYear.find(y => y.year === 2023)?.count).toBe(2);
      expect(timeline.byYear.find(y => y.year === 2024)?.count).toBe(1);
    });

    test('should group by month', async () => {
      await insertTestMedia({ createdAt: new Date('2024-01-15') });
      await insertTestMedia({ createdAt: new Date('2024-01-20') });
      await insertTestMedia({ createdAt: new Date('2024-02-10') });
      
      const timeline = await stats.getTimelineStats();
      
      const year2024 = timeline.byYear.find(y => y.year === 2024);
      expect(year2024?.months).toHaveLength(2);
      expect(year2024?.months[0]).toEqual({ month: 1, count: 2 });
      expect(year2024?.months[1]).toEqual({ month: 2, count: 1 });
    });

    test('should group by day of week', async () => {
      // Create media for different days
      await insertTestMedia({ createdAt: new Date('2024-03-18') }); // Monday
      await insertTestMedia({ createdAt: new Date('2024-03-19') }); // Tuesday
      await insertTestMedia({ createdAt: new Date('2024-03-19') }); // Tuesday
      await insertTestMedia({ createdAt: new Date('2024-03-23') }); // Saturday
      
      const timeline = await stats.getTimelineStats();
      
      expect(timeline.byDayOfWeek).toHaveLength(3);
      expect(timeline.byDayOfWeek.find(d => d.day === 1)?.count).toBe(1); // Monday
      expect(timeline.byDayOfWeek.find(d => d.day === 2)?.count).toBe(2); // Tuesday
      expect(timeline.byDayOfWeek.find(d => d.day === 6)?.count).toBe(1); // Saturday
    });

    test('should group by hour', async () => {
      await insertTestMedia({ createdAt: new Date('2024-03-20T09:30:00') });
      await insertTestMedia({ createdAt: new Date('2024-03-20T09:45:00') });
      await insertTestMedia({ createdAt: new Date('2024-03-20T14:00:00') });
      
      const timeline = await stats.getTimelineStats();
      
      expect(timeline.byHour).toHaveLength(2);
      expect(timeline.byHour.find(h => h.hour === 9)?.count).toBe(2);
      expect(timeline.byHour.find(h => h.hour === 14)?.count).toBe(1);
    });
  });

  describe('storage statistics', () => {
    test('should calculate storage by type', async () => {
      await generateMediaItems(3, { fileType: 'image', fileSize: 1024 * 1024 });
      await generateMediaItems(2, { fileType: 'video', fileSize: 10 * 1024 * 1024 });
      
      const storage = await stats.getStorageStats();
      
      expect(storage.byType.image.count).toBe(3);
      expect(storage.byType.image.totalBytes).toBe(3 * 1024 * 1024);
      expect(storage.byType.video.count).toBe(2);
      expect(storage.byType.video.totalBytes).toBe(20 * 1024 * 1024);
    });

    test('should calculate average file sizes', async () => {
      await insertTestMedia({ fileType: 'image', fileSize: 1 * 1024 * 1024 });
      await insertTestMedia({ fileType: 'image', fileSize: 3 * 1024 * 1024 });
      await insertTestMedia({ fileType: 'video', fileSize: 100 * 1024 * 1024 });
      
      const storage = await stats.getStorageStats();
      
      expect(storage.byType.image.averageBytes).toBe(2 * 1024 * 1024);
      expect(storage.byType.video.averageBytes).toBe(100 * 1024 * 1024);
    });

    test('should identify largest files', async () => {
      const large1 = await insertTestMedia({ 
        filename: 'large1.mp4',
        fileSize: 500 * 1024 * 1024 
      });
      const large2 = await insertTestMedia({ 
        filename: 'large2.mp4',
        fileSize: 300 * 1024 * 1024 
      });
      await insertTestMedia({ 
        filename: 'small.jpg',
        fileSize: 1 * 1024 * 1024 
      });
      
      const storage = await stats.getStorageStats();
      
      expect(storage.largestFiles).toHaveLength(3);
      expect(storage.largestFiles[0].id).toBe(large1.id);
      expect(storage.largestFiles[1].id).toBe(large2.id);
    });

    test('should calculate storage distribution', async () => {
      // Create files in different size ranges
      await insertTestMedia({ fileSize: 500 * 1024 }); // < 1MB
      await insertTestMedia({ fileSize: 5 * 1024 * 1024 }); // 1-10MB
      await insertTestMedia({ fileSize: 50 * 1024 * 1024 }); // 10-100MB
      await insertTestMedia({ fileSize: 500 * 1024 * 1024 }); // 100MB-1GB
      await insertTestMedia({ fileSize: 2 * 1024 * 1024 * 1024 }); // > 1GB
      
      const storage = await stats.getStorageStats();
      
      expect(storage.distribution['<1MB']).toBe(1);
      expect(storage.distribution['1-10MB']).toBe(1);
      expect(storage.distribution['10-100MB']).toBe(1);
      expect(storage.distribution['100MB-1GB']).toBe(1);
      expect(storage.distribution['>1GB']).toBe(1);
    });
  });

  describe('tag statistics', () => {
    test('should count tags and usage', async () => {
      const tag1 = await insertTestTag({ name: 'popular' });
      const tag2 = await insertTestTag({ name: 'unused' });
      
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      const media3 = await insertTestMedia();
      
      // Add tags
      await db.insert(schema.mediaTags).values([
        { mediaId: media1.id, tagId: tag1.id },
        { mediaId: media2.id, tagId: tag1.id },
        { mediaId: media3.id, tagId: tag1.id }
      ]);
      
      const tagStats = await stats.getTagStats();
      
      expect(tagStats.totalTags).toBe(2);
      expect(tagStats.totalUnusedTags).toBe(1);
      expect(tagStats.mostUsed[0].name).toBe('popular');
      expect(tagStats.mostUsed[0].count).toBe(3);
    });

    test('should track recently used tags', async () => {
      const tag = await insertTestTag({ name: 'recent' });
      const media = await insertTestMedia();
      
      await db.insert(schema.mediaTags).values({
        mediaId: media.id,
        tagId: tag.id,
        createdAt: new Date()
      });
      
      const tagStats = await stats.getTagStats();
      
      expect(tagStats.recentlyUsed).toHaveLength(1);
      expect(tagStats.recentlyUsed[0].id).toBe(tag.id);
    });

    test('should calculate tag hierarchy depth', async () => {
      const parent = await insertTestTag({ name: 'parent' });
      const child = await insertTestTag({ name: 'child', parentId: parent.id });
      const grandchild = await insertTestTag({ 
        name: 'grandchild', 
        parentId: child.id 
      });
      
      const tagStats = await stats.getTagStats();
      
      expect(tagStats.hierarchyDepth).toBe(3);
    });
  });

  describe('collection statistics', () => {
    test('should count collections and sizes', async () => {
      const collection1 = await insertTestCollection({ title: 'Large Collection' });
      const collection2 = await insertTestCollection({ title: 'Small Collection' });
      
      // Add media to collections
      const mediaItems = await generateMediaItems(10);
      
      for (let i = 0; i < 8; i++) {
        await db.insert(schema.collectionMedia).values({
          collectionId: collection1.id,
          mediaId: mediaItems[i].id,
          orderIndex: i
        });
      }
      
      for (let i = 0; i < 2; i++) {
        await db.insert(schema.collectionMedia).values({
          collectionId: collection2.id,
          mediaId: mediaItems[i].id,
          orderIndex: i
        });
      }
      
      const collectionStats = await stats.getCollectionStats();
      
      expect(collectionStats.totalCollections).toBe(2);
      expect(collectionStats.totalMediaInCollections).toBe(8); // 8 unique media items
      expect(collectionStats.averageSize).toBe(5); // (8+2)/2
      expect(collectionStats.largestCollections[0].title).toBe('Large Collection');
      expect(collectionStats.largestCollections[0].mediaCount).toBe(8);
    });

    test('should track recently updated collections', async () => {
      const collection = await insertTestCollection({ 
        title: 'Recent',
        updatedAt: new Date()
      });
      
      const collectionStats = await stats.getCollectionStats();
      
      expect(collectionStats.recentlyUpdated).toHaveLength(1);
      expect(collectionStats.recentlyUpdated[0].id).toBe(collection.id);
    });
  });

  describe('quality statistics', () => {
    test('should analyze resolution distribution', async () => {
      await insertTestMedia({ width: 640, height: 480 }); // SD
      await insertTestMedia({ width: 1920, height: 1080 }); // HD
      await insertTestMedia({ width: 1920, height: 1080 }); // HD
      await insertTestMedia({ width: 3840, height: 2160 }); // 4K
      
      const quality = await stats.getQualityStats();
      
      expect(quality.resolutionDistribution['<HD']).toBe(1);
      expect(quality.resolutionDistribution['HD']).toBe(2);
      expect(quality.resolutionDistribution['4K']).toBe(1);
    });

    test('should analyze aspect ratios', async () => {
      await insertTestMedia({ width: 1920, height: 1080 }); // 16:9
      await insertTestMedia({ width: 1920, height: 1080 }); // 16:9
      await insertTestMedia({ width: 1000, height: 1000 }); // 1:1
      await insertTestMedia({ width: 1080, height: 1920 }); // 9:16
      
      const quality = await stats.getQualityStats();
      
      expect(quality.aspectRatios['16:9']).toBe(2);
      expect(quality.aspectRatios['1:1']).toBe(1);
      expect(quality.aspectRatios['9:16']).toBe(1);
    });

    test('should analyze video durations', async () => {
      await insertTestMedia({ fileType: 'video', duration: 30 }); // < 1min
      await insertTestMedia({ fileType: 'video', duration: 180 }); // 1-5min
      await insertTestMedia({ fileType: 'video', duration: 1800 }); // 5-30min
      await insertTestMedia({ fileType: 'video', duration: 3600 }); // 30-60min
      
      const quality = await stats.getQualityStats();
      
      expect(quality.videoDurations['<1min']).toBe(1);
      expect(quality.videoDurations['1-5min']).toBe(1);
      expect(quality.videoDurations['5-30min']).toBe(1);
      expect(quality.videoDurations['30-60min']).toBe(1);
    });
  });

  describe('activity statistics', () => {
    test('should track uploads by date', async () => {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      
      await insertTestMedia({ uploadedAt: today });
      await insertTestMedia({ uploadedAt: today });
      await insertTestMedia({ uploadedAt: yesterday });
      
      const activity = await stats.getActivityStats();
      
      expect(activity.uploadsByDate).toHaveLength(2);
      expect(activity.uploadsByDate[0].count).toBe(2);
      expect(activity.uploadsByDate[1].count).toBe(1);
    });

    test('should track scan activity', async () => {
      // Create scan sessions
      await db.insert(schema.scanSessions).values([
        {
          timestamp: new Date(),
          filesProcessed: 100,
          newFiles: 80,
          updated: 20,
          errors: 0,
          duplicatesSkipped: 5
        },
        {
          timestamp: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
          filesProcessed: 50,
          newFiles: 50,
          updated: 0,
          errors: 2,
          duplicatesSkipped: 0
        }
      ]);
      
      const activity = await stats.getActivityStats();
      
      expect(activity.recentScans).toHaveLength(2);
      expect(activity.recentScans[0].filesProcessed).toBe(100);
    });
  });

  describe('trend statistics', () => {
    test('should calculate growth rates', async () => {
      const now = new Date();
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      // Last month: 10 items
      for (let i = 0; i < 10; i++) {
        await insertTestMedia({ createdAt: lastMonth });
      }
      
      // Last week: 5 more items
      for (let i = 0; i < 5; i++) {
        await insertTestMedia({ createdAt: lastWeek });
      }
      
      // This week: 3 more items
      for (let i = 0; i < 3; i++) {
        await insertTestMedia({ createdAt: now });
      }
      
      const trends = await stats.getTrendStats();
      
      expect(trends.weeklyGrowth).toBeGreaterThan(0);
      expect(trends.monthlyGrowth).toBeGreaterThan(0);
    });

    test('should identify hot tags', async () => {
      const tag = await insertTestTag({ name: 'trending' });
      const media = await insertTestMedia();
      
      // Add tag recently
      await db.insert(schema.mediaTags).values({
        mediaId: media.id,
        tagId: tag.id,
        createdAt: new Date()
      });
      
      const trends = await stats.getTrendStats();
      
      expect(trends.hotTags).toHaveLength(1);
      expect(trends.hotTags[0].name).toBe('trending');
    });
  });

  describe('dashboard statistics', () => {
    test('should generate complete dashboard stats', async () => {
      // Create comprehensive test data
      await generateMediaItems(10);
      await insertTestTag({ name: 'test-tag' });
      await insertTestCollection({ title: 'Test Collection' });
      
      const dashboard = await stats.getDashboardStats();
      
      expect(dashboard).toHaveProperty('overview');
      expect(dashboard).toHaveProperty('timeline');
      expect(dashboard).toHaveProperty('storage');
      expect(dashboard).toHaveProperty('tags');
      expect(dashboard).toHaveProperty('collections');
      expect(dashboard).toHaveProperty('quality');
      expect(dashboard).toHaveProperty('activity');
      expect(dashboard).toHaveProperty('trends');
      
      expect(dashboard.overview.totalMedia).toBe(10);
    });
  });
});