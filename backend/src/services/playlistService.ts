import { db, schema } from '../db';
import { eq, desc, and, inArray } from 'drizzle-orm';
import type { StreamingMediaItem } from './streamingServer';

export class PlaylistService {
  async getAllPlaylists() {
    const playlists = await db.select()
      .from(schema.playlists)
      .orderBy(desc(schema.playlists.updatedAt));
    
    // Add item count for each playlist
    const playlistsWithCounts = await Promise.all(
      playlists.map(async (playlist) => {
        const items = await db.select({ count: db.count() })
          .from(schema.playlistItems)
          .where(eq(schema.playlistItems.playlistId, playlist.id));
        
        return {
          ...playlist,
          itemCount: items[0]?.count || 0
        };
      })
    );
    
    return playlistsWithCounts;
  }

  async getPlaylistById(id: number) {
    const [playlist] = await db.select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, id))
      .limit(1);
    
    if (!playlist) return null;
    
    // Get items with media details
    const items = await db.select({
      playlistItem: schema.playlistItems,
      mediaItem: schema.mediaItems
    })
      .from(schema.playlistItems)
      .innerJoin(schema.mediaItems, eq(schema.playlistItems.mediaItemId, schema.mediaItems.id))
      .where(eq(schema.playlistItems.playlistId, id))
      .orderBy(schema.playlistItems.position);
    
    // Calculate total duration
    const totalDuration = items.reduce((sum, item) => 
      sum + (item.mediaItem.duration || 0), 0
    );
    
    return {
      ...playlist,
      itemCount: items.length,
      totalDuration,
      items: items.map(({ playlistItem, mediaItem }) => ({
        id: playlistItem.id,
        position: playlistItem.position,
        mediaItem,
        addedAt: playlistItem.addedAt
      }))
    };
  }

  async getActivePlaylist() {
    const [playlist] = await db.select()
      .from(schema.playlists)
      .where(eq(schema.playlists.isActive, true))
      .limit(1);
    
    if (!playlist) return null;
    
    return this.getPlaylistById(playlist.id);
  }

  async createPlaylist(input: {
    name: string;
    description?: string;
    mediaItemIds: number[];
  }) {
    // Create playlist
    const [playlist] = await db.insert(schema.playlists)
      .values({
        name: input.name,
        description: input.description,
        isActive: false,
        updatedAt: new Date()
      })
      .returning();
    
    // Add items
    if (input.mediaItemIds.length > 0) {
      const playlistItems = input.mediaItemIds.map((mediaId, index) => ({
        playlistId: playlist.id,
        mediaItemId: mediaId,
        position: index
      }));
      
      await db.insert(schema.playlistItems).values(playlistItems);
    }
    
    return this.getPlaylistById(playlist.id);
  }

  async updatePlaylist(input: {
    id: number;
    name?: string;
    description?: string;
    mediaItemIds?: number[];
  }) {
    const playlist = await this.getPlaylistById(input.id);
    if (!playlist) throw new Error('Playlist not found');
    
    // Update playlist metadata
    if (input.name !== undefined || input.description !== undefined) {
      await db.update(schema.playlists)
        .set({
          name: input.name || playlist.name,
          description: input.description !== undefined ? input.description : playlist.description,
          updatedAt: new Date()
        })
        .where(eq(schema.playlists.id, input.id));
    }
    
    // Update items if provided
    if (input.mediaItemIds !== undefined) {
      // Delete existing items
      await db.delete(schema.playlistItems)
        .where(eq(schema.playlistItems.playlistId, input.id));
      
      // Add new items
      if (input.mediaItemIds.length > 0) {
        const playlistItems = input.mediaItemIds.map((mediaId, index) => ({
          playlistId: input.id,
          mediaItemId: mediaId,
          position: index
        }));
        
        await db.insert(schema.playlistItems).values(playlistItems);
      }
      
      // Update timestamp
      await db.update(schema.playlists)
        .set({ updatedAt: new Date() })
        .where(eq(schema.playlists.id, input.id));
    }
    
    return this.getPlaylistById(input.id);
  }

  async deletePlaylist(id: number) {
    const playlist = await this.getPlaylistById(id);
    if (!playlist) throw new Error('Playlist not found');
    
    // Delete will cascade to playlist_items
    await db.delete(schema.playlists)
      .where(eq(schema.playlists.id, id));
    
    return { success: true, message: `Playlist "${playlist.name}" deleted` };
  }

  async activatePlaylist(id: number) {
    const playlist = await this.getPlaylistById(id);
    if (!playlist) throw new Error('Playlist not found');
    
    // Deactivate all playlists
    await db.update(schema.playlists)
      .set({ isActive: false });
    
    // Activate selected playlist
    await db.update(schema.playlists)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(schema.playlists.id, id));
    
    return this.getPlaylistById(id);
  }

  async deactivateAllPlaylists() {
    await db.update(schema.playlists)
      .set({ isActive: false });
    
    return { success: true, message: 'All playlists deactivated' };
  }

  async exportPlaylist(id: number, format: string = 'm3u') {
    const playlist = await this.getPlaylistById(id);
    if (!playlist) throw new Error('Playlist not found');
    
    if (format === 'm3u') {
      let m3u = '#EXTM3U\n';
      m3u += `#PLAYLIST:${playlist.name}\n`;
      if (playlist.description) {
        m3u += `#COMMENT:${playlist.description}\n`;
      }
      
      playlist.items.forEach((item, index) => {
        const duration = Math.round(item.mediaItem.duration || -1);
        m3u += `#EXTINF:${duration},${item.mediaItem.filename}\n`;
        m3u += `${item.mediaItem.filepath}\n`;
      });
      
      return m3u;
    } else if (format === 'json') {
      return JSON.stringify({
        name: playlist.name,
        description: playlist.description,
        created: playlist.createdAt,
        items: playlist.items.map(item => ({
          filename: item.mediaItem.filename,
          filepath: item.mediaItem.filepath,
          duration: item.mediaItem.duration,
          size: item.mediaItem.fileSize
        }))
      }, null, 2);
    }
    
    throw new Error(`Unsupported export format: ${format}`);
  }

  async getPlaylistAsStreamingItems(playlistId: number): Promise<StreamingMediaItem[]> {
    const playlist = await this.getPlaylistById(playlistId);
    if (!playlist) return [];
    
    return playlist.items.map(item => ({
      id: item.mediaItem.id,
      filename: item.mediaItem.filename,
      filepath: item.mediaItem.filepath,
      fileType: item.mediaItem.fileType,
      createdAt: item.mediaItem.createdAt.toISOString(),
      fileSize: item.mediaItem.fileSize,
      duration: item.mediaItem.duration || undefined,
      width: item.mediaItem.width || 0,
      height: item.mediaItem.height || 0,
      thumbnailId: item.mediaItem.thumbnailId || undefined
    }));
  }
}

export const playlistService = new PlaylistService();