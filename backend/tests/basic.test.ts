import './test-env'; // Must be first import
import { describe, test, expect, beforeEach } from 'bun:test';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { cleanDatabase, insertTestMedia, insertTestTag, insertTestCollection } from './setup';

describe('Basic Database Operations', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  test('should insert and retrieve media item', async () => {
    const media = await insertTestMedia({
      filename: 'test-photo.jpg',
      fileType: 'image',
      fileSize: 1024000,
      width: 1920,
      height: 1080
    });
    
    expect(media.id).toBeDefined();
    expect(media.filename).toBe('test-photo.jpg');
    expect(media.fileType).toBe('image');
    expect(media.fileSize).toBe(1024000);
    expect(media.width).toBe(1920);
    expect(media.height).toBe(1080);
    
    // Verify we can retrieve it
    const [retrieved] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, media.id));
    
    expect(retrieved).toBeDefined();
    expect(retrieved.filename).toBe('test-photo.jpg');
  });

  test('should insert and retrieve tag', async () => {
    const tag = await insertTestTag({
      name: 'vacation',
      description: 'Vacation photos',
      color: '#00ff00'
    });
    
    expect(tag.id).toBeDefined();
    expect(tag.name).toBe('vacation');
    expect(tag.description).toBe('Vacation photos');
    expect(tag.color).toBe('#00ff00');
  });

  test('should insert and retrieve collection', async () => {
    const collection = await insertTestCollection({
      title: 'Summer 2024',
      description: 'Best summer moments'
    });
    
    expect(collection.id).toBeDefined();
    expect(collection.title).toBe('Summer 2024');
    expect(collection.description).toBe('Best summer moments');
  });

  test('should create media-tag relationship', async () => {
    const media = await insertTestMedia();
    const tag = await insertTestTag({ name: 'test-tag' });
    
    await db.insert(schema.mediaTags).values({
      mediaId: media.id,
      tagId: tag.id
    });
    
    const [relation] = await db.select()
      .from(schema.mediaTags)
      .where(eq(schema.mediaTags.mediaId, media.id));
    
    expect(relation).toBeDefined();
    expect(relation.tagId).toBe(tag.id);
  });

  test('should create collection-media relationship', async () => {
    const media = await insertTestMedia();
    const collection = await insertTestCollection();
    
    await db.insert(schema.collectionMedia).values({
      collectionId: collection.id,
      mediaId: media.id,
      orderIndex: 0
    });
    
    const [relation] = await db.select()
      .from(schema.collectionMedia)
      .where(eq(schema.collectionMedia.mediaId, media.id));
    
    expect(relation).toBeDefined();
    expect(relation.collectionId).toBe(collection.id);
    expect(relation.orderIndex).toBe(0);
  });
});