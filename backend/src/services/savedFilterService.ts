import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import * as schema from '../db/schema';

export class SavedFilterService {
  async createSavedFilter(input: {
    name: string;
    mode: string;
    filter: string;
    uiOptions?: string;
    favorite?: boolean;
  }): Promise<schema.SavedFilter> {
    const [savedFilter] = await db.insert(schema.savedFilters)
      .values(input)
      .returning();
    
    return this.formatSavedFilter(savedFilter);
  }

  async updateSavedFilter(input: {
    id: number;
    name?: string;
    filter?: string;
    uiOptions?: string;
    favorite?: boolean;
  }): Promise<schema.SavedFilter | null> {
    const { id, ...updates } = input;
    
    const updateData: any = {
      ...updates,
      updatedAt: new Date(),
    };
    
    const [updated] = await db.update(schema.savedFilters)
      .set(updateData)
      .where(eq(schema.savedFilters.id, id))
      .returning();
    
    return updated ? this.formatSavedFilter(updated) : null;
  }

  async deleteSavedFilter(id: number): Promise<boolean> {
    const deleted = await db.delete(schema.savedFilters)
      .where(eq(schema.savedFilters.id, id))
      .returning();
    
    return deleted.length > 0;
  }

  async getSavedFilter(id: number): Promise<schema.SavedFilter | null> {
    const [filter] = await db.select()
      .from(schema.savedFilters)
      .where(eq(schema.savedFilters.id, id));
    
    return filter ? this.formatSavedFilter(filter) : null;
  }

  async getSavedFiltersByMode(mode?: string): Promise<schema.SavedFilter[]> {
    let query = db.select()
      .from(schema.savedFilters)
      .orderBy(desc(schema.savedFilters.favorite), schema.savedFilters.name);
    
    if (mode) {
      query = query.where(eq(schema.savedFilters.mode, mode));
    }
    
    const filters = await query;
    return filters.map(filter => this.formatSavedFilter(filter));
  }

  async getFavoriteSavedFilters(): Promise<schema.SavedFilter[]> {
    const filters = await db.select()
      .from(schema.savedFilters)
      .where(eq(schema.savedFilters.favorite, true))
      .orderBy(schema.savedFilters.name);
    
    return filters.map(filter => this.formatSavedFilter(filter));
  }

  async toggleFavorite(id: number): Promise<schema.SavedFilter | null> {
    const [filter] = await db.select()
      .from(schema.savedFilters)
      .where(eq(schema.savedFilters.id, id));
    
    if (!filter) return null;
    
    const [updated] = await db.update(schema.savedFilters)
      .set({ 
        favorite: !filter.favorite,
        updatedAt: new Date(),
      })
      .where(eq(schema.savedFilters.id, id))
      .returning();
    
    return updated ? this.formatSavedFilter(updated) : null;
  }

  async duplicateSavedFilter(id: number, newName?: string): Promise<schema.SavedFilter | null> {
    const original = await this.getSavedFilter(id);
    if (!original) return null;
    
    return this.createSavedFilter({
      name: newName || `${original.name} (Copy)`,
      mode: original.mode,
      filter: original.filter,
      uiOptions: original.uiOptions,
      favorite: false,
    });
  }

  async importSavedFilters(filters: Array<{
    name: string;
    mode: string;
    filter: string;
    uiOptions?: string;
    favorite?: boolean;
  }>): Promise<schema.SavedFilter[]> {
    const created: schema.SavedFilter[] = [];
    
    for (const filter of filters) {
      // Check if filter with same name exists
      const existing = await db.select()
        .from(schema.savedFilters)
        .where(eq(schema.savedFilters.name, filter.name));
      
      if (existing.length === 0) {
        const savedFilter = await this.createSavedFilter(filter);
        created.push(savedFilter);
      }
    }
    
    return created;
  }

  async exportSavedFilters(mode?: string): Promise<Array<{
    name: string;
    mode: string;
    filter: string;
    uiOptions?: string;
    favorite?: boolean;
  }>> {
    const filters = await this.getSavedFiltersByMode(mode);
    
    return filters.map(filter => ({
      name: filter.name,
      mode: filter.mode,
      filter: filter.filter,
      uiOptions: filter.uiOptions,
      favorite: filter.favorite,
    }));
  }

