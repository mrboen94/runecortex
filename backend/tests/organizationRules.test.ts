import './test-env'; // Must be first import
import { describe, test, expect, beforeEach } from 'bun:test';
import { OrganizationRulesService } from '../src/services/organizationRulesService';
import { AutoTaggingService } from '../src/services/autoTaggingService';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { 
  cleanDatabase, 
  insertTestMedia, 
  insertTestTag,
  insertTestCollection,
  waitForCondition 
} from './setup';

describe('OrganizationRulesService', () => {
  let rulesService: OrganizationRulesService;
  let autoTagging: AutoTaggingService;

  beforeEach(async () => {
    await cleanDatabase();
    autoTagging = new AutoTaggingService();
    rulesService = new OrganizationRulesService(autoTagging);
  });

  describe('rule creation and management', () => {
    test('should create organization rule', async () => {
      const rule = {
        name: 'Organize by Date',
        description: 'Organize photos by year and month',
        trigger: {
          type: 'scan' as const,
          options: {}
        },
        conditions: [{
          type: 'fileType' as const,
          operator: 'equals' as const,
          value: 'image'
        }],
        actions: [{
          type: 'organize' as const,
          config: {
            pattern: 'YYYY/MM'
          }
        }]
      };
      
      const created = await rulesService.createRule(rule);
      
      expect(created.id).toBeTruthy();
      expect(created.name).toBe('Organize by Date');
      expect(created.enabled).toBe(true);
      expect(created.priority).toBe(50);
    });

    test('should update rule', async () => {
      const rule = await rulesService.createRule({
        name: 'Test Rule',
        trigger: { type: 'manual', options: {} },
        conditions: [],
        actions: []
      });
      
      const updated = await rulesService.updateRule(rule.id, {
        name: 'Updated Rule',
        enabled: false,
        priority: 100
      });
      
      expect(updated?.name).toBe('Updated Rule');
      expect(updated?.enabled).toBe(false);
      expect(updated?.priority).toBe(100);
    });

    test('should delete rule', async () => {
      const rule = await rulesService.createRule({
        name: 'To Delete',
        trigger: { type: 'manual', options: {} },
        conditions: [],
        actions: []
      });
      
      const deleted = await rulesService.deleteRule(rule.id);
      expect(deleted).toBe(true);
      
      const rules = await rulesService.getRules();
      expect(rules.find(r => r.id === rule.id)).toBeUndefined();
    });

    test('should get rules by trigger type', async () => {
      await rulesService.createRule({
        name: 'Scan Rule',
        trigger: { type: 'scan', options: {} },
        conditions: [],
        actions: []
      });
      
      await rulesService.createRule({
        name: 'Upload Rule',
        trigger: { type: 'upload', options: {} },
        conditions: [],
        actions: []
      });
      
      const scanRules = await rulesService.getRulesByTrigger('scan');
      const uploadRules = await rulesService.getRulesByTrigger('upload');
      
      expect(scanRules).toHaveLength(1);
      expect(uploadRules).toHaveLength(1);
    });
  });

  describe('condition evaluation', () => {
    test('should evaluate file type conditions', async () => {
      const rule = await rulesService.createRule({
        name: 'Images Only',
        trigger: { type: 'manual', options: {} },
        conditions: [{
          type: 'fileType',
          operator: 'equals',
          value: 'image'
        }],
        actions: []
      });
      
      const image = await insertTestMedia({ fileType: 'image' });
      const video = await insertTestMedia({ fileType: 'video' });
      
      const imageMatch = await rulesService.evaluateConditions(rule.conditions, image.id);
      const videoMatch = await rulesService.evaluateConditions(rule.conditions, video.id);
      
      expect(imageMatch).toBe(true);
      expect(videoMatch).toBe(false);
    });

    test('should evaluate date conditions', async () => {
      const rule = await rulesService.createRule({
        name: 'Old Media',
        trigger: { type: 'manual', options: {} },
        conditions: [{
          type: 'date',
          operator: 'before',
          value: '2023-01-01'
        }],
        actions: []
      });
      
      const oldMedia = await insertTestMedia({ createdAt: new Date('2022-06-15') });
      const newMedia = await insertTestMedia({ createdAt: new Date('2024-01-15') });
      
      const oldMatch = await rulesService.evaluateConditions(rule.conditions, oldMedia.id);
      const newMatch = await rulesService.evaluateConditions(rule.conditions, newMedia.id);
      
      expect(oldMatch).toBe(true);
      expect(newMatch).toBe(false);
    });

    test('should evaluate size conditions', async () => {
      const rule = await rulesService.createRule({
        name: 'Large Files',
        trigger: { type: 'manual', options: {} },
        conditions: [{
          type: 'size',
          operator: 'greater',
          value: 10 * 1024 * 1024 // 10MB
        }],
        actions: []
      });
      
      const largeFile = await insertTestMedia({ fileSize: 20 * 1024 * 1024 });
      const smallFile = await insertTestMedia({ fileSize: 5 * 1024 * 1024 });
      
      const largeMatch = await rulesService.evaluateConditions(rule.conditions, largeFile.id);
      const smallMatch = await rulesService.evaluateConditions(rule.conditions, smallFile.id);
      
      expect(largeMatch).toBe(true);
      expect(smallMatch).toBe(false);
    });

    test('should evaluate tag conditions', async () => {
      const tag = await insertTestTag({ name: 'vacation' });
      const media = await insertTestMedia();
      
      await db.insert(schema.mediaTags).values({
        mediaId: media.id,
        tagId: tag.id
      });
      
      const rule = await rulesService.createRule({
        name: 'Has Tag',
        trigger: { type: 'manual', options: {} },
        conditions: [{
          type: 'tag',
          operator: 'has',
          value: 'vacation'
        }],
        actions: []
      });
      
      const hasTag = await rulesService.evaluateConditions(rule.conditions, media.id);
      expect(hasTag).toBe(true);
    });

    test('should evaluate metadata conditions', async () => {
      const rule = await rulesService.createRule({
        name: 'High Rated',
        trigger: { type: 'manual', options: {} },
        conditions: [{
          type: 'metadata',
          operator: 'equals',
          field: 'rating',
          value: 5
        }],
        actions: []
      });
      
      const highRated = await insertTestMedia({ rating: 5 });
      const lowRated = await insertTestMedia({ rating: 2 });
      
      const highMatch = await rulesService.evaluateConditions(rule.conditions, highRated.id);
      const lowMatch = await rulesService.evaluateConditions(rule.conditions, lowRated.id);
      
      expect(highMatch).toBe(true);
      expect(lowMatch).toBe(false);
    });

    test('should evaluate multiple conditions with AND logic', async () => {
      const rule = await rulesService.createRule({
        name: 'Large Images',
        trigger: { type: 'manual', options: {} },
        conditions: [
          {
            type: 'fileType',
            operator: 'equals',
            value: 'image'
          },
          {
            type: 'size',
            operator: 'greater',
            value: 5 * 1024 * 1024
          }
        ],
        actions: []
      });
      
      const largeImage = await insertTestMedia({ 
        fileType: 'image',
        fileSize: 10 * 1024 * 1024 
      });
      const smallImage = await insertTestMedia({ 
        fileType: 'image',
        fileSize: 1 * 1024 * 1024 
      });
      const largeVideo = await insertTestMedia({ 
        fileType: 'video',
        fileSize: 10 * 1024 * 1024 
      });
      
      const largeImageMatch = await rulesService.evaluateConditions(rule.conditions, largeImage.id);
      const smallImageMatch = await rulesService.evaluateConditions(rule.conditions, smallImage.id);
      const largeVideoMatch = await rulesService.evaluateConditions(rule.conditions, largeVideo.id);
      
      expect(largeImageMatch).toBe(true);
      expect(smallImageMatch).toBe(false);
      expect(largeVideoMatch).toBe(false);
    });
  });

  describe('action execution', () => {
    test('should execute organize action', async () => {
      const media = await insertTestMedia({ 
        createdAt: new Date('2024-06-15'),
        organized: false 
      });
      
      const actions = [{
        type: 'organize' as const,
        config: {
          pattern: 'YYYY/MM/DD'
        }
      }];
      
      await rulesService.executeActions(actions, media.id);
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      expect(updated.organized).toBe(true);
      
      // Check custom field for organization path
      const [customField] = await db.select()
        .from(schema.customFields)
        .where(eq(schema.customFields.entityId, media.id));
      
      expect(customField?.fieldName).toBe('organized_path');
      expect(customField?.fieldValue).toBe('2024/06/15');
    });

    test('should execute add tag action', async () => {
      const media = await insertTestMedia();
      
      const actions = [{
        type: 'addTag' as const,
        config: {
          tags: ['auto-organized', '2024']
        }
      }];
      
      await rulesService.executeActions(actions, media.id);
      
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .innerJoin(schema.tags, eq(schema.mediaTags.tagId, schema.tags.id))
        .where(eq(schema.mediaTags.mediaId, media.id));
      
      const tagNames = mediaTags.map(mt => mt.tags.name);
      expect(tagNames).toContain('auto-organized');
      expect(tagNames).toContain('2024');
    });

    test('should execute move to collection action', async () => {
      const collection = await insertTestCollection({ title: 'Auto Collection' });
      const media = await insertTestMedia();
      
      const actions = [{
        type: 'moveToCollection' as const,
        config: {
          collectionId: collection.id
        }
      }];
      
      await rulesService.executeActions(actions, media.id);
      
      const [collectionMedia] = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.mediaId, media.id));
      
      expect(collectionMedia?.collectionId).toBe(collection.id);
    });

    test('should execute set metadata action', async () => {
      const media = await insertTestMedia({ rating: null });
      
      const actions = [{
        type: 'setMetadata' as const,
        config: {
          field: 'rating',
          value: 4
        }
      }];
      
      await rulesService.executeActions(actions, media.id);
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      expect(updated.rating).toBe(4);
    });

    test('should execute auto tag action', async () => {
      const media = await insertTestMedia({ 
        filename: 'vacation_photo.jpg',
        createdAt: new Date('2024-06-15')
      });
      
      const actions = [{
        type: 'autoTag' as const,
        config: {}
      }];
      
      await rulesService.executeActions(actions, media.id);
      
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.mediaId, media.id));
      
      expect(mediaTags.length).toBeGreaterThan(0);
    });

    test('should execute notify action', async () => {
      const media = await insertTestMedia();
      
      const actions = [{
        type: 'notify' as const,
        config: {
          message: 'New media added: {filename}'
        }
      }];
      
      // Mock console.log to verify notification
      const originalLog = console.log;
      let loggedMessage = '';
      console.log = (msg: string) => { loggedMessage = msg; };
      
      await rulesService.executeActions(actions, media.id);
      
      expect(loggedMessage).toContain(media.filename);
      
      // Restore console.log
      console.log = originalLog;
    });
  });

  describe('rule processing', () => {
    test('should process media with scan trigger', async () => {
      const rule = await rulesService.createRule({
        name: 'Auto Organize Images',
        trigger: { type: 'scan', options: {} },
        conditions: [{
          type: 'fileType',
          operator: 'equals',
          value: 'image'
        }],
        actions: [{
          type: 'organize',
          config: { pattern: 'YYYY/MM' }
        }]
      });
      
      const image = await insertTestMedia({ 
        fileType: 'image',
        organized: false 
      });
      const video = await insertTestMedia({ 
        fileType: 'video',
        organized: false 
      });
      
      await rulesService.processMediaWithRules([image.id, video.id], 'scan');
      
      const [updatedImage] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, image.id));
      
      const [updatedVideo] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, video.id));
      
      expect(updatedImage.organized).toBe(true);
      expect(updatedVideo.organized).toBe(false);
    });

    test('should respect rule priority', async () => {
      const highPriorityRule = await rulesService.createRule({
        name: 'High Priority',
        priority: 100,
        trigger: { type: 'scan', options: {} },
        conditions: [{
          type: 'fileType',
          operator: 'equals',
          value: 'image'
        }],
        actions: [{
          type: 'setMetadata',
          config: { field: 'rating', value: 5 }
        }]
      });
      
      const lowPriorityRule = await rulesService.createRule({
        name: 'Low Priority',
        priority: 10,
        trigger: { type: 'scan', options: {} },
        conditions: [{
          type: 'fileType',
          operator: 'equals',
          value: 'image'
        }],
        actions: [{
          type: 'setMetadata',
          config: { field: 'rating', value: 3 }
        }]
      });
      
      const media = await insertTestMedia({ fileType: 'image' });
      
      await rulesService.processMediaWithRules([media.id], 'scan');
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      // High priority rule should execute last, setting rating to 5
      expect(updated.rating).toBe(5);
    });

    test('should skip disabled rules', async () => {
      const rule = await rulesService.createRule({
        name: 'Disabled Rule',
        enabled: false,
        trigger: { type: 'scan', options: {} },
        conditions: [],
        actions: [{
          type: 'setMetadata',
          config: { field: 'rating', value: 1 }
        }]
      });
      
      const media = await insertTestMedia({ rating: null });
      
      await rulesService.processMediaWithRules([media.id], 'scan');
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      expect(updated.rating).toBeNull();
    });

    test('should handle scheduled trigger', async () => {
      const rule = await rulesService.createRule({
        name: 'Daily Cleanup',
        trigger: { 
          type: 'scheduled',
          options: {
            schedule: '0 0 * * *' // Daily at midnight
          }
        },
        conditions: [{
          type: 'metadata',
          operator: 'equals',
          field: 'organized',
          value: false
        }],
        actions: [{
          type: 'organize',
          config: { pattern: 'YYYY/MM' }
        }]
      });
      
      const unorganized = await insertTestMedia({ organized: false });
      const organized = await insertTestMedia({ organized: true });
      
      const processed = await rulesService.runScheduledRules();
      
      expect(processed).toBeGreaterThan(0);
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, unorganized.id));
      
      expect(updated.organized).toBe(true);
    });
  });

  describe('rule statistics', () => {
    test('should track rule execution stats', async () => {
      const rule = await rulesService.createRule({
        name: 'Stats Rule',
        trigger: { type: 'manual', options: {} },
        conditions: [],
        actions: [{
          type: 'addTag',
          config: { tags: ['processed'] }
        }]
      });
      
      const media = await insertTestMedia();
      
      await rulesService.applyRule(rule.id, [media.id]);
      
      const stats = await rulesService.getRuleStats(rule.id);
      
      expect(stats.executionCount).toBe(1);
      expect(stats.lastExecuted).toBeTruthy();
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(0);
    });
  });
});