import './test-env'; // Must be first import
import { describe, test, expect, beforeEach } from 'bun:test';
import { CollectionService } from '../src/services/collectionService';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { cleanDatabase, insertTestMedia, insertTestCollection } from './setup';

describe('CollectionService', () => {
  let collectionService: CollectionService;

  beforeEach(async () => {
    await cleanDatabase();
    collectionService = new CollectionService();
  });

  describe('collection management', () => {
    test('should create collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'Summer 2024',
        description: 'Best moments from summer vacation',
        coverImage: 'cover.jpg'
      });
      
      expect(collection.id).toBeTruthy();
      expect(collection.title).toBe('Summer 2024');
      expect(collection.description).toBe('Best moments from summer vacation');
      expect(collection.coverImage).toBe('cover.jpg');
    });

    test('should update collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'Original Title'
      });
      
      const updated = await collectionService.updateCollection(collection.id, {
        title: 'Updated Title',
        description: 'Now with description'
      });
      
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.description).toBe('Now with description');
    });

    test('should delete collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'To Delete'
      });
      
      const deleted = await collectionService.deleteCollection(collection.id);
      expect(deleted).toBe(true);
      
      const found = await collectionService.getCollection(collection.id);
      expect(found).toBeNull();
    });

    test('should delete collection with media', async () => {
      const collection = await collectionService.createCollection({
        title: 'With Media'
      });
      const media = await insertTestMedia();
      
      await collectionService.addMediaToCollection(collection.id, [media.id]);
      
      const deleted = await collectionService.deleteCollection(collection.id);
      expect(deleted).toBe(true);
      
      // Check that collection_media entries are also deleted
      const collectionMedia = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.collectionId, collection.id));
      
      expect(collectionMedia).toHaveLength(0);
    });
  });

  describe('media management', () => {
    test('should add media to collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'Test Collection'
      });
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      
      const added = await collectionService.addMediaToCollection(
        collection.id,
        [media1.id, media2.id]
      );
      
      expect(added).toBe(2);
      
      const collectionMedia = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.collectionId, collection.id));
      
      expect(collectionMedia).toHaveLength(2);
      expect(collectionMedia[0].orderIndex).toBe(0);
      expect(collectionMedia[1].orderIndex).toBe(1);
    });

    test('should remove media from collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'Test Collection'
      });
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      
      await collectionService.addMediaToCollection(
        collection.id,
        [media1.id, media2.id]
      );
      
      const removed = await collectionService.removeMediaFromCollection(
        collection.id,
        [media1.id]
      );
      
      expect(removed).toBe(1);
      
      const remaining = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.collectionId, collection.id));
      
      expect(remaining).toHaveLength(1);
      expect(remaining[0].mediaId).toBe(media2.id);
    });

    test('should reorder media in collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'Test Collection'
      });
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      const media3 = await insertTestMedia();
      
      await collectionService.addMediaToCollection(
        collection.id,
        [media1.id, media2.id, media3.id]
      );
      
      // Reorder: move media3 to position 0
      const reordered = await collectionService.reorderMedia(
        collection.id,
        media3.id,
        0
      );
      
      expect(reordered).toBe(true);
      
      const collectionMedia = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.collectionId, collection.id))
        .orderBy(schema.collectionMedia.orderIndex);
      
      expect(collectionMedia[0].mediaId).toBe(media3.id);
      expect(collectionMedia[1].mediaId).toBe(media1.id);
      expect(collectionMedia[2].mediaId).toBe(media2.id);
    });

    test('should set collection cover', async () => {
      const collection = await collectionService.createCollection({
        title: 'Test Collection'
      });
      const media = await insertTestMedia({ filepath: '/path/to/image.jpg' });
      
      await collectionService.addMediaToCollection(collection.id, [media.id]);
      
      const updated = await collectionService.setCollectionCover(
        collection.id,
        media.id
      );
      
      expect(updated?.coverImage).toBe(media.filepath);
    });
  });

  describe('collection retrieval', () => {
    test('should get all collections', async () => {
      await collectionService.createCollection({ title: 'Collection 1' });
      await collectionService.createCollection({ title: 'Collection 2' });
      await collectionService.createCollection({ title: 'Collection 3' });
      
      const collections = await collectionService.getAllCollections();
      expect(collections).toHaveLength(3);
    });

    test('should get collections with media count', async () => {
      const collection = await collectionService.createCollection({
        title: 'With Media'
      });
      
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      await collectionService.addMediaToCollection(
        collection.id,
        [media1.id, media2.id]
      );
      
      const collections = await collectionService.getCollectionsWithCounts();
      const found = collections.find(c => c.id === collection.id);
      
      expect(found?.mediaCount).toBe(2);
    });

    test('should get collection with media', async () => {
      const collection = await collectionService.createCollection({
        title: 'Test Collection'
      });
      
      const media1 = await insertTestMedia({ filename: 'first.jpg' });
      const media2 = await insertTestMedia({ filename: 'second.jpg' });
      await collectionService.addMediaToCollection(
        collection.id,
        [media1.id, media2.id]
      );
      
      const withMedia = await collectionService.getCollectionWithMedia(
        collection.id
      );
      
      expect(withMedia?.media).toHaveLength(2);
      expect(withMedia?.media[0].filename).toBe('first.jpg');
      expect(withMedia?.media[1].filename).toBe('second.jpg');
    });

    test('should search collections', async () => {
      await collectionService.createCollection({ title: 'Vacation 2024' });
      await collectionService.createCollection({ title: 'Birthday Party' });
      await collectionService.createCollection({ title: 'Work Events' });
      
      const results = await collectionService.searchCollections('vac');
      
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Vacation 2024');
    });
  });

  describe('collection operations', () => {
    test('should duplicate collection', async () => {
      const original = await collectionService.createCollection({
        title: 'Original',
        description: 'Original description'
      });
      
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      await collectionService.addMediaToCollection(
        original.id,
        [media1.id, media2.id]
      );
      
      const duplicate = await collectionService.duplicateCollection(
        original.id,
        'Copy of Original'
      );
      
      expect(duplicate.title).toBe('Copy of Original');
      expect(duplicate.description).toBe('Original description');
      
      // Check that media was also duplicated
      const duplicateMedia = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.collectionId, duplicate.id));
      
      expect(duplicateMedia).toHaveLength(2);
    });

    test('should merge collections', async () => {
      const collection1 = await collectionService.createCollection({
        title: 'Collection 1'
      });
      const collection2 = await collectionService.createCollection({
        title: 'Collection 2'
      });
      
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      const media3 = await insertTestMedia();
      
      await collectionService.addMediaToCollection(collection1.id, [media1.id]);
      await collectionService.addMediaToCollection(collection2.id, [media2.id, media3.id]);
      
      const merged = await collectionService.mergeCollections(
        [collection1.id, collection2.id],
        'Merged Collection'
      );
      
      expect(merged.title).toBe('Merged Collection');
      
      // Check that all media is in the merged collection
      const mergedMedia = await db.select()
        .from(schema.collectionMedia)
        .where(eq(schema.collectionMedia.collectionId, merged.id));
      
      expect(mergedMedia).toHaveLength(3);
      
      // Original collections should be deleted
      const original1 = await collectionService.getCollection(collection1.id);
      const original2 = await collectionService.getCollection(collection2.id);
      expect(original1).toBeNull();
      expect(original2).toBeNull();
    });

    test('should export collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'Export Test',
        description: 'Collection for export'
      });
      
      const media1 = await insertTestMedia({ 
        filename: 'photo1.jpg',
        title: 'Photo 1' 
      });
      const media2 = await insertTestMedia({ 
        filename: 'photo2.jpg',
        title: 'Photo 2' 
      });
      
      await collectionService.addMediaToCollection(
        collection.id,
        [media1.id, media2.id]
      );
      
      const exported = await collectionService.exportCollection(collection.id);
      
      expect(exported.collection.title).toBe('Export Test');
      expect(exported.media).toHaveLength(2);
      expect(exported.media[0].filename).toBe('photo1.jpg');
      expect(exported.media[1].filename).toBe('photo2.jpg');
    });
  });

  describe('collection statistics', () => {
    test('should get collection stats', async () => {
      const collection = await collectionService.createCollection({
        title: 'Stats Test'
      });
      
      // Add media with different properties
      const image1 = await insertTestMedia({ 
        fileType: 'image',
        fileSize: 1024 * 1024,
        favorite: true
      });
      const image2 = await insertTestMedia({ 
        fileType: 'image',
        fileSize: 2 * 1024 * 1024
      });
      const video = await insertTestMedia({ 
        fileType: 'video',
        fileSize: 10 * 1024 * 1024,
        duration: 120
      });
      
      await collectionService.addMediaToCollection(
        collection.id,
        [image1.id, image2.id, video.id]
      );
      
      const stats = await collectionService.getCollectionStats(collection.id);
      
      expect(stats.totalMedia).toBe(3);
      expect(stats.totalImages).toBe(2);
      expect(stats.totalVideos).toBe(1);
      expect(stats.totalSize).toBe(13 * 1024 * 1024);
      expect(stats.totalDuration).toBe(120);
      expect(stats.favoriteCount).toBe(1);
    });
  });

  describe('media collection queries', () => {
    test('should get collections containing media', async () => {
      const media = await insertTestMedia();
      
      const collection1 = await collectionService.createCollection({
        title: 'Collection 1'
      });
      const collection2 = await collectionService.createCollection({
        title: 'Collection 2'
      });
      
      await collectionService.addMediaToCollection(collection1.id, [media.id]);
      await collectionService.addMediaToCollection(collection2.id, [media.id]);
      
      const collections = await collectionService.getMediaCollections(media.id);
      
      expect(collections).toHaveLength(2);
      expect(collections.map(c => c.title)).toContain('Collection 1');
      expect(collections.map(c => c.title)).toContain('Collection 2');
    });

    test('should check if media is in collection', async () => {
      const collection = await collectionService.createCollection({
        title: 'Test Collection'
      });
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      
      await collectionService.addMediaToCollection(collection.id, [media1.id]);
      
      const isInCollection1 = await collectionService.isMediaInCollection(
        media1.id,
        collection.id
      );
      const isInCollection2 = await collectionService.isMediaInCollection(
        media2.id,
        collection.id
      );
      
      expect(isInCollection1).toBe(true);
      expect(isInCollection2).toBe(false);
    });
  });
});