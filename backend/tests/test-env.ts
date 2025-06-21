// Set test environment before importing anything else
process.env.DATABASE_PATH = './test.db';
process.env.NODE_ENV = 'test';

// Disable thumbnail generation in tests
process.env.DISABLE_THUMBNAILS = 'true';

console.log('Test environment configured');