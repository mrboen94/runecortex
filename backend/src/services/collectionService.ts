import { eq, inArray, and, isNull, sql, desc } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';

export class CollectionService {
  async createCollection(input: {
    title: string;
    description?: string;
    date?: Date;
    rating?: number;
    favorite?: boolean;
    organized?: boolean;
    parentId?: number;
    coverMediaId?: number;
  }): Promise<schema.Collection> {
    const [collection] = await db.insert(schema.collections)
      .values({
        ...input,
        date: input.date ? Math.floor(input.date.getTime() / 1000) : undefined,
      })
      .returning();
    
    return this.formatCollection(collection);
  }

  async updateCollection(input: {
    id: number;
    title?: string;
    description?: string;
    date?: Date;
    rating?: number;
    favorite?: boolean;
    organized?: boolean;
    parentId?: number;
    coverMediaId?: number;
  }): Promise<schema.Collection | null> {
    const { id, date, ...updates } = input;
    
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    
    if (date !== undefined) {
      updateData.date = date ? Math.floor(date.getTime() / 1000) : null;
    }
    
    const [updated] = await db.update(schema.collections)
      .set(updateData)
      .where(eq(schema.collections.id, id))
      .returning();
    
    return updated ? this.formatCollection(updated) : null;
  }

  async deleteCollection(id: number): Promise<boolean> {
    // First, update any child collections to have no parent
    await db.update(schema.collections)
      .set({ parentId: null })
      .where(eq(schema.collections.parentId, id));
    
    const deleted = await db.delete(schema.collections)
      .where(eq(schema.collections.id, id))
      .returning();
    
    return deleted.length > 0;
  }

  async getCollection(id: number): Promise<schema.Collection | null> {
    const [collection] = await db.select()
      .from(schema.collections)
      .where(eq(schema.collections.id, id));
    
    return collection ? this.formatCollection(collection) : null;
  }

  async getAllCollections(): Promise<schema.Collection[]> {
    const collections = await db.select()
      .from(schema.collections)
      .orderBy(desc(schema.collections.date), schema.collections.title);
    
    return collections.map(col => this.formatCollection(col));
  }

  async getCollectionChildren(parentId: number): Promise<schema.Collection[]> {
    const children = await db.select()
      .from(schema.collections)
      .where(eq(schema.collections.parentId, parentId))
      .orderBy(desc(schema.collections.date), schema.collections.title);
    
    return children.map(col => this.formatCollection(col));
  }

  async getCollectionParent(collectionId: number): Promise<schema.Collection | null> {
    const [collection] = await db.select()
      .from(schema.collections)
      .where(eq(schema.collections.id, collectionId));
    
    if (!collection || !collection.parentId) return null;
    
    return this.getCollection(collection.parentId);
  }

  async getCollectionMediaCount(collectionId: number): Promise<number> {
    const [result] = await db.select({
      count: sql<number>`COUNT(DISTINCT ${schema.collectionMedia.mediaId})`,
    })
      .from(schema.collectionMedia)
      .where(eq(schema.collectionMedia.collectionId, collectionId));
    
    return result?.count || 0;
  }

  async getCollectionChildCount(collectionId: number): Promise<number> {
    const [result] = await db.select({
      count: sql<number>`COUNT(*)`,
    })
      .from(schema.collections)
      .where(eq(schema.collections.parentId, collectionId));
    
    return result?.count || 0;
  }

  async getCollectionMedia(collectionId: number, limit?: number, offset?: number): Promise<schema.MediaItem[]> {
    let query = db.select({
      media: schema.mediaItems,
      orderIndex: schema.collectionMedia.orderIndex,
    })
      .from(schema.collectionMedia)
      .innerJoin(schema.mediaItems, eq(schema.collectionMedia.mediaId, schema.mediaItems.id))
      .where(eq(schema.collectionMedia.collectionId, collectionId))
      .orderBy(schema.collectionMedia.orderIndex, desc(schema.mediaItems.createdAt));
    
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    
    if (offset !== undefined) {
      query = query.offset(offset);
    }
    
    const results = await query;
    return results.map(({ media }) => media);
  }

  async addMediaToCollection(collectionId: number, mediaIds: number[]): Promise<void> {
    // Get current max order index
    const [maxOrder] = await db.select({
      max: sql<number>`COALESCE(MAX(${schema.collectionMedia.orderIndex}), -1)`,
    })
      .from(schema.collectionMedia)
      .where(eq(schema.collectionMedia.collectionId, collectionId));
    
    let currentOrder = (maxOrder?.max || -1) + 1;
    
    const values = mediaIds.map(mediaId => ({
      collectionId,
      mediaId,
      orderIndex: currentOrder++,
    }));
    
    if (values.length > 0) {
      // Insert ignore duplicates
      await db.insert(schema.collectionMedia)
        .values(values)
        .onConflictDoNothing();
    }
  }

  async removeMediaFromCollection(collectionId: number, mediaIds: number[]): Promise<void> {
    await db.delete(schema.collectionMedia)
      .where(and(
        eq(schema.collectionMedia.collectionId, collectionId),
        inArray(schema.collectionMedia.mediaId, mediaIds)
      ));
  }

