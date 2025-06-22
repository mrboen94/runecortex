import { db } from './src/db/index';
import { mediaItems } from './src/db/schema';
import { eq } from 'drizzle-orm';

// Test locations for demonstration
const testLocations = [
  { lat: 37.7749, lon: -122.4194, name: "San Francisco, CA" }, // San Francisco
  { lat: 40.7128, lon: -74.0060, name: "New York, NY" }, // New York
  { lat: 51.5074, lon: -0.1278, name: "London, UK" }, // London
  { lat: 48.8566, lon: 2.3522, name: "Paris, France" }, // Paris
  { lat: 35.6762, lon: 139.6503, name: "Tokyo, Japan" }, // Tokyo
];

async function addTestGPSData() {
  try {
    // Get first 10 images
    const images = await db.select()
      .from(mediaItems)
      .where(eq(mediaItems.fileType, 'image'))
      .limit(10);
    
    console.log(`Found ${images.length} images to update`);
    
    // Update each image with a test location
    for (let i = 0; i < images.length && i < testLocations.length; i++) {
      const image = images[i];
      const location = testLocations[i % testLocations.length];
      
      await db.update(mediaItems)
        .set({
          latitude: location.lat,
          longitude: location.lon,
          altitude: Math.random() * 500 + 50, // Random altitude between 50-550m
          locationName: location.name
        })
        .where(eq(mediaItems.id, image.id));
      
      console.log(`Updated ${image.filename} with location: ${location.name}`);
    }
    
    console.log('Test GPS data added successfully!');
  } catch (error) {
    console.error('Error adding test GPS data:', error);
  }
  process.exit(0);
}

addTestGPSData();