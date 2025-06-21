import { db, schema } from '../db';
import { eq, inArray, and, or, not, sql } from 'drizzle-orm';
import { mediaMetadataService } from './mediaMetadataService';
import { tagService } from './tagService';
import { collectionService } from './collectionService';
import { autoTaggingService } from './autoTaggingService';
import { phashService } from './phashService';
import { thumbnailQueue } from './thumbnailQueue';
import { filterService } from './filterService';
import { MediaFilterInput } from '../models/filter';
import fs from 'fs/promises';
import path from 'path';

export interface BatchOperation {
  id: string;
  type: BatchOperationType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  total: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  results?: any;
}

export enum BatchOperationType {
  // Metadata operations
  UPDATE_METADATA = 'UPDATE_METADATA',
  AUTO_GENERATE_TITLES = 'AUTO_GENERATE_TITLES',
  AUTO_TAG = 'AUTO_TAG',
  REMOVE_ALL_TAGS = 'REMOVE_ALL_TAGS',
  
  // Organization operations
  ADD_TO_COLLECTION = 'ADD_TO_COLLECTION',
  REMOVE_FROM_COLLECTION = 'REMOVE_FROM_COLLECTION',
  CREATE_COLLECTION_FROM_SELECTION = 'CREATE_COLLECTION_FROM_SELECTION',
  ORGANIZE_BY_DATE = 'ORGANIZE_BY_DATE',
  
  // File operations
  REGENERATE_THUMBNAILS = 'REGENERATE_THUMBNAILS',
  GENERATE_PHASHES = 'GENERATE_PHASHES',
  FIND_DUPLICATES = 'FIND_DUPLICATES',
  DELETE_FILES = 'DELETE_FILES',
  MOVE_FILES = 'MOVE_FILES',
  COPY_FILES = 'COPY_FILES',
  
  // Export operations
  EXPORT_METADATA = 'EXPORT_METADATA',
  EXPORT_FILES = 'EXPORT_FILES',
  CREATE_SLIDESHOW = 'CREATE_SLIDESHOW',
  
  // Maintenance operations
  VERIFY_FILES = 'VERIFY_FILES',
  CLEAN_ORPHANED_DATA = 'CLEAN_ORPHANED_DATA',
  OPTIMIZE_DATABASE = 'OPTIMIZE_DATABASE',
}

export class BatchOperationsService {
  private operations = new Map<string, BatchOperation>();
  private activeOperation: BatchOperation | null = null;

  async executeBatch(
    type: BatchOperationType,
    mediaIds: number[],
    options: any = {}
  ): Promise<BatchOperation> {
    const operation: BatchOperation = {
      id: `batch-${Date.now()}`,
      type,
      status: 'pending',
      progress: 0,
      total: mediaIds.length,
      startedAt: new Date(),
    };

    this.operations.set(operation.id, operation);

    // Execute operation asynchronously
    this.runOperation(operation, mediaIds, options).catch(error => {
      operation.status = 'failed';
      operation.error = error.message;
      operation.completedAt = new Date();
    });

    return operation;
  }

  async executeBatchWithFilter(
    type: BatchOperationType,
    filter: MediaFilterInput,
    options: any = {}
  ): Promise<BatchOperation> {
    // Get media IDs from filter
    const conditions = await filterService.buildMediaFilter(filter);
    let query = db.select({ id: schema.mediaItems.id })
      .from(schema.mediaItems);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    const items = await query;
    const mediaIds = items.map(item => item.id);
    
    // Apply complex filters
    const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
    
    return this.executeBatch(type, filteredIds, options);
  }

