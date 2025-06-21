import './test-env'; // Must be first import
import { describe, test, expect, beforeEach } from 'bun:test';
import { TagService } from '../src/services/tagService';
import { db, schema } from '../src/db';
import { eq } from 'drizzle-orm';
import { cleanDatabase, insertTestMedia, insertTestTag } from './setup';

describe('TagService', () => {
  let tagService: TagService;

  beforeEach(async () => {
    await cleanDatabase();
    tagService = new TagService();
  });

  describe('tag management', () => {
    test('should create tag', async () => {
      const tag = await tagService.createTag({
        name: 'vacation',
        description: 'Vacation photos',
        color: '#ff0000'
      });
      
      expect(tag.id).toBeTruthy();
      expect(tag.name).toBe('vacation');
      expect(tag.description).toBe('Vacation photos');
      expect(tag.color).toBe('#ff0000');
      expect(tag.slug).toBe('vacation');
    });

    test('should create tag with parent', async () => {
      const parent = await tagService.createTag({ name: 'events' });
      const child = await tagService.createTag({
        name: 'birthday',
        parentId: parent.id
      });
      
      expect(child.parentId).toBe(parent.id);
      expect(child.path).toBe(`${parent.path}/${child.id}`);
    });

    test('should prevent duplicate tag names', async () => {
      await tagService.createTag({ name: 'duplicate' });
      
      await expect(
        tagService.createTag({ name: 'duplicate' })
      ).rejects.toThrow();
    });

    test('should update tag', async () => {
      const tag = await tagService.createTag({ name: 'original' });
      
      const updated = await tagService.updateTag(tag.id, {
        name: 'updated',
        description: 'Updated description',
        color: '#00ff00'
      });
      
      expect(updated?.name).toBe('updated');
      expect(updated?.description).toBe('Updated description');
      expect(updated?.color).toBe('#00ff00');
      expect(updated?.slug).toBe('updated');
    });

    test('should delete tag', async () => {
      const tag = await tagService.createTag({ name: 'to-delete' });
      
      const deleted = await tagService.deleteTag(tag.id);
      expect(deleted).toBe(true);
      
      const found = await tagService.getTag(tag.id);
      expect(found).toBeUndefined();
    });

    test('should delete tag with children', async () => {
      const parent = await tagService.createTag({ name: 'parent' });
      const child1 = await tagService.createTag({ 
        name: 'child1',
        parentId: parent.id 
      });
      const child2 = await tagService.createTag({ 
        name: 'child2',
        parentId: parent.id 
      });
      
      const deleted = await tagService.deleteTag(parent.id);
      expect(deleted).toBe(true);
      
      // Children should also be deleted
      const foundChild1 = await tagService.getTag(child1.id);
      const foundChild2 = await tagService.getTag(child2.id);
      expect(foundChild1).toBeUndefined();
      expect(foundChild2).toBeUndefined();
    });
  });

  describe('tag retrieval', () => {
    test('should get all tags', async () => {
      await tagService.createTag({ name: 'tag1' });
      await tagService.createTag({ name: 'tag2' });
      await tagService.createTag({ name: 'tag3' });
      
      const tags = await tagService.getAllTags();
      expect(tags).toHaveLength(3);
    });

    test('should get tags as tree', async () => {
      const parent1 = await tagService.createTag({ name: 'parent1' });
      const parent2 = await tagService.createTag({ name: 'parent2' });
      const child1 = await tagService.createTag({ 
        name: 'child1',
        parentId: parent1.id 
      });
      const child2 = await tagService.createTag({ 
        name: 'child2',
        parentId: parent1.id 
      });
      
      const tree = await tagService.getTagTree();
      
      expect(tree).toHaveLength(2); // Two root tags
      const p1 = tree.find(t => t.id === parent1.id);
      expect(p1?.children).toHaveLength(2);
      expect(p1?.children?.map(c => c.id)).toContain(child1.id);
      expect(p1?.children?.map(c => c.id)).toContain(child2.id);
    });

    test('should search tags', async () => {
      await tagService.createTag({ name: 'vacation' });
      await tagService.createTag({ name: 'birthday' });
      await tagService.createTag({ name: 'work' });
      
      const results = await tagService.searchTags('vac');
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('vacation');
    });

    test('should get tag with media count', async () => {
      const tag = await tagService.createTag({ name: 'popular' });
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      
      await db.insert(schema.mediaTags).values([
        { mediaId: media1.id, tagId: tag.id },
        { mediaId: media2.id, tagId: tag.id }
      ]);
      
      const withCount = await tagService.getTagWithCount(tag.id);
      expect(withCount?.mediaCount).toBe(2);
    });
  });

  describe('tag operations', () => {
    test('should merge tags', async () => {
      const sourceTag = await tagService.createTag({ name: 'source' });
      const targetTag = await tagService.createTag({ name: 'target' });
      
      // Add media to source tag
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      await db.insert(schema.mediaTags).values([
        { mediaId: media1.id, tagId: sourceTag.id },
        { mediaId: media2.id, tagId: sourceTag.id }
      ]);
      
      const merged = await tagService.mergeTags(sourceTag.id, targetTag.id);
      expect(merged).toBe(true);
      
      // Source tag should be deleted
      const foundSource = await tagService.getTag(sourceTag.id);
      expect(foundSource).toBeUndefined();
      
      // Media should be moved to target tag
      const targetMedia = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.tagId, targetTag.id));
      expect(targetMedia).toHaveLength(2);
    });

    test('should rename tag and update slug', async () => {
      const tag = await tagService.createTag({ name: 'old-name' });
      
      const renamed = await tagService.renameTag(tag.id, 'new-name');
      
      expect(renamed?.name).toBe('new-name');
      expect(renamed?.slug).toBe('new-name');
    });

    test('should move tag to new parent', async () => {
      const parent1 = await tagService.createTag({ name: 'parent1' });
      const parent2 = await tagService.createTag({ name: 'parent2' });
      const child = await tagService.createTag({ 
        name: 'child',
        parentId: parent1.id 
      });
      
      const moved = await tagService.moveTag(child.id, parent2.id);
      
      expect(moved?.parentId).toBe(parent2.id);
      expect(moved?.path).toContain(parent2.id.toString());
    });

    test('should set tag color', async () => {
      const tag = await tagService.createTag({ name: 'colorful' });
      
      const colored = await tagService.setTagColor(tag.id, '#ff00ff');
      
      expect(colored?.color).toBe('#ff00ff');
    });
  });

  describe('media tagging', () => {
    test('should tag media', async () => {
      const tag = await tagService.createTag({ name: 'test-tag' });
      const media = await insertTestMedia();
      
      const tagged = await tagService.tagMedia(media.id, tag.id);
      expect(tagged).toBe(true);
      
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.mediaId, media.id));
      
      expect(mediaTags).toHaveLength(1);
      expect(mediaTags[0].tagId).toBe(tag.id);
    });

    test('should untag media', async () => {
      const tag = await tagService.createTag({ name: 'remove-me' });
      const media = await insertTestMedia();
      
      await tagService.tagMedia(media.id, tag.id);
      const untagged = await tagService.untagMedia(media.id, tag.id);
      
      expect(untagged).toBe(true);
      
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.mediaId, media.id));
      
      expect(mediaTags).toHaveLength(0);
    });

    test('should get media tags', async () => {
      const tag1 = await tagService.createTag({ name: 'tag1' });
      const tag2 = await tagService.createTag({ name: 'tag2' });
      const media = await insertTestMedia();
      
      await tagService.tagMedia(media.id, tag1.id);
      await tagService.tagMedia(media.id, tag2.id);
      
      const tags = await tagService.getMediaTags(media.id);
      
      expect(tags).toHaveLength(2);
      expect(tags.map(t => t.name)).toContain('tag1');
      expect(tags.map(t => t.name)).toContain('tag2');
    });

    test('should bulk tag media', async () => {
      const tag = await tagService.createTag({ name: 'bulk-tag' });
      const media1 = await insertTestMedia();
      const media2 = await insertTestMedia();
      const media3 = await insertTestMedia();
      
      const tagged = await tagService.bulkTagMedia(
        [media1.id, media2.id, media3.id],
        tag.id
      );
      
      expect(tagged).toBe(3);
      
      const mediaTags = await db.select()
        .from(schema.mediaTags)
        .where(eq(schema.mediaTags.tagId, tag.id));
      
      expect(mediaTags).toHaveLength(3);
    });
  });

  describe('tag statistics', () => {
    test('should get tag usage stats', async () => {
      const popularTag = await tagService.createTag({ name: 'popular' });
      const unusedTag = await tagService.createTag({ name: 'unused' });
      
      // Add media to popular tag
      for (let i = 0; i < 5; i++) {
        const media = await insertTestMedia();
        await tagService.tagMedia(media.id, popularTag.id);
      }
      
      const stats = await tagService.getTagStats();
      
      expect(stats.totalTags).toBe(2);
      expect(stats.usedTags).toBe(1);
      expect(stats.unusedTags).toBe(1);
      expect(stats.mostUsed[0].name).toBe('popular');
      expect(stats.mostUsed[0].count).toBe(5);
    });

    test('should get tag hierarchy stats', async () => {
      const root = await tagService.createTag({ name: 'root' });
      const child1 = await tagService.createTag({ 
        name: 'child1',
        parentId: root.id 
      });
      const grandchild = await tagService.createTag({ 
        name: 'grandchild',
        parentId: child1.id 
      });
      
      const stats = await tagService.getTagHierarchyStats();
      
      expect(stats.totalTags).toBe(3);
      expect(stats.rootTags).toBe(1);
      expect(stats.maxDepth).toBe(3);
    });
  });

  describe('tag aliases', () => {
    test('should add tag alias', async () => {
      const tag = await tagService.createTag({ name: 'primary' });
      
      const added = await tagService.addTagAlias(tag.id, 'synonym');
      expect(added).toBe(true);
      
      // Should be able to find tag by alias
      const found = await tagService.findTagByAlias('synonym');
      expect(found?.id).toBe(tag.id);
    });

    test('should remove tag alias', async () => {
      const tag = await tagService.createTag({ name: 'primary' });
      await tagService.addTagAlias(tag.id, 'toremove');
      
      const removed = await tagService.removeTagAlias(tag.id, 'toremove');
      expect(removed).toBe(true);
      
      const found = await tagService.findTagByAlias('toremove');
      expect(found).toBeUndefined();
    });

    test('should get tag aliases', async () => {
      const tag = await tagService.createTag({ name: 'primary' });
      await tagService.addTagAlias(tag.id, 'alias1');
      await tagService.addTagAlias(tag.id, 'alias2');
      
      const aliases = await tagService.getTagAliases(tag.id);
      expect(aliases).toHaveLength(2);
      expect(aliases).toContain('alias1');
      expect(aliases).toContain('alias2');
    });
  });
});