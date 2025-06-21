import { db, schema } from '../db';
import { eq, and, gte, lte, sql, desc, asc } from 'drizzle-orm';
import { mediaMetadataService } from './mediaMetadataService';

export interface DashboardStats {
  overview: OverviewStats;
  timeline: TimelineStats;
  storage: StorageStats;
  tags: TagStats;
  collections: CollectionStats;
  quality: QualityStats;
  activity: ActivityStats;
  trends: TrendStats;
}

export interface OverviewStats {
  totalMedia: number;
  totalPhotos: number;
  totalVideos: number;
  totalSize: number;
  totalDuration: number;
  averageFileSize: number;
  averageVideoDuration: number;
  favoriteCount: number;
  organizedCount: number;
  lastScanDate: Date | null;
  lastAddedDate: Date | null;
}

export interface TimelineStats {
  mediaByYear: Array<{ year: number; count: number; size: number }>;
  mediaByMonth: Array<{ month: string; count: number }>;
  mediaByDayOfWeek: Array<{ day: string; count: number }>;
  mediaByHour: Array<{ hour: number; count: number }>;
  oldestMedia: Date | null;
  newestMedia: Date | null;
  busiestDay: { date: Date; count: number } | null;
}

export interface StorageStats {
  totalStorage: number;
  photoStorage: number;
  videoStorage: number;
  thumbnailStorage: number;
  storageByType: Array<{ type: string; size: number; count: number }>;
  largestFiles: Array<{ id: number; filename: string; size: number }>;
  duplicateStorage: number;
  potentialSavings: number;
}

export interface TagStats {
  totalTags: number;
  totalTaggedMedia: number;
  untaggedMedia: number;
  averageTagsPerMedia: number;
  mostUsedTags: Array<{ name: string; count: number }>;
  tagHierarchyDepth: number;
  recentlyAddedTags: Array<{ name: string; createdAt: Date }>;
}

export interface CollectionStats {
  totalCollections: number;
  totalMediaInCollections: number;
  averageCollectionSize: number;
  largestCollections: Array<{ id: number; title: string; count: number }>;
  recentCollections: Array<{ id: number; title: string; createdAt: Date }>;
  emptyCollections: number;
}

export interface QualityStats {
  resolutionDistribution: Array<{ resolution: string; count: number }>;
  orientationDistribution: Array<{ orientation: string; count: number }>;
  formatDistribution: Array<{ format: string; count: number }>;
  averageResolution: { width: number; height: number };
  highQualityCount: number; // 1080p and above
  lowQualityCount: number; // Below 720p
}

export interface ActivityStats {
  recentlyAdded: Array<{ date: Date; count: number }>;
  recentlyViewed: Array<{ id: number; filename: string; viewedAt: Date }>;
  mostViewed: Array<{ id: number; filename: string; viewCount: number }>;
  editHistory: Array<{ action: string; count: number; date: Date }>;
  scanHistory: Array<{ date: Date; filesProcessed: number; newFiles: number }>;
}

export interface TrendStats {
  growthRate: number; // Media added per day average
  uploadPatterns: Array<{ period: string; count: number }>;
  seasonalTrends: Array<{ season: string; averageCount: number }>;
  predictionNextMonth: number; // Predicted media count
  storageGrowthRate: number; // MB per day
}

export class StatisticsService {
  async getDashboardStats(): Promise<DashboardStats> {
    const [
      overview,
      timeline,
      storage,
      tags,
      collections,
      quality,
      activity,
      trends
    ] = await Promise.all([
      this.getOverviewStats(),
      this.getTimelineStats(),
      this.getStorageStats(),
      this.getTagStats(),
      this.getCollectionStats(),
      this.getQualityStats(),
      this.getActivityStats(),
      this.getTrendStats()
    ]);

    return {
      overview,
      timeline,
      storage,
      tags,
      collections,
      quality,
      activity,
      trends
    };
  }

  private async getOverviewStats(): Promise<OverviewStats> {
    const baseStats = await mediaMetadataService.getMediaStatistics();
    
    const [photos] = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.fileType, 'image'));
    
    const [videos] = await db.select({
      count: sql<number>`COUNT(*)`,
      totalDuration: sql<number>`SUM(${schema.mediaItems.duration})`
    })
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.fileType, 'video'));
    
    const [lastScan] = await db.select()
      .from(schema.scanSessions)
      .orderBy(desc(schema.scanSessions.timestamp))
      .limit(1);
    
    const [lastAdded] = await db.select()
      .from(schema.mediaItems)
      .orderBy(desc(schema.mediaItems.addedAt))
      .limit(1);
    
    return {
      totalMedia: baseStats.totalCount,
      totalPhotos: photos.count || 0,
      totalVideos: videos.count || 0,
      totalSize: baseStats.totalFileSize,
      totalDuration: videos.totalDuration || 0,
      averageFileSize: baseStats.totalCount > 0 ? Math.round(baseStats.totalFileSize / baseStats.totalCount) : 0,
      averageVideoDuration: videos.count > 0 ? Math.round((videos.totalDuration || 0) / videos.count) : 0,
      favoriteCount: baseStats.favoriteCount,
      organizedCount: baseStats.organizedCount,
      lastScanDate: lastScan?.timestamp || null,
      lastAddedDate: lastAdded?.addedAt || null
    };
  }

  private async getTimelineStats(): Promise<TimelineStats> {
    // Media by year
    const mediaByYear = await db.select({
      year: sql<number>`strftime('%Y', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`,
      size: sql<number>`SUM(${schema.mediaItems.fileSize})`
    })
      .from(schema.mediaItems)
      .groupBy(sql`strftime('%Y', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`)
      .orderBy(sql`year`);
    
    // Media by month (current year)
    const currentYear = new Date().getFullYear();
    const mediaByMonth = await db.select({
      month: sql<string>`strftime('%m', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .where(sql`strftime('%Y', datetime(${schema.mediaItems.createdAt}, 'unixepoch')) = ${currentYear.toString()}`)
      .groupBy(sql`strftime('%m', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`)
      .orderBy(sql`month`);
    
    // Media by day of week
    const mediaByDayOfWeek = await db.select({
      day: sql<number>`strftime('%w', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .groupBy(sql`strftime('%w', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`)
      .orderBy(sql`day`);
    
    // Media by hour
    const mediaByHour = await db.select({
      hour: sql<number>`strftime('%H', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .groupBy(sql`strftime('%H', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`)
      .orderBy(sql`hour`);
    
    // Oldest and newest
    const [oldest] = await db.select({ createdAt: schema.mediaItems.createdAt })
      .from(schema.mediaItems)
      .orderBy(asc(schema.mediaItems.createdAt))
      .limit(1);
    
    const [newest] = await db.select({ createdAt: schema.mediaItems.createdAt })
      .from(schema.mediaItems)
      .orderBy(desc(schema.mediaItems.createdAt))
      .limit(1);
    
    // Busiest day
    const [busiestDay] = await db.select({
      date: sql<string>`date(datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .groupBy(sql`date(datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(1);
    
    // Format results
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    return {
      mediaByYear: mediaByYear.map(item => ({
        year: parseInt(item.year as any),
        count: item.count,
        size: item.size
      })),
      mediaByMonth: mediaByMonth.map(item => ({
        month: monthNames[parseInt(item.month) - 1],
        count: item.count
      })),
      mediaByDayOfWeek: mediaByDayOfWeek.map(item => ({
        day: dayNames[parseInt(item.day as any)],
        count: item.count
      })),
      mediaByHour: mediaByHour.map(item => ({
        hour: parseInt(item.hour as any),
        count: item.count
      })),
      oldestMedia: oldest?.createdAt || null,
      newestMedia: newest?.createdAt || null,
      busiestDay: busiestDay ? {
        date: new Date(busiestDay.date),
        count: busiestDay.count
      } : null
    };
  }

  private async getStorageStats(): Promise<StorageStats> {
    const baseStats = await mediaMetadataService.getMediaStatistics();
    
    // Storage by file type
    const storageByType = await db.select({
      ext: sql<string>`LOWER(SUBSTR(${schema.mediaItems.filename}, -4))`,
      size: sql<number>`SUM(${schema.mediaItems.fileSize})`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .groupBy(sql`LOWER(SUBSTR(${schema.mediaItems.filename}, -4))`)
      .orderBy(desc(sql`SUM(${schema.mediaItems.fileSize})`));
    
    // Largest files
    const largestFiles = await db.select({
      id: schema.mediaItems.id,
      filename: schema.mediaItems.filename,
      size: schema.mediaItems.fileSize
    })
      .from(schema.mediaItems)
      .orderBy(desc(schema.mediaItems.fileSize))
      .limit(10);
    
    // Calculate duplicate storage
    const duplicates = await db.select({
      phash: schema.mediaItems.phash,
      count: sql<number>`COUNT(*)`,
      totalSize: sql<number>`SUM(${schema.mediaItems.fileSize})`,
      minSize: sql<number>`MIN(${schema.mediaItems.fileSize})`
    })
      .from(schema.mediaItems)
      .where(sql`${schema.mediaItems.phash} IS NOT NULL`)
      .groupBy(schema.mediaItems.phash)
      .having(sql`COUNT(*) > 1`);
    
    const duplicateStorage = duplicates.reduce((sum, dup) => 
      sum + (dup.totalSize - dup.minSize), 0
    );
    
    // Thumbnail storage estimate (300x300 JPEG ≈ 20KB per thumbnail)
    const [thumbnailCount] = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.thumbnailGenerated, true));
    
    const thumbnailStorage = (thumbnailCount.count || 0) * 20 * 1024; // 20KB per thumbnail
    
    return {
      totalStorage: baseStats.totalFileSize,
      photoStorage: storageByType.find(s => s.ext === '.jpg' || s.ext === '.png')?.size || 0,
      videoStorage: storageByType.find(s => s.ext === '.mp4' || s.ext === '.mov')?.size || 0,
      thumbnailStorage,
      storageByType: storageByType.map(item => ({
        type: item.ext,
        size: item.size,
        count: item.count
      })),
      largestFiles: largestFiles.map(item => ({
        id: item.id,
        filename: item.filename,
        size: item.size
      })),
      duplicateStorage,
      potentialSavings: duplicateStorage + (baseStats.totalCount - thumbnailCount.count) * 20 * 1024
    };
  }

  private async getTagStats(): Promise<TagStats> {
    const [totalTags] = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(schema.tags);
    
    const [taggedMedia] = await db.select({
      count: sql<number>`COUNT(DISTINCT ${schema.mediaTags.mediaId})`
    })
      .from(schema.mediaTags);
    
    const [totalMedia] = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems);
    
    const mostUsedTags = await db.select({
      name: schema.tags.name,
      count: sql<number>`COUNT(${schema.mediaTags.mediaId})`
    })
      .from(schema.tags)
      .leftJoin(schema.mediaTags, eq(schema.tags.id, schema.mediaTags.tagId))
      .groupBy(schema.tags.id)
      .orderBy(desc(sql`COUNT(${schema.mediaTags.mediaId})`))
      .limit(10);
    
    const recentTags = await db.select({
      name: schema.tags.name,
      createdAt: schema.tags.createdAt
    })
      .from(schema.tags)
      .orderBy(desc(schema.tags.createdAt))
      .limit(10);
    
    // Calculate tag hierarchy depth
    const [maxDepth] = await db.select({
      depth: sql<number>`
        WITH RECURSIVE tag_depth AS (
          SELECT id, parent_id, 0 as depth FROM ${schema.tags} WHERE parent_id IS NULL
          UNION ALL
          SELECT t.id, t.parent_id, td.depth + 1
          FROM ${schema.tags} t
          JOIN tag_depth td ON t.parent_id = td.id
        )
        SELECT MAX(depth) as depth FROM tag_depth
      `
    })
      .from(schema.tags);
    
    const taggedMediaCount = taggedMedia.count || 0;
    const totalMediaCount = totalMedia.count || 0;
    
    return {
      totalTags: totalTags.count || 0,
      totalTaggedMedia: taggedMediaCount,
      untaggedMedia: totalMediaCount - taggedMediaCount,
      averageTagsPerMedia: taggedMediaCount > 0 ? 
        Math.round((await db.select({ count: sql<number>`COUNT(*)` }).from(schema.mediaTags))[0].count / taggedMediaCount * 10) / 10 : 0,
      mostUsedTags: mostUsedTags.map(tag => ({
        name: tag.name,
        count: tag.count
      })),
      tagHierarchyDepth: maxDepth?.depth || 0,
      recentlyAddedTags: recentTags.map(tag => ({
        name: tag.name,
        createdAt: tag.createdAt
      }))
    };
  }

  private async getCollectionStats(): Promise<CollectionStats> {
    const [totalCollections] = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(schema.collections);
    
    const [mediaInCollections] = await db.select({
      count: sql<number>`COUNT(DISTINCT ${schema.collectionMedia.mediaId})`
    })
      .from(schema.collectionMedia);
    
    const largestCollections = await db.select({
      id: schema.collections.id,
      title: schema.collections.title,
      count: sql<number>`COUNT(${schema.collectionMedia.mediaId})`
    })
      .from(schema.collections)
      .leftJoin(schema.collectionMedia, eq(schema.collections.id, schema.collectionMedia.collectionId))
      .groupBy(schema.collections.id)
      .orderBy(desc(sql`COUNT(${schema.collectionMedia.mediaId})`))
      .limit(10);
    
    const recentCollections = await db.select({
      id: schema.collections.id,
      title: schema.collections.title,
      createdAt: schema.collections.createdAt
    })
      .from(schema.collections)
      .orderBy(desc(schema.collections.createdAt))
      .limit(10);
    
    const [emptyCollections] = await db.select({
      count: sql<number>`COUNT(*)`
    })
      .from(schema.collections)
      .leftJoin(schema.collectionMedia, eq(schema.collections.id, schema.collectionMedia.collectionId))
      .where(sql`${schema.collectionMedia.mediaId} IS NULL`);
    
    const totalCollectionCount = totalCollections.count || 0;
    
    return {
      totalCollections: totalCollectionCount,
      totalMediaInCollections: mediaInCollections.count || 0,
      averageCollectionSize: totalCollectionCount > 0 ? 
        Math.round((mediaInCollections.count || 0) / totalCollectionCount) : 0,
      largestCollections: largestCollections.map(col => ({
        id: col.id,
        title: col.title,
        count: col.count
      })),
      recentCollections: recentCollections.map(col => ({
        id: col.id,
        title: col.title,
        createdAt: col.createdAt
      })),
      emptyCollections: emptyCollections.count || 0
    };
  }

  private async getQualityStats(): Promise<QualityStats> {
    // Resolution distribution
    const resolutions = await db.select({
      width: schema.mediaItems.width,
      height: schema.mediaItems.height,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .where(and(
        sql`${schema.mediaItems.width} IS NOT NULL`,
        sql`${schema.mediaItems.height} IS NOT NULL`
      ))
      .groupBy(schema.mediaItems.width, schema.mediaItems.height);
    
    // Categorize resolutions
    const resolutionCategories = new Map<string, number>();
    let totalWidth = 0;
    let totalHeight = 0;
    let highQuality = 0;
    let lowQuality = 0;
    
    for (const res of resolutions) {
      if (res.width && res.height) {
        totalWidth += res.width * res.count;
        totalHeight += res.height * res.count;
        
        let category = 'Other';
        if (res.height >= 2160) {
          category = '4K+';
          highQuality += res.count;
        } else if (res.height >= 1080) {
          category = 'Full HD';
          highQuality += res.count;
        } else if (res.height >= 720) {
          category = 'HD';
        } else {
          category = 'SD';
          lowQuality += res.count;
        }
        
        resolutionCategories.set(category, (resolutionCategories.get(category) || 0) + res.count);
      }
    }
    
    // Orientation distribution
    const orientations = await db.select({
      width: schema.mediaItems.width,
      height: schema.mediaItems.height,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .where(and(
        sql`${schema.mediaItems.width} IS NOT NULL`,
        sql`${schema.mediaItems.height} IS NOT NULL`
      ))
      .groupBy(schema.mediaItems.width, schema.mediaItems.height);
    
    const orientationCounts = { portrait: 0, landscape: 0, square: 0 };
    
    for (const item of orientations) {
      if (item.width && item.height) {
        const ratio = item.width / item.height;
        if (ratio > 1.2) {
          orientationCounts.landscape += item.count;
        } else if (ratio < 0.8) {
          orientationCounts.portrait += item.count;
        } else {
          orientationCounts.square += item.count;
        }
      }
    }
    
    // Format distribution
    const formats = await db.select({
      ext: sql<string>`LOWER(SUBSTR(${schema.mediaItems.filename}, -4))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .groupBy(sql`LOWER(SUBSTR(${schema.mediaItems.filename}, -4))`)
      .orderBy(desc(sql`COUNT(*)`));
    
    const totalCount = resolutions.reduce((sum, res) => sum + res.count, 0);
    
    return {
      resolutionDistribution: Array.from(resolutionCategories.entries()).map(([resolution, count]) => ({
        resolution,
        count
      })),
      orientationDistribution: Object.entries(orientationCounts).map(([orientation, count]) => ({
        orientation,
        count
      })),
      formatDistribution: formats.map(f => ({
        format: f.ext,
        count: f.count
      })),
      averageResolution: totalCount > 0 ? {
        width: Math.round(totalWidth / totalCount),
        height: Math.round(totalHeight / totalCount)
      } : { width: 0, height: 0 },
      highQualityCount: highQuality,
      lowQualityCount: lowQuality
    };
  }

  private async getActivityStats(): Promise<ActivityStats> {
    // Recently added (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentlyAdded = await db.select({
      date: sql<string>`date(datetime(${schema.mediaItems.addedAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .where(gte(schema.mediaItems.addedAt, thirtyDaysAgo))
      .groupBy(sql`date(datetime(${schema.mediaItems.addedAt}, 'unixepoch'))`)
      .orderBy(desc(sql`date`));
    
    // Scan history
    const scanHistory = await db.select({
      date: schema.scanSessions.timestamp,
      filesProcessed: schema.scanSessions.filesProcessed,
      newFiles: schema.scanSessions.newFiles
    })
      .from(schema.scanSessions)
      .where(eq(schema.scanSessions.status, 'completed'))
      .orderBy(desc(schema.scanSessions.timestamp))
      .limit(10);
    
    // Mock data for features not yet implemented
    const recentlyViewed: any[] = [];
    const mostViewed: any[] = [];
    const editHistory: any[] = [];
    
    return {
      recentlyAdded: recentlyAdded.map(item => ({
        date: new Date(item.date),
        count: item.count
      })),
      recentlyViewed,
      mostViewed,
      editHistory,
      scanHistory: scanHistory.map(scan => ({
        date: scan.timestamp,
        filesProcessed: scan.filesProcessed || 0,
        newFiles: scan.newFiles || 0
      }))
    };
  }

  private async getTrendStats(): Promise<TrendStats> {
    // Calculate growth rate (media added per day over last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const [recentGrowth] = await db.select({
      count: sql<number>`COUNT(*)`,
      totalSize: sql<number>`SUM(${schema.mediaItems.fileSize})`
    })
      .from(schema.mediaItems)
      .where(gte(schema.mediaItems.addedAt, thirtyDaysAgo));
    
    const growthRate = (recentGrowth.count || 0) / 30;
    const storageGrowthRate = ((recentGrowth.totalSize || 0) / 30) / (1024 * 1024); // MB per day
    
    // Upload patterns (by day of week)
    const uploadPatterns = await db.select({
      dayOfWeek: sql<number>`strftime('%w', datetime(${schema.mediaItems.addedAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .groupBy(sql`strftime('%w', datetime(${schema.mediaItems.addedAt}, 'unixepoch'))`);
    
    // Seasonal trends
    const seasonalData = await db.select({
      month: sql<number>`strftime('%m', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`,
      count: sql<number>`COUNT(*)`
    })
      .from(schema.mediaItems)
      .groupBy(sql`strftime('%m', datetime(${schema.mediaItems.createdAt}, 'unixepoch'))`);
    
    const seasonalTrends = [
      { season: 'Spring', months: [3, 4, 5] },
      { season: 'Summer', months: [6, 7, 8] },
      { season: 'Autumn', months: [9, 10, 11] },
      { season: 'Winter', months: [12, 1, 2] }
    ].map(season => {
      const counts = seasonalData
        .filter(d => season.months.includes(parseInt(d.month as any)))
        .map(d => d.count);
      
      const average = counts.length > 0 ? 
        counts.reduce((a, b) => a + b, 0) / counts.length : 0;
      
      return {
        season: season.season,
        averageCount: Math.round(average)
      };
    });
    
    // Simple prediction for next month based on growth rate
    const predictionNextMonth = Math.round(growthRate * 30);
    
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    return {
      growthRate: Math.round(growthRate * 10) / 10,
      uploadPatterns: uploadPatterns.map(p => ({
        period: dayNames[parseInt(p.dayOfWeek as any)],
        count: p.count
      })),
      seasonalTrends,
      predictionNextMonth,
      storageGrowthRate: Math.round(storageGrowthRate * 10) / 10
    };
  }

  async getCustomStats(dateRange?: { start: Date; end: Date }): Promise<any> {
    let query = db.select()
      .from(schema.mediaItems);
    
    if (dateRange) {
      query = query.where(and(
        gte(schema.mediaItems.createdAt, dateRange.start),
        lte(schema.mediaItems.createdAt, dateRange.end)
      ));
    }
    
    const items = await query;
    
    // Custom analysis based on date range
    return {
      count: items.length,
      dateRange,
      // Add more custom stats as needed
    };
  }

  async getStorageForecast(months: number = 12): Promise<Array<{
    month: string;
    estimatedSize: number;
    estimatedCount: number;
  }>> {
    const stats = await this.getTrendStats();
    const forecast: Array<{ month: string; estimatedSize: number; estimatedCount: number }> = [];
    
    const currentDate = new Date();
    let cumulativeSize = (await this.getStorageStats()).totalStorage;
    let cumulativeCount = (await this.getOverviewStats()).totalMedia;
    
    for (let i = 1; i <= months; i++) {
      const futureDate = new Date(currentDate);
      futureDate.setMonth(futureDate.getMonth() + i);
      
      cumulativeSize += stats.storageGrowthRate * 30 * 1024 * 1024; // Convert MB to bytes
      cumulativeCount += stats.growthRate * 30;
      
      forecast.push({
        month: futureDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short' }),
        estimatedSize: Math.round(cumulativeSize),
        estimatedCount: Math.round(cumulativeCount)
      });
    }
    
    return forecast;
  }
}

export const statisticsService = new StatisticsService();