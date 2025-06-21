import { db, schema } from '../db';
import { eq, and, or, gte, lte, inArray, sql } from 'drizzle-orm';
import { collectionService } from './collectionService';
import { tagService } from './tagService';
import { mediaMetadataService } from './mediaMetadataService';
import { filterService } from './filterService';
import { MediaFilterInput } from '../models/filter';
import path from 'path';

export interface OrganizationRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
  lastRun?: Date;
  lastResult?: RuleResult;
}

export interface RuleTrigger {
  type: 'scan' | 'upload' | 'manual' | 'schedule';
  schedule?: {
    frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
    time?: string; // HH:MM format
    dayOfWeek?: number; // 0-6
    dayOfMonth?: number; // 1-31
  };
}

export interface RuleCondition {
  type: 'filter' | 'age' | 'size' | 'count' | 'custom';
  operator: 'and' | 'or';
  filter?: MediaFilterInput;
  age?: {
    field: 'created' | 'added' | 'modified';
    operator: 'older' | 'newer';
    value: number;
    unit: 'hours' | 'days' | 'weeks' | 'months';
  };
  size?: {
    operator: 'greater' | 'less';
    value: number;
    unit: 'KB' | 'MB' | 'GB';
  };
  count?: {
    field: 'tags' | 'collections';
    operator: 'equals' | 'greater' | 'less';
    value: number;
  };
}

export interface RuleAction {
  type: 'addToCollection' | 'addTags' | 'removeTags' | 'setMetadata' | 
        'markFavorite' | 'markOrganized' | 'moveToFolder' | 'createCollection' |
        'autoTag' | 'generateTitle' | 'notify';
  params: any;
}

export interface RuleResult {
  success: boolean;
  itemsProcessed: number;
  itemsAffected: number;
  errors?: string[];
  timestamp: Date;
}

export class OrganizationRulesService {
  private rules: Map<string, OrganizationRule> = new Map();
  private scheduleTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules() {
    const defaultRules: OrganizationRule[] = [
      {
        id: 'organize-by-date',
        name: 'Organize by Date',
        description: 'Automatically organize media into monthly collections',
        enabled: false,
        priority: 100,
        trigger: { type: 'scan' },
        conditions: [{
          type: 'filter',
          operator: 'and',
          filter: { organized: false }
        }],
        actions: [{
          type: 'createCollection',
          params: {
            namePattern: '{year}-{month} {monthName}',
            groupBy: 'month'
          }
        }, {
          type: 'markOrganized',
          params: {}
        }]
      },
      {
        id: 'auto-favorite-high-quality',
        name: 'Auto-Favorite High Quality',
        description: 'Mark high resolution media as favorites',
        enabled: false,
        priority: 90,
        trigger: { type: 'scan' },
        conditions: [{
          type: 'filter',
          operator: 'and',
          filter: {
            resolution: { value: 'FOUR_K', modifier: 'GREATER_THAN' as any },
            favorite: false
          }
        }],
        actions: [{
          type: 'markFavorite',
          params: { favorite: true }
        }]
      },
      {
        id: 'tag-old-unorganized',
        name: 'Tag Old Unorganized Media',
        description: 'Add "needs-review" tag to old unorganized media',
        enabled: false,
        priority: 80,
        trigger: {
          type: 'schedule',
          schedule: { frequency: 'weekly', dayOfWeek: 0 } // Sunday
        },
        conditions: [{
          type: 'age',
          operator: 'and',
          age: {
            field: 'added',
            operator: 'older',
            value: 30,
            unit: 'days'
          }
        }, {
          type: 'filter',
          operator: 'and',
          filter: { organized: false }
        }],
        actions: [{
          type: 'addTags',
          params: { tags: ['needs-review'] }
        }]
      },
      {
        id: 'archive-old-screenshots',
        name: 'Archive Old Screenshots',
        description: 'Move old screenshots to archive collection',
        enabled: false,
        priority: 70,
        trigger: {
          type: 'schedule',
          schedule: { frequency: 'monthly', dayOfMonth: 1 }
        },
        conditions: [{
          type: 'filter',
          operator: 'and',
          filter: {
            tags: { value: 'screenshot', modifier: 'INCLUDES' as any }
          }
        }, {
          type: 'age',
          operator: 'and',
          age: {
            field: 'created',
            operator: 'older',
            value: 3,
            unit: 'months'
          }
        }],
        actions: [{
          type: 'addToCollection',
          params: {
            collectionName: 'Archived Screenshots',
            createIfNotExists: true
          }
        }]
      },
      {
        id: 'detect-events',
        name: 'Detect Events',
        description: 'Group photos taken within short time periods',
        enabled: false,
        priority: 60,
        trigger: { type: 'scan' },
        conditions: [{
          type: 'custom',
          operator: 'and'
        }],
        actions: [{
          type: 'createCollection',
          params: {
            namePattern: 'Event {date}',
            groupBy: 'timeClusters',
            clusterGap: 3600 // 1 hour gap between events
          }
        }]
      }
    ];

    for (const rule of defaultRules) {
      this.rules.set(rule.id, rule);
    }
  }

