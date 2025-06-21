import './test-env'; // Must be first import
import { describe, test, expect, beforeEach } from 'bun:test';
import { BatchOperationsService, BatchOperationType } from '../src/services/batchOperationsService';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { 
  cleanDatabase, 
  insertTestMedia, 
  insertTestTag,
  insertTestCollection,
  generateMediaItems,
  waitForCondition 
} from './setup';

describe('BatchOperationsService', () => {
  let batchOps: BatchOperationsService;

  beforeEach(async () => {
    await cleanDatabase();
    batchOps = new BatchOperationsService();
  });

  describe('metadata operations', () => {
    test('should batch update metadata', async () => {
      const mediaItems = await generateMediaItems(5);
      const mediaIds = mediaItems.map(m => m.id);
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.UPDATE_METADATA,
        mediaIds,
        {
          updates: {
            rating: 5,
            favorite: true
          }
        }
      );
      
      const operation = await batchOps.getOperationStatus(operationId);
      expect(operation?.status).toBe('completed');
      expect(operation?.stats.processed).toBe(5);
      
      // Verify updates
      const updated = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.rating, 5));
      
      expect(updated).toHaveLength(5);
      expect(updated.every(m => m.favorite === true)).toBe(true);
    });

    test('should auto-generate titles', async () => {
      const media1 = await insertTestMedia({ 
        filename: 'IMG_20240315_145623.jpg',
        title: null 
      });
      const media2 = await insertTestMedia({ 
        filename: 'DSC_0012.jpg',
        title: null 
      });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.AUTO_GENERATE_TITLES,
        [media1.id, media2.id]
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      // Check generated titles
      const [updated1] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media1.id));
      
      const [updated2] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media2.id));
      
      expect(updated1.title).toBe('Photo from March 15, 2024');
      expect(updated2.title).toBe('Photo 0012');
    });

    test('should clear metadata fields', async () => {
      const media = await insertTestMedia({
        title: 'Test Title',
        description: 'Test Description',
        rating: 4
      });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.CLEAR_METADATA,
        [media.id],
        { fields: ['title', 'description'] }
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      expect(updated.title).toBeNull();
      expect(updated.description).toBeNull();
      expect(updated.rating).toBe(4); // Not cleared
    });
  });

  describe('tag operations', () => {
    test('should add tags to media', async () => {
      const tag1 = await insertTestTag({ name: 'vacation' });
      const tag2 = await insertTestTag({ name: '2024' });
      const media = await insertTestMedia();
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.ADD_TAGS,
        [media.id],
        { tagIds: [tag1.id, tag2.id] }
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.mediaId, media.id));
      
      expect(mediaTags).toHaveLength(2);
    });

    test('should remove tags from media', async () => {
      const tag1 = await insertTestTag({ name: 'keep' });
      const tag2 = await insertTestTag({ name: 'remove' });
      const media = await insertTestMedia();
      
      // Add both tags
      await db.insert(schema.mediaTags).values([
        { mediaId: media.id, tagId: tag1.id },
        { mediaId: media.id, tagId: tag2.id }
      ]);
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.REMOVE_TAGS,
        [media.id],
        { tagIds: [tag2.id] }
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.mediaId, media.id));
      
      expect(mediaTags).toHaveLength(1);
      expect(mediaTags[0].tagId).toBe(tag1.id);
    });

    test('should run auto-tagging', async () => {
      const media = await insertTestMedia({ 
        filename: 'vacation_photo.jpg',
        createdAt: new Date('2024-06-15')
      });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.AUTO_TAG,
        [media.id]
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      // Should have auto-generated tags
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.mediaId, media.id));
      
      expect(mediaTags.length).toBeGreaterThan(0);
    });
  });

  describe('collection operations', () => {
    test('should add media to collection', async () => {
      const collection = await insertTestCollection({ title: 'Best of 2024' });
      const media = await insertTestMedia();
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.ADD_TO_COLLECTION,
        [media.id],
        { collectionId: collection.id }
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const collectionMedia = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.mediaId, media.id));
      
      expect(collectionMedia).toHaveLength(1);
      expect(collectionMedia[0].collectionId).toBe(collection.id);
    });

    test('should remove media from collections', async () => {
      const collection = await insertTestCollection({ title: 'Test Collection' });
      const media = await insertTestMedia();
      
      // Add to collection
      await db.insert(schema.collectionMedia).values({
        collectionId: collection.id,
        mediaId: media.id,
        orderIndex: 0
      });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.REMOVE_FROM_COLLECTIONS,
        [media.id]
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const collectionMedia = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.mediaId, media.id));
      
      expect(collectionMedia).toHaveLength(0);
    });
  });

  describe('file operations', () => {
    test('should mark media as organized', async () => {
      const media = await insertTestMedia({ organized: false });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.ORGANIZE_FILES,
        [media.id],
        { pattern: 'YYYY/MM/filename' }
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      expect(updated.organized).toBe(true);
    });

    test('should regenerate thumbnails', async () => {
      const media = await insertTestMedia({ thumbnailGenerated: true });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.REGENERATE_THUMBNAILS,
        [media.id]
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const [updated] = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.id, media.id));
      
      // Should mark for regeneration
      expect(updated.thumbnailGenerated).toBe(false);
    });
  });

  describe('operation management', () => {
    test('should track operation progress', async () => {
      const mediaItems = await generateMediaItems(10);
      const mediaIds = mediaItems.map(m => m.id);
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.UPDATE_METADATA,
        mediaIds,
        { updates: { rating: 3 } }
      );
      
      // Check initial status
      const initialStatus = await batchOps.getOperationStatus(operationId);
      expect(initialStatus?.status).toBe('pending');
      expect(initialStatus?.totalItems).toBe(10);
      
      // Wait for completion
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        2000
      );
      
      const finalStatus = await batchOps.getOperationStatus(operationId);
      expect(finalStatus?.stats.processed).toBe(10);
    });

    test('should cancel operation', async () => {
      const mediaItems = await generateMediaItems(100);
      const mediaIds = mediaItems.map(m => m.id);
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.UPDATE_METADATA,
        mediaIds,
        { updates: { rating: 1 } }
      );
      
      // Cancel immediately
      const cancelled = await batchOps.cancelOperation(operationId);
      expect(cancelled).toBe(true);
      
      const status = await batchOps.getOperationStatus(operationId);
      expect(status?.status).toBe('cancelled');
    });

    test('should get active operations', async () => {
      const media = await insertTestMedia();
      
      const op1 = await batchOps.executeBatch(
        BatchOperationType.UPDATE_METADATA,
        [media.id],
        { updates: { rating: 1 } }
      );
      
      const op2 = await batchOps.executeBatch(
        BatchOperationType.ADD_TAGS,
        [media.id],
        { tagIds: [] }
      );
      
      const activeOps = await batchOps.getActiveOperations();
      expect(activeOps.length).toBeGreaterThanOrEqual(2);
      
      const ids = activeOps.map(op => op.id);
      expect(ids).toContain(op1);
      expect(ids).toContain(op2);
    });

    test('should handle operation errors', async () => {
      const operationId = await batchOps.executeBatch(
        BatchOperationType.ADD_TO_COLLECTION,
        [999999], // Non-existent media ID
        { collectionId: 1 }
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed' || op?.status === 'failed';
        },
        1000
      );
      
      const status = await batchOps.getOperationStatus(operationId);
      expect(status?.stats.failed).toBeGreaterThan(0);
    });
  });

  describe('bulk operations', () => {
    test('should export metadata', async () => {
      const media1 = await insertTestMedia({ 
        title: 'Export Test 1',
        description: 'Test description'
      });
      const media2 = await insertTestMedia({ 
        title: 'Export Test 2',
        rating: 5
      });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.EXPORT_METADATA,
        [media1.id, media2.id],
        { format: 'json' }
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      const status = await batchOps.getOperationStatus(operationId);
      expect(status?.stats.processed).toBe(2);
      // In real implementation, would check exported file
    });

    test('should analyze media quality', async () => {
      const media = await insertTestMedia({ 
        width: 1920,
        height: 1080,
        fileSize: 1024 * 1024 * 5 // 5MB
      });
      
      const operationId = await batchOps.executeBatch(
        BatchOperationType.ANALYZE_QUALITY,
        [media.id]
      );
      
      await waitForCondition(
        async () => {
          const op = await batchOps.getOperationStatus(operationId);
          return op?.status === 'completed';
        },
        1000
      );
      
      // Check for quality analysis results
      const customFields = await db.select()
        .from(schema.customFields)
        .where(eq(schema.customFields.entityId, media.id));
      
      const qualityField = customFields.find(f => f.fieldName === 'quality_score');
      expect(qualityField).toBeTruthy();
    });
  });
});