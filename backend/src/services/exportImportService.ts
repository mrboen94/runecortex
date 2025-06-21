import { eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import { savedFilterService } from './savedFilterService';
import { tagService } from './tagService';
import { collectionService } from './collectionService';
import fs from 'fs/promises';
import path from 'path';

interface ExportData {
  version: string;
  exportDate: string;
  media?: Array<{
    filepath: string;
    title?: string;
    description?: string;
    rating?: number;
    favorite: boolean;
    organized: boolean;
    tags: string[];
    collections: string[];
    customFields: Record<string, any>;
  }>;
  tags?: Array<{
    name: string;
    description?: string;
    aliases: string[];
    parent?: string;
    favorite: boolean;
    ignoreAutoTag: boolean;
  }>;
  collections?: Array<{
    title: string;
    description?: string;
    date?: string;
    rating?: number;
    favorite: boolean;
    organized: boolean;
    parent?: string;
    media: string[];
  }>;
  savedFilters?: Array<{
    name: string;
    mode: string;
    filter: string;
    uiOptions?: string;
    favorite: boolean;
  }>;
}

export class ExportImportService {
  private readonly EXPORT_VERSION = '1.0.0';

  async exportData(options: {
    includeMedia?: boolean;
    includeTags?: boolean;
    includeCollections?: boolean;
    includeSavedFilters?: boolean;
    mediaIds?: number[];
    tagIds?: number[];
    collectionIds?: number[];
  }): Promise<ExportData> {
    const data: ExportData = {
      version: this.EXPORT_VERSION,
      exportDate: new Date().toISOString(),
    };

    // Export tags
    if (options.includeTags) {
      let tags: schema.Tag[];
      if (options.tagIds && options.tagIds.length > 0) {
        tags = await db.select()
          .from(schema.tags)
          .where(inArray(schema.tags.id, options.tagIds));
      } else {
        tags = await db.select().from(schema.tags);
      }

      // Build tag hierarchy map
      const tagMap = new Map(tags.map(t => [t.id, t]));
      
      data.tags = tags.map(tag => {
        const parent = tag.parentId ? tagMap.get(tag.parentId) : null;
        return {
          name: tag.name,
          description: tag.description || undefined,
          aliases: this.parseAliases(tag.aliases),
          parent: parent?.name,
          favorite: Boolean(tag.favorite),
          ignoreAutoTag: Boolean(tag.ignoreAutoTag),
        };
      });
    }

    // Export collections
    if (options.includeCollections) {
      let collections: schema.Collection[];
      if (options.collectionIds && options.collectionIds.length > 0) {
        collections = await db.select()
          .from(schema.collections)
          .where(inArray(schema.collections.id, options.collectionIds));
      } else {
        collections = await db.select().from(schema.collections);
      }

      // Build collection hierarchy map
      const collectionMap = new Map(collections.map(c => [c.id, c]));
      
      data.collections = await Promise.all(collections.map(async collection => {
        const parent = collection.parentId ? collectionMap.get(collection.parentId) : null;
        
        // Get media paths
        const media = await db.select({
          filepath: schema.mediaItems.filepath,
        })
          .from(schema.collectionMedia)
          .innerJoin(schema.mediaItems, eq(schema.collectionMedia.mediaId, schema.mediaItems.id))
          .where(eq(schema.collectionMedia.collectionId, collection.id))
          .orderBy(schema.collectionMedia.orderIndex);
        
        return {
          title: collection.title,
          description: collection.description || undefined,
          date: collection.date ? new Date(collection.date * 1000).toISOString() : undefined,
          rating: collection.rating || undefined,
          favorite: Boolean(collection.favorite),
          organized: Boolean(collection.organized),
          parent: parent?.title,
          media: media.map(m => m.filepath),
        };
      }));
    }

    // Export media
    if (options.includeMedia) {
      let mediaQuery = db.select()
        .from(schema.mediaItems);
      
      if (options.mediaIds && options.mediaIds.length > 0) {
        mediaQuery = mediaQuery.where(inArray(schema.mediaItems.id, options.mediaIds));
      }
      
      const mediaItems = await mediaQuery;
      
      data.media = await Promise.all(mediaItems.map(async media => {
        // Get tags
        const tags = await db.select({
          name: schema.tags.name,
        })
          .from(schema.mediaTags)
          .innerJoin(schema.tags, eq(schema.mediaTags.tagId, schema.tags.id))
          .where(eq(schema.mediaTags.mediaId, media.id));
        
        // Get collections
        const collections = await db.select({
          title: schema.collections.title,
        })
          .from(schema.collectionMedia)
          .innerJoin(schema.collections, eq(schema.collectionMedia.collectionId, schema.collections.id))
          .where(eq(schema.collectionMedia.mediaId, media.id));
        
        // Get custom fields
        const customFields = await db.select()
          .from(schema.customFields)
          .where(eq(schema.customFields.entityId, media.id))
          .where(eq(schema.customFields.entityType, 'media'));
        
        const customFieldsMap: Record<string, any> = {};
        for (const field of customFields) {
          if (field.fieldValue) {
            customFieldsMap[field.fieldName] = this.parseFieldValue(field.fieldValue, field.fieldType);
          }
        }
        
        return {
          filepath: media.filepath,
          title: media.title || undefined,
          description: media.description || undefined,
          rating: media.rating || undefined,
          favorite: Boolean(media.favorite),
          organized: Boolean(media.organized),
          tags: tags.map(t => t.name),
          collections: collections.map(c => c.title),
          customFields: customFieldsMap,
        };
      }));
    }

    // Export saved filters
    if (options.includeSavedFilters) {
      const filters = await savedFilterService.exportSavedFilters();
      data.savedFilters = filters;
    }

    return data;
  }

  async exportToFile(filepath: string, options: Parameters<typeof this.exportData>[0]): Promise<void> {
    const data = await this.exportData(options);
    const json = JSON.stringify(data, null, 2);
    await fs.writeFile(filepath, json, 'utf-8');
  }

  async importData(data: ExportData, options: {
    importMedia?: boolean;
    importTags?: boolean;
    importCollections?: boolean;
    importSavedFilters?: boolean;
    mergeStrategy?: 'skip' | 'merge' | 'overwrite';
  } = {}): Promise<{
    tags: number;
    collections: number;
    media: number;
    savedFilters: number;
  }> {
    const results = {
      tags: 0,
      collections: 0,
      media: 0,
      savedFilters: 0,
    };

    const mergeStrategy = options.mergeStrategy || 'skip';

    // Import tags first (they may have hierarchy)
    if (options.importTags && data.tags) {
      const tagNameToId = new Map<string, number>();
      
      // Sort tags so parents are created before children
      const sortedTags = this.topologicalSort(
        data.tags,
        tag => tag.name,
        tag => tag.parent
      );
      
      for (const tagData of sortedTags) {
        const existing = await tagService.getTagByName(tagData.name);
        
        if (existing) {
          if (mergeStrategy === 'overwrite') {
            const parentId = tagData.parent ? tagNameToId.get(tagData.parent) : undefined;
            await tagService.updateTag({
              id: existing.id,
              description: tagData.description,
              aliases: tagData.aliases,
              parentId,
              favorite: tagData.favorite,
              ignoreAutoTag: tagData.ignoreAutoTag,
            });
            tagNameToId.set(tagData.name, existing.id);
            results.tags++;
          } else if (mergeStrategy === 'merge') {
            // Merge aliases
            const existingAliases = this.parseAliases(existing.aliases);
            const newAliases = [...new Set([...existingAliases, ...tagData.aliases])];
            
            await tagService.updateTag({
              id: existing.id,
              aliases: newAliases,
              favorite: existing.favorite || tagData.favorite,
            });
            tagNameToId.set(tagData.name, existing.id);
            results.tags++;
          } else {
            tagNameToId.set(tagData.name, existing.id);
          }
        } else {
          const parentId = tagData.parent ? tagNameToId.get(tagData.parent) : undefined;
          const created = await tagService.createTag({
            name: tagData.name,
            description: tagData.description,
            aliases: tagData.aliases,
            parentId,
            favorite: tagData.favorite,
            ignoreAutoTag: tagData.ignoreAutoTag,
          });
          tagNameToId.set(tagData.name, created.id);
          results.tags++;
        }
      }
    }

    // Import collections
    if (options.importCollections && data.collections) {
      const collectionTitleToId = new Map<string, number>();
      
      // Sort collections so parents are created before children
      const sortedCollections = this.topologicalSort(
        data.collections,
        col => col.title,
        col => col.parent
      );
      
      for (const colData of sortedCollections) {
        const existing = await db.select()
          .from(schema.collections)
          .where(eq(schema.collections.title, colData.title));
        
        if (existing.length > 0) {
          if (mergeStrategy === 'overwrite') {
            const parentId = colData.parent ? collectionTitleToId.get(colData.parent) : undefined;
            await collectionService.updateCollection({
              id: existing[0].id,
              description: colData.description,
              date: colData.date ? new Date(colData.date) : undefined,
              rating: colData.rating,
              parentId,
              favorite: colData.favorite,
              organized: colData.organized,
            });
            collectionTitleToId.set(colData.title, existing[0].id);
            results.collections++;
          } else {
            collectionTitleToId.set(colData.title, existing[0].id);
          }
        } else {
          const parentId = colData.parent ? collectionTitleToId.get(colData.parent) : undefined;
          const created = await collectionService.createCollection({
            title: colData.title,
            description: colData.description,
            date: colData.date ? new Date(colData.date) : undefined,
            rating: colData.rating,
            parentId,
            favorite: colData.favorite,
            organized: colData.organized,
          });
          collectionTitleToId.set(colData.title, created.id);
          results.collections++;
        }
        
        // Add media to collection
        if (colData.media.length > 0) {
          const mediaItems = await db.select()
            .from(schema.mediaItems)
            .where(inArray(schema.mediaItems.filepath, colData.media));
          
          if (mediaItems.length > 0) {
            const collectionId = collectionTitleToId.get(colData.title)!;
            const mediaIds = mediaItems.map(m => m.id);
            await collectionService.addMediaToCollection(collectionId, mediaIds);
          }
        }
      }
    }

    // Import media metadata
    if (options.importMedia && data.media) {
      for (const mediaData of data.media) {
        const [existing] = await db.select()
          .from(schema.mediaItems)
          .where(eq(schema.mediaItems.filepath, mediaData.filepath));
        
        if (existing) {
          if (mergeStrategy === 'overwrite' || mergeStrategy === 'merge') {
            // Update metadata
            await db.update(schema.mediaItems)
              .set({
                title: mediaData.title || existing.title,
                description: mediaData.description || existing.description,
                rating: mediaData.rating || existing.rating,
                favorite: mergeStrategy === 'overwrite' ? mediaData.favorite : existing.favorite || mediaData.favorite,
                organized: mergeStrategy === 'overwrite' ? mediaData.organized : existing.organized || mediaData.organized,
              })
              .where(eq(schema.mediaItems.id, existing.id));
            
            // Update tags
            if (mediaData.tags.length > 0) {
              const tagIds: number[] = [];
              for (const tagName of mediaData.tags) {
                const tag = await tagService.findOrCreateTag(tagName);
                tagIds.push(tag.id);
              }
              
              if (mergeStrategy === 'overwrite') {
                await db.delete(schema.mediaTags)
                  .where(eq(schema.mediaTags.mediaId, existing.id));
              }
              
              await tagService.addTagsToMedia([existing.id], tagIds);
            }
            
            // Update custom fields
            for (const [fieldName, fieldValue] of Object.entries(mediaData.customFields)) {
              await db.delete(schema.customFields)
                .where(eq(schema.customFields.entityId, existing.id))
                .where(eq(schema.customFields.entityType, 'media'))
                .where(eq(schema.customFields.fieldName, fieldName));
              
              await db.insert(schema.customFields)
                .values({
                  entityType: 'media',
                  entityId: existing.id,
                  fieldName,
                  fieldValue: JSON.stringify(fieldValue),
                  fieldType: typeof fieldValue,
                });
            }
            
            results.media++;
          }
        }
      }
    }

    // Import saved filters
    if (options.importSavedFilters && data.savedFilters) {
      const imported = await savedFilterService.importSavedFilters(data.savedFilters);
      results.savedFilters = imported.length;
    }

    return results;
  }

  async importFromFile(filepath: string, options: Parameters<typeof this.importData>[1]): Promise<ReturnType<typeof this.importData>> {
    const json = await fs.readFile(filepath, 'utf-8');
    const data = JSON.parse(json) as ExportData;
    
    // Validate version
    if (!data.version) {
      throw new Error('Invalid export file: missing version');
    }
    
    return this.importData(data, options);
  }

  async exportDatabase(outputPath: string): Promise<void> {
    // Export entire database to JSON
    const allData = await this.exportData({
      includeMedia: true,
      includeTags: true,
      includeCollections: true,
      includeSavedFilters: true,
    });
    
    await this.exportToFile(outputPath, {
      includeMedia: true,
      includeTags: true,
      includeCollections: true,
      includeSavedFilters: true,
    });
  }

  async createBackup(backupDir: string): Promise<string> {
    // Create timestamped backup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `runecortex-backup-${timestamp}.json`;
    const backupPath = path.join(backupDir, backupName);
    
    await this.exportDatabase(backupPath);
    
    return backupPath;
  }

  private parseAliases(aliases: string | null): string[] {
    if (!aliases) return [];
    try {
      const parsed = JSON.parse(aliases);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private parseFieldValue(value: string, type: string | null): any {
    if (!type || type === 'string') return value;
    
    try {
      switch (type) {
        case 'number':
          return Number(value);
        case 'boolean':
          return value === 'true';
        case 'date':
          return new Date(value);
        default:
          return JSON.parse(value);
      }
    } catch {
      return value;
    }
  }

  private topologicalSort<T>(
    items: T[],
    getKey: (item: T) => string,
    getParent: (item: T) => string | undefined
  ): T[] {
    const sorted: T[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();
    
    const itemMap = new Map(items.map(item => [getKey(item), item]));
    
    const visit = (key: string) => {
      if (temp.has(key)) {
        throw new Error(`Circular dependency detected at: ${key}`);
      }
      if (visited.has(key)) {
        return;
      }
      
      temp.add(key);
      const item = itemMap.get(key);
      if (item) {
        const parent = getParent(item);
        if (parent && itemMap.has(parent)) {
          visit(parent);
        }
      }
      temp.delete(key);
      visited.add(key);
      
      if (item) {
        sorted.push(item);
      }
    };
    
    for (const item of items) {
      visit(getKey(item));
    }
    
    return sorted;
  }
}

export const exportImportService = new ExportImportService();