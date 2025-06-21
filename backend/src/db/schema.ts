import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const mediaItems = sqliteTable('media_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filepath: text('filepath').notNull().unique(),
  filename: text('filename').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  fileType: text('file_type').notNull(), // 'video' | 'image'
  fileSize: integer('file_size').notNull(),
  duration: real('duration'), // seconds for videos
  width: integer('width'),
  height: integer('height'),
  metadataJson: text('metadata_json'), // JSON string
  thumbnailGenerated: integer('thumbnail_generated', { mode: 'boolean' }).default(false),
  lastModified: integer('last_modified', { mode: 'timestamp' }).notNull(),
  checksum: text('checksum'), // file hash for change detection
  addedAt: integer('added_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const scanSessions = sqliteTable('scan_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  filesProcessed: integer('files_processed').default(0),
  newFiles: integer('new_files').default(0),
  updatedFiles: integer('updated_files').default(0),
  errors: integer('errors').default(0),
  errorLog: text('error_log'), // JSON array of errors
  status: text('status').default('running'), // 'running' | 'completed' | 'failed'
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type ScanSession = typeof scanSessions.$inferSelect;
export type NewScanSession = typeof scanSessions.$inferInsert;