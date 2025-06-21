#!/bin/bash

# Clean test environment
echo "🧹 Cleaning test environment..."
rm -rf test.db test.db-shm test.db-wal test-media test-thumbnails

# Set test environment
export DATABASE_PATH=./test.db
export NODE_ENV=test
export DISABLE_THUMBNAILS=true

# Run migrations
echo "🗄️  Setting up test database..."
bun run db:migrate

# Run tests
echo "🧪 Running tests..."
bun test "$@"

# Clean up after tests
echo "🧹 Cleaning up..."
rm -rf test.db test.db-shm test.db-wal test-media test-thumbnails

echo "✅ Tests complete!"