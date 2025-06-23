import { stat, readdir } from 'fs/promises';
import { join } from 'path';
import { db, schema } from '../db';
import { eq, and, inArray } from 'drizzle-orm';
import { createHash } from 'crypto';
import { MediaScanner } from './scanner';
import { scanProgress } from './scanProgress';

export interface FolderScanResult {
  path: string;
  needsScan: boolean;
  reason?: string;
  subdirectories: FolderScanResult[];
  mtime?: Date;
  fileCount?: number;
}

export interface SmartScanOptions {
  forceDeepScan?: boolean;
  deepScanIntervalHours?: number;
  scanStrategy?: 'shallow' | 'deep' | 'auto' | 'startup';
}

export class SmartScanner {
  private scanner: MediaScanner;
  private readonly DEFAULT_DEEP_SCAN_INTERVAL = 7 * 24; // 1 week in hours

  constructor() {
    this.scanner = new MediaScanner();
  }

  /**
   * Check if a folder needs scanning based on modification time
   */
  async checkFolderNeedsScan(
    folderPath: string, 
    indexedFolderId: number,
    options: SmartScanOptions = {}
  ): Promise<FolderScanResult> {
    try {
      // Get folder stats
      const stats = await stat(folderPath);
      const folderMtime = stats.mtime;

      // Get cached info from database
      const [cachedInfo] = await db
        .select()
        .from(schema.folderScanCache)
        .where(
          and(
            eq(schema.folderScanCache.indexedFolderId, indexedFolderId),
            eq(schema.folderScanCache.folderPath, folderPath)
          )
        )
        .limit(1);

      // Get indexed folder info
      const [indexedFolder] = await db
        .select()
        .from(schema.indexedFolders)
        .where(eq(schema.indexedFolders.id, indexedFolderId))
        .limit(1);

      let needsScan = false;
      let reason = '';

      // Check various conditions
      if (options.forceDeepScan) {
        needsScan = true;
        reason = 'Force deep scan requested';
      } else if (!cachedInfo) {
        needsScan = true;
        reason = 'Never scanned before';
      } else if (options.scanStrategy === 'startup') {
        // On startup, only scan if folder was modified or never scanned
        // Don't do periodic deep scans on startup
        needsScan = false;
      } else if (cachedInfo.lastModifiedTime && folderMtime > new Date(cachedInfo.lastModifiedTime)) {
        needsScan = true;
        reason = `Folder modified (${folderMtime.toISOString()} > ${new Date(cachedInfo.lastModifiedTime).toISOString()})`;
      } else if (options.scanStrategy === 'deep' || 
                (options.scanStrategy === 'auto' && this.shouldPerformDeepScan(indexedFolder, options))) {
        needsScan = true;
        reason = 'Periodic deep scan';
      }

      // Only check subdirectories if this folder needs scanning
      const subdirectories: FolderScanResult[] = [];
      if (needsScan && options.scanStrategy !== 'shallow') {
        const entries = await readdir(folderPath, { withFileTypes: true });
        const subdirs = entries.filter(entry => entry.isDirectory());
        
        for (const subdir of subdirs) {
          const subdirPath = join(folderPath, subdir.name);
          const subdirResult = await this.checkFolderNeedsScan(
            subdirPath, 
            indexedFolderId, 
            options
          );
          subdirectories.push(subdirResult);
        }
      }

      return {
        path: folderPath,
        needsScan,
        reason,
        subdirectories,
        mtime: folderMtime,
        fileCount: cachedInfo?.fileCount
      };
    } catch (error) {
      console.error(`Error checking folder ${folderPath}:`, error);
      return {
        path: folderPath,
        needsScan: true,
        reason: `Error accessing folder: ${error.message}`,
        subdirectories: []
      };
    }
  }

  /**
   * Perform a smart scan that only scans changed folders
   */
  async smartScan(
    indexedFolderId: number,
    rootPath: string,
    options: SmartScanOptions = {}
  ): Promise<number> {
    console.log(`Starting smart scan for ${rootPath} with strategy: ${options.scanStrategy || 'auto'}`);
    scanProgress.startScan(rootPath);

    try {
      // For startup scans, do a quick check first
      if (options.scanStrategy === 'startup') {
        // Check if the root folder has been scanned before and hasn't changed
        const [rootCache] = await db
          .select()
          .from(schema.folderScanCache)
          .where(
            and(
              eq(schema.folderScanCache.indexedFolderId, indexedFolderId),
              eq(schema.folderScanCache.folderPath, rootPath)
            )
          )
          .limit(1);

        if (rootCache && rootCache.lastModifiedTime) {
          const stats = await stat(rootPath);
          if (stats.mtime <= new Date(rootCache.lastModifiedTime)) {
            console.log(`Root folder ${rootPath} unchanged since last scan, skipping startup scan`);
            scanProgress.complete();
            return 0;
          }
        }
      }

      // Check which folders need scanning
      const scanResult = await this.checkFolderNeedsScan(rootPath, indexedFolderId, options);
      
      if (!scanResult.needsScan && options.scanStrategy !== 'startup') {
        console.log(`No changes detected in ${rootPath}, skipping scan`);
        scanProgress.complete();
        return 0;
      }

      // For startup, if root changed, check each subfolder individually
      let foldersToScan: FolderScanResult[] = [];
      
      if (options.scanStrategy === 'startup' && scanResult.needsScan) {
        // Root folder changed, but check each subfolder individually
        console.log(`Root folder changed, checking subfolders individually...`);
        foldersToScan = await this.getChangedSubfolders(rootPath, indexedFolderId);
        console.log(`Found ${foldersToScan.length} changed subfolders`);
      } else if (scanResult.needsScan) {
        // Normal scan - get all folders that need scanning
        console.log(`Scanning needed for ${rootPath}: ${scanResult.reason}`);
        foldersToScan = this.getFoldersToScan(scanResult);
        console.log(`Found ${foldersToScan.length} folders to scan`);
      }

      // Perform the scan
      let totalProcessed = 0;
      for (const folder of foldersToScan) {
        console.log(`Scanning folder: ${folder.path}`);
        const processed = await this.scanFolder(folder.path, indexedFolderId);
        totalProcessed += processed;
      }

      // Update indexed folder info
      await db
        .update(schema.indexedFolders)
        .set({
          lastScanned: new Date(),
          lastModifiedTime: scanResult.mtime,
          lastDeepScan: options.forceDeepScan || options.scanStrategy === 'deep' 
            ? new Date() 
            : undefined,
          totalFiles: totalProcessed,
          folderTreeChecksum: await this.calculateFolderTreeChecksum(rootPath)
        })
        .where(eq(schema.indexedFolders.id, indexedFolderId));

      scanProgress.complete();
      return totalProcessed;
    } catch (error) {
      console.error('Smart scan error:', error);
      scanProgress.reset();
      throw error;
    }
  }

  /**
   * Scan a specific folder and update cache
   */
  private async scanFolder(folderPath: string, indexedFolderId: number): Promise<number> {
    // Use existing scanner to process files
    const result = await this.scanner.scanDirectory(folderPath);
    
    // Update folder cache
    const stats = await stat(folderPath);
    
    // Check if cache entry exists
    const [existingCache] = await db
      .select()
      .from(schema.folderScanCache)
      .where(
        and(
          eq(schema.folderScanCache.indexedFolderId, indexedFolderId),
          eq(schema.folderScanCache.folderPath, folderPath)
        )
      )
      .limit(1);
    
    if (existingCache) {
      // Update existing cache
      await db
        .update(schema.folderScanCache)
        .set({
          lastModifiedTime: stats.mtime,
          fileCount: result.processed,
          lastChecked: new Date()
        })
        .where(eq(schema.folderScanCache.id, existingCache.id));
    } else {
      // Insert new cache entry
      await db
        .insert(schema.folderScanCache)
        .values({
          indexedFolderId,
          folderPath,
          lastModifiedTime: stats.mtime,
          fileCount: result.processed,
          lastChecked: new Date()
        });
    }

    return result.processed;
  }

  /**
   * Get changed subfolders for startup scan
   */
  private async getChangedSubfolders(rootPath: string, indexedFolderId: number): Promise<FolderScanResult[]> {
    const changedFolders: FolderScanResult[] = [];
    
    try {
      // Get all cached folder info for this indexed folder
      const cachedFolders = await db
        .select()
        .from(schema.folderScanCache)
        .where(eq(schema.folderScanCache.indexedFolderId, indexedFolderId));
      
      // Create a map for quick lookup
      const cacheMap = new Map(cachedFolders.map(f => [f.folderPath, f]));
      
      // Walk through the directory tree and check each folder
      const checkFolder = async (folderPath: string) => {
        const entries = await readdir(folderPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const subPath = join(folderPath, entry.name);
            const stats = await stat(subPath);
            const cached = cacheMap.get(subPath);
            
            // Check if this specific folder has changed
            if (!cached || stats.mtime > new Date(cached.lastModifiedTime || 0)) {
              changedFolders.push({
                path: subPath,
                needsScan: true,
                reason: cached ? 'Folder modified' : 'New folder',
                subdirectories: [],
                mtime: stats.mtime
              });
            }
            
            // Recursively check subfolders
            await checkFolder(subPath);
          }
        }
      };
      
      // Start from root but don't include root itself
      await checkFolder(rootPath);
      
    } catch (error) {
      console.error(`Error checking changed subfolders: ${error}`);
    }
    
    return changedFolders;
  }

  /**
   * Get flat list of folders that need scanning
   */
  private getFoldersToScan(result: FolderScanResult): FolderScanResult[] {
    const folders: FolderScanResult[] = [];
    
    if (result.needsScan) {
      folders.push(result);
    }
    
    for (const subdir of result.subdirectories) {
      folders.push(...this.getFoldersToScan(subdir));
    }
    
    return folders;
  }

  /**
   * Check if we should perform a deep scan
   */
  private shouldPerformDeepScan(
    indexedFolder: any, 
    options: SmartScanOptions
  ): boolean {
    if (!indexedFolder.lastDeepScan) {
      return true; // Never had a deep scan
    }

    const hoursSinceLastDeepScan = 
      (Date.now() - new Date(indexedFolder.lastDeepScan).getTime()) / 
      (1000 * 60 * 60);

    const interval = options.deepScanIntervalHours || this.DEFAULT_DEEP_SCAN_INTERVAL;
    return hoursSinceLastDeepScan >= interval;
  }

  /**
   * Calculate a checksum of the folder tree structure
   */
  private async calculateFolderTreeChecksum(rootPath: string): Promise<string> {
    const hash = createHash('sha256');
    
    async function processDir(dirPath: string) {
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
        
        for (const entry of sorted) {
          hash.update(entry.name);
          hash.update(entry.isDirectory() ? 'd' : 'f');
          
          if (entry.isDirectory()) {
            await processDir(join(dirPath, entry.name));
          }
        }
      } catch (error) {
        console.error(`Error processing directory ${dirPath}:`, error);
      }
    }
    
    await processDir(rootPath);
    return hash.digest('hex');
  }

  /**
   * Clean up old cache entries
   */
  async cleanupCache(daysOld: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await db
      .delete(schema.folderScanCache)
      .where(eq(schema.folderScanCache.lastChecked, cutoffDate));
    
    return result.rowsAffected || 0;
  }
}