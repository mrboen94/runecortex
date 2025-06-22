import { db, schema } from '../db';
import { isNotNull } from 'drizzle-orm';

async function checkLocationData() {
  const itemsWithLocation = await db.select()
    .from(schema.mediaItems)
    .where(isNotNull(schema.mediaItems.latitude));
  
  console.log(`Items with location data: ${itemsWithLocation.length}`);
  
  if (itemsWithLocation.length > 0) {
    console.log('\nSample items with location:');
    itemsWithLocation.slice(0, 5).forEach(item => {
      console.log(`- ${item.filename}: ${item.latitude}, ${item.longitude} ${item.altitude ? `(${item.altitude}m)` : ''}`);
    });
  }
  
  const totalItems = await db.select().from(schema.mediaItems);
  console.log(`\nTotal items: ${totalItems.length}`);
  console.log(`Items without location: ${totalItems.length - itemsWithLocation.length}`);
}

checkLocationData().then(() => process.exit(0));