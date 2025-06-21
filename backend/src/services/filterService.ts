import { and, or, not, eq, ne, gt, lt, gte, lte, like, inArray, isNull, isNotNull, sql, SQL } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';
import {
  MediaFilterInput,
  TagFilterInput,
  CollectionFilterInput,
  CriterionModifier,
  StringCriterionInput,
  IntCriterionInput,
  DateCriterionInput,
  ResolutionCriterionInput,
  OrientationCriterionInput,
  HierarchicalCriterionInput,
  CustomFieldFilterInput,
  getResolutionEnum,
  getOrientation,
  ResolutionEnum,
  OrientationEnum,
} from '../models/filter';

export class FilterService {
  // Convert string criterion to SQL condition
  private stringCriterion(column: SQL, criterion: StringCriterionInput): SQL | undefined {
    const { value, modifier } = criterion;
    
    switch (modifier) {
      case CriterionModifier.EQUALS:
        return eq(column, value);
      case CriterionModifier.NOT_EQUALS:
        return ne(column, value);
      case CriterionModifier.INCLUDES:
        return like(column, `%${value}%`);
      case CriterionModifier.EXCLUDES:
        return not(like(column, `%${value}%`));
      case CriterionModifier.MATCHES_REGEX:
        // Convert basic regex patterns to LIKE patterns for SQLite compatibility
        // This handles simple patterns like ^IMG_\d+ 
        if (value.startsWith('^') && value.includes('\\d')) {
          // Convert ^IMG_\d+ to IMG_% pattern
          const likePattern = value.replace(/^\^/, '').replace(/\\\\d\+.*$/, '%');
          return like(column, likePattern);
        }
        // For more complex regex, we'll need to filter in application code
        // Return a condition that matches all for now and filter later
        return sql`1=1`;
      case CriterionModifier.NOT_MATCHES_REGEX:
        if (value.startsWith('^') && value.includes('\\d')) {
          const likePattern = value.replace(/^\^/, '').replace(/\\\\d\+.*$/, '%');
          return not(like(column, likePattern));
        }
        return sql`1=1`;
      case CriterionModifier.IS_NULL:
        return isNull(column);
      case CriterionModifier.NOT_NULL:
        return isNotNull(column);
      default:
        return undefined;
    }
  }

  // Convert integer criterion to SQL condition
  private intCriterion(column: SQL, criterion: IntCriterionInput): SQL | undefined {
    const { value, value2, modifier } = criterion;
    
    switch (modifier) {
      case CriterionModifier.EQUALS:
        return eq(column, value);
      case CriterionModifier.NOT_EQUALS:
        return ne(column, value);
      case CriterionModifier.GREATER_THAN:
        return gt(column, value);
      case CriterionModifier.LESS_THAN:
        return lt(column, value);
      case CriterionModifier.BETWEEN:
        if (value2 !== undefined) {
          return and(gte(column, value), lte(column, value2));
        }
        return undefined;
      case CriterionModifier.NOT_BETWEEN:
        if (value2 !== undefined) {
          return or(lt(column, value), gt(column, value2));
        }
        return undefined;
      case CriterionModifier.IS_NULL:
        return isNull(column);
      case CriterionModifier.NOT_NULL:
        return isNotNull(column);
      default:
        return undefined;
    }
  }

  // Convert date criterion to SQL condition
  private dateCriterion(column: SQL, criterion: DateCriterionInput): SQL | undefined {
    const { value, value2, modifier } = criterion;
    const date = new Date(value);
    const date2 = value2 ? new Date(value2) : undefined;
    
    switch (modifier) {
      case CriterionModifier.EQUALS:
        // For date equality, we check if it's within the same day
        const dayStart = new Date(value);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(value);
        dayEnd.setHours(23, 59, 59, 999);
        return and(
          gte(column, dayStart),
          lte(column, dayEnd)
        );
      case CriterionModifier.NOT_EQUALS:
        const notDayStart = new Date(value);
        notDayStart.setHours(0, 0, 0, 0);
        const notDayEnd = new Date(value);
        notDayEnd.setHours(23, 59, 59, 999);
        return or(
          lt(column, notDayStart),
          gt(column, notDayEnd)
        );
      case CriterionModifier.GREATER_THAN:
        return gt(column, date);
      case CriterionModifier.LESS_THAN:
        return lt(column, date);
      case CriterionModifier.BETWEEN:
        if (date2 !== undefined) {
          return and(gte(column, date), lte(column, date2));
        }
        return undefined;
      case CriterionModifier.NOT_BETWEEN:
        if (date2 !== undefined) {
          return or(lt(column, date), gt(column, date2));
        }
        return undefined;
      case CriterionModifier.IS_NULL:
        return isNull(column);
      case CriterionModifier.NOT_NULL:
        return isNotNull(column);
      default:
        return undefined;
    }
  }

