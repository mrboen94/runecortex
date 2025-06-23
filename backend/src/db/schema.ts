import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';

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
  thumbnailId: text('thumbnail_id'), // UUID for thumbnail filename
  lastModified: integer('last_modified', { mode: 'timestamp' }).notNull(),
  checksum: text('checksum'), // file hash for change detection
  addedAt: integer('added_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  sourcePath: text('source_path'), // The watch path this item was scanned from
  // Location metadata
  latitude: real('latitude'), // GPS latitude
  longitude: real('longitude'), // GPS longitude
  altitude: real('altitude'), // GPS altitude in meters
  locationName: text('location_name'), // Reverse geocoded location name
  // New fields inspired by stash
  title: text('title'), // User-defined title
  description: text('description'),
  rating: integer('rating'), // 1-5 stars
  favorite: integer('favorite', { mode: 'boolean' }).default(false),
  organized: integer('organized', { mode: 'boolean' }).default(false),
  phash: text('phash'), // Perceptual hash for duplicate detection
  // Error tracking fields
  lastError: text('last_error'), // Last error encountered
  errorCount: integer('error_count').default(0),
  processingStatus: text('processing_status').default('pending'), // 'pending' | 'processing' | 'completed' | 'error'
}, (table) => {
  return {
    createdAtIdx: index('media_created_at_idx').on(table.createdAt),
    fileTypeIdx: index('media_file_type_idx').on(table.fileType),
    favoriteIdx: index('media_favorite_idx').on(table.favorite),
    ratingIdx: index('media_rating_idx').on(table.rating),
    sourcePathIdx: index('media_source_path_idx').on(table.sourcePath),
    locationIdx: index('media_location_idx').on(table.latitude, table.longitude),
    thumbnailGeneratedIdx: index('media_thumbnail_generated_idx').on(table.thumbnailGenerated),
    checksumIdx: index('media_checksum_idx').on(table.checksum),
    processingStatusIdx: index('media_processing_status_idx').on(table.processingStatus),
  };
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

// Tags system inspired by stash
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(), // URL-friendly version of name
  description: text('description'),
  aliases: text('aliases'), // JSON array of alternative names
  color: text('color'), // Hex color for UI
  parentId: integer('parent_id').references(() => tags.id),
  path: text('path'), // Hierarchical path like "1/5/12"
  favorite: integer('favorite', { mode: 'boolean' }).default(false),
  ignoreAutoTag: integer('ignore_auto_tag', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => {
  return {
    nameIdx: index('tag_name_idx').on(table.name),
    parentIdx: index('tag_parent_idx').on(table.parentId),
  };
});

// Junction table for media-tag relationships
export const mediaTags = sqliteTable('media_tags', {
  mediaId: integer('media_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => {
  return {
    pk: uniqueIndex('media_tag_pk').on(table.mediaId, table.tagId),
    mediaIdx: index('media_tag_media_idx').on(table.mediaId),
    tagIdx: index('media_tag_tag_idx').on(table.tagId),
  };
});

// Collections/Galleries inspired by stash
export const collections = sqliteTable('collections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  date: integer('date', { mode: 'timestamp' }),
  rating: integer('rating'),
  favorite: integer('favorite', { mode: 'boolean' }).default(false),
  organized: integer('organized', { mode: 'boolean' }).default(false),
  parentId: integer('parent_id').references(() => collections.id),
  coverImage: text('cover_image'), // Path to cover image
  coverMediaId: integer('cover_media_id').references(() => mediaItems.id),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => {
  return {
    titleIdx: index('collection_title_idx').on(table.title),
    dateIdx: index('collection_date_idx').on(table.date),
    parentIdx: index('collection_parent_idx').on(table.parentId),
  };
});

// Junction table for collection-media relationships
export const collectionMedia = sqliteTable('collection_media', {
  collectionId: integer('collection_id').notNull().references(() => collections.id, { onDelete: 'cascade' }),
  mediaId: integer('media_id').notNull().references(() => mediaItems.id, { onDelete: 'cascade' }),
  orderIndex: integer('order_index').default(0),
}, (table) => {
  return {
    pk: uniqueIndex('collection_media_pk').on(table.collectionId, table.mediaId),
    collectionIdx: index('collection_media_collection_idx').on(table.collectionId),
    mediaIdx: index('collection_media_media_idx').on(table.mediaId),
  };
});

// Saved filters inspired by stash
export const savedFilters = sqliteTable('saved_filters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  mode: text('mode').notNull(), // 'MEDIA' | 'COLLECTIONS' | 'TAGS'
  filter: text('filter').notNull(), // JSON string of filter criteria
  uiOptions: text('ui_options'), // JSON string of UI state
  favorite: integer('favorite', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => {
  return {
    nameIdx: index('saved_filter_name_idx').on(table.name),
    modeIdx: index('saved_filter_mode_idx').on(table.mode),
  };
});

// Custom fields for extensibility
export const customFields = sqliteTable('custom_fields', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entityType: text('entity_type').notNull(), // 'media' | 'collection' | 'tag'
  entityId: integer('entity_id').notNull(),
  fieldName: text('field_name').notNull(),
  fieldValue: text('field_value'),
  fieldType: text('field_type').default('string'), // 'string' | 'number' | 'date' | 'boolean'
}, (table) => {
  return {
    entityIdx: uniqueIndex('custom_field_entity_idx').on(table.entityType, table.entityId, table.fieldName),
  };
});

// Error logs table for detailed error tracking
export const errorLogs = sqliteTable('error_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  service: text('service').notNull(), // 'scanner', 'thumbnail', 'watcher', 'playback'
  operation: text('operation').notNull(), // 'scan_file', 'generate_thumbnail', 'play_media'
  entityType: text('entity_type'), // 'media', 'collection', 'tag'
  entityId: integer('entity_id'),
  filePath: text('file_path'),
  errorMessage: text('error_message').notNull(),
  errorStack: text('error_stack'),
  severity: text('severity').default('error'), // 'warning', 'error', 'critical'
  contextJson: text('context_json'), // Additional context data
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  resolvedAt: integer('resolved_at', { mode: 'timestamp' }),
  resolvedBy: text('resolved_by'),
}, (table) => {
  return {
    serviceIdx: index('error_log_service_idx').on(table.service),
    entityIdx: index('error_log_entity_idx').on(table.entityType, table.entityId),
    severityIdx: index('error_log_severity_idx').on(table.severity),
    createdAtIdx: index('error_log_created_at_idx').on(table.createdAt),
  };
});

// Define relations
export const mediaItemsRelations = relations(mediaItems, ({ many }) => ({
  tags: many(mediaTags),
  collections: many(collectionMedia),
  customFields: many(customFields),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  parent: one(tags, {
    fields: [tags.parentId],
    references: [tags.id],
  }),
  children: many(tags),
  media: many(mediaTags),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  parent: one(collections, {
    fields: [collections.parentId],
    references: [collections.id],
  }),
  children: many(collections),
  coverMedia: one(mediaItems, {
    fields: [collections.coverMediaId],
    references: [mediaItems.id],
  }),
  media: many(collectionMedia),
}));

// Export types
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type ScanSession = typeof scanSessions.$inferSelect;
export type NewScanSession = typeof scanSessions.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type Collection = typeof collections.$inferSelect;
export type NewCollection = typeof collections.$inferInsert;
export type SavedFilter = typeof savedFilters.$inferSelect;
export type NewSavedFilter = typeof savedFilters.$inferInsert;
export type CustomField = typeof customFields.$inferSelect;
export type NewCustomField = typeof customFields.$inferInsert;
export type ErrorLog = typeof errorLogs.$inferSelect;
export type NewErrorLog = typeof errorLogs.$inferInsert;

// Re-export playlist schema
export { playlists, playlistItems } from './schema/playlists';
export type { Playlist, NewPlaylist, PlaylistItem, NewPlaylistItem } from './schema/playlists';

// Duplicate tracking table
export const duplicateGroups = sqliteTable('duplicate_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  checksum: text('checksum').notNull(), // Common checksum for the group
  phash: text('phash'), // Common perceptual hash
  fileSize: integer('file_size').notNull(),
  fileType: text('file_type').notNull(),
  duplicateCount: integer('duplicate_count').default(2),
  totalSize: integer('total_size'), // Total size of all duplicates
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  markedForReview: integer('marked_for_review', { mode: 'boolean' }).default(false),
}, (table) => {
  return {
    checksumIdx: index('duplicate_group_checksum_idx').on(table.checksum),
    markedIdx: index('duplicate_group_marked_idx').on(table.markedForReview),
  };
});

