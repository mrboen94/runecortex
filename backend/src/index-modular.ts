import { createYoga } from 'graphql-yoga';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolvers } from './graphql/resolvers';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { DateTimeTypeDefinition, DateTimeResolver } from 'graphql-scalars';
import { PluginManager } from './plugins/pluginManager';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';

// Read GraphQL schema
const typeDefs = readFileSync(join(__dirname, 'graphql/schema.graphql'), 'utf-8');

// Create executable schema
const graphqlSchema = makeExecutableSchema({
  typeDefs: [DateTimeTypeDefinition, typeDefs],
  resolvers: {
    ...resolvers,
    DateTime: DateTimeResolver,
  },
});

// Get server port
const serverPort = parseInt(process.env.PORT || '4001');

// Create GraphQL Yoga instance
const yoga = createYoga({
  schema: graphqlSchema,
  landingPage: true,
  cors: {
    origin: '*',
    credentials: true,
  },
});

// Initialize plugin manager
const pluginManager = new PluginManager();

// Make streaming server available to resolvers (for backward compatibility)
const streamingServer = pluginManager.getStreamingServer();
if (streamingServer) {
  (resolvers as any).streamingServer = streamingServer;
}

// Create and configure server
const server = Bun.serve({
  port: serverPort,
  hostname: '0.0.0.0',
  async fetch(request) {
    const url = new URL(request.url);
    
    // Log non-GraphQL requests for debugging
    if (url.pathname !== '/graphql' && 
        !url.pathname.startsWith('/thumbnails/') && 
        !url.pathname.startsWith('/media/') &&
        !url.pathname.startsWith('/static/')) {
      console.log(`🌐 Request: ${request.method} ${url.pathname} from ${request.headers.get('user-agent') || 'unknown'}`);
    }
    
    // Try plugins first
    const pluginResponse = await pluginManager.handleRequest(request);
    if (pluginResponse) {
      return pluginResponse;
    }
    
    // Handle GraphQL endpoint
    if (url.pathname === '/graphql') {
      return yoga(request);
    }
    
    // Handle thumbnail serving
    if (url.pathname.startsWith('/thumbnails/')) {
      const filename = url.pathname.split('/').pop();
      if (!filename) {
        return new Response('Not found', { status: 404 });
      }
      
      const thumbnailPath = join('./thumbnails', filename);
      if (!existsSync(thumbnailPath)) {
        return new Response('Not found', { status: 404 });
      }
      
      const file = Bun.file(thumbnailPath);
      return new Response(file, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    // Handle media file serving
    if (url.pathname.startsWith('/media/')) {
      const mediaId = parseInt(url.pathname.split('/')[2]);
      
      if (!isNaN(mediaId)) {
        const [item] = await db.select()
          .from(schema.mediaItems)
          .where(eq(schema.mediaItems.id, mediaId))
          .limit(1);
        
        if (item && existsSync(item.filepath)) {
          const file = Bun.file(item.filepath);
          const contentType = item.fileType === 'video' 
            ? `video/${item.filepath.split('.').pop()}`
            : `image/${item.filepath.split('.').pop()}`;
          
          return new Response(file, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=3600',
              'Access-Control-Allow-Origin': '*',
              'Accept-Ranges': 'bytes',
            },
          });
        }
      }
      
      return new Response('Not found', { status: 404 });
    }
    
    // Handle streaming (for backward compatibility with existing streaming server)
    if (url.pathname.startsWith('/stream/') && streamingServer) {
      const mediaId = parseInt(url.pathname.split('/')[2]);
      
      if (!isNaN(mediaId)) {
        // Check if media is in current streaming items first
        const streamingItem = streamingServer.currentStreamingItems.get(mediaId);
        let filepath = null;
        
        if (streamingItem && existsSync(streamingItem.filepath)) {
          filepath = streamingItem.filepath;
          // Mark as currently playing
          streamingServer.currentlyPlayingId = mediaId;
        } else {
          // Fallback to database lookup
          const [item] = await db.select()
            .from(schema.mediaItems)
            .where(eq(schema.mediaItems.id, mediaId))
            .limit(1);
          
          if (item && existsSync(item.filepath)) {
            filepath = item.filepath;
          }
        }
        
        if (filepath) {
          try {
            const file = Bun.file(filepath);
            const size = file.size;
            const range = request.headers.get('range');
            
            if (range) {
              // Handle range requests for video streaming
              const parts = range.replace(/bytes=/, '').split('-');
              const start = parseInt(parts[0], 10);
              const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
              const chunksize = (end - start) + 1;
              
              const stream = file.slice(start, end + 1);
              
              return new Response(stream, {
                status: 206,
                headers: {
                  'Content-Range': `bytes ${start}-${end}/${size}`,
                  'Accept-Ranges': 'bytes',
                  'Content-Length': chunksize.toString(),
                  'Content-Type': streamingServer.getContentType(filepath),
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-cache',
                },
              });
            } else {
              // Full file request
              const contentType = streamingServer.getContentType(filepath);
              return new Response(file, {
                headers: {
                  'Content-Length': size.toString(),
                  'Content-Type': contentType,
                  'Accept-Ranges': 'bytes',
                  'Access-Control-Allow-Origin': '*',
                  'Cache-Control': 'no-cache',
                },
              });
            }
          } catch (error) {
            console.error(`Error streaming file ${filepath}:`, error);
            return new Response('Internal server error', { status: 500 });
          }
        }
      }
      
      return new Response('Not found', { status: 404 });
    }
    
    // Fallback
    return new Response('Not found', { status: 404 });
  },
});

// Start all plugins
await pluginManager.startAll();

// Initialize media watcher if enabled
const watcherEnabled = process.env.WATCHER_ENABLED !== 'false';
if (watcherEnabled) {
  const enabledFolders = await db.select()
    .from(schema.indexedFolders)
    .where(eq(schema.indexedFolders.enabled, true));

  if (enabledFolders.length > 0) {
    await resolvers.Mutation.toggleWatcher(null, { enabled: true });
    console.log(`👁️  Watcher enabled. Watching ${enabledFolders.length} directories`);
  } else {
    console.log(`👁️  Watcher enabled but no folders configured`);
  }
} else {
  console.log(`👁️  Watcher is disabled`);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  
  // Stop watcher
  await resolvers.Mutation.stopWatcher();
  
  // Stop all plugins
  await pluginManager.stopAll();
  
  // Stop server
  server.stop();
  process.exit(0);
});

// Log server info
console.log(`🚀 Server ready at http://localhost:${server.port}/graphql`);
console.log(`📁 Media files served at http://localhost:${server.port}/media/:id`);
console.log(`🖼️ Thumbnails served at http://localhost:${server.port}/thumbnails/:id.jpg`);

// Log plugin status
const pluginStatus = pluginManager.getStatus();
console.log(`\n🔌 Plugin Status:`);
for (const [plugin, enabled] of Object.entries(pluginStatus)) {
  console.log(`  ${enabled ? '✅' : '❌'} ${plugin}`);
}