  async reorderMediaInCollection(collectionId: number, mediaId: number, newIndex: number): Promise<void> {
    // Get all media in collection ordered by current index
    const allMedia = await db.select({
      mediaId: schema.collectionMedia.mediaId,
      orderIndex: schema.collectionMedia.orderIndex,
    })
      .from(schema.collectionMedia)
      .where(eq(schema.collectionMedia.collectionId, collectionId))
      .orderBy(schema.collectionMedia.orderIndex);
    
    // Find current position
    const currentIndex = allMedia.findIndex(m => m.mediaId === mediaId);
    if (currentIndex === -1) return;
    
    // Remove from current position and insert at new position
    const [moved] = allMedia.splice(currentIndex, 1);
    allMedia.splice(newIndex, 0, moved);
    
    // Update all order indices
    const updates = allMedia.map((media, index) => ({
      collectionId,
      mediaId: media.mediaId,
      orderIndex: index,
    }));
    
    // Batch update
    for (const update of updates) {
      await db.update(schema.collectionMedia)
        .set({ orderIndex: update.orderIndex })
        .where(and(
          eq(schema.collectionMedia.collectionId, update.collectionId),
          eq(schema.collectionMedia.mediaId, update.mediaId)
        ));
    }
  }

  async getMediaCollections(mediaId: number): Promise<schema.Collection[]> {
    const collections = await db.select({
      collection: schema.collections,
    })
      .from(schema.collectionMedia)
      .innerJoin(schema.collections, eq(schema.collectionMedia.collectionId, schema.collections.id))
      .where(eq(schema.collectionMedia.mediaId, mediaId))
      .orderBy(desc(schema.collections.date), schema.collections.title);
    
    return collections.map(({ collection }) => this.formatCollection(collection));
  }

  async getRootCollections(): Promise<schema.Collection[]> {
    const collections = await db.select()
      .from(schema.collections)
      .where(isNull(schema.collections.parentId))
      .orderBy(desc(schema.collections.date), schema.collections.title);
    
    return collections.map(col => this.formatCollection(col));
  }

  async getCollectionHierarchy(collectionId: number): Promise<schema.Collection[]> {
    const hierarchy: schema.Collection[] = [];
    let currentId: number | null = collectionId;
    
    while (currentId !== null) {
      const collection = await this.getCollection(currentId);
      if (!collection) break;
      
      hierarchy.unshift(collection);
      currentId = collection.parentId;
    }
    
    return hierarchy;
  }

  async getAllCollectionsWithCounts(): Promise<Array<schema.Collection & { mediaCount: number; childCount: number }>> {
    const collections = await db.select({
      collection: schema.collections,
      mediaCount: sql<number>`(
        SELECT COUNT(DISTINCT media_id) 
        FROM ${schema.collectionMedia} 
        WHERE collection_id = ${schema.collections.id}
      )`,
      childCount: sql<number>`(
        SELECT COUNT(*) 
        FROM ${schema.collections} AS children 
        WHERE children.parent_id = ${schema.collections.id}
      )`,
    })
      .from(schema.collections)
      .orderBy(desc(schema.collections.date), schema.collections.title);
    
    return collections.map(({ collection, mediaCount, childCount }) => ({
      ...this.formatCollection(collection),
      mediaCount,
      childCount,
    }));
  }

  async getCoverMedia(collectionId: number): Promise<schema.MediaItem | null> {
    const [collection] = await db.select()
      .from(schema.collections)
      .where(eq(schema.collections.id, collectionId));
    
    if (!collection) return null;
    
    // If cover media is set, use it
    if (collection.coverMediaId) {
      const [media] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, collection.coverMediaId));
      
      return media || null;
    }
    
    // Otherwise, get the first media item in the collection
    const [firstMedia] = await db.select({
      media: schema.mediaItems,
    })
      .from(schema.collectionMedia)
      .innerJoin(schema.mediaItems, eq(schema.collectionMedia.mediaId, schema.mediaItems.id))
      .where(eq(schema.collectionMedia.collectionId, collectionId))
      .orderBy(schema.collectionMedia.orderIndex)
      .limit(1);
    
    return firstMedia?.media || null;
  }

  async updateCollectionMediaOrder(collectionId: number, mediaIds: number[]): Promise<void> {
    // Update all media items with their new order
    const updates = mediaIds.map((mediaId, index) => ({
      collectionId,
      mediaId,
      orderIndex: index,
    }));
    
    for (const update of updates) {
      await db.update(schema.collectionMedia)
        .set({ orderIndex: update.orderIndex })
        .where(and(
          eq(schema.collectionMedia.collectionId, update.collectionId),
          eq(schema.collectionMedia.mediaId, update.mediaId)
        ));
    }
  }

  async duplicateCollection(collectionId: number, newTitle?: string): Promise<schema.Collection | null> {
    const original = await this.getCollection(collectionId);
    if (!original) return null;
    
    // Create new collection
    const newCollection = await this.createCollection({
      title: newTitle || `${original.title} (Copy)`,
      description: original.description,
      date: original.date,
      rating: original.rating,
      favorite: original.favorite,
      organized: original.organized,
      parentId: original.parentId,
    });
    
    // Copy all media items
    const media = await db.select()
      .from(schema.collectionMedia)
      .where(eq(schema.collectionMedia.collectionId, collectionId))
      .orderBy(schema.collectionMedia.orderIndex);
    
    if (media.length > 0) {
      const values = media.map(m => ({
        collectionId: newCollection.id,
        mediaId: m.mediaId,
        orderIndex: m.orderIndex,
      }));
      
      await db.insert(schema.collectionMedia)
        .values(values);
    }
    
    return newCollection;
  }

  private formatCollection(collection: any): schema.Collection {
    const formatted: any = { ...collection };
    
    // Convert timestamp to Date
    if (collection.date) {
      formatted.date = new Date(collection.date * 1000);
    }
    
    // Convert boolean fields
    formatted.favorite = Boolean(collection.favorite);
    formatted.organized = Boolean(collection.organized);
    
    return formatted as schema.Collection;
  }
}

export const collectionService = new CollectionService();