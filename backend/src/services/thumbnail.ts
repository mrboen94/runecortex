import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { $ } from 'bun';
import { join, dirname, extname, basename } from 'path';
import { mkdir, access } from 'fs/promises';
import { constants } from 'fs';
import { v4 as uuidv4 } from 'uuid';

export class ThumbnailGenerator {
  private thumbnailDir: string;
  private thumbnailSize = 300;

  constructor(thumbnailDir: string = './thumbnails') {
    this.thumbnailDir = thumbnailDir;
  }

  async ensureThumbnailDir(): Promise<void> {
    await mkdir(this.thumbnailDir, { recursive: true });
  }

  async generateThumbnail(mediaItemId: number): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const path = await this.generateForMediaItem(mediaItemId);
      return { success: true, path: path || undefined };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async generateForMediaItem(mediaItemId: number): Promise<string | null> {
    const [item] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaItemId))
      .limit(1);

    if (!item) {
      throw new Error(`Media item ${mediaItemId} not found`);
    }

    // Generate or get existing thumbnail ID
    let thumbnailId = item.thumbnailId;
    if (!thumbnailId) {
      // Generate new thumbnail ID: filename (without extension) + UUID
      const fileBaseName = basename(item.filename, extname(item.filename));
      const uuid = uuidv4().substring(0, 8); // Use first 8 chars for brevity
      thumbnailId = `${fileBaseName}_${uuid}`;
      
      // Update the database with the new thumbnail ID
      await db.update(schema.mediaItems)
        .set({ thumbnailId })
        .where(eq(schema.mediaItems.id, mediaItemId));
    }

    const thumbnailPath = join(this.thumbnailDir, `${thumbnailId}.jpg`);

    // Check if thumbnail already exists
    try {
      await access(thumbnailPath, constants.F_OK);
      return thumbnailPath;
    } catch {
      // Thumbnail doesn't exist, generate it
    }


    // Check if source file exists
    try {
      await access(item.filepath, constants.F_OK);
    } catch {
      throw new Error(`Source file not found: ${item.filepath}`);
    }

    await this.ensureThumbnailDir();

    try {
      if (item.fileType === 'video') {
        await this.generateVideoThumbnail(item.filepath, thumbnailPath, item.duration || 0);
      } else {
        await this.generateImageThumbnail(item.filepath, thumbnailPath);
      }

      // Update database
      await db.update(schema.mediaItems)
        .set({ thumbnailGenerated: true })
        .where(eq(schema.mediaItems.id, mediaItemId));

      return thumbnailPath;
    } catch (error) {
      console.error(`Failed to generate thumbnail for ${item.filepath}:`, error);
      throw error;
    }
  }

  private async generateVideoThumbnail(inputPath: string, outputPath: string, duration: number): Promise<void> {
    // Extract frame at 10% of video duration
    const seekTime = Math.max(1, duration * 0.1);

    await $`ffmpeg -i "${inputPath}" -ss ${seekTime} -vframes 1 -vf "scale=${this.thumbnailSize}:${this.thumbnailSize}:force_original_aspect_ratio=decrease,pad=${this.thumbnailSize}:${this.thumbnailSize}:(ow-iw)/2:(oh-ih)/2" -q:v 2 -strict unofficial "${outputPath}" -y`.quiet();
  }

  private async generateImageThumbnail(inputPath: string, outputPath: string): Promise<void> {
    await $`ffmpeg -i "${inputPath}" -vf "scale=${this.thumbnailSize}:${this.thumbnailSize}:force_original_aspect_ratio=decrease,pad=${this.thumbnailSize}:${this.thumbnailSize}:(ow-iw)/2:(oh-ih)/2" -q:v 2 "${outputPath}" -y`.quiet();
  }

  async generateMissingThumbnails(batchSize: number = 10): Promise<number> {
    let generated = 0;
    let offset = 0;

    while (true) {
      const items = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.thumbnailGenerated, false))
        .limit(batchSize)
        .offset(offset);

      if (items.length === 0) break;

      // Process in parallel with concurrency limit
      const promises = items.map(item => 
        this.generateForMediaItem(item.id)
          .then(result => result ? 1 : 0)
          .catch(() => 0)
      );

      const results = await Promise.all(promises);
      generated += results.reduce((a, b) => a + b, 0);

      offset += batchSize;

      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return generated;
  }
}