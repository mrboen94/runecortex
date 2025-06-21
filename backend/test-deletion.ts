#!/usr/bin/env bun

// Test script to demonstrate file deletion handling

const GRAPHQL_URL = 'http://localhost:4001/graphql';

async function query(query: string, variables?: any) {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  
  const result = await response.json();
  if (result.errors) {
    console.error('GraphQL errors:', result.errors);
  }
  return result.data;
}

async function testFileAccess(mediaId: number) {
  try {
    const response = await fetch(`http://localhost:4001/media/${mediaId}`);
    return {
      status: response.status,
      statusText: response.statusText
    };
  } catch (error) {
    return { status: 0, statusText: 'Network error' };
  }
}

async function main() {
  console.log('Testing File Deletion Handling...\n');

  // Get a sample media item
  const mediaQuery = `
    query {
      allMedia(limit: 1) {
        id
        filename
        filepath
        thumbnailUrl
      }
    }
  `;
  
  const result = await query(mediaQuery);
  
  if (result.allMedia.length === 0) {
    console.log('No media files found in database');
    return;
  }

  const testFile = result.allMedia[0];
  console.log('Test file:', testFile);

  // Check if we can access the file
  console.log('\n1. Testing file access before deletion:');
  const beforeAccess = await testFileAccess(testFile.id);
  console.log(`   Media endpoint: ${beforeAccess.status} ${beforeAccess.statusText}`);
  
  // Check thumbnail
  const thumbnailResponse = await fetch(`http://localhost:4001${testFile.thumbnailUrl}`);
  console.log(`   Thumbnail: ${thumbnailResponse.status} ${thumbnailResponse.statusText}`);

  console.log('\n2. File deletion behavior:');
  console.log('   When a file is deleted from the source folder:');
  console.log('   - The watcher will detect the deletion');
  console.log('   - The file will be removed from the database');
  console.log('   - The thumbnail will be preserved');
  console.log('   - The media endpoint will return 404');
  console.log('   - The thumbnail will still be accessible');

  console.log('\n3. To test deletion:');
  console.log(`   Delete this file: ${testFile.filepath}`);
  console.log('   Then check:');
  console.log(`   - Media URL: http://localhost:4001/media/${testFile.id} (should be 404)`);
  console.log(`   - Thumbnail: http://localhost:4001${testFile.thumbnailUrl} (should still work)`);

  console.log('\n4. Watcher improvements:');
  console.log('   - Automatic deletion detection');
  console.log('   - Periodic checks every 5 minutes for missed files');
  console.log('   - Thumbnail preservation for re-uploads');
  console.log('   - File existence check before serving');
}

main().catch(console.error);