export const duplicateFiles = sqliteTable('duplicate_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull().references(() => duplicateGroups.id, { onDelete: 'cascade' }),
  mediaId: integer('media_id').references(() => mediaItems.id, { onDelete: 'set null' }),
  filepath: text('filepath').notNull(),
  filename: text('filename').notNull(),
  fileExists: integer('file_exists', { mode: 'boolean' }).default(true),
  lastVerified: integer('last_verified', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  suggestedForDeletion: integer('suggested_for_deletion', { mode: 'boolean' }).default(false),
  reason: text('reason'), // Why this file was suggested for deletion
}, (table) => {
  return {
    groupIdx: index('duplicate_file_group_idx').on(table.groupId),
    mediaIdx: index('duplicate_file_media_idx').on(table.mediaId),
    filepathIdx: index('duplicate_file_filepath_idx').on(table.filepath),
  };
});

// Re-export app config schema
export { appConfig, indexedFolders, folderScanCache } from './schema/appConfig';
export type { AppConfig, NewAppConfig, IndexedFolder, NewIndexedFolder, FolderScanCache, NewFolderScanCache } from './schema/appConfig';

// Export duplicate types
export type DuplicateGroup = typeof duplicateGroups.$inferSelect;
export type NewDuplicateGroup = typeof duplicateGroups.$inferInsert;
export type DuplicateFile = typeof duplicateFiles.$inferSelect;
export type NewDuplicateFile = typeof duplicateFiles.$inferInsert;