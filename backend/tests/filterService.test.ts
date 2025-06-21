import './test-env'; // Must be first import
import { 
  describe, 
  test, 
  expect, 
  beforeEach,
  cleanDatabase, 
  insertTestMedia, 
  insertTestTag,
  insertTestCollection,
  generateMediaItems 
} from './test-config';
import { FilterService } from '../src/services/filterService';
import { db, schema } from '../src/db';
import { CriterionModifier } from '../src/models/filter';

describe('FilterService', () => {
  let filterService: FilterService;

  beforeEach(async () => {
    await cleanDatabase();
    filterService = new FilterService();
  });

  describe('string criterion', () => {
    test('should filter by filename contains', async () => {
      await insertTestMedia({ filename: 'vacation_photo.jpg' });
      await insertTestMedia({ filename: 'work_document.jpg' });
      await insertTestMedia({ filename: 'vacation_video.mp4' });

      const filter = {
        filename: {
          value: 'vacation',
          modifier: CriterionModifier.INCLUDES
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(2);
    });

    test('should filter by exact match', async () => {
      await insertTestMedia({ filename: 'exact_match.jpg' });
      await insertTestMedia({ filename: 'exact_match_not.jpg' });

      const filter = {
        filename: {
          value: 'exact_match.jpg',
          modifier: CriterionModifier.EQUALS
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(1);
    });

    test('should filter by regex match', async () => {
      await insertTestMedia({ filename: 'IMG_1234.jpg' });
      await insertTestMedia({ filename: 'IMG_5678.jpg' });
      await insertTestMedia({ filename: 'DSC_9012.jpg' });

      const filter = {
        filename: {
          value: '^IMG_\\d+',
          modifier: CriterionModifier.MATCHES_REGEX
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      if (conditions.length > 0) {
        query.where(conditions[0]);
      }
      
      const results = await query;
      expect(results).toHaveLength(2);
    });

    test('should filter by null/not null', async () => {
      await insertTestMedia({ title: 'Has Title' });
      await insertTestMedia({ title: null });

      const filter = {
        title: {
          value: '',
          modifier: CriterionModifier.NOT_NULL
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(1);
    });
  });

  describe('numeric criterion', () => {
    test('should filter by file size greater than', async () => {
      await insertTestMedia({ fileSize: 1000 });
      await insertTestMedia({ fileSize: 5000 });
      await insertTestMedia({ fileSize: 10000 });

      const filter = {
        fileSize: {
          value: 4000,
          modifier: CriterionModifier.GREATER_THAN
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(2);
    });

    test('should filter by rating between', async () => {
      await insertTestMedia({ rating: 1 });
      await insertTestMedia({ rating: 3 });
      await insertTestMedia({ rating: 5 });

      const filter = {
        rating: {
          value: 2,
          value2: 4,
          modifier: CriterionModifier.BETWEEN
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(1);
    });
  });

  describe('date criterion', () => {
    test('should filter by date equals (same day)', async () => {
      await insertTestMedia({ createdAt: new Date('2024-01-15T10:00:00') });
      await insertTestMedia({ createdAt: new Date('2024-01-15T20:00:00') });
      await insertTestMedia({ createdAt: new Date('2024-01-16T10:00:00') });

      const filter = {
        createdAt: {
          value: '2024-01-15',
          modifier: CriterionModifier.EQUALS
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(2);
    });

    test('should filter by date range', async () => {
      await insertTestMedia({ createdAt: new Date('2024-01-10') });
      await insertTestMedia({ createdAt: new Date('2024-01-15') });
      await insertTestMedia({ createdAt: new Date('2024-01-20') });
      await insertTestMedia({ createdAt: new Date('2024-01-25') });

      const filter = {
        createdAt: {
          value: '2024-01-12',
          value2: '2024-01-22',
          modifier: CriterionModifier.BETWEEN
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(2);
    });
  });

  describe('boolean filters', () => {
    test('should filter by favorite status', async () => {
      await insertTestMedia({ favorite: true });
      await insertTestMedia({ favorite: false });
      await insertTestMedia({ favorite: true });

      const filter = { favorite: true };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(2);
    });

    test('should filter by organized status', async () => {
      await insertTestMedia({ organized: true });
      await insertTestMedia({ organized: false });

      const filter = { organized: false };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems)
        .where(conditions[0]);
      
      const results = await query;
      expect(results).toHaveLength(1);
    });
  });

  describe('resolution and orientation filters', () => {
    test('should filter by resolution category', async () => {
      const media1 = await insertTestMedia({ width: 1920, height: 1080 }); // Full HD
      const media2 = await insertTestMedia({ width: 3840, height: 2160 }); // 4K
      const media3 = await insertTestMedia({ width: 640, height: 480 });   // SD

      const filter = {
        resolution: {
          value: 'FULL_HD' as any,
          modifier: CriterionModifier.GREATER_THAN
        }
      };

      const mediaIds = [media1.id, media2.id, media3.id];
      const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
      
      expect(filteredIds).toHaveLength(1);
      expect(filteredIds).toContain(media2.id);
    });

    test('should filter by orientation', async () => {
      const landscape = await insertTestMedia({ width: 1920, height: 1080 });
      const portrait = await insertTestMedia({ width: 1080, height: 1920 });
      const square = await insertTestMedia({ width: 1000, height: 1000 });

      const filter = {
        orientation: {
          value: 'LANDSCAPE' as any
        }
      };

      const mediaIds = [landscape.id, portrait.id, square.id];
      const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
      
      expect(filteredIds).toHaveLength(1);
      expect(filteredIds).toContain(landscape.id);
    });
  });

  describe('hierarchical filters (tags/collections)', () => {
    test('should filter by tag inclusion', async () => {
      const tag = await insertTestTag({ name: 'vacation' });
      const media1 = await insertTestMedia({ filename: 'tagged1.jpg' });
      const media2 = await insertTestMedia({ filename: 'tagged2.jpg' });
      const media3 = await insertTestMedia({ filename: 'untagged.jpg' });

      // Add tags to media
      await db.insert(schema.mediaTags).values([
        { mediaId: media1.id, tagId: tag.id },
        { mediaId: media2.id, tagId: tag.id }
      ]);

      const filter = {
        tags: {
          value: 'vacation',
          modifier: CriterionModifier.INCLUDES
        }
      };

      const mediaIds = [media1.id, media2.id, media3.id];
      const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
      
      expect(filteredIds).toHaveLength(2);
      expect(filteredIds).toContain(media1.id);
      expect(filteredIds).toContain(media2.id);
    });

    test('should filter by tag hierarchy', async () => {
      const parentTag = await insertTestTag({ name: 'events' });
      const childTag = await insertTestTag({ name: 'birthday', parentId: parentTag.id });
      
      const media1 = await insertTestMedia({ filename: 'birthday1.jpg' });
      const media2 = await insertTestMedia({ filename: 'other.jpg' });

      await db.insert(schema.mediaTags).values([
        { mediaId: media1.id, tagId: childTag.id }
      ]);

      const filter = {
        tags: {
          value: parentTag.id.toString(),
          modifier: CriterionModifier.INCLUDES,
          depth: 1
        }
      };

      const mediaIds = [media1.id, media2.id];
      const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
      
      expect(filteredIds).toHaveLength(1);
      expect(filteredIds).toContain(media1.id);
    });

    test('should filter by collection membership', async () => {
      const collection = await insertTestCollection({ title: 'Summer 2024' });
      const media1 = await insertTestMedia({ filename: 'in_collection.jpg' });
      const media2 = await insertTestMedia({ filename: 'not_in_collection.jpg' });

      await db.insert(schema.collectionMedia).values([
        { collectionId: collection.id, mediaId: media1.id, orderIndex: 0 }
      ]);

      const filter = {
        collections: {
          value: collection.id.toString(),
          modifier: CriterionModifier.INCLUDES
        }
      };

      const mediaIds = [media1.id, media2.id];
      const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
      
      expect(filteredIds).toHaveLength(1);
      expect(filteredIds).toContain(media1.id);
    });

    test('should filter by tag count', async () => {
      const tag1 = await insertTestTag({ name: 'tag1' });
      const tag2 = await insertTestTag({ name: 'tag2' });
      const tag3 = await insertTestTag({ name: 'tag3' });
      
      const media1 = await insertTestMedia({ filename: 'many_tags.jpg' });
      const media2 = await insertTestMedia({ filename: 'few_tags.jpg' });
      const media3 = await insertTestMedia({ filename: 'no_tags.jpg' });

      await db.insert(schema.mediaTags).values([
        { mediaId: media1.id, tagId: tag1.id },
        { mediaId: media1.id, tagId: tag2.id },
        { mediaId: media1.id, tagId: tag3.id },
        { mediaId: media2.id, tagId: tag1.id }
      ]);

      const filter = {
        tagCount: {
          value: 2,
          modifier: CriterionModifier.GREATER_THAN
        }
      };

      const mediaIds = [media1.id, media2.id, media3.id];
      const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
      
      expect(filteredIds).toHaveLength(1);
      expect(filteredIds).toContain(media1.id);
    });
  });

  describe('logical operators', () => {
    test('should handle AND conditions', async () => {
      await insertTestMedia({ fileType: 'image', favorite: true, rating: 5 });
      await insertTestMedia({ fileType: 'image', favorite: false, rating: 5 });
      await insertTestMedia({ fileType: 'video', favorite: true, rating: 5 });

      const filter = {
        AND: [
          { fileType: { value: 'image', modifier: CriterionModifier.EQUALS } },
          { favorite: true },
          { rating: { value: 5, modifier: CriterionModifier.EQUALS } }
        ]
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      if (conditions.length > 0) {
        query.where(conditions[0]);
      }
      
      const results = await query;
      expect(results).toHaveLength(1);
    });

    test('should handle OR conditions', async () => {
      await insertTestMedia({ filename: 'vacation.jpg' });
      await insertTestMedia({ filename: 'birthday.jpg' });
      await insertTestMedia({ filename: 'work.jpg' });

      const filter = {
        OR: [
          { filename: { value: 'vacation', modifier: CriterionModifier.INCLUDES } },
          { filename: { value: 'birthday', modifier: CriterionModifier.INCLUDES } }
        ]
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      if (conditions.length > 0) {
        query.where(conditions[0]);
      }
      
      const results = await query;
      expect(results).toHaveLength(2);
    });

    test('should handle NOT conditions', async () => {
      await insertTestMedia({ fileType: 'image' });
      await insertTestMedia({ fileType: 'video' });
      await insertTestMedia({ fileType: 'image' });

      const filter = {
        NOT: {
          fileType: { value: 'video', modifier: CriterionModifier.EQUALS }
        }
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      if (conditions.length > 0) {
        query.where(conditions[0]);
      }
      
      const results = await query;
      expect(results).toHaveLength(2);
    });

    test('should handle complex nested conditions', async () => {
      await insertTestMedia({ fileType: 'image', favorite: true, rating: 5 });
      await insertTestMedia({ fileType: 'video', favorite: true, rating: 3 });
      await insertTestMedia({ fileType: 'image', favorite: false, rating: 4 });
      await insertTestMedia({ fileType: 'video', favorite: false, rating: 5 });

      const filter = {
        AND: [
          {
            OR: [
              { fileType: { value: 'image', modifier: CriterionModifier.EQUALS } },
              { rating: { value: 5, modifier: CriterionModifier.EQUALS } }
            ]
          },
          { favorite: true }
        ]
      };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      if (conditions.length > 0) {
        query.where(conditions[0]);
      }
      
      const results = await query;
      expect(results).toHaveLength(1); // Only the first item matches
    });
  });

  describe('duplicate detection filters', () => {
    test('should filter items with duplicates', async () => {
      // Create items with duplicate phashes
      await insertTestMedia({ phash: 'hash1' });
      await insertTestMedia({ phash: 'hash1' });
      await insertTestMedia({ phash: 'hash2' });
      await insertTestMedia({ phash: null });

      const filter = { hasDuplicates: true };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      if (conditions.length > 0) {
        query.where(conditions[0]);
      }
      
      const results = await query;
      expect(results).toHaveLength(2); // Both items with hash1
    });

    test('should filter items without duplicates', async () => {
      await insertTestMedia({ phash: 'unique1' });
      await insertTestMedia({ phash: 'unique2' });
      await insertTestMedia({ phash: 'duplicate' });
      await insertTestMedia({ phash: 'duplicate' });

      const filter = { hasDuplicates: false };

      const conditions = await filterService.buildMediaFilter(filter);
      const query = db.select({ id: schema.mediaItems.id })
        .from(schema.mediaItems);
      
      if (conditions.length > 0) {
        query.where(conditions[0]);
      }
      
      const results = await query;
      expect(results).toHaveLength(2); // unique1 and unique2
    });
  });

  describe('custom fields filters', () => {
    test('should filter by custom field value', async () => {
      const media1 = await insertTestMedia({ filename: 'custom1.jpg' });
      const media2 = await insertTestMedia({ filename: 'custom2.jpg' });
      
      await db.insert(schema.customFields).values([
        {
          entityType: 'media',
          entityId: media1.id,
          fieldName: 'location',
          fieldValue: 'Paris',
          fieldType: 'string'
        }
      ]);

      const filter = {
        customFields: [{
          fieldName: 'location',
          fieldValue: {
            value: 'Paris',
            modifier: CriterionModifier.EQUALS
          }
        }]
      };

      const mediaIds = [media1.id, media2.id];
      const filteredIds = await filterService.applyComplexMediaFilters(mediaIds, filter);
      
      expect(filteredIds).toHaveLength(1);
      expect(filteredIds).toContain(media1.id);
    });
  });
});