  async addRule(rule: Omit<OrganizationRule, 'id'>): Promise<OrganizationRule> {
    const newRule: OrganizationRule = {
      ...rule,
      id: `rule-${Date.now()}`
    };

    this.rules.set(newRule.id, newRule);
    
    if (newRule.enabled && newRule.trigger.type === 'schedule') {
      this.scheduleRule(newRule);
    }

    return newRule;
  }

  async updateRule(id: string, updates: Partial<OrganizationRule>): Promise<OrganizationRule | null> {
    const rule = this.rules.get(id);
    if (!rule) return null;

    const wasScheduled = rule.enabled && rule.trigger.type === 'schedule';
    const updatedRule = { ...rule, ...updates };
    
    this.rules.set(id, updatedRule);

    // Update scheduling
    if (wasScheduled) {
      this.unscheduleRule(id);
    }
    if (updatedRule.enabled && updatedRule.trigger.type === 'schedule') {
      this.scheduleRule(updatedRule);
    }

    return updatedRule;
  }

  async deleteRule(id: string): Promise<boolean> {
    const rule = this.rules.get(id);
    if (!rule) return false;

    this.unscheduleRule(id);
    this.rules.delete(id);
    return true;
  }

  getRules(): OrganizationRule[] {
    return Array.from(this.rules.values());
  }

  getRule(id: string): OrganizationRule | undefined {
    return this.rules.get(id);
  }

  async runRule(ruleId: string): Promise<RuleResult> {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return {
        success: false,
        itemsProcessed: 0,
        itemsAffected: 0,
        errors: ['Rule not found'],
        timestamp: new Date()
      };
    }

    const result: RuleResult = {
      success: true,
      itemsProcessed: 0,
      itemsAffected: 0,
      errors: [],
      timestamp: new Date()
    };

    try {
      // Get items that match conditions
      const matchingIds = await this.evaluateConditions(rule.conditions);
      result.itemsProcessed = matchingIds.length;

      if (matchingIds.length === 0) {
        rule.lastRun = new Date();
        rule.lastResult = result;
        return result;
      }

      // Execute actions
      for (const action of rule.actions) {
        try {
          const affected = await this.executeAction(action, matchingIds);
          result.itemsAffected += affected;
        } catch (error: any) {
          result.errors?.push(`Action ${action.type} failed: ${error.message}`);
          result.success = false;
        }
      }

      rule.lastRun = new Date();
      rule.lastResult = result;
    } catch (error: any) {
      result.success = false;
      result.errors?.push(error.message);
    }

