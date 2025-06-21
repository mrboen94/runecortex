#!/usr/bin/env bun

// Test script to demonstrate the thumbnail queue system

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

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Testing RuneCortex Thumbnail Queue System...\n');

  // Check current queue status
  console.log('1. Checking thumbnail queue status...');
  const statusQuery = `
    query {
      thumbnailQueueStatus {
        status
        queueSize
        stats {
          totalQueued
          processed
          failed
          skipped
        }
        lastPing
        lastRun
        nextRun
      }
    }
  `;
  
  let status = await query(statusQuery);
  console.log('Current status:', JSON.stringify(status.thumbnailQueueStatus, null, 2));

  // Find media items without thumbnails
  console.log('\n2. Finding media items without thumbnails...');
  const mediaQuery = `
    query {
      allMedia(limit: 100) {
        id
        filename
        thumbnailUrl
      }
    }
  `;
  
  const media = await query(mediaQuery);
  const withoutThumbnails = media.allMedia.filter((m: any) => !m.thumbnailUrl);
  console.log(`Found ${withoutThumbnails.length} media items without thumbnails`);

  if (withoutThumbnails.length > 0) {
    // Ping the queue to generate thumbnails
    console.log('\n3. Pinging thumbnail queue...');
    const pingMutation = `
      mutation {
        pingThumbnailQueue {
          status
          queueSize
          nextRun
        }
      }
    `;
    
    const pingResult = await query(pingMutation);
    console.log('Queue after ping:', pingResult.pingThumbnailQueue);

    // Monitor the queue
    console.log('\n4. Monitoring queue progress...');
    console.log('The queue will wait 1 minute before processing (configurable via THUMBNAIL_DEBOUNCE_MINUTES)');
    console.log('Then process up to 20 items with 4 concurrent workers (configurable)\n');

    let lastStatus = pingResult.pingThumbnailQueue.status;
    let checkCount = 0;
    
    while (checkCount < 15) { // Check for up to 2.5 minutes
      await sleep(10000); // Check every 10 seconds
      
      status = await query(statusQuery);
      const currentStatus = status.thumbnailQueueStatus;
      
      if (currentStatus.status !== lastStatus) {
        console.log(`Status changed: ${lastStatus} -> ${currentStatus.status}`);
        lastStatus = currentStatus.status;
      }
      
      console.log(`[${new Date().toTimeString().split(' ')[0]}] Status: ${currentStatus.status}, Queue: ${currentStatus.queueSize}, Processed: ${currentStatus.stats.processed}`);
      
      if (currentStatus.status === 'idle' && currentStatus.queueSize === 0 && currentStatus.stats.processed > 0) {
        console.log('\nQueue processing complete!');
        break;
      }
      
      checkCount++;
    }

    // Final status
    console.log('\n5. Final queue statistics:');
    status = await query(statusQuery);
    console.log(JSON.stringify(status.thumbnailQueueStatus.stats, null, 2));
  }

  console.log('\n6. Key features of the thumbnail queue:');
  console.log('   - Batches requests with debouncing (waits after last ping)');
  console.log('   - Cooldown period between runs to prevent overload');
  console.log('   - Parallel processing with worker pool');
  console.log('   - Preserves thumbnails even when files are deleted');
  console.log('   - Automatic retry via periodic checks');
  console.log('\n   Environment variables:');
  console.log('   - THUMBNAIL_DEBOUNCE_MINUTES (default: 1)');
  console.log('   - THUMBNAIL_COOLDOWN_MINUTES (default: 5)');
  console.log('   - THUMBNAIL_MAX_CONCURRENT (default: 4)');
  console.log('   - THUMBNAIL_BATCH_SIZE (default: 20)');
}

main().catch(console.error);