# Testing Guide for RuneCortex Backend

## Quick Start

Run all tests:
```bash
./run-tests.sh
```

Run specific test file:
```bash
./run-tests.sh scanner.test.ts
```

## Test Structure

### Test Files
- `tests/basic.test.ts` - Basic database operations
- `tests/scanner.test.ts` - Media scanner with duplicate detection
- `tests/thumbnailQueue.test.ts` - Thumbnail queue management
- `tests/autoTagging.test.ts` - Auto-tagging rules and smart tags
- `tests/filterService.test.ts` - Complex filtering logic
- `tests/batchOperations.test.ts` - Batch operations
- `tests/statistics.test.ts` - Dashboard statistics
- `tests/organizationRules.test.ts` - Automated organization
- `tests/tagService.test.ts` - Tag management
- `tests/collectionService.test.ts` - Collection management

### Test Helpers
- `tests/setup.ts` - Common test utilities
- `tests/mockFFmpeg.ts` - FFmpeg/FFprobe mocking
- `tests/test-env.ts` - Test environment setup
- `tests/test.config.ts` - Test configuration

## FFmpeg in Tests

By default, tests use mocked FFmpeg responses for speed and reliability.

### Using Real FFmpeg
```bash
export USE_REAL_FFMPEG=true
./run-tests.sh
```

### Using Docker FFmpeg
```bash
export USE_DOCKER_FFMPEG=true
./run-tests.sh
```

See `tests/ffmpeg-setup.md` for detailed setup instructions.

## Environment Variables

### Test Database
- `DATABASE_PATH` - Test database location (default: `./test.db`)
- `KEEP_TEST_DB` - Keep database after tests (default: false)

### Test Behavior
- `SKIP_SLOW_TESTS` - Skip slow-running tests
- `VERBOSE_TESTS` - Enable verbose logging
- `FAIL_FAST` - Stop on first failure

### Test Categories
- `TEST_CATEGORY=unit` - Run only unit tests
- `TEST_CATEGORY=integration` - Run only integration tests
- `TEST_CATEGORY=e2e` - Run only end-to-end tests

## Writing Tests

### Basic Test Template
```typescript
import { describe, test, expect, beforeEach } from 'bun:test';
import { cleanDatabase, insertTestMedia } from './setup';

describe('MyService', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  test('should do something', async () => {
    const media = await insertTestMedia({ filename: 'test.jpg' });
    expect(media.filename).toBe('test.jpg');
  });
});
```

### Mocking External Services
```typescript
import { setupFFmpegMocks } from './mockFFmpeg';

describe('Service with FFmpeg', () => {
  let cleanup: () => void;

  beforeEach(() => {
    cleanup = setupFFmpegMocks();
  });

  afterEach(() => {
    cleanup();
  });
});
```

## Common Issues

### Database Schema Mismatch
If tests fail with "no such column" errors:
```bash
bun drizzle-kit generate
./run-tests.sh
```

### Test Files Persisting
The `run-tests.sh` script automatically cleans up test artifacts.
To manually clean:
```bash
rm -rf test.db test.db-shm test.db-wal test-media test-thumbnails
```

### FFmpeg Not Found
Install FFmpeg locally or use mocks:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Or use mocks (default)
unset USE_REAL_FFMPEG
```

## Coverage Reports

Generate coverage report:
```bash
bun test --coverage
```

## CI/CD Integration

The tests are designed to run in CI environments:
```yaml
- name: Run tests
  run: |
    bun install
    bun run db:generate
    ./run-tests.sh
```

## Immediate Mode Note

The thumbnail queue tests include a TODO for implementing immediate mode,
which would bypass debouncing for tethered shooting scenarios where
photographers need instant thumbnail generation.

To implement:
1. Add `THUMBNAIL_IMMEDIATE_MODE` environment variable
2. Modify ThumbnailQueue to check this flag
3. Skip debounce timer when enabled
4. Process thumbnails immediately while respecting worker limits