  async getDefaultFilters(): Promise<Array<{
    name: string;
    mode: string;
    filter: string;
    description: string;
  }>> {
    return [
      {
        name: 'Recent Media',
        mode: 'MEDIA',
        filter: JSON.stringify({
          sort: { field: 'createdAt', direction: 'DESC' },
          perPage: 50,
        }),
        description: 'Recently added media files',
      },
      {
        name: 'Favorites',
        mode: 'MEDIA',
        filter: JSON.stringify({
          filter: { favorite: true },
          sort: { field: 'createdAt', direction: 'DESC' },
        }),
        description: 'All favorite media',
      },
      {
        name: 'Videos Only',
        mode: 'MEDIA',
        filter: JSON.stringify({
          filter: { fileType: { value: 'video', modifier: 'EQUALS' } },
          sort: { field: 'createdAt', direction: 'DESC' },
        }),
        description: 'Only video files',
      },
      {
        name: 'Images Only',
        mode: 'MEDIA',
        filter: JSON.stringify({
          filter: { fileType: { value: 'image', modifier: 'EQUALS' } },
          sort: { field: 'createdAt', direction: 'DESC' },
        }),
        description: 'Only image files',
      },
      {
        name: 'High Resolution',
        mode: 'MEDIA',
        filter: JSON.stringify({
          filter: { resolution: { value: 'FOUR_K', modifier: 'GREATER_THAN' } },
          sort: { field: 'fileSize', direction: 'DESC' },
        }),
        description: '4K and higher resolution media',
      },
      {
        name: 'Unorganized',
        mode: 'MEDIA',
        filter: JSON.stringify({
          filter: { organized: false },
          sort: { field: 'createdAt', direction: 'ASC' },
        }),
        description: 'Media that needs organization',
      },
      {
        name: 'No Tags',
        mode: 'MEDIA',
        filter: JSON.stringify({
          filter: { tagCount: { value: 0, modifier: 'EQUALS' } },
          sort: { field: 'createdAt', direction: 'ASC' },
        }),
        description: 'Media without any tags',
      },
      {
        name: 'Duplicates',
        mode: 'MEDIA',
        filter: JSON.stringify({
          filter: { hasDuplicates: true },
          sort: { field: 'phash', direction: 'ASC' },
        }),
        description: 'Potential duplicate media files',
      },
      {
        name: 'Recent Collections',
        mode: 'COLLECTIONS',
        filter: JSON.stringify({
          sort: { field: 'date', direction: 'DESC' },
          perPage: 20,
        }),
        description: 'Recently created collections',
      },
      {
        name: 'Favorite Collections',
        mode: 'COLLECTIONS',
        filter: JSON.stringify({
          filter: { favorite: true },
          sort: { field: 'title', direction: 'ASC' },
        }),
        description: 'Favorite collections',
      },
      {
        name: 'Popular Tags',
        mode: 'TAGS',
        filter: JSON.stringify({
          sort: { field: 'mediaCount', direction: 'DESC' },
          perPage: 50,
        }),
        description: 'Most used tags',
      },
      {
        name: 'Unused Tags',
        mode: 'TAGS',
        filter: JSON.stringify({
          filter: { mediaCount: { value: 0, modifier: 'EQUALS' } },
          sort: { field: 'name', direction: 'ASC' },
        }),
        description: 'Tags with no media',
      },
    ];
  }

  async initializeDefaultFilters(): Promise<void> {
    const defaults = await this.getDefaultFilters();
    
    for (const defaultFilter of defaults) {
      // Check if already exists
      const existing = await db.select()
        .from(schema.savedFilters)
        .where(eq(schema.savedFilters.name, defaultFilter.name));
      
      if (existing.length === 0) {
        await this.createSavedFilter({
          name: defaultFilter.name,
          mode: defaultFilter.mode,
          filter: defaultFilter.filter,
          favorite: true,
        });
      }
    }
  }

  private formatSavedFilter(filter: any): schema.SavedFilter {
    const formatted: any = { ...filter };
    
    // Convert boolean fields
    formatted.favorite = Boolean(filter.favorite);
    
    return formatted as schema.SavedFilter;
  }
}

export const savedFilterService = new SavedFilterService();