  // Handle resolution criterion
  private async resolutionCriterion(mediaIds: Set<number>, criterion: ResolutionCriterionInput): Promise<Set<number>> {
    const { value, modifier } = criterion;
    
    // Get all media items with their resolution info
    const items = await db.select({
      id: schema.mediaItems.id,
      width: schema.mediaItems.width,
      height: schema.mediaItems.height,
    }).from(schema.mediaItems)
      .where(inArray(schema.mediaItems.id, Array.from(mediaIds)));
    
    const matchingIds = new Set<number>();
    
    for (const item of items) {
      if (item.width && item.height) {
        const resolution = getResolutionEnum(item.width, item.height);
        
        switch (modifier) {
          case CriterionModifier.EQUALS:
            if (resolution === value) matchingIds.add(item.id);
            break;
          case CriterionModifier.NOT_EQUALS:
            if (resolution !== value) matchingIds.add(item.id);
            break;
          case CriterionModifier.GREATER_THAN:
            if (this.compareResolutions(resolution, value) > 0) matchingIds.add(item.id);
            break;
          case CriterionModifier.LESS_THAN:
            if (this.compareResolutions(resolution, value) < 0) matchingIds.add(item.id);
            break;
        }
      } else if (modifier === CriterionModifier.IS_NULL) {
        matchingIds.add(item.id);
      }
    }
    
    return matchingIds;
  }

  // Compare resolution enums
  private compareResolutions(a: ResolutionEnum, b: ResolutionEnum): number {
    const order = [
      ResolutionEnum.VERY_LOW,
      ResolutionEnum.LOW,
      ResolutionEnum.SD,
      ResolutionEnum.HD,
      ResolutionEnum.FULL_HD,
      ResolutionEnum.QUAD_HD,
      ResolutionEnum.VR_HD,
      ResolutionEnum.FOUR_K,
      ResolutionEnum.FIVE_K,
      ResolutionEnum.SIX_K,
      ResolutionEnum.SEVEN_K,
      ResolutionEnum.EIGHT_K,
    ];
    
    return order.indexOf(a) - order.indexOf(b);
  }

  // Handle orientation criterion
  private async orientationCriterion(mediaIds: Set<number>, criterion: OrientationCriterionInput): Promise<Set<number>> {
    const { value } = criterion;
    
    const items = await db.select({
      id: schema.mediaItems.id,
      width: schema.mediaItems.width,
      height: schema.mediaItems.height,
    }).from(schema.mediaItems)
      .where(inArray(schema.mediaItems.id, Array.from(mediaIds)));
    
    const matchingIds = new Set<number>();
    
    for (const item of items) {
      if (item.width && item.height) {
        const orientation = getOrientation(item.width, item.height);
        if (orientation === value) {
          matchingIds.add(item.id);
        }
      }
    }
    
    return matchingIds;
  }

  // Handle hierarchical criterion (tags/collections)
  private async hierarchicalCriterion(
    mediaIds: Set<number>,
    criterion: HierarchicalCriterionInput,
    type: 'tags' | 'collections'
  ): Promise<Set<number>> {
    const { value, modifier, depth } = criterion;
    
    // Get IDs including children if depth is specified
    let targetIds: number[] = [];
    
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
      const numericValue = typeof value === 'number' ? value : parseInt(value, 10);
      targetIds = [numericValue];
      if (depth && depth > 0) {
        // Get child IDs recursively
        targetIds = await this.getHierarchicalIds(numericValue, type, depth);
      }
    } else {
      // Search by name
      const table = type === 'tags' ? schema.tags : schema.collections;
      const nameField = type === 'tags' ? schema.tags.name : schema.collections.title;
      
      const results = await db.select({ id: table.id })
        .from(table)
        .where(like(nameField, `%${value}%`));
      
      targetIds = results.map(r => r.id);
      
      // Get children for each match if depth is specified
      if (depth && depth > 0) {
        const allIds: number[] = [];
        for (const id of targetIds) {
          const childIds = await this.getHierarchicalIds(id, type, depth);
          allIds.push(...childIds);
        }
        targetIds = [...new Set(allIds)];
      }
    }
    