    return result;
  }

  async runAllEnabledRules(trigger: 'scan' | 'upload' | 'manual'): Promise<Map<string, RuleResult>> {
    const results = new Map<string, RuleResult>();
    
    const rulesToRun = Array.from(this.rules.values())
      .filter(rule => rule.enabled && rule.trigger.type === trigger)
      .sort((a, b) => b.priority - a.priority);

    for (const rule of rulesToRun) {
      const result = await this.runRule(rule.id);
      results.set(rule.id, result);
    }

    return results;
  }

  private async evaluateConditions(conditions: RuleCondition[]): Promise<number[]> {
    let allMatchingIds: Set<number> | null = null;

    for (const condition of conditions) {
      const conditionIds = await this.evaluateCondition(condition);
      
      if (allMatchingIds === null) {
        allMatchingIds = new Set(conditionIds);
      } else {
        if (condition.operator === 'and') {
          // Intersection
          allMatchingIds = new Set(
            [...allMatchingIds].filter(id => conditionIds.includes(id))
          );
        } else {
          // Union
          conditionIds.forEach(id => allMatchingIds!.add(id));
        }
      }
    }

    return Array.from(allMatchingIds || []);
  }

  private async evaluateCondition(condition: RuleCondition): Promise<number[]> {
    switch (condition.type) {
      case 'filter':
        if (!condition.filter) return [];
        return this.evaluateFilterCondition(condition.filter);

      case 'age':
        if (!condition.age) return [];
        return this.evaluateAgeCondition(condition.age);

      case 'size':
        if (!condition.size) return [];
        return this.evaluateSizeCondition(condition.size);

      case 'count':
        if (!condition.count) return [];
        return this.evaluateCountCondition(condition.count);

      case 'custom':
        return this.evaluateCustomCondition(condition);

      default:
        return [];
    }
  }

  private async evaluateFilterCondition(filter: MediaFilterInput): Promise<number[]> {
    const conditions = await filterService.buildMediaFilter(filter);
    let query = db.select({ id: schema.mediaItems.id })
      .from(schema.mediaItems);
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }
    
    const items = await query;
    const mediaIds = items.map(item => item.id);
    
    // Apply complex filters
    return filterService.applyComplexMediaFilters(mediaIds, filter);
  }

  private async evaluateAgeCondition(age: {
    field: 'created' | 'added' | 'modified';
    operator: 'older' | 'newer';
    value: number;
    unit: 'hours' | 'days' | 'weeks' | 'months';
  }): Promise<number[]> {
    const now = new Date();
    const threshold = new Date(now);

    // Calculate threshold date
    switch (age.unit) {
      case 'hours':
        threshold.setHours(threshold.getHours() - age.value);
        break;
      case 'days':
        threshold.setDate(threshold.getDate() - age.value);
        break;
      case 'weeks':
        threshold.setDate(threshold.getDate() - (age.value * 7));
        break;
      case 'months':
        threshold.setMonth(threshold.getMonth() - age.value);
        break;
    }

    // Select appropriate field
    let field;
    switch (age.field) {
      case 'created':
        field = schema.mediaItems.createdAt;
        break;
      case 'added':
        field = schema.mediaItems.addedAt;
        break;
      case 'modified':
        field = schema.mediaItems.lastModified;
        break;
    }

    // Query based on operator
    const items = await db.select({ id: schema.mediaItems.id })
      .from(schema.mediaItems)
      .where(age.operator === 'older' ? 
        lte(field, threshold) : 
        gte(field, threshold)
      );

    return items.map(item => item.id);
  }

  private async evaluateSizeCondition(size: {
    operator: 'greater' | 'less';
    value: number;
    unit: 'KB' | 'MB' | 'GB';
  }): Promise<number[]> {
    // Convert to bytes
    let bytes = size.value;
    switch (size.unit) {
      case 'KB':
        bytes *= 1024;
        break;
      case 'MB':
        bytes *= 1024 * 1024;
        break;
      case 'GB':
        bytes *= 1024 * 1024 * 1024;
        break;
    }

    const items = await db.select({ id: schema.mediaItems.id })
      .from(schema.mediaItems)
      .where(size.operator === 'greater' ?
        gte(schema.mediaItems.fileSize, bytes) :
        lte(schema.mediaItems.fileSize, bytes)
      );

    return items.map(item => item.id);
  }

  private async evaluateCountCondition(count: {
    field: 'tags' | 'collections';
    operator: 'equals' | 'greater' | 'less';
    value: number;
  }): Promise<number[]> {
    let query;

    if (count.field === 'tags') {
      query = db.select({
        mediaId: schema.mediaTags.mediaId,
        count: sql<number>`COUNT(*)`.as('count')
      })
        .from(schema.mediaTags)
        .groupBy(schema.mediaTags.mediaId);
    } else {
      query = db.select({
        mediaId: schema.collectionMedia.mediaId,
        count: sql<number>`COUNT(*)`.as('count')
      })
        .from(schema.collectionMedia)
        .groupBy(schema.collectionMedia.mediaId);
    }

    const counts = await query;
    const matchingIds: number[] = [];

    for (const item of counts) {
      const matches = count.operator === 'equals' ? item.count === count.value :
                     count.operator === 'greater' ? item.count > count.value :
                     item.count < count.value;
      
      if (matches) {
        matchingIds.push(item.mediaId);
      }
    }

    // Also include items with 0 count if applicable
    if ((count.operator === 'equals' && count.value === 0) ||
        (count.operator === 'less' && count.value > 0)) {
      const allIds = await db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      const idsWithCount = new Set(counts.map(c => c.mediaId));
      
      for (const item of allIds) {
        if (!idsWithCount.has(item.id)) {
          matchingIds.push(item.id);
        }
      }
    }

    return matchingIds;
  }

  private async evaluateCustomCondition(condition: RuleCondition): Promise<number[]> {
    // Custom conditions would be implemented based on specific needs
    // For now, return all items
    const items = await db.select({ id: schema.mediaItems.id })
      .from(schema.mediaItems);
    
    return items.map(item => item.id);
  }

  private async executeAction(action: RuleAction, mediaIds: number[]): Promise<number> {
    let affected = 0;

    switch (action.type) {
      case 'addToCollection':
        affected = await this.actionAddToCollection(mediaIds, action.params);
        break;

      case 'addTags':
        affected = await this.actionAddTags(mediaIds, action.params);
        break;

      case 'removeTags':
        affected = await this.actionRemoveTags(mediaIds, action.params);
        break;

      case 'setMetadata':
        affected = await this.actionSetMetadata(mediaIds, action.params);
        break;

      case 'markFavorite':
        affected = await this.actionMarkFavorite(mediaIds, action.params);
        break;

      case 'markOrganized':
        affected = await this.actionMarkOrganized(mediaIds, action.params);
        break;

      case 'createCollection':
        affected = await this.actionCreateCollection(mediaIds, action.params);
        break;

      case 'autoTag':
        affected = await this.actionAutoTag(mediaIds, action.params);
        break;

      case 'generateTitle':
        affected = await this.actionGenerateTitle(mediaIds, action.params);
        break;

      case 'notify':
        affected = await this.actionNotify(mediaIds, action.params);
        break;

      default:
        break;
    }

    return affected;
  }

  private async actionAddToCollection(mediaIds: number[], params: any): Promise<number> {
    let collection;

    if (params.collectionId) {
      collection = await collectionService.getCollection(params.collectionId);
    } else if (params.collectionName && params.createIfNotExists) {
      // Find or create collection
      const existing = await db.select()
        .from(schema.collections)
        .where(eq(schema.collections.title, params.collectionName))
        .limit(1);
      
      if (existing.length > 0) {
        collection = existing[0];
      } else {
        collection = await collectionService.createCollection({
          title: params.collectionName,
          description: params.description
        });
      }
    }

    if (!collection) return 0;

    await collectionService.addMediaToCollection(collection.id, mediaIds);
    return mediaIds.length;
  }

  private async actionAddTags(mediaIds: number[], params: any): Promise<number> {
    const tags = params.tags || [];
    
    for (const mediaId of mediaIds) {
      await tagService.autoTagMedia(mediaId, tags);
    }

    return mediaIds.length;
  }

  private async actionRemoveTags(mediaIds: number[], params: any): Promise<number> {
    const tagNames = params.tags || [];
    
    // Get tag IDs
    const tags = await db.select()
      .from(schema.tags)
      .where(inArray(schema.tags.name, tagNames));
    
    const tagIds = tags.map(t => t.id);
    
    if (tagIds.length > 0) {
      await tagService.removeTagsFromMedia(mediaIds, tagIds);
    }

    return mediaIds.length;
  }

  private async actionSetMetadata(mediaIds: number[], params: any): Promise<number> {
    return mediaMetadataService.bulkUpdateMediaMetadata({
      ids: mediaIds,
      ...params
    });
  }

  private async actionMarkFavorite(mediaIds: number[], params: any): Promise<number> {
    return mediaMetadataService.bulkUpdateMediaMetadata({
      ids: mediaIds,
      favorite: params.favorite !== false
    });
  }

  private async actionMarkOrganized(mediaIds: number[], params: any): Promise<number> {
    return mediaMetadataService.bulkUpdateMediaMetadata({
      ids: mediaIds,
      organized: params.organized !== false
    });
  }

  private async actionCreateCollection(mediaIds: number[], params: any): Promise<number> {
    if (params.groupBy === 'month') {
      // Group by year-month
      const items = await db.select()
        .from(schema.mediaItems)
        .where(inArray(schema.mediaItems.id, mediaIds));
      
      const groups = new Map<string, number[]>();
      
      for (const item of items) {
        const date = item.createdAt;
        const year = date.getFullYear();
        const month = date.getMonth();
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(item.id);
      }

      // Create collections for each group
      let totalAffected = 0;
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];

      for (const [key, ids] of groups) {
        const [year, month] = key.split('-');
        const monthName = monthNames[parseInt(month) - 1];
        
        let title = params.namePattern || '{year}-{month} {monthName}';
        title = title
          .replace('{year}', year)
          .replace('{month}', month)
          .replace('{monthName}', monthName);

        const collection = await collectionService.createCollection({
          title,
          date: new Date(parseInt(year), parseInt(month) - 1, 1),
          organized: true
        });

        await collectionService.addMediaToCollection(collection.id, ids);
        totalAffected += ids.length;
      }

      return totalAffected;
    } else if (params.groupBy === 'timeClusters') {
      // Group by time proximity
      const items = await db.select()
        .from(schema.mediaItems)
        .where(inArray(schema.mediaItems.id, mediaIds))
        .orderBy(schema.mediaItems.createdAt);
      
      const clusters: Array<number[]> = [];
      let currentCluster: number[] = [];
      let lastTime: Date | null = null;
      const gapSeconds = params.clusterGap || 3600;

      for (const item of items) {
        if (!lastTime || 
            (item.createdAt.getTime() - lastTime.getTime()) / 1000 > gapSeconds) {
          // Start new cluster
          if (currentCluster.length > 0) {
            clusters.push(currentCluster);
          }
          currentCluster = [item.id];
        } else {
          currentCluster.push(item.id);
        }
        lastTime = item.createdAt;
      }

      if (currentCluster.length > 0) {
        clusters.push(currentCluster);
      }

      // Create collections for clusters
      let totalAffected = 0;
      let clusterIndex = 1;

      for (const cluster of clusters) {
        if (cluster.length >= (params.minClusterSize || 3)) {
          const firstItem = items.find(i => i.id === cluster[0]);
          if (!firstItem) continue;

          let title = params.namePattern || 'Event {date}';
          title = title
            .replace('{date}', firstItem.createdAt.toLocaleDateString())
            .replace('{index}', clusterIndex.toString());

          const collection = await collectionService.createCollection({
            title,
            date: firstItem.createdAt,
            organized: true
          });

          await collectionService.addMediaToCollection(collection.id, cluster);
          totalAffected += cluster.length;
          clusterIndex++;
        }
      }

      return totalAffected;
    }

    return 0;
  }

  private async actionAutoTag(mediaIds: number[], params: any): Promise<number> {
    const { autoTaggingService } = await import('./autoTaggingService');
    
    let tagged = 0;
    for (const mediaId of mediaIds) {
      const tags = await autoTaggingService.autoTagMedia(mediaId);
      if (tags.length > 0) tagged++;
    }

    return tagged;
  }

  private async actionGenerateTitle(mediaIds: number[], params: any): Promise<number> {
    return mediaMetadataService.bulkAutoGenerateTitles(mediaIds);
  }

  private async actionNotify(mediaIds: number[], params: any): Promise<number> {
    // In a real implementation, this would send notifications
    console.log(`Organization rule notification: ${params.message || 'Items processed'}`);
    console.log(`Affected items: ${mediaIds.length}`);
    return mediaIds.length;
  }

  private scheduleRule(rule: OrganizationRule): void {
    if (!rule.trigger.schedule) return;

    const schedule = rule.trigger.schedule;
    let interval: number;

    switch (schedule.frequency) {
      case 'hourly':
        interval = 60 * 60 * 1000;
        break;
      case 'daily':
        interval = 24 * 60 * 60 * 1000;
        break;
      case 'weekly':
        interval = 7 * 24 * 60 * 60 * 1000;
        break;
      case 'monthly':
        interval = 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        return;
    }

    // Clear existing timer
    this.unscheduleRule(rule.id);

    // Set up new timer
    const timer = setInterval(async () => {
      await this.runRule(rule.id);
    }, interval);

    this.scheduleTimers.set(rule.id, timer);
  }

  private unscheduleRule(ruleId: string): void {
    const timer = this.scheduleTimers.get(ruleId);
    if (timer) {
      clearInterval(timer);
      this.scheduleTimers.delete(ruleId);
    }
  }

  // Clean up timers on shutdown
  shutdown(): void {
    for (const timer of this.scheduleTimers.values()) {
      clearInterval(timer);
    }
    this.scheduleTimers.clear();
  }
}

export const organizationRulesService = new OrganizationRulesService();