  private async runOperation(
    operation: BatchOperation,
    mediaIds: number[],
    options: any
  ): Promise<void> {
    operation.status = 'running';
    this.activeOperation = operation;

    try {
      switch (operation.type) {
        case BatchOperationType.UPDATE_METADATA:
          await this.batchUpdateMetadata(operation, mediaIds, options);
          break;
        
        case BatchOperationType.AUTO_GENERATE_TITLES:
          await this.batchAutoGenerateTitles(operation, mediaIds);
          break;
        
        case BatchOperationType.AUTO_TAG:
          await this.batchAutoTag(operation, mediaIds);
          break;
        
        case BatchOperationType.REMOVE_ALL_TAGS:
          await this.batchRemoveAllTags(operation, mediaIds);
          break;
        
        case BatchOperationType.ADD_TO_COLLECTION:
          await this.batchAddToCollection(operation, mediaIds, options.collectionId);
          break;
        
        case BatchOperationType.REMOVE_FROM_COLLECTION:
          await this.batchRemoveFromCollection(operation, mediaIds, options.collectionId);
          break;
        
        case BatchOperationType.CREATE_COLLECTION_FROM_SELECTION:
          await this.createCollectionFromSelection(operation, mediaIds, options);
          break;
        
        case BatchOperationType.ORGANIZE_BY_DATE:
          await this.organizeByDate(operation, mediaIds, options);
          break;
        
        case BatchOperationType.REGENERATE_THUMBNAILS:
          await this.batchRegenerateThumbnails(operation, mediaIds);
          break;
        
        case BatchOperationType.GENERATE_PHASHES:
          await this.batchGeneratePhashes(operation, mediaIds);
          break;
        
        case BatchOperationType.FIND_DUPLICATES:
          await this.findDuplicatesInBatch(operation, mediaIds);
          break;
        
        case BatchOperationType.DELETE_FILES:
          await this.batchDeleteFiles(operation, mediaIds, options);
          break;
        
        case BatchOperationType.MOVE_FILES:
          await this.batchMoveFiles(operation, mediaIds, options.destination);
          break;
        
        case BatchOperationType.COPY_FILES:
          await this.batchCopyFiles(operation, mediaIds, options.destination);
          break;
        
        case BatchOperationType.EXPORT_METADATA:
          await this.exportMetadata(operation, mediaIds, options);
          break;
        
        case BatchOperationType.EXPORT_FILES:
          await this.exportFiles(operation, mediaIds, options);
          break;
        
        case BatchOperationType.CREATE_SLIDESHOW:
          await this.createSlideshow(operation, mediaIds, options);
          break;
        
        case BatchOperationType.VERIFY_FILES:
          await this.verifyFiles(operation, mediaIds);
          break;
        
        case BatchOperationType.CLEAN_ORPHANED_DATA:
          await this.cleanOrphanedData(operation);
          break;
        
        case BatchOperationType.OPTIMIZE_DATABASE:
          await this.optimizeDatabase(operation);
          break;
        
        default:
          throw new Error(`Unknown batch operation type: ${operation.type}`);
      }

      operation.status = 'completed';
    } catch (error: any) {
      operation.status = 'failed';
      operation.error = error.message;
    } finally {
      operation.completedAt = new Date();
      this.activeOperation = null;
    }
  }

  private async batchUpdateMetadata(
    operation: BatchOperation,
    mediaIds: number[],
    updates: any
  ): Promise<void> {
    const batchSize = 100;
    
    for (let i = 0; i < mediaIds.length; i += batchSize) {
      if (operation.status === 'cancelled') break;
      
      const batch = mediaIds.slice(i, i + batchSize);
      await mediaMetadataService.bulkUpdateMediaMetadata({
        ids: batch,
        ...updates
      });
      
      operation.progress = Math.min(i + batchSize, mediaIds.length);
    }
  }

  private async batchAutoGenerateTitles(
    operation: BatchOperation,
    mediaIds: number[]
  ): Promise<void> {
    let generated = 0;
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const title = await mediaMetadataService.autoGenerateTitle(mediaIds[i]);
      if (title) generated++;
      
      operation.progress = i + 1;
    }
    
