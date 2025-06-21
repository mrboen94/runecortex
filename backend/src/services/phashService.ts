import { spawn } from 'child_process';
import { promisify } from 'util';
import { db, schema } from '../db';
import { eq, isNull, sql } from 'drizzle-orm';
import crypto from 'crypto';
import { $ } from 'bun';
import fs from 'fs/promises';

const execFile = promisify(require('child_process').execFile);

export class PerceptualHashService {
  private readonly HASH_SIZE = 16; // 16x16 = 256 bits
  
  async generatePhash(filepath: string, fileType: 'image' | 'video'): Promise<string | null> {
    try {
      if (fileType === 'image') {
        return await this.generateImagePhash(filepath);
      } else {
        return await this.generateVideoPhash(filepath);
      }
    } catch (error) {
      console.error(`Failed to generate phash for ${filepath}:`, error);
      return null;
    }
  }

  private async generateImagePhash(filepath: string): Promise<string> {
    // Use ffmpeg to process image instead of sharp
    const tempPath = `/tmp/phash-${Date.now()}.raw`;
    
    try {
      // Resize to small size and convert to grayscale using ffmpeg
      await $`ffmpeg -i ${filepath} -vf "scale=${this.HASH_SIZE + 1}:${this.HASH_SIZE + 1},format=gray" -f rawvideo -pix_fmt gray ${tempPath}`.quiet();
      
      // Read raw pixel data
      const processed = await fs.readFile(tempPath);
      
      // Calculate DCT-based hash
      const hash = this.calculateDCTHash(processed, this.HASH_SIZE + 1);
      
      // Cleanup
      await fs.unlink(tempPath).catch(() => {});
      
      return hash;
    } catch (error) {
      // Cleanup on error
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  private async generateVideoPhash(filepath: string): Promise<string> {
    // Extract a frame from the video at 10% duration
    const framePath = `/tmp/frame-${Date.now()}.png`;
    
    try {
      // Get video duration
      const duration = await this.getVideoDuration(filepath);
      const seekTime = Math.floor(duration * 0.1);
      
      // Extract frame
      await execFile('ffmpeg', [
        '-ss', seekTime.toString(),
        '-i', filepath,
        '-vframes', '1',
        '-f', 'image2',
        '-y',
        framePath
      ]);
      
      // Generate hash from frame
      const hash = await this.generateImagePhash(framePath);
      
      // Cleanup
      await require('fs/promises').unlink(framePath).catch(() => {});
      
      return hash;
    } catch (error) {
      // Cleanup on error
      await require('fs/promises').unlink(framePath).catch(() => {});
      throw error;
    }
  }

  private async getVideoDuration(filepath: string): Promise<number> {
    const { stdout } = await execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filepath
    ]);
    
    return parseFloat(stdout.trim());
  }

