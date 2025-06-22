import { db, schema } from '../db';
import { isNull } from 'drizzle-orm';

// Script to update existing media items with their source path based on current watch path
async function updateSourcePaths() {
  const currentWatchPath = process.env.WATCH_PATHS || '/Users/mathiasboe/Projects/runecortex/images-and-video-folder-for-testing';
  
  console.log(`Updating media items with source path: ${currentWatchPath}`);
  
  try {
    // Update all media items that don't have a sourcePath
    const result = await db.update(schema.mediaItems)
      .set({ sourcePath: currentWatchPath })
      .where(isNull(schema.mediaItems.sourcePath));
    
    console.log('Successfully updated media items with source path');
  } catch (error) {
    console.error('Error updating source paths:', error);
    process.exit(1);
  }
}

updateSourcePaths().then(() => {
  console.log('Done!');
  process.exit(0);
});