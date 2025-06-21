#!/usr/bin/env bun

// Simple test runner to ensure clean state
import { $ } from 'bun';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';

async function cleanTestEnvironment() {
  console.log('Cleaning test environment...');
  
  // Remove test database
  if (existsSync('./test.db')) {
    await rm('./test.db', { force: true });
  }
  
  // Remove test directories
  if (existsSync('./test-media')) {
    await rm('./test-media', { recursive: true, force: true });
  }
  
  if (existsSync('./test-thumbnails')) {
    await rm('./test-thumbnails', { recursive: true, force: true });
  }
  
  console.log('Test environment cleaned');
}

async function runTests() {
  try {
    await cleanTestEnvironment();
    
    // Run specific test file or all tests
    const testFile = process.argv[2];
    const command = testFile ? `bun test ${testFile}` : 'bun test';
    
    console.log(`Running: ${command}`);
    await $`${command}`;
  } catch (error) {
    console.error('Tests failed:', error);
    process.exit(1);
  } finally {
    // Clean up after tests
    await cleanTestEnvironment();
  }
}

runTests();