  private calculateDCTHash(pixels: Buffer, size: number): string {
    // Convert to 2D array
    const matrix: number[][] = [];
    for (let y = 0; y < size; y++) {
      matrix[y] = [];
      for (let x = 0; x < size; x++) {
        matrix[y][x] = pixels[y * size + x];
      }
    }
    
    // Apply DCT
    const dct = this.applyDCT(matrix, size);
    
    // Get top-left 8x8 excluding DC component
    const subMatrix: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (x === 0 && y === 0) continue; // Skip DC component
        subMatrix.push(dct[y][x]);
      }
    }
    
    // Calculate median
    const sorted = [...subMatrix].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    
    // Generate hash
    let hash = '';
    let byte = 0;
    let bitIndex = 0;
    
    for (let i = 0; i < subMatrix.length; i++) {
      if (subMatrix[i] > median) {
        byte |= (1 << (7 - bitIndex));
      }
      
      bitIndex++;
      if (bitIndex === 8) {
        hash += byte.toString(16).padStart(2, '0');
        byte = 0;
        bitIndex = 0;
      }
    }
    
    // Add remaining bits if any
    if (bitIndex > 0) {
      hash += byte.toString(16).padStart(2, '0');
    }
    
    return hash;
  }

  private applyDCT(matrix: number[][], size: number): number[][] {
    const result: number[][] = [];
    const c = (i: number) => i === 0 ? 1 / Math.sqrt(2) : 1;
    
    for (let u = 0; u < size; u++) {
      result[u] = [];
      for (let v = 0; v < size; v++) {
        let sum = 0;
        
        for (let x = 0; x < size; x++) {
          for (let y = 0; y < size; y++) {
            sum += matrix[y][x] * 
              Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size)) *
              Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
          }
        }
        
        result[u][v] = (2 / size) * c(u) * c(v) * sum;
      }
    }
    
    return result;
  }

  async updateMediaPhash(mediaId: number): Promise<string | null> {
    const [media] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId));
    
    if (!media) return null;
    
    const phash = await this.generatePhash(media.filepath, media.fileType as 'image' | 'video');
    
    if (phash) {
      await db.update(schema.mediaItems)
        .set({ phash })
        .where(eq(schema.mediaItems.id, mediaId));
    }
    
    return phash;
  }

  async generateMissingPhashes(limit: number = 100): Promise<number> {
    const media = await db.select()
      .from(schema.mediaItems)
      .where(isNull(schema.mediaItems.phash))
      .limit(limit);
    
    let generated = 0;
    
    for (const item of media) {
      const phash = await this.generatePhash(item.filepath, item.fileType as 'image' | 'video');
      if (phash) {
        await db.update(schema.mediaItems)
          .set({ phash })
          .where(eq(schema.mediaItems.id, item.id));
        generated++;
      }
    }
    
    return generated;
  }

  calculateHammingDistance(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) {
      throw new Error('Hashes must be the same length');
    }
    
    let distance = 0;
    
    for (let i = 0; i < hash1.length; i += 2) {
      const byte1 = parseInt(hash1.substr(i, 2), 16);
      const byte2 = parseInt(hash2.substr(i, 2), 16);
      
      // Count differing bits
      let xor = byte1 ^ byte2;
      while (xor > 0) {
        distance += xor & 1;
        xor >>= 1;
      }
    }
    
    return distance;
  }

  async findDuplicates(threshold: number = 10): Promise<Array<{
    hash: string;
    items: schema.MediaItem[];
  }>> {
    // Get all media with phashes
    const allMedia = await db.select()
      .from(schema.mediaItems)
      .where(sql`${schema.mediaItems.phash} IS NOT NULL`);
    
    // Group by similar hashes
    const groups = new Map<string, schema.MediaItem[]>();
    const processed = new Set<number>();
    
    for (let i = 0; i < allMedia.length; i++) {
      if (processed.has(allMedia[i].id)) continue;
      
      const group: schema.MediaItem[] = [allMedia[i]];
      processed.add(allMedia[i].id);
      
      for (let j = i + 1; j < allMedia.length; j++) {
        if (processed.has(allMedia[j].id)) continue;
        
        const distance = this.calculateHammingDistance(
          allMedia[i].phash!,
          allMedia[j].phash!
        );
        
        if (distance <= threshold) {
          group.push(allMedia[j]);
          processed.add(allMedia[j].id);
        }
      }
      
      if (group.length > 1) {
        groups.set(allMedia[i].phash!, group);
      }
    }
    
    return Array.from(groups.entries()).map(([hash, items]) => ({ hash, items }));
  }

  async findSimilar(mediaId: number, threshold: number = 10): Promise<schema.MediaItem[]> {
    const [media] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId));
    
    if (!media || !media.phash) return [];
    
    const allMedia = await db.select()
      .from(schema.mediaItems)
      .where(sql`${schema.mediaItems.phash} IS NOT NULL AND ${schema.mediaItems.id} != ${mediaId}`);
    
    const similar: schema.MediaItem[] = [];
    
    for (const item of allMedia) {
      const distance = this.calculateHammingDistance(media.phash, item.phash!);
      if (distance <= threshold) {
        similar.push(item);
      }
    }
    
    return similar.sort((a, b) => {
      const distA = this.calculateHammingDistance(media.phash!, a.phash!);
      const distB = this.calculateHammingDistance(media.phash!, b.phash!);
      return distA - distB;
    });
  }

  async getDuplicateStats(): Promise<{
    totalMedia: number;
    withPhash: number;
    duplicateGroups: number;
    totalDuplicates: number;
  }> {
    const [stats] = await db.select({
      totalMedia: sql<number>`COUNT(*)`,
      withPhash: sql<number>`COUNT(${schema.mediaItems.phash})`,
    }).from(schema.mediaItems);
    
    const duplicates = await this.findDuplicates();
    
    return {
      totalMedia: stats.totalMedia || 0,
      withPhash: stats.withPhash || 0,
      duplicateGroups: duplicates.length,
      totalDuplicates: duplicates.reduce((sum, group) => sum + group.items.length, 0),
    };
  }

  // Alternative simple hash for faster processing
  async generateSimpleHash(filepath: string): Promise<string> {
    const tempPath = `/tmp/simplehash-${Date.now()}.raw`;
    
    try {
      // Resize to 8x8 and convert to grayscale using ffmpeg
      await $`ffmpeg -i ${filepath} -vf "scale=8:8,format=gray" -f rawvideo -pix_fmt gray ${tempPath}`.quiet();
      
      // Read raw pixel data
      const pixels = await fs.readFile(tempPath);
      
      // Calculate average
      let sum = 0;
      for (let i = 0; i < pixels.length; i++) {
        sum += pixels[i];
      }
      const avg = sum / pixels.length;
      
      // Generate hash
      let hash = '';
      let byte = 0;
      let bitIndex = 0;
      
      for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] > avg) {
          byte |= (1 << (7 - bitIndex));
        }
        
        bitIndex++;
        if (bitIndex === 8) {
          hash += byte.toString(16).padStart(2, '0');
          byte = 0;
          bitIndex = 0;
        }
      }
      
      // Cleanup
      await fs.unlink(tempPath).catch(() => {});
      
      return hash;
    } catch (error) {
      // Cleanup on error
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
  }
}

export const phashService = new PerceptualHashService();