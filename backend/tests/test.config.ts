/**
 * Test configuration
 */
export const testConfig = {
  // FFmpeg settings
  ffmpeg: {
    // Use real ffmpeg if available (default: false - use mocks)
    useReal: process.env.USE_REAL_FFMPEG === 'true',
    
    // Use Docker for ffmpeg (default: false)
    useDocker: process.env.USE_DOCKER_FFMPEG === 'true',
    
    // Timeout for ffmpeg operations in tests (ms)
    timeout: parseInt(process.env.FFMPEG_TEST_TIMEOUT || '5000'),
  },
  
  // Database settings
  database: {
    // Path to test database
    path: process.env.TEST_DB_PATH || './test.db',
    
    // Clean database between tests
    cleanBetweenTests: process.env.KEEP_TEST_DB !== 'true',
  },
  
  // File system settings
  filesystem: {
    // Test media directory
    mediaDir: process.env.TEST_MEDIA_DIR || './test-media',
    
    // Test thumbnails directory
    thumbnailsDir: process.env.TEST_THUMBNAILS_DIR || './test-thumbnails',
    
    // Clean directories after tests
    cleanAfterTests: process.env.KEEP_TEST_FILES !== 'true',
  },
  
  // Test behavior
  behavior: {
    // Skip slow tests
    skipSlowTests: process.env.SKIP_SLOW_TESTS === 'true',
    
    // Verbose logging
    verbose: process.env.VERBOSE_TESTS === 'true',
    
    // Fail fast on first error
    failFast: process.env.FAIL_FAST === 'true',
  },
  
  // Mock settings
  mocks: {
    // Mock external services
    mockExternalServices: process.env.MOCK_EXTERNAL !== 'false',
    
    // Mock file system operations
    mockFileSystem: process.env.MOCK_FS === 'true',
    
    // Mock database operations
    mockDatabase: process.env.MOCK_DB === 'true',
  }
};

/**
 * Helper to check if we should skip a test
 */
export function shouldSkipTest(testType: 'slow' | 'integration' | 'external'): boolean {
  switch (testType) {
    case 'slow':
      return testConfig.behavior.skipSlowTests;
    case 'integration':
      return process.env.SKIP_INTEGRATION_TESTS === 'true';
    case 'external':
      return process.env.SKIP_EXTERNAL_TESTS === 'true';
    default:
      return false;
  }
}

/**
 * Test categories for conditional execution
 */
export const testCategories = {
  unit: process.env.TEST_CATEGORY === 'unit' || !process.env.TEST_CATEGORY,
  integration: process.env.TEST_CATEGORY === 'integration' || !process.env.TEST_CATEGORY,
  e2e: process.env.TEST_CATEGORY === 'e2e',
  performance: process.env.TEST_CATEGORY === 'performance',
};

/**
 * Log test configuration on startup
 */
export function logTestConfig() {
  if (testConfig.behavior.verbose) {
    console.log('🧪 Test Configuration:');
    console.log('  FFmpeg:', 
      testConfig.ffmpeg.useReal ? 'Real' : 
      testConfig.ffmpeg.useDocker ? 'Docker' : 'Mocked'
    );
    console.log('  Database:', testConfig.database.path);
    console.log('  Clean between tests:', testConfig.database.cleanBetweenTests);
    console.log('  Test categories:', Object.entries(testCategories)
      .filter(([_, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ')
    );
  }
}