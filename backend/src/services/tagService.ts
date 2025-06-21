import { eq, inArray, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';

export class TagService {
  async createTag(input: {
    name: string;
    description?: string;
    aliases?: string[];
    parentId?: number;
    favorite?: boolean;
    ignoreAutoTag?: boolean;
  }): Promise<schema.Tag> {
    const { aliases, ...tagData } = input;
    
    const [tag] = await db.insert(schema.tags)
      .values({
        ...tagData,
        aliases: aliases ? JSON.stringify(aliases) : null,
      })
      .returning();
    
    return this.formatTag(tag);
  }

  async updateTag(input: {
    id: number;
    name?: string;
    description?: string;
    aliases?: string[];
    parentId?: number;
    favorite?: boolean;
    ignoreAutoTag?: boolean;
  }): Promise<schema.Tag | null> {
    const { id, aliases, ...updates } = input;
    
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    
    if (aliases !== undefined) {
      updateData.aliases = aliases ? JSON.stringify(aliases) : null;
    }
    
    const [updated] = await db.update(schema.tags)
      .set(updateData)
      .where(eq(schema.tags.id, id))
      .returning();
    
    return updated ? this.formatTag(updated) : null;
  }

  async deleteTag(id: number): Promise<boolean> {
    // First, update any child tags to have no parent
    await db.update(schema.tags)
      .set({ parentId: null })
      .where(eq(schema.tags.parentId, id));
    
    const deleted = await db.delete(schema.tags)
      .where(eq(schema.tags.id, id))
      .returning();
    
    return deleted.length > 0;
  }

  async getTag(id: number): Promise<schema.Tag | null> {
    const [tag] = await db.select()
      .from(schema.tags)
      .where(eq(schema.tags.id, id));
    
    return tag ? this.formatTag(tag) : null;
  }

  async getTagByName(name: string): Promise<schema.Tag | null> {
    const [tag] = await db.select()
      .from(schema.tags)
      .where(eq(schema.tags.name, name));
    
    return tag ? this.formatTag(tag) : null;
  }

  async getAllTags(): Promise<schema.Tag[]> {
    const tags = await db.select()
      .from(schema.tags)
      .orderBy(schema.tags.name);
    
    return tags.map(tag => this.formatTag(tag));
  }

  async getTagChildren(parentId: number): Promise<schema.Tag[]> {
    const children = await db.select()
      .from(schema.tags)
      .where(eq(schema.tags.parentId, parentId))
      .orderBy(schema.tags.name);
    
    return children.map(tag => this.formatTag(tag));
  }

  async getTagParent(tagId: number): Promise<schema.Tag | null> {
    const [tag] = await db.select()
      .from(schema.tags)
      .where(eq(schema.tags.id, tagId));
    
    if (!tag || !tag.parentId) return null;
    
    return this.getTag(tag.parentId);
  }

  async getTagMediaCount(tagId: number): Promise<number> {
    const [result] = await db.select({
      count: sql<number>`COUNT(DISTINCT ${schema.mediaTags.mediaId})`,
    })
      .from(schema.mediaTags)
      .where(eq(schema.mediaTags.tagId, tagId));
    
    return result?.count || 0;
  }

  async getTagChildCount(tagId: number): Promise<number> {
    const [result] = await db.select({
      count: sql<number>`COUNT(*)`,
    })
      .from(schema.tags)
      .where(eq(schema.tags.parentId, tagId));
    
    return result?.count || 0;
  }

  async mergeTags(sourceIds: number[], targetId: number): Promise<schema.Tag | null> {
    // Get target tag
    const targetTag = await this.getTag(targetId);
    if (!targetTag) return null;
    
    // Get all source tags
    const sourceTags = await db.select()
      .from(schema.tags)
      .where(inArray(schema.tags.id, sourceIds));
    
    // Collect all aliases
    const allAliases: string[] = [];
    for (const tag of sourceTags) {
      allAliases.push(tag.name);
      if (tag.aliases) {
        try {
          const aliases = JSON.parse(tag.aliases);
          if (Array.isArray(aliases)) {
            allAliases.push(...aliases);
          }
        } catch {}
      }
    }
    
    // Add existing target aliases
    if (targetTag.aliases) {
      try {
        const existingAliases = JSON.parse(targetTag.aliases);
        if (Array.isArray(existingAliases)) {
          allAliases.push(...existingAliases);
        }
      } catch {}
    }
    
    // Remove duplicates
    const uniqueAliases = [...new Set(allAliases)];
    
    // Update all media tags to point to target
    await db.update(schema.mediaTags)
      .set({ tagId: targetId })
      .where(inArray(schema.mediaTags.tagId, sourceIds));
    
    // Remove duplicate media-tag relationships
    await db.run(sql`
      DELETE FROM ${schema.mediaTags}
      WHERE rowid NOT IN (
        SELECT MIN(rowid)
        FROM ${schema.mediaTags}
        GROUP BY media_id, tag_id
      )
    `);
    
    // Update child tags to point to target
    await db.update(schema.tags)
      .set({ parentId: targetId })
      .where(inArray(schema.tags.parentId, sourceIds));
    
    // Delete source tags
    await db.delete(schema.tags)
      .where(inArray(schema.tags.id, sourceIds));
    
    // Update target tag with new aliases
    return this.updateTag({
      id: targetId,
      aliases: uniqueAliases,
    });
  }

  async addTagsToMedia(mediaIds: number[], tagIds: number[]): Promise<void> {
    const values = [];
    for (const mediaId of mediaIds) {
      for (const tagId of tagIds) {
        values.push({ mediaId, tagId });
      }
    }
    
    if (values.length > 0) {
      // Insert ignore duplicates
      await db.insert(schema.mediaTags)
        .values(values)
        .onConflictDoNothing();
    }
  }

  async removeTagsFromMedia(mediaIds: number[], tagIds: number[]): Promise<void> {
    await db.delete(schema.mediaTags)
      .where(and(
        inArray(schema.mediaTags.mediaId, mediaIds),
        inArray(schema.mediaTags.tagId, tagIds)
      ));
  }

  async getMediaTags(mediaId: number): Promise<schema.Tag[]> {
    const tags = await db.select({
      tag: schema.tags,
    })
      .from(schema.mediaTags)
      .innerJoin(schema.tags, eq(schema.mediaTags.tagId, schema.tags.id))
      .where(eq(schema.mediaTags.mediaId, mediaId))
      .orderBy(schema.tags.name);
    
    return tags.map(({ tag }) => this.formatTag(tag));
  }

  async getRootTags(): Promise<schema.Tag[]> {
    const tags = await db.select()
      .from(schema.tags)
      .where(isNull(schema.tags.parentId))
      .orderBy(schema.tags.name);
    
    return tags.map(tag => this.formatTag(tag));
  }

  async getTagHierarchy(tagId: number): Promise<schema.Tag[]> {
    const hierarchy: schema.Tag[] = [];
    let currentId: number | null = tagId;
    
    while (currentId !== null) {
      const tag = await this.getTag(currentId);
      if (!tag) break;
      
      hierarchy.unshift(tag);
      currentId = tag.parentId;
    }
    
    return hierarchy;
  }

  async getAllTagsWithCounts(): Promise<Array<schema.Tag & { mediaCount: number; childCount: number }>> {
    const tags = await db.select({
      tag: schema.tags,
      mediaCount: sql<number>`(
        SELECT COUNT(DISTINCT media_id) 
        FROM ${schema.mediaTags} 
        WHERE tag_id = ${schema.tags.id}
      )`,
      childCount: sql<number>`(
        SELECT COUNT(*) 
        FROM ${schema.tags} AS children 
        WHERE children.parent_id = ${schema.tags.id}
      )`,
    })
      .from(schema.tags)
      .orderBy(schema.tags.name);
    
    return tags.map(({ tag, mediaCount, childCount }) => ({
      ...this.formatTag(tag),
      mediaCount,
      childCount,
    }));
  }

  async findOrCreateTag(name: string): Promise<schema.Tag> {
    // Check if tag exists
    const existing = await this.getTagByName(name);
    if (existing) return existing;
    
    // Create new tag
    return this.createTag({ name });
  }

  async autoTagMedia(mediaId: number, tagNames: string[]): Promise<void> {
    const tagIds: number[] = [];
    
    for (const name of tagNames) {
      const tag = await this.findOrCreateTag(name);
      if (!tag.ignoreAutoTag) {
        tagIds.push(tag.id);
      }
    }
    
    if (tagIds.length > 0) {
      await this.addTagsToMedia([mediaId], tagIds);
    }
  }

  private formatTag(tag: any): schema.Tag {
    const formatted: any = { ...tag };
    
    // Parse aliases
    if (tag.aliases) {
      try {
        formatted.aliases = JSON.parse(tag.aliases);
      } catch {
        formatted.aliases = [];
      }
    } else {
      formatted.aliases = [];
    }
    
    // Convert boolean fields
    formatted.favorite = Boolean(tag.favorite);
    formatted.ignoreAutoTag = Boolean(tag.ignoreAutoTag);
    
    return formatted as schema.Tag;
  }
}

export const tagService = new TagService();