    if (targetIds.length === 0) {
      return new Set<number>();
    }
    
    // Get media items with these tags/collections
    const junctionTable = type === 'tags' ? schema.mediaTags : schema.collectionMedia;
    const foreignKey = type === 'tags' ? schema.mediaTags.tagId : schema.collectionMedia.collectionId;
    
    const mediaResults = await db.select({ mediaId: junctionTable.mediaId })
      .from(junctionTable)
      .where(and(
        inArray(junctionTable.mediaId, Array.from(mediaIds)),
        inArray(foreignKey, targetIds)
      ));
    
    const matchingIds = new Set(mediaResults.map(r => r.mediaId));
    
    // Apply modifier logic
    switch (modifier) {
      case CriterionModifier.INCLUDES:
      case CriterionModifier.INCLUDES_ANY:
        return matchingIds;
      case CriterionModifier.EXCLUDES:
        return new Set(Array.from(mediaIds).filter(id => !matchingIds.has(id)));
      case CriterionModifier.INCLUDES_ALL:
        // For INCLUDES_ALL, we need to check that all targetIds are present
        const mediaWithAllTags = new Set<number>();
        for (const mediaId of matchingIds) {
          const tagCount = await db.select({ count: sql<number>`COUNT(*)` })
            .from(junctionTable)
            .where(and(
              eq(junctionTable.mediaId, mediaId),
              inArray(foreignKey, targetIds)
            ));
          
          if (tagCount[0].count === targetIds.length) {
            mediaWithAllTags.add(mediaId);
          }
        }
        return mediaWithAllTags;
      default:
        return matchingIds;
    }
  }

  // Get hierarchical IDs (including children)
  private async getHierarchicalIds(parentId: number, type: 'tags' | 'collections', maxDepth: number): Promise<number[]> {
    const table = type === 'tags' ? schema.tags : schema.collections;
    const results: number[] = [parentId];
    
    const getChildren = async (id: number, depth: number): Promise<number[]> => {
      if (depth >= maxDepth) return [];
      
      const children = await db.select({ id: table.id })
        .from(table)
        .where(eq(table.parentId, id));
      
      const childIds: number[] = [];
      for (const child of children) {
        childIds.push(child.id);
        const grandchildren = await getChildren(child.id, depth + 1);
        childIds.push(...grandchildren);
      }
      
      return childIds;
    };
    
    const childIds = await getChildren(parentId, 0);
    results.push(...childIds);
    
    return [...new Set(results)];
  }

  // Handle custom field criterion
  private async customFieldCriterion(
    mediaIds: Set<number>,
    criterion: CustomFieldFilterInput
  ): Promise<Set<number>> {
    const { fieldName, fieldValue } = criterion;
    
    const conditions: SQL[] = [
      eq(schema.customFields.entityType, 'media'),
      inArray(schema.customFields.entityId, Array.from(mediaIds)),
      eq(schema.customFields.fieldName, fieldName),
    ];
    
    if (fieldValue) {
      const valueCondition = this.stringCriterion(schema.customFields.fieldValue, fieldValue);
      if (valueCondition) {
        conditions.push(valueCondition);
      }
    }
    
    const results = await db.select({ entityId: schema.customFields.entityId })
      .from(schema.customFields)
      .where(and(...conditions));
    
    return new Set(results.map(r => r.entityId));
  }

  // Build media filter conditions
  async buildMediaFilter(filter: MediaFilterInput): Promise<SQL[]> {
    const conditions: SQL[] = [];
    const table = schema.mediaItems;
    
    // Handle logical operators
    if (filter.AND) {
      const andConditions = await Promise.all(
        filter.AND.map(f => this.buildMediaFilter(f))
      );
      conditions.push(and(...andConditions.flat()));
    }
    
    if (filter.OR) {
      const orConditions = await Promise.all(
        filter.OR.map(f => this.buildMediaFilter(f))
      );
      conditions.push(or(...orConditions.flat()));
    }
    
    if (filter.NOT) {
      const notConditions = await this.buildMediaFilter(filter.NOT);
      conditions.push(not(and(...notConditions)));
    }
    
    // Basic fields
    if (filter.id) {
      const condition = this.intCriterion(table.id, filter.id);
      if (condition) conditions.push(condition);
    }
    
    if (filter.path) {
      const condition = this.stringCriterion(table.filepath, filter.path);
      if (condition) conditions.push(condition);
    }
    
    if (filter.filename) {
      const condition = this.stringCriterion(table.filename, filter.filename);
      if (condition) conditions.push(condition);
    }
    
    if (filter.title) {
      const condition = this.stringCriterion(table.title, filter.title);
      if (condition) conditions.push(condition);
    }
    
    if (filter.description) {
      const condition = this.stringCriterion(table.description, filter.description);
      if (condition) conditions.push(condition);
    }
    
    // Ratings and favorites
    if (filter.rating) {
      const condition = this.intCriterion(table.rating, filter.rating);
      if (condition) conditions.push(condition);
    }
    
    if (filter.favorite !== undefined) {
      conditions.push(eq(table.favorite, filter.favorite));
    }
    
    if (filter.organized !== undefined) {
      conditions.push(eq(table.organized, filter.organized));
    }
    
    // File properties
    if (filter.fileSize) {
      const condition = this.intCriterion(table.fileSize, filter.fileSize);
      if (condition) conditions.push(condition);
    }
    
    if (filter.duration) {
      const condition = this.intCriterion(table.duration, filter.duration);
      if (condition) conditions.push(condition);
    }
    
    if (filter.width) {
      const condition = this.intCriterion(table.width, filter.width);
      if (condition) conditions.push(condition);
    }
    
    if (filter.height) {
      const condition = this.intCriterion(table.height, filter.height);
      if (condition) conditions.push(condition);
    }
    
    if (filter.fileType) {
      const condition = this.stringCriterion(table.fileType, filter.fileType);
      if (condition) conditions.push(condition);
    }
    
    // Dates
    if (filter.createdAt) {
      const condition = this.dateCriterion(table.createdAt, filter.createdAt);
      if (condition) conditions.push(condition);
    }
    
    if (filter.updatedAt) {
      const condition = this.dateCriterion(table.addedAt, filter.updatedAt);
      if (condition) conditions.push(condition);
    }
    
    // Duplicate detection
    if (filter.hasDuplicates !== undefined) {
      if (filter.hasDuplicates) {
        // Find items with duplicate phash
        conditions.push(sql`${table.phash} IN (
          SELECT phash FROM ${table} 
          WHERE phash IS NOT NULL 
          GROUP BY phash 
          HAVING COUNT(*) > 1
        )`);
      } else {
        // Find items without duplicate phash
        conditions.push(sql`(${table.phash} IS NULL OR ${table.phash} IN (
          SELECT phash FROM ${table} 
          WHERE phash IS NOT NULL 
          GROUP BY phash 
          HAVING COUNT(*) = 1
        ))`);
      }
    }
    
    if (filter.phash) {
      const condition = this.stringCriterion(table.phash, filter.phash);
      if (condition) conditions.push(condition);
    }
    
    return conditions;
  }

  // Apply complex filters that require post-processing
  async applyComplexMediaFilters(
    mediaIds: number[],
    filter: MediaFilterInput
  ): Promise<number[]> {
    let resultIds = new Set(mediaIds);
    
    // Resolution filter
    if (filter.resolution) {
      resultIds = await this.resolutionCriterion(resultIds, filter.resolution);
    }
    
    // Orientation filter
    if (filter.orientation) {
      resultIds = await this.orientationCriterion(resultIds, filter.orientation);
    }
    
    // Tag filter
    if (filter.tags) {
      resultIds = await this.hierarchicalCriterion(resultIds, filter.tags, 'tags');
    }
    
    // Collection filter
    if (filter.collections) {
      resultIds = await this.hierarchicalCriterion(resultIds, filter.collections, 'collections');
    }
    
    // Tag count filter
    if (filter.tagCount) {
      const counts = await db.select({
        mediaId: schema.mediaTags.mediaId,
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(schema.mediaTags)
        .where(inArray(schema.mediaTags.mediaId, Array.from(resultIds)))
        .groupBy(schema.mediaTags.mediaId);
      
      const countMap = new Map(counts.map(c => [c.mediaId, c.count]));
      resultIds = new Set(
        Array.from(resultIds).filter(id => {
          const count = countMap.get(id) || 0;
          return this.matchesIntCriterion(count, filter.tagCount!);
        })
      );
    }
    
    // Collection count filter
    if (filter.collectionCount) {
      const counts = await db.select({
        mediaId: schema.collectionMedia.mediaId,
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(schema.collectionMedia)
        .where(inArray(schema.collectionMedia.mediaId, Array.from(resultIds)))
        .groupBy(schema.collectionMedia.mediaId);
      
      const countMap = new Map(counts.map(c => [c.mediaId, c.count]));
      resultIds = new Set(
        Array.from(resultIds).filter(id => {
          const count = countMap.get(id) || 0;
          return this.matchesIntCriterion(count, filter.collectionCount!);
        })
      );
    }
    
    // Custom fields filter
    if (filter.customFields) {
      for (const customField of filter.customFields) {
        resultIds = await this.customFieldCriterion(resultIds, customField);
      }
    }
    
    return Array.from(resultIds);
  }

  // Helper to check if a value matches an int criterion
  private matchesIntCriterion(value: number, criterion: IntCriterionInput): boolean {
    const { value: target, value2, modifier } = criterion;
    
    switch (modifier) {
      case CriterionModifier.EQUALS:
        return value === target;
      case CriterionModifier.NOT_EQUALS:
        return value !== target;
      case CriterionModifier.GREATER_THAN:
        return value > target;
      case CriterionModifier.LESS_THAN:
        return value < target;
      case CriterionModifier.BETWEEN:
        return value2 !== undefined && value >= target && value <= value2;
      case CriterionModifier.NOT_BETWEEN:
        return value2 !== undefined && (value < target || value > value2);
      default:
        return false;
    }
  }

  // Build tag filter conditions
  async buildTagFilter(filter: TagFilterInput): Promise<SQL[]> {
    const conditions: SQL[] = [];
    const table = schema.tags;
    
    // Handle logical operators
    if (filter.AND) {
      const andConditions = await Promise.all(
        filter.AND.map(f => this.buildTagFilter(f))
      );
      conditions.push(and(...andConditions.flat()));
    }
    
    if (filter.OR) {
      const orConditions = await Promise.all(
        filter.OR.map(f => this.buildTagFilter(f))
      );
      conditions.push(or(...orConditions.flat()));
    }
    
    if (filter.NOT) {
      const notConditions = await this.buildTagFilter(filter.NOT);
      conditions.push(not(and(...notConditions)));
    }
    
    // Basic fields
    if (filter.id) {
      const condition = this.intCriterion(table.id, filter.id);
      if (condition) conditions.push(condition);
    }
    
    if (filter.name) {
      const condition = this.stringCriterion(table.name, filter.name);
      if (condition) conditions.push(condition);
    }
    
    if (filter.description) {
      const condition = this.stringCriterion(table.description, filter.description);
      if (condition) conditions.push(condition);
    }
    
    if (filter.aliases) {
      const condition = this.stringCriterion(table.aliases, filter.aliases);
      if (condition) conditions.push(condition);
    }
    
    if (filter.parentId) {
      const condition = this.intCriterion(table.parentId, filter.parentId);
      if (condition) conditions.push(condition);
    }
    
    if (filter.favorite !== undefined) {
      conditions.push(eq(table.favorite, filter.favorite));
    }
    
    if (filter.ignoreAutoTag !== undefined) {
      conditions.push(eq(table.ignoreAutoTag, filter.ignoreAutoTag));
    }
    
    return conditions;
  }

  // Apply complex filters for tags
  async applyComplexTagFilters(
    tagIds: number[],
    filter: TagFilterInput
  ): Promise<number[]> {
    let resultIds = new Set(tagIds);
    
    // Child count filter
    if (filter.childCount) {
      const counts = await db.select({
        parentId: schema.tags.parentId,
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(schema.tags)
        .where(and(
          inArray(schema.tags.parentId, Array.from(resultIds)),
          isNotNull(schema.tags.parentId)
        ))
        .groupBy(schema.tags.parentId);
      
      const countMap = new Map(counts.map(c => [c.parentId!, c.count]));
      resultIds = new Set(
        Array.from(resultIds).filter(id => {
          const count = countMap.get(id) || 0;
          return this.matchesIntCriterion(count, filter.childCount!);
        })
      );
    }
    
    // Media count filter
    if (filter.mediaCount) {
      const counts = await db.select({
        tagId: schema.mediaTags.tagId,
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(schema.mediaTags)
        .where(inArray(schema.mediaTags.tagId, Array.from(resultIds)))
        .groupBy(schema.mediaTags.tagId);
      
      const countMap = new Map(counts.map(c => [c.tagId, c.count]));
      resultIds = new Set(
        Array.from(resultIds).filter(id => {
          const count = countMap.get(id) || 0;
          return this.matchesIntCriterion(count, filter.mediaCount!);
        })
      );
    }
    
    return Array.from(resultIds);
  }

  // Build collection filter conditions
  async buildCollectionFilter(filter: CollectionFilterInput): Promise<SQL[]> {
    const conditions: SQL[] = [];
    const table = schema.collections;
    
    // Handle logical operators
    if (filter.AND) {
      const andConditions = await Promise.all(
        filter.AND.map(f => this.buildCollectionFilter(f))
      );
      conditions.push(and(...andConditions.flat()));
    }
    
    if (filter.OR) {
      const orConditions = await Promise.all(
        filter.OR.map(f => this.buildCollectionFilter(f))
      );
      conditions.push(or(...orConditions.flat()));
    }
    
    if (filter.NOT) {
      const notConditions = await this.buildCollectionFilter(filter.NOT);
      conditions.push(not(and(...notConditions)));
    }
    
    // Basic fields
    if (filter.id) {
      const condition = this.intCriterion(table.id, filter.id);
      if (condition) conditions.push(condition);
    }
    
    if (filter.title) {
      const condition = this.stringCriterion(table.title, filter.title);
      if (condition) conditions.push(condition);
    }
    
    if (filter.description) {
      const condition = this.stringCriterion(table.description, filter.description);
      if (condition) conditions.push(condition);
    }
    
    if (filter.date) {
      const condition = this.dateCriterion(table.date, filter.date);
      if (condition) conditions.push(condition);
    }
    
    if (filter.rating) {
      const condition = this.intCriterion(table.rating, filter.rating);
      if (condition) conditions.push(condition);
    }
    
    if (filter.favorite !== undefined) {
      conditions.push(eq(table.favorite, filter.favorite));
    }
    
    if (filter.organized !== undefined) {
      conditions.push(eq(table.organized, filter.organized));
    }
    
    if (filter.parentId) {
      const condition = this.intCriterion(table.parentId, filter.parentId);
      if (condition) conditions.push(condition);
    }
    
    return conditions;
  }

  // Apply complex filters for collections
  async applyComplexCollectionFilters(
    collectionIds: number[],
    filter: CollectionFilterInput
  ): Promise<number[]> {
    let resultIds = new Set(collectionIds);
    
    // Child count filter
    if (filter.childCount) {
      const counts = await db.select({
        parentId: schema.collections.parentId,
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(schema.collections)
        .where(and(
          inArray(schema.collections.parentId, Array.from(resultIds)),
          isNotNull(schema.collections.parentId)
        ))
        .groupBy(schema.collections.parentId);
      
      const countMap = new Map(counts.map(c => [c.parentId!, c.count]));
      resultIds = new Set(
        Array.from(resultIds).filter(id => {
          const count = countMap.get(id) || 0;
          return this.matchesIntCriterion(count, filter.childCount!);
        })
      );
    }
    
    // Media count filter
    if (filter.mediaCount) {
      const counts = await db.select({
        collectionId: schema.collectionMedia.collectionId,
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(schema.collectionMedia)
        .where(inArray(schema.collectionMedia.collectionId, Array.from(resultIds)))
        .groupBy(schema.collectionMedia.collectionId);
      
      const countMap = new Map(counts.map(c => [c.collectionId, c.count]));
      resultIds = new Set(
        Array.from(resultIds).filter(id => {
          const count = countMap.get(id) || 0;
          return this.matchesIntCriterion(count, filter.mediaCount!);
        })
      );
    }
    
    return Array.from(resultIds);
  }
}

export const filterService = new FilterService();