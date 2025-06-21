import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolvers } from './graphql/resolvers';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { DateTimeTypeDefinition, DateTimeResolver } from 'graphql-scalars';

// Read GraphQL schema
const typeDefs = readFileSync(join(__dirname, 'graphql/schema.graphql'), 'utf-8');

// Create executable schema
const schema = makeExecutableSchema({
  typeDefs: [DateTimeTypeDefinition, typeDefs],
  resolvers: {
    ...resolvers,
    DateTime: DateTimeResolver,
  },
});

// Create GraphQL Yoga instance
const yoga = createYoga({
  schema,
  landingPage: true,
  cors: {
    origin: '*',
    credentials: true,
  },
});

// Create and configure server
const server = Bun.serve({
  port: process.env.PORT || 4001,
  async fetch(request) {
    const url = new URL(request.url);
    
    // Serve GraphQL endpoint
    if (url.pathname.startsWith('/graphql')) {
      return yoga.fetch(request);
    }
    
    // Serve thumbnails
    if (url.pathname.startsWith('/thumbnails/')) {
      // Decode URL to handle special characters in filenames
      const thumbnailFilename = decodeURIComponent(url.pathname.replace('/thumbnails/', ''));
      const thumbnailPath = join('./thumbnails', thumbnailFilename);
      const file = Bun.file(thumbnailPath);
      
      if (await file.exists()) {
        return new Response(file, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      }
    }
    
    // Serve original media files
    if (url.pathname.startsWith('/media/')) {
      const mediaId = parseInt(url.pathname.replace('/media/', '').split('/')[0]);
      
      if (!isNaN(mediaId)) {
        const { db, schema } = await import('./db');
        const { eq } = await import('drizzle-orm');
        
        const [item] = await db.select()
          .from(schema.mediaItems)
          .where(eq(schema.mediaItems.id, mediaId))
          .limit(1);
        
        if (item) {
          const file = Bun.file(item.filepath);
          
          if (await file.exists()) {
            const range = request.headers.get('range');
            
            if (range) {
              // Handle range requests for video streaming
              const size = file.size;
              const parts = range.replace(/bytes=/, '').split('-');
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
              const chunksize = (end - start) + 1;
              
              return new Response(file.slice(start, end + 1), {
                status: 206,
                headers: {
                  'Content-Range': `bytes ${start}-${end}/${size}`,
                  'Accept-Ranges': 'bytes',
                  'Content-Length': chunksize.toString(),
                  'Content-Type': file.type || 'video/mp4',
                },
              });
            }
            
            return new Response(file, {
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'Content-Length': file.size.toString(),
              },
            });
          }
        }
      }
    }
    
    return new Response('Not Found', { status: 404 });
  },
});

// Ensure thumbnails directory exists
import { mkdir } from 'fs/promises';
await mkdir('./thumbnails', { recursive: true }).catch(() => {});

// Start media watcher if watch paths are configured
import { MediaWatcher } from './services/watcher';

const watchPaths = process.env.WATCH_PATHS?.split(',').map(p => p.trim()) || [];
let watcher: MediaWatcher | null = null;

if (watchPaths.length > 0) {
  watcher = new MediaWatcher({
    paths: watchPaths,
    debounceMs: 2000, // Wait 2 seconds after last change before processing
  });
  
  await watcher.start();
  console.log(`👁️  Watching directories: ${watchPaths.join(', ')}`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  if (watcher) {
    watcher.stop();
  }
  server.stop();
  process.exit(0);
});

console.log(`🚀 Server ready at http://localhost:${server.port}/graphql`);
console.log(`📁 Media files served at http://localhost:${server.port}/media/:id`);
console.log(`🖼️ Thumbnails served at http://localhost:${server.port}/thumbnails/:id.jpg`);