    operation.results = { generated };
  }

  private async batchAutoTag(
    operation: BatchOperation,
    mediaIds: number[]
  ): Promise<void> {
    let totalTags = 0;
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const tags = await autoTaggingService.autoTagMedia(mediaIds[i]);
      totalTags += tags.length;
      
      operation.progress = i + 1;
    }
    
    operation.results = { totalTags };
  }

  private async batchRemoveAllTags(
    operation: BatchOperation,
    mediaIds: number[]
  ): Promise<void> {
    await db.delete(schema.mediaTags)
      .where(inArray(schema.mediaTags.mediaId, mediaIds));
    
    operation.progress = mediaIds.length;
  }

  private async batchAddToCollection(
    operation: BatchOperation,
    mediaIds: number[],
    collectionId: number
  ): Promise<void> {
    await collectionService.addMediaToCollection(collectionId, mediaIds);
    operation.progress = mediaIds.length;
  }

  private async batchRemoveFromCollection(
    operation: BatchOperation,
    mediaIds: number[],
    collectionId: number
  ): Promise<void> {
    await collectionService.removeMediaFromCollection(collectionId, mediaIds);
    operation.progress = mediaIds.length;
  }

  private async createCollectionFromSelection(
    operation: BatchOperation,
    mediaIds: number[],
    options: any
  ): Promise<void> {
    const collection = await collectionService.createCollection({
      title: options.title || `Collection ${new Date().toISOString()}`,
      description: options.description,
      date: new Date(),
      favorite: options.favorite || false,
    });
    
    await collectionService.addMediaToCollection(collection.id, mediaIds);
    
    operation.progress = mediaIds.length;
    operation.results = { collectionId: collection.id };
  }

  private async organizeByDate(
    operation: BatchOperation,
    mediaIds: number[],
    options: any
  ): Promise<void> {
    const mediaItems = await db.select()
      .from(schema.mediaItems)
      .where(inArray(schema.mediaItems.id, mediaIds));
    
    // Group by year/month
    const groups = new Map<string, number[]>();
    
    for (const item of mediaItems) {
      const date = item.createdAt;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item.id);
    }
    
    // Create collections for each group
    const collections: number[] = [];
    
    for (const [key, ids] of groups) {
      const [year, month] = key.split('-');
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];
      
      const collection = await collectionService.createCollection({
        title: `${monthNames[parseInt(month) - 1]} ${year}`,
        date: new Date(parseInt(year), parseInt(month) - 1, 1),
        organized: true,
      });
      
      await collectionService.addMediaToCollection(collection.id, ids);
      collections.push(collection.id);
      
      operation.progress += ids.length;
    }
    
    operation.results = { collectionsCreated: collections.length, collections };
  }

  private async batchRegenerateThumbnails(
    operation: BatchOperation,
    mediaIds: number[]
  ): Promise<void> {
    // Delete existing thumbnails
    await db.update(schema.mediaItems)
      .set({ thumbnailGenerated: false })
      .where(inArray(schema.mediaItems.id, mediaIds));
    
    // Queue for regeneration
    await thumbnailQueue.ping(mediaIds);
    
    operation.progress = mediaIds.length;
    operation.results = { queued: mediaIds.length };
  }

  private async batchGeneratePhashes(
    operation: BatchOperation,
    mediaIds: number[]
  ): Promise<void> {
    let generated = 0;
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const phash = await phashService.updateMediaPhash(mediaIds[i]);
      if (phash) generated++;
      
      operation.progress = i + 1;
    }
    
    operation.results = { generated };
  }

  private async findDuplicatesInBatch(
    operation: BatchOperation,
    mediaIds: number[]
  ): Promise<void> {
    const duplicateGroups: Array<{ hash: string; items: number[] }> = [];
    const processed = new Set<number>();
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      if (processed.has(mediaIds[i])) continue;
      
      const similar = await phashService.findSimilar(mediaIds[i]);
      const similarInBatch = similar.filter(item => mediaIds.includes(item.id));
      
      if (similarInBatch.length > 0) {
        const group = {
          hash: similar[0].phash!,
          items: [mediaIds[i], ...similarInBatch.map(s => s.id)]
        };
        duplicateGroups.push(group);
        
        // Mark all as processed
        group.items.forEach(id => processed.add(id));
      }
      
      operation.progress = i + 1;
    }
    
    operation.results = { duplicateGroups };
  }

  private async batchDeleteFiles(
    operation: BatchOperation,
    mediaIds: number[],
    options: any
  ): Promise<void> {
    const deleteFromDisk = options.deleteFromDisk || false;
    let deleted = 0;
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, mediaIds[i]));
      
      if (item) {
        // Delete from database
        await db.delete(schema.mediaItems)
          .where(eq(schema.mediaItems.id, mediaIds[i]));
        
        // Delete physical file if requested
        if (deleteFromDisk) {
          try {
            await fs.unlink(item.filepath);
            deleted++;
          } catch (error) {
            console.error(`Failed to delete file: ${item.filepath}`, error);
          }
        }
      }
      
      operation.progress = i + 1;
    }
    
    operation.results = { deleted };
  }

  private async batchMoveFiles(
    operation: BatchOperation,
    mediaIds: number[],
    destination: string
  ): Promise<void> {
    let moved = 0;
    
    await fs.mkdir(destination, { recursive: true });
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, mediaIds[i]));
      
      if (item) {
        const newPath = path.join(destination, path.basename(item.filepath));
        
        try {
          await fs.rename(item.filepath, newPath);
          
          // Update database
          await db.update(schema.mediaItems)
            .set({ filepath: newPath })
            .where(eq(schema.mediaItems.id, mediaIds[i]));
          
          moved++;
        } catch (error) {
          console.error(`Failed to move file: ${item.filepath}`, error);
        }
      }
      
      operation.progress = i + 1;
    }
    
    operation.results = { moved };
  }

  private async batchCopyFiles(
    operation: BatchOperation,
    mediaIds: number[],
    destination: string
  ): Promise<void> {
    let copied = 0;
    
    await fs.mkdir(destination, { recursive: true });
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, mediaIds[i]));
      
      if (item) {
        const newPath = path.join(destination, path.basename(item.filepath));
        
        try {
          await fs.copyFile(item.filepath, newPath);
          copied++;
        } catch (error) {
          console.error(`Failed to copy file: ${item.filepath}`, error);
        }
      }
      
      operation.progress = i + 1;
    }
    
    operation.results = { copied };
  }

  private async exportMetadata(
    operation: BatchOperation,
    mediaIds: number[],
    options: any
  ): Promise<void> {
    const mediaItems = await db.select()
      .from(schema.mediaItems)
      .where(inArray(schema.mediaItems.id, mediaIds));
    
    const exportData = {
      exportDate: new Date().toISOString(),
      itemCount: mediaItems.length,
      items: mediaItems,
    };
    
    const outputPath = options.outputPath || `export-${Date.now()}.json`;
    await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2));
    
    operation.progress = mediaIds.length;
    operation.results = { outputPath };
  }

  private async exportFiles(
    operation: BatchOperation,
    mediaIds: number[],
    options: any
  ): Promise<void> {
    const outputDir = options.outputDir || `export-${Date.now()}`;
    await fs.mkdir(outputDir, { recursive: true });
    
    let exported = 0;
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, mediaIds[i]));
      
      if (item) {
        const destPath = path.join(outputDir, path.basename(item.filepath));
        
        try {
          await fs.copyFile(item.filepath, destPath);
          exported++;
        } catch (error) {
          console.error(`Failed to export file: ${item.filepath}`, error);
        }
      }
      
      operation.progress = i + 1;
    }
    
    operation.results = { exported, outputDir };
  }

  private async createSlideshow(
    operation: BatchOperation,
    mediaIds: number[],
    options: any
  ): Promise<void> {
    // This would create a video slideshow from images
    // For now, just create a playlist file
    const mediaItems = await db.select()
      .from(schema.mediaItems)
      .where(inArray(schema.mediaItems.id, mediaIds))
      .orderBy(schema.mediaItems.createdAt);
    
    const playlist = mediaItems.map(item => item.filepath).join('\n');
    const outputPath = options.outputPath || `slideshow-${Date.now()}.m3u`;
    
    await fs.writeFile(outputPath, playlist);
    
    operation.progress = mediaIds.length;
    operation.results = { outputPath };
  }

  private async verifyFiles(
    operation: BatchOperation,
    mediaIds: number[]
  ): Promise<void> {
    let missing = 0;
    let corrupted = 0;
    const errors: Array<{ id: number; path: string; error: string }> = [];
    
    for (let i = 0; i < mediaIds.length; i++) {
      if (operation.status === 'cancelled') break;
      
      const [item] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, mediaIds[i]));
      
      if (item) {
        try {
          await fs.access(item.filepath);
          
          // Verify file integrity (basic check)
          const stats = await fs.stat(item.filepath);
          if (stats.size === 0) {
            corrupted++;
            errors.push({
              id: item.id,
              path: item.filepath,
              error: 'File is empty'
            });
          }
        } catch (error: any) {
          missing++;
          errors.push({
            id: item.id,
            path: item.filepath,
            error: error.code === 'ENOENT' ? 'File not found' : error.message
          });
        }
      }
      
      operation.progress = i + 1;
    }
    
    operation.results = { missing, corrupted, errors };
  }

  private async cleanOrphanedData(operation: BatchOperation): Promise<void> {
    // Clean orphaned tags
    const orphanedTags = await db.delete(schema.mediaTags)
      .where(
        not(
          inArray(
            schema.mediaTags.mediaId,
            db.select({ id: schema.mediaItems.id }).from(schema.mediaItems)
          )
        )
      )
      .returning();
    
    // Clean orphaned collections
    const orphanedCollections = await db.delete(schema.collectionMedia)
      .where(
        not(
          inArray(
            schema.collectionMedia.mediaId,
            db.select({ id: schema.mediaItems.id }).from(schema.mediaItems)
          )
        )
      )
      .returning();
    
    // Clean orphaned custom fields
    const orphanedCustomFields = await db.delete(schema.customFields)
      .where(
        and(
          eq(schema.customFields.entityType, 'media'),
          not(
            inArray(
              schema.customFields.entityId,
              db.select({ id: schema.mediaItems.id }).from(schema.mediaItems)
            )
          )
        )
      )
      .returning();
    
    operation.progress = 100;
    operation.results = {
      orphanedTags: orphanedTags.length,
      orphanedCollections: orphanedCollections.length,
      orphanedCustomFields: orphanedCustomFields.length,
    };
  }

  private async optimizeDatabase(operation: BatchOperation): Promise<void> {
    // Run SQLite optimization commands
    await db.run(sql`VACUUM`);
    await db.run(sql`ANALYZE`);
    
    operation.progress = 100;
    operation.results = { optimized: true };
  }

  getOperation(operationId: string): BatchOperation | undefined {
    return this.operations.get(operationId);
  }

  getAllOperations(): BatchOperation[] {
    return Array.from(this.operations.values());
  }

  cancelOperation(operationId: string): boolean {
    const operation = this.operations.get(operationId);
    if (operation && operation.status === 'running') {
      operation.status = 'cancelled';
      return true;
    }
    return false;
  }

  clearCompletedOperations(): void {
    for (const [id, operation] of this.operations) {
      if (operation.status === 'completed' || operation.status === 'failed') {
        this.operations.delete(id);
      }
    }
  }
}

export const batchOperationsService = new BatchOperationsService();