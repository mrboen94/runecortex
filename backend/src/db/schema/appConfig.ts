import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Application configuration table for persistent settings
export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(), // Configuration key
  value: text('value'), // JSON-encoded value
  description: text('description'), // Human-readable description
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Indexed folders table for persistent watch path storage
export const indexedFolders = sqliteTable('indexed_folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  lastScanned: integer('last_scanned', { mode: 'timestamp' }),
  lastModifiedTime: integer('last_modified_time', { mode: 'timestamp' }), // Folder's mtime when last scanned
  lastDeepScan: integer('last_deep_scan', { mode: 'timestamp' }), // When we last did a full deep scan
  scanStrategy: text('scan_strategy').default('auto'), // 'shallow' | 'deep' | 'auto'
  totalFiles: integer('total_files').default(0),
  totalFolders: integer('total_folders').default(0),
  folderTreeChecksum: text('folder_tree_checksum'), // Hash of folder structure for quick comparison
  addedAt: integer('added_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Folder scan cache for tracking subdirectory mtimes
export const folderScanCache = sqliteTable('folder_scan_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  indexedFolderId: integer('indexed_folder_id').notNull().references(() => indexedFolders.id, { onDelete: 'cascade' }),
  folderPath: text('folder_path').notNull(),
  lastModifiedTime: integer('last_modified_time', { mode: 'timestamp' }),
  fileCount: integer('file_count').default(0),
  lastChecked: integer('last_checked', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => {
  return {
    folderPathIdx: index('folder_scan_cache_path_idx').on(table.folderPath),
    indexedFolderIdx: index('folder_scan_cache_indexed_folder_idx').on(table.indexedFolderId),
  };
});

// Export types
export type AppConfig = typeof appConfig.$inferSelect;
export type NewAppConfig = typeof appConfig.$inferInsert;
export type IndexedFolder = typeof indexedFolders.$inferSelect;
export type NewIndexedFolder = typeof indexedFolders.$inferInsert;
export type FolderScanCache = typeof folderScanCache.$inferSelect;
export type NewFolderScanCache = typeof folderScanCache.$inferInsert;