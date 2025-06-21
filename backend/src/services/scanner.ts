import { readdir, stat } from 'fs/promises';
import { join, extname, basename } from 'path';
import { db, schema } from '../db';
import { eq, and, ne } from 'drizzle-orm';
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import { $ } from 'bun';
import { phashService } from './phashService';

const SUPPORTED_VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.3gp'];
const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'];

export interface ScanResult {
  processed: number;
  newFiles: number;
  updated: number;
  duplicatesSkipped: number;
  errors: { path: string; error: string }[];
}

export class MediaScanner {
  private scanResult: ScanResult = {
    processed: 0,
    newFiles: 0,
    updated: 0,
    duplicatesSkipped: 0,
    errors: []
  };
  private enableDuplicateDetection: boolean = true;
  private duplicateThreshold: number = 10; // Hamming distance threshold

  async scanDirectory(rootPath: string): Promise<ScanResult> {
    // Reset scan result for new scan
    this.scanResult = {
      processed: 0,
      newFiles: 0,
      updated: 0,
      duplicatesSkipped: 0,
      errors: []
    };
    
    const scanSession = await db.insert(schema.scanSessions).values({
      status: 'running'
    }).returning();

    const sessionId = scanSession[0].id;

    try {
      await this.walkDirectory(rootPath);
      
      await db.update(schema.scanSessions)
        .set({
          status: 'completed',
          filesProcessed: this.scanResult.processed,
          newFiles: this.scanResult.newFiles,
          updatedFiles: this.scanResult.updated,
          errors: this.scanResult.errors.length,
          errorLog: JSON.stringify(this.scanResult.errors),
          completedAt: new Date()
        })
        .where(eq(schema.scanSessions.id, sessionId));

    } catch (error) {
      await db.update(schema.scanSessions)
        .set({
          status: 'failed',
          errorLog: JSON.stringify([{ error: String(error) }]),
          completedAt: new Date()
        })
        .where(eq(schema.scanSessions.id, sessionId));
      
      throw error;
    }

    return this.scanResult;
  }

  private async walkDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await this.walkDirectory(fullPath);
        } else if (entry.isFile() && !entry.name.startsWith('.') && this.isMediaFile(entry.name)) {
          await this.processFile(fullPath);
        }
      }
    } catch (error) {
      this.scanResult.errors.push({
        path: dirPath,
        error: `Failed to read directory: ${error}`
      });
    }
  }

  private isMediaFile(filename: string): boolean {
    const ext = extname(filename).toLowerCase();
    return SUPPORTED_VIDEO_EXTENSIONS.includes(ext) || SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  }

  async processFile(filepath: string): Promise<void> {
    try {
      this.scanResult.processed++;
      
      const stats = await stat(filepath);
      const ext = extname(filepath).toLowerCase();
      const fileType = SUPPORTED_VIDEO_EXTENSIONS.includes(ext) ? 'video' : 'image';
      
      // Check if file already exists
      const existing = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.filepath, filepath))
        .limit(1);
      
      // Calculate checksum for change detection
      const checksum = await this.calculateChecksum(filepath, stats.size);
      
      if (existing.length > 0) {
        // Update if modified
        if (existing[0].checksum !== checksum || existing[0].lastModified.getTime() !== stats.mtime.getTime()) {
          const metadata = await this.extractMetadata(filepath, fileType);
          
          await db.update(schema.mediaItems)
            .set({
              fileSize: stats.size,
              lastModified: stats.mtime,
              checksum,
              ...metadata
            })
            .where(eq(schema.mediaItems.id, existing[0].id));
          
          this.scanResult.updated++;
        }
      } else {
        // Check for duplicates before inserting
        if (this.enableDuplicateDetection) {
          const duplicate = await this.checkForDuplicate(filepath, fileType, checksum, stats.size);
          if (duplicate) {
            console.log(`Duplicate detected: ${filepath} is similar to ${duplicate.filepath}`);
            this.scanResult.duplicatesSkipped++;
            
            // Store duplicate relationship in a custom field
            await db.insert(schema.customFields).values({
              entityType: 'media',
              entityId: duplicate.id,
              fieldName: 'duplicate_paths',
              fieldValue: JSON.stringify([...(JSON.parse(duplicate.duplicatePaths || '[]')), filepath]),
              fieldType: 'array'
            }).onConflictDoUpdate({
              target: [schema.customFields.entityType, schema.customFields.entityId, schema.customFields.fieldName],
              set: {
                fieldValue: JSON.stringify([...(JSON.parse(duplicate.duplicatePaths || '[]')), filepath])
              }
            });
            return;
          }
        }
        
        // Insert new file
        const metadata = await this.extractMetadata(filepath, fileType);
        const createdAt = await this.extractCreationDate(filepath, fileType, stats);
        
        const [newItem] = await db.insert(schema.mediaItems).values({
          filepath,
          filename: basename(filepath),
          createdAt,
          fileType,
          fileSize: stats.size,
          lastModified: stats.mtime,
          checksum,
          ...metadata
        }).returning();
        
        // Generate perceptual hash for future duplicate detection
        if (this.enableDuplicateDetection && newItem) {
          try {
            const phash = await phashService.generatePhash(filepath, fileType);
            if (phash) {
              await db.update(schema.mediaItems)
                .set({ phash })
                .where(eq(schema.mediaItems.id, newItem.id));
            }
          } catch (error) {
            console.error(`Failed to generate phash for ${filepath}:`, error);
          }
        }
        
        this.scanResult.newFiles++;
      }
    } catch (error) {
      this.scanResult.errors.push({
        path: filepath,
        error: String(error)
      });
    }
  }

  private async calculateChecksum(filepath: string, size: number): Promise<string> {
    // For large files, only hash first and last 1MB
    const chunkSize = 1024 * 1024; // 1MB
    
    if (size <= chunkSize * 2) {
      const data = await readFile(filepath);
      return crypto.createHash('sha256').update(data).digest('hex');
    }
    
    const hash = crypto.createHash('sha256');
    const file = Bun.file(filepath);
    
    // Read first chunk
    const firstChunk = await file.slice(0, chunkSize).arrayBuffer();
    hash.update(new Uint8Array(firstChunk));
    
    // Read last chunk
    const lastChunk = await file.slice(size - chunkSize, size).arrayBuffer();
    hash.update(new Uint8Array(lastChunk));
    
    // Include file size
    hash.update(size.toString());
    
    return hash.digest('hex');
  }

  private async extractMetadata(filepath: string, fileType: string): Promise<Partial<schema.MediaItem>> {
    const metadata: Partial<schema.MediaItem> = {};
    
    try {
      if (fileType === 'video') {
        // Use ffprobe to extract video metadata
        const result = await $`ffprobe -v quiet -print_format json -show_format -show_streams "${filepath}"`.json();
        
        if (result.format) {
          metadata.duration = parseFloat(result.format.duration || '0');
        }
        
        const videoStream = result.streams?.find((s: any) => s.codec_type === 'video');
        if (videoStream) {
          metadata.width = videoStream.width;
          metadata.height = videoStream.height;
        }
        
        metadata.metadataJson = JSON.stringify(result);
      } else {
        // Try to get image info using ffprobe as fallback
        try {
          const exiftoolExists = await $`which exiftool`.quiet().then(() => true).catch(() => false);
          
          if (exiftoolExists) {
            // Use exiftool for images
            const result = await $`exiftool -j "${filepath}"`.json();
            
            if (result && result[0]) {
              metadata.width = result[0].ImageWidth;
              metadata.height = result[0].ImageHeight;
              metadata.metadataJson = JSON.stringify(result[0]);
            }
          } else {
            // Use ffprobe as fallback
            const result = await $`ffprobe -v quiet -print_format json -show_streams "${filepath}"`.json();
            
            const stream = result.streams?.find((s: any) => s.codec_type === 'video');
            if (stream) {
              metadata.width = stream.width;
              metadata.height = stream.height;
              metadata.metadataJson = JSON.stringify(result);
            }
          }
        } catch (error) {
          console.error(`Failed to extract image metadata for ${filepath}:`, error);
        }
      }
    } catch (error) {
      console.error(`Failed to extract metadata for ${filepath}:`, error);
    }
    
    return metadata;
  }

  private async extractCreationDate(filepath: string, fileType: string, stats: any): Promise<Date> {
    try {
      // Check if exiftool is available
      const exiftoolExists = await $`which exiftool`.quiet().then(() => true).catch(() => false);
      
      if (exiftoolExists) {
        // Try EXIF data first
        const result = await $`exiftool -DateTimeOriginal -CreateDate -MediaCreateDate -j "${filepath}"`.json();
        
        if (result && result[0]) {
          const dates = [
            result[0].DateTimeOriginal,
            result[0].CreateDate,
            result[0].MediaCreateDate
          ].filter(Boolean);
          
          for (const dateStr of dates) {
            const date = new Date(dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
            if (!isNaN(date.getTime())) {
              return date;
            }
          }
        }
      } else {
        // Try ffprobe for creation time
        const result = await $`ffprobe -v quiet -print_format json -show_format "${filepath}"`.json();
        if (result?.format?.tags?.creation_time) {
          const date = new Date(result.format.tags.creation_time);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    } catch (error) {
      // Continue to fallback methods
    }
    
    // Try to parse date from filename
    const filenameDate = this.parseDateFromFilename(basename(filepath));
    if (filenameDate) {
      return filenameDate;
    }
    
    // Fallback to file creation time
    return stats.birthtime || stats.mtime;
  }

  private parseDateFromFilename(filename: string): Date | null {
    // Common date patterns in filenames
    const patterns = [
      /(\d{4})-(\d{2})-(\d{2})/,  // YYYY-MM-DD
      /(\d{4})(\d{2})(\d{2})/,     // YYYYMMDD
      /(\d{2})-(\d{2})-(\d{4})/,   // DD-MM-YYYY
      /(\d{2})\.(\d{2})\.(\d{4})/, // DD.MM.YYYY
    ];
    
    for (const pattern of patterns) {
      const match = filename.match(pattern);
      if (match) {
        let year, month, day;
        
        if (match[0].includes('-') || match[0].includes('.')) {
          if (match[1].length === 4) {
            [, year, month, day] = match;
          } else {
            [, day, month, year] = match;
          }
        } else {
          [, year, month, day] = match;
        }
        
        const date = new Date(`${year}-${month}-${day}`);
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2100) {
          return date;
        }
      }
    }
    
    return null;
  }

  private async checkForDuplicate(filepath: string, fileType: string, checksum: string, fileSize: number): Promise<any | null> {
    try {
      // First check for exact checksum match
      const exactMatch = await db.select()
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.checksum, checksum))
        .limit(1);
      
      if (exactMatch.length > 0) {
        return exactMatch[0];
      }
      
      // Check for similar file sizes (within 5%)
      const sizeTolerance = fileSize * 0.05;
      const similarSizeItems = await db.select()
        .from(schema.mediaItems)
        .where(and(
          eq(schema.mediaItems.fileType, fileType),
          // @ts-ignore - Drizzle ORM comparison operators
          schema.mediaItems.fileSize >= fileSize - sizeTolerance,
          // @ts-ignore - Drizzle ORM comparison operators
          schema.mediaItems.fileSize <= fileSize + sizeTolerance
        ));
      
      if (similarSizeItems.length === 0) {
        return null;
      }
      
      // Generate phash for the new file
      const newPhash = await phashService.generatePhash(filepath, fileType);
      if (!newPhash) {
        return null;
      }
      
      // Check perceptual similarity
      for (const item of similarSizeItems) {
        if (item.phash) {
          const distance = phashService.calculateHammingDistance(newPhash, item.phash);
          if (distance <= this.duplicateThreshold) {
            // Get custom field for duplicate paths
            const customField = await db.select()
              .from(schema.customFields)
              .where(and(
                eq(schema.customFields.entityType, 'media'),
                eq(schema.customFields.entityId, item.id),
                eq(schema.customFields.fieldName, 'duplicate_paths')
              ))
              .limit(1);
            
            return {
              ...item,
              duplicatePaths: customField[0]?.fieldValue || '[]'
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error checking for duplicate: ${error}`);
      return null;
    }
  }
}