// Bun test configuration
import { beforeAll } from 'bun:test';

// Set test environment variables before any imports
process.env.DATABASE_PATH = './test.db';
process.env.NODE_ENV = 'test';
process.env.DISABLE_THUMBNAILS = 'true';

// Ensure test database is clean
beforeAll(async () => {
  const { $spawn } = await import('bun');
  
  // Remove old test database
  await $spawn(['rm', '-f', 'test.db', 'test.db-shm', 'test.db-wal']);
  
  // Run migrations
  await $spawn(['bun', 'run', 'db:migrate']);
});

export default {
  // Test patterns
  testMatch: ['**/*.test.ts'],
  
  // Setup files
  setupFilesAfterEnv: ['./tests/test-env.ts'],
  
  // Coverage
  coverageDirectory: './coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
};