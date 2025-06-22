import { db, schema } from '../db';
import { isNull } from 'drizzle-orm';
import { $ } from 'bun';

// Script to extract location data from existing media items
async function extractLocationData() {
  console.log('Extracting location data from existing media items...');
  
  try {
    // Get all media items without location data
    const mediaItems = await db.select()
      .from(schema.mediaItems)
      .where(isNull(schema.mediaItems.latitude));
    
    console.log(`Found ${mediaItems.length} media items without location data`);
    
    let updated = 0;
    let withLocation = 0;
    
    for (const item of mediaItems) {
      if (item.fileType === 'image') {
        try {
          // Check if exiftool is available
          const exiftoolExists = await $`which exiftool`.quiet().then(() => true).catch(() => false);
          
          if (exiftoolExists) {
            // Use exiftool to extract GPS data
            const result = await $`exiftool -j -GPSLatitude -GPSLongitude -GPSLatitudeRef -GPSLongitudeRef -GPSAltitude -GPSAltitudeRef "${item.filepath}"`.json();
            
            if (result && result[0]) {
              const exifData = result[0];
              const gpsData = extractGPSFromExif(exifData);
              
              if (gpsData) {
                await db.update(schema.mediaItems)
                  .set({
                    latitude: gpsData.latitude,
                    longitude: gpsData.longitude,
                    altitude: gpsData.altitude
                  })
                  .where(schema.mediaItems.id === item.id);
                
                console.log(`Updated ${item.filename} with location: ${gpsData.latitude}, ${gpsData.longitude}`);
                withLocation++;
              }
            }
          }
          
          updated++;
        } catch (error) {
          console.error(`Error processing ${item.filename}:`, error);
        }
      }
    }
    
    console.log(`\nProcessed ${updated} items, found location data for ${withLocation} items`);
  } catch (error) {
    console.error('Error extracting location data:', error);
    process.exit(1);
  }
}

function extractGPSFromExif(exifData: any): { latitude: number; longitude: number; altitude?: number } | null {
  try {
    let latitude: number | null = null;
    let longitude: number | null = null;
    let altitude: number | null = null;
    
    // Method 1: Decimal degrees
    if (typeof exifData.GPSLatitude === 'number' && typeof exifData.GPSLongitude === 'number') {
      latitude = exifData.GPSLatitude;
      longitude = exifData.GPSLongitude;
    }
    // Method 2: DMS format
    else if (exifData.GPSLatitude && exifData.GPSLongitude && 
             exifData.GPSLatitudeRef && exifData.GPSLongitudeRef) {
      latitude = convertDMSToDecimal(exifData.GPSLatitude, exifData.GPSLatitudeRef);
      longitude = convertDMSToDecimal(exifData.GPSLongitude, exifData.GPSLongitudeRef);
    }
    
    // Extract altitude
    if (exifData.GPSAltitude !== undefined) {
      altitude = parseFloat(exifData.GPSAltitude);
      if (exifData.GPSAltitudeRef === '1' || exifData.GPSAltitudeRef === 1) {
        altitude = -altitude;
      }
    }
    
    if (latitude === null || longitude === null) {
      return null;
    }
    
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return null;
    }
    
    const result: { latitude: number; longitude: number; altitude?: number } = {
      latitude,
      longitude
    };
    
    if (altitude !== null) {
      result.altitude = altitude;
    }
    
    return result;
  } catch (error) {
    return null;
  }
}

function convertDMSToDecimal(dmsString: string, ref: string): number {
  try {
    let dms = dmsString;
    
    // Extract degrees, minutes, seconds
    const dmsMatch = dms.match(/(\d+)\s*deg\s*(\d+)'\s*([\d.]+)"/);
    if (!dmsMatch) {
      const parts = dms.split(/[°'"]/);
      if (parts.length >= 3) {
        const degrees = parseFloat(parts[0]);
        const minutes = parseFloat(parts[1]);
        const seconds = parseFloat(parts[2]);
        
        let decimal = degrees + minutes / 60 + seconds / 3600;
        
        if (ref === 'S' || ref === 'W') {
          decimal = -decimal;
        }
        
        return decimal;
      }
    } else {
      const degrees = parseFloat(dmsMatch[1]);
      const minutes = parseFloat(dmsMatch[2]);
      const seconds = parseFloat(dmsMatch[3]);
      
      let decimal = degrees + minutes / 60 + seconds / 3600;
      
      if (ref === 'S' || ref === 'W') {
        decimal = -decimal;
      }
      
      return decimal;
    }
    
    return 0;
  } catch (error) {
    return 0;
  }
}

extractLocationData().then(() => {
  console.log('Done!');
  process.exit(0);
});