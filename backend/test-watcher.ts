#!/usr/bin/env bun

// Test script to demonstrate the file watcher functionality

const GRAPHQL_URL = 'http://localhost:4001/graphql';
const TEST_FOLDER = '/Users/mathiasboe/Projects/runecortex/images-and-video-folder-for-testing';

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

async function main() {
  console.log('Testing RuneCortex File Watcher...\n');

  // Check current watcher status
  console.log('1. Checking current watcher status...');
  const statusQuery = `
    query {
      watcherStatus {
        isActive
        watchPaths
        lastProcessed
      }
    }
  `;
  
  const status = await query(statusQuery);
  console.log('Current status:', status.watcherStatus);

  // Start the watcher
  console.log('\n2. Starting watcher for test folder...');
  const startMutation = `
    mutation StartWatcher($paths: [String!]!) {
      startWatcher(paths: $paths) {
        isActive
        watchPaths
        lastProcessed
      }
    }
  `;
  
  const started = await query(startMutation, { paths: [TEST_FOLDER] });
  console.log('Watcher started:', started.startWatcher);

  console.log('\n3. Watcher is now active!');
  console.log('Try adding, modifying, or deleting files in:');
  console.log(`   ${TEST_FOLDER}`);
  console.log('\nThe watcher will automatically:');
  console.log('- Detect new media files');
  console.log('- Process metadata');
  console.log('- Generate thumbnails');
  console.log('- Update the database');

  console.log('\n4. To stop the watcher, run:');
  console.log('   mutation { stopWatcher }');

  // Query recent scan sessions
  console.log('\n5. Recent scan sessions:');
  const sessionsQuery = `
    query {
      recentScanSessions(limit: 3) {
        id
        timestamp
        filesProcessed
        newFiles
        status
      }
    }
  `;
  
  const sessions = await query(sessionsQuery);
  console.log(JSON.stringify(sessions.recentScanSessions, null, 2));
}

main().catch(console.error);