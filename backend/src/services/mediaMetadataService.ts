import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { tagService } from './tagService';
import { collectionService } from './collectionService';

export class MediaMetadataService {
  async updateMediaMetadata(input: {
    id: number;
    title?: string;
    description?: string;
    rating?: number;
    favorite?: boolean;
    organized?: boolean;
  }): Promise<schema.MediaItem | null> {
    const { id, ...updates } = input;
    
    const [updated] = await db.update(schema.mediaItems)
      .set(updates)
      .where(eq(schema.mediaItems.id, id))
      .returning();
    
    return updated || null;
  }

  async bulkUpdateMediaMetadata(input: {
    ids: number[];
    title?: string;
    description?: string;
    rating?: number;
    favorite?: boolean;
    organized?: boolean;
  }): Promise<number> {
    const { ids, ...updates } = input;
    
    const result = await db.update(schema.mediaItems)
      .set(updates)
      .where(inArray(schema.mediaItems.id, ids))
      .returning();
    
    return result.length;
  }

  async updateMediaTags(input: {
    mediaIds: number[];
    tagIds: number[];
    mode: 'SET' | 'ADD' | 'REMOVE';
  }): Promise<void> {
    const { mediaIds, tagIds, mode } = input;
    
    switch (mode) {
      case 'SET':
        // Remove all existing tags
        await db.delete(schema.mediaTags)
          .where(inArray(schema.mediaTags.mediaId, mediaIds));
        
        // Add new tags
        if (tagIds.length > 0) {
          await tagService.addTagsToMedia(mediaIds, tagIds);
        }
        break;
      
      case 'ADD':
        await tagService.addTagsToMedia(mediaIds, tagIds);
        break;
      
      case 'REMOVE':
        await tagService.removeTagsFromMedia(mediaIds, tagIds);
        break;
    }
  }

  async updateMediaCollections(input: {
    mediaIds: number[];
    collectionIds: number[];
    mode: 'SET' | 'ADD' | 'REMOVE';
  }): Promise<void> {
    const { mediaIds, collectionIds, mode } = input;
    
    switch (mode) {
      case 'SET':
        // Remove from all existing collections
        await db.delete(schema.collectionMedia)
          .where(inArray(schema.collectionMedia.mediaId, mediaIds));
        
        // Add to new collections
        if (collectionIds.length > 0) {
          for (const collectionId of collectionIds) {
            await collectionService.addMediaToCollection(collectionId, mediaIds);
          }
        }
        break;
      
      case 'ADD':
        for (const collectionId of collectionIds) {
          await collectionService.addMediaToCollection(collectionId, mediaIds);
        }
        break;
      
      case 'REMOVE':
        for (const collectionId of collectionIds) {
          await collectionService.removeMediaFromCollection(collectionId, mediaIds);
        }
        break;
    }
  }

  async getMediaWithFullMetadata(id: number): Promise<any | null> {
    const [media] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, id));
    
    if (!media) return null;
    
    // Get tags
    const tags = await tagService.getMediaTags(id);
    
    // Get collections
    const collections = await collectionService.getMediaCollections(id);
    
    // Get custom fields
    const customFields = await this.getMediaCustomFields(id);
    
    return {
      ...media,
      tags,
      collections,
      customFields,
    };
  }

  async setCustomField(
    entityType: 'media' | 'collection' | 'tag',
    entityId: number,
    fieldName: string,
    fieldValue: string | null,
    fieldType: string = 'string'
  ): Promise<void> {
    if (fieldValue === null) {
      // Delete the custom field
      await db.delete(schema.customFields)
        .where(
          sql`${schema.customFields.entityType} = ${entityType} 
          AND ${schema.customFields.entityId} = ${entityId} 
          AND ${schema.customFields.fieldName} = ${fieldName}`
        );
      return;
    }
    
    // Check if field exists
    const [existing] = await db.select()
      .from(schema.customFields)
      .where(
        sql`${schema.customFields.entityType} = ${entityType} 
        AND ${schema.customFields.entityId} = ${entityId} 
        AND ${schema.customFields.fieldName} = ${fieldName}`
      );
    
    if (existing) {
      // Update existing field
      await db.update(schema.customFields)
        .set({ fieldValue, fieldType })
        .where(eq(schema.customFields.id, existing.id));
    } else {
      // Insert new field
      await db.insert(schema.customFields)
        .values({
          entityType,
          entityId,
          fieldName,
          fieldValue,
          fieldType,
        });
    }
  }

  async getCustomFields(
    entityType: 'media' | 'collection' | 'tag',
    entityId: number
  ): Promise<schema.CustomField[]> {
    return db.select()
      .from(schema.customFields)
      .where(
        sql`${schema.customFields.entityType} = ${entityType} 
        AND ${schema.customFields.entityId} = ${entityId}`
      );
  }

  async getMediaCustomFields(mediaId: number): Promise<schema.CustomField[]> {
    return this.getCustomFields('media', mediaId);
  }

  async bulkSetCustomField(
    entityType: 'media' | 'collection' | 'tag',
    entityIds: number[],
    fieldName: string,
    fieldValue: string | null,
    fieldType: string = 'string'
  ): Promise<void> {
    if (fieldValue === null) {
      // Delete the custom fields
      await db.delete(schema.customFields)
        .where(
          sql`${schema.customFields.entityType} = ${entityType} 
          AND ${schema.customFields.entityId} IN ${entityIds} 
          AND ${schema.customFields.fieldName} = ${fieldName}`
        );
      return;
    }
    
    // Get existing fields
    const existing = await db.select()
      .from(schema.customFields)
      .where(
        sql`${schema.customFields.entityType} = ${entityType} 
        AND ${schema.customFields.entityId} IN ${entityIds} 
        AND ${schema.customFields.fieldName} = ${fieldName}`
      );
    
    const existingEntityIds = new Set(existing.map(e => e.entityId));
    const toInsert: schema.NewCustomField[] = [];
    
    // Update existing fields
    if (existing.length > 0) {
      await db.update(schema.customFields)
        .set({ fieldValue, fieldType })
        .where(inArray(schema.customFields.id, existing.map(e => e.id)));
    }
    
    // Insert new fields
    for (const entityId of entityIds) {
      if (!existingEntityIds.has(entityId)) {
        toInsert.push({
          entityType,
          entityId,
          fieldName,
          fieldValue,
          fieldType,
        });
      }
    }
    
    if (toInsert.length > 0) {
      await db.insert(schema.customFields)
        .values(toInsert);
    }
  }

  async getAllCustomFieldNames(): Promise<Array<{ fieldName: string; count: number }>> {
    const results = await db.select({
      fieldName: schema.customFields.fieldName,
      count: sql<number>`COUNT(*)`,
    })
      .from(schema.customFields)
      .groupBy(schema.customFields.fieldName)
      .orderBy(sql`COUNT(*) DESC`);
    
    return results.map(r => ({
      fieldName: r.fieldName,
      count: r.count,
    }));
  }

  async toggleFavorite(mediaId: number): Promise<schema.MediaItem | null> {
    const [media] = await db.select({ favorite: schema.mediaItems.favorite })
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId));
    
    if (!media) return null;
    
    const [updated] = await db.update(schema.mediaItems)
      .set({ favorite: !media.favorite })
      .where(eq(schema.mediaItems.id, mediaId))
      .returning();
    
    return updated || null;
  }

  async bulkToggleFavorite(mediaIds: number[]): Promise<number> {
    // Get current favorite status
    const media = await db.select({
      id: schema.mediaItems.id,
      favorite: schema.mediaItems.favorite,
    })
      .from(schema.mediaItems)
      .where(inArray(schema.mediaItems.id, mediaIds));
    
    // Group by favorite status
    const favorited = media.filter(m => m.favorite).map(m => m.id);
    const notFavorited = media.filter(m => !m.favorite).map(m => m.id);
    
    let updated = 0;
    
    // Toggle favorited to false
    if (favorited.length > 0) {
      const result = await db.update(schema.mediaItems)
        .set({ favorite: false })
        .where(inArray(schema.mediaItems.id, favorited))
        .returning();
      updated += result.length;
    }
    
    // Toggle not favorited to true
    if (notFavorited.length > 0) {
      const result = await db.update(schema.mediaItems)
        .set({ favorite: true })
        .where(inArray(schema.mediaItems.id, notFavorited))
        .returning();
      updated += result.length;
    }
    
    return updated;
  }

  async autoGenerateTitle(mediaId: number): Promise<string | null> {
    const [media] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId));
    
    if (!media) return null;
    
    // Extract title from filename
    const filename = media.filename;
    let title = filename
      .replace(/\.[^/.]+$/, '') // Remove extension
      .replace(/[-_]/g, ' ') // Replace dashes and underscores with spaces
      .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
      .replace(/\b\w/g, l => l.toUpperCase()) // Capitalize first letter of each word
      .trim();
    
    // Remove common patterns
    title = title
      .replace(/\b(IMG|VID|DSC|DCIM|)\s*\d+\b/gi, '') // Remove camera prefixes
      .replace(/\b\d{8}\b/g, '') // Remove date patterns
      .replace(/\b\d{6}\b/g, '') // Remove time patterns
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
    
    // If title is empty or too short, use original filename without extension
    if (title.length < 3) {
      title = filename.replace(/\.[^/.]+$/, '');
    }
    
    // Update the media item
    await this.updateMediaMetadata({
      id: mediaId,
      title,
    });
    
    return title;
  }

  async bulkAutoGenerateTitles(mediaIds: number[]): Promise<number> {
    let updated = 0;
    
    for (const id of mediaIds) {
      const title = await this.autoGenerateTitle(id);
      if (title) updated++;
    }
    
    return updated;
  }

  async getMediaStatistics(mediaIds?: number[]): Promise<{
    totalCount: number;
    totalFileSize: number;
    totalDuration: number;
    averageRating: number;
    favoriteCount: number;
    organizedCount: number;
    taggedCount: number;
    inCollectionCount: number;
    fileTypeBreakdown: Record<string, number>;
    resolutionBreakdown: Record<string, number>;
  }> {
    let baseQuery = db.select({
      count: sql<number>`COUNT(*)`,
      totalFileSize: sql<number>`SUM(${schema.mediaItems.fileSize})`,
      totalDuration: sql<number>`SUM(${schema.mediaItems.duration})`,
      averageRating: sql<number>`AVG(${schema.mediaItems.rating})`,
      favoriteCount: sql<number>`SUM(CASE WHEN ${schema.mediaItems.favorite} THEN 1 ELSE 0 END)`,
      organizedCount: sql<number>`SUM(CASE WHEN ${schema.mediaItems.organized} THEN 1 ELSE 0 END)`,
    })
      .from(schema.mediaItems);
    
    if (mediaIds && mediaIds.length > 0) {
      baseQuery = baseQuery.where(inArray(schema.mediaItems.id, mediaIds));
    }
    
    const [baseStats] = await baseQuery;
    
    // Get tagged count
    let taggedQuery = db.select({
      count: sql<number>`COUNT(DISTINCT ${schema.mediaTags.mediaId})`,
    })
      .from(schema.mediaTags);
    
    if (mediaIds && mediaIds.length > 0) {
      taggedQuery = taggedQuery.where(inArray(schema.mediaTags.mediaId, mediaIds));
    }
    
    const [taggedStats] = await taggedQuery;
    
    // Get in collection count
    let collectionQuery = db.select({
      count: sql<number>`COUNT(DISTINCT ${schema.collectionMedia.mediaId})`,
    })
      .from(schema.collectionMedia);
    
    if (mediaIds && mediaIds.length > 0) {
      collectionQuery = collectionQuery.where(inArray(schema.collectionMedia.mediaId, mediaIds));
    }
    
    const [collectionStats] = await collectionQuery;
    
    // Get file type breakdown
    let fileTypeQuery = db.select({
      fileType: schema.mediaItems.fileType,
      count: sql<number>`COUNT(*)`,
    })
      .from(schema.mediaItems)
      .groupBy(schema.mediaItems.fileType);
    
    if (mediaIds && mediaIds.length > 0) {
      fileTypeQuery = fileTypeQuery.where(inArray(schema.mediaItems.id, mediaIds));
    }
    
    const fileTypes = await fileTypeQuery;
    
    const fileTypeBreakdown: Record<string, number> = {};
    for (const ft of fileTypes) {
      fileTypeBreakdown[ft.fileType] = ft.count;
    }
    
    // Get resolution breakdown
    let resolutionQuery = db.select({
      width: schema.mediaItems.width,
      height: schema.mediaItems.height,
    })
      .from(schema.mediaItems)
      .where(sql`${schema.mediaItems.width} IS NOT NULL AND ${schema.mediaItems.height} IS NOT NULL`);
    
    if (mediaIds && mediaIds.length > 0) {
      resolutionQuery = resolutionQuery.where(inArray(schema.mediaItems.id, mediaIds));
    }
    
    const resolutions = await resolutionQuery;
    
    const resolutionBreakdown: Record<string, number> = {};
    for (const res of resolutions) {
      if (res.width && res.height) {
        const resolution = getResolutionEnum(res.width, res.height);
        resolutionBreakdown[resolution] = (resolutionBreakdown[resolution] || 0) + 1;
      }
    }
    
    return {
      totalCount: baseStats.count || 0,
      totalFileSize: baseStats.totalFileSize || 0,
      totalDuration: baseStats.totalDuration || 0,
      averageRating: baseStats.averageRating || 0,
      favoriteCount: baseStats.favoriteCount || 0,
      organizedCount: baseStats.organizedCount || 0,
      taggedCount: taggedStats.count || 0,
      inCollectionCount: collectionStats.count || 0,
      fileTypeBreakdown,
      resolutionBreakdown,
    };
  }
}

export const mediaMetadataService = new MediaMetadataService();