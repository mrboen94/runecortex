import { createYoga } from 'graphql-yoga';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolvers } from './graphql/resolvers';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { DateTimeTypeDefinition, DateTimeResolver } from 'graphql-scalars';
import { StreamingServer } from './services/streamingServer';
import { SSDPServer } from './services/ssdp';

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

// Get server port
const serverPort = parseInt(process.env.PORT || '4001');

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
  port: serverPort,
  hostname: '0.0.0.0', // Listen on all interfaces (IPv4)
  async fetch(request) {
    const url = new URL(request.url);
    
    // Log all incoming requests for debugging DLNA issues
    if (url.pathname !== '/graphql' && !url.pathname.startsWith('/thumbnails/') && !url.pathname.startsWith('/media/')) {
      console.log(`🌐 Request: ${request.method} ${url.pathname} from ${request.headers.get('user-agent') || 'unknown'}`);
    }
    
    // Handle all streaming server endpoints directly without Hono framework
    if (url.pathname.startsWith('/streaming') || 
        url.pathname.startsWith('/stream/') ||
        url.pathname === '/device.xml' ||
        url.pathname === '/contentdirectory.xml' ||
        url.pathname === '/control' ||
        url.pathname === '/playlist.m3u' ||
        url.pathname === '/playlist.m3u8' ||
        url.pathname === '/playlist.json') {
      
      const streamingServerInstance = (resolvers as any).streamingServer;
      
      // GET /streaming/status
      if (url.pathname === '/streaming/status' && request.method === 'GET') {
        const status = streamingServerInstance.getStreamingFolderStatus();
        return new Response(JSON.stringify(status), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      // GET /streaming/debug - Debug endpoint
      if (url.pathname === '/streaming/debug' && request.method === 'GET') {
        const items = Array.from(streamingServerInstance.currentStreamingItems.entries());
        return new Response(JSON.stringify({
          itemsMap: items,
          currentlyPlaying: streamingServerInstance.currentlyPlayingId,
          itemCount: streamingServerInstance.currentStreamingItems.size
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      // GET /streaming
      if (url.pathname === '/streaming' && request.method === 'GET') {
        // Get items in order with prefixes
        const orderedItems = streamingServerInstance.orderedItemIds
          .map(id => streamingServerInstance.currentStreamingItems.get(id))
          .filter(item => item !== undefined);
        
        const response = {
          name: 'Current Selection',
          type: 'folder',
          children: orderedItems.map((item, index) => ({
            name: `${(index + 1).toString().padStart(6, '0')} - ${item.filename}`,
            path: `/stream/${item.id}`,
            type: 'media',
            fileType: item.fileType,
            size: item.fileSize,
            duration: item.duration,
            created: item.createdAt,
            mimeType: streamingServerInstance.getContentType(item.filepath),
            isCurrentlyPlaying: item.id === streamingServerInstance.currentlyPlayingId
          }))
        };
        return new Response(JSON.stringify(response), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      // POST /streaming/update
      if (url.pathname === '/streaming/update' && request.method === 'POST') {
        try {
          const body = await request.json();
          streamingServerInstance.updateStreamingFolderFromExternal(body.mediaItems, body.currentlyPlayingId);
          
          return new Response(JSON.stringify({
            success: true,
            message: `Updated streaming folder with ${body.mediaItems.length} items`,
            totalItems: streamingServerInstance.currentStreamingItems.size,
            currentlyPlaying: streamingServerInstance.currentlyPlayingId
          }), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        } catch (error) {
          console.error('Failed to update streaming folder:', error);
          return new Response(JSON.stringify({
            success: false,
            error: 'Failed to update streaming folder'
          }), {
            status: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
      }
      
      // POST /streaming/playing/:id
      if (url.pathname.startsWith('/streaming/playing/') && request.method === 'POST') {
        const id = parseInt(url.pathname.split('/')[3]);
        streamingServerInstance.currentlyPlayingId = id;
        
        return new Response(JSON.stringify({
          success: true,
          currentlyPlaying: id
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      // DELETE /streaming/playing
      if (url.pathname === '/streaming/playing' && request.method === 'DELETE') {
        streamingServerInstance.currentlyPlayingId = null;
        
        return new Response(JSON.stringify({
          success: true,
          currentlyPlaying: null
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      // GET /stream/:id - Media streaming with range support
      if (url.pathname.startsWith('/stream/') && request.method === 'GET') {
        const mediaId = parseInt(url.pathname.split('/')[2]);
        
        if (!isNaN(mediaId)) {
          // Check if media is in current streaming items first
          const streamingItem = streamingServerInstance.currentStreamingItems.get(mediaId);
          let filepath = null;
          
          if (streamingItem && existsSync(streamingItem.filepath)) {
            filepath = streamingItem.filepath;
            // Mark as currently playing
            streamingServerInstance.currentlyPlayingId = mediaId;
          } else {
            // Fallback to database lookup
            const { db, schema } = await import('./db');
            const { eq } = await import('drizzle-orm');
            
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
                
                const fileSlice = file.slice(start, end + 1);
                const arrayBuffer = await fileSlice.arrayBuffer();
                
                return new Response(arrayBuffer, {
                  status: 206,
                  headers: {
                    'Content-Range': `bytes ${start}-${end}/${size}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunksize.toString(),
                    'Content-Type': streamingServerInstance.getContentType(filepath),
                    'Access-Control-Allow-Origin': '*',
                  },
                });
              } else {
                // Handle full file requests
                const arrayBuffer = await file.arrayBuffer();
                
                return new Response(arrayBuffer, {
                  status: 200,
                  headers: {
                    'Content-Length': size.toString(),
                    'Content-Type': streamingServerInstance.getContentType(filepath),
                    'Accept-Ranges': 'bytes',
                    'Access-Control-Allow-Origin': '*',
                  },
                });
              }
            } catch (error) {
              console.error('Streaming error:', error);
              return new Response('Internal Server Error', { status: 500 });
            }
          }
        }
        
        return new Response('Not Found', { status: 404 });
      }
      
      // GET /device.xml - DLNA device description
      if (url.pathname === '/device.xml' && request.method === 'GET') {
        console.log(`📱 DLNA device.xml requested from ${request.headers.get('user-agent') || 'unknown'}`);
        const requestHost = request.headers.get('host');
        const deviceXml = streamingServerInstance.generateDeviceDescription(requestHost || undefined);
        return new Response(deviceXml, {
          headers: {
            'Content-Type': 'text/xml',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      // GET /contentdirectory.xml - Content directory service description
      if (url.pathname === '/contentdirectory.xml' && request.method === 'GET') {
        console.log(`📋 DLNA contentdirectory.xml requested from ${request.headers.get('user-agent') || 'unknown'}`);
        const serviceXml = streamingServerInstance.generateContentDirectoryService();
        return new Response(serviceXml, {
          headers: {
            'Content-Type': 'text/xml',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
      
      
      // GET /playlist.m3u - M3U playlist
      if (url.pathname === '/playlist.m3u' && request.method === 'GET') {
        console.log(`🎵 M3U playlist requested from ${request.headers.get('user-agent') || 'unknown'}`);
        return streamingServerInstance.handleRequest(request);
      }
      
      // GET /playlist.m3u8 - M3U8 (HLS) playlist
      if (url.pathname === '/playlist.m3u8' && request.method === 'GET') {
        console.log(`🎵 M3U8 playlist requested from ${request.headers.get('user-agent') || 'unknown'}`);
        return streamingServerInstance.handleRequest(request);
      }
      
      // POST /control - SOAP endpoint for UPnP actions
      if (url.pathname === '/control' && request.method === 'POST') {
        const soapAction = request.headers.get('soapaction');
        console.log(`🎯 DLNA SOAP action requested: ${soapAction} from ${request.headers.get('user-agent') || 'unknown'}`);
        const body = await request.text();
        const requestHost = request.headers.get('host');
        
        if (soapAction?.includes('Browse')) {
          // Parse the SOAP request to get ObjectID
          const objectIdMatch = body.match(/<ObjectID>([^<]+)<\/ObjectID>/);
          const objectId = objectIdMatch ? objectIdMatch[1] : '0';
          
          // Create a minimal context object with the necessary method
          const context = {
            header: (name: string, value: string) => {},
            text: (content: string) => new Response(content, {
              headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
              },
            })
          };
          
          // Let the streaming server handle the browse action
          const response = await streamingServerInstance.handleBrowseAction(context, body, requestHost || undefined);
          return response;
        } else if (soapAction?.includes('GetSystemUpdateID')) {
          // Return the current system update ID
          const soapResponse = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:GetSystemUpdateIDResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <Id>${streamingServerInstance.systemUpdateId || 0}</Id>
    </u:GetSystemUpdateIDResponse>
  </s:Body>
</s:Envelope>`;
          
          return new Response(soapResponse, {
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          });
        }
        
        return new Response('Unsupported SOAP action', { status: 400 });
      }
      
    }
    
    // GET / - Root directory listing for DLNA browsing
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'RuneCortex Media Server',
        type: 'root',
        children: [
          { name: 'Streaming', path: '/streaming', type: 'folder' }
        ]
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
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
        // Read the file as an ArrayBuffer to avoid _Response issues
        const arrayBuffer = await file.arrayBuffer();
        return new Response(arrayBuffer, {
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000',
            'Content-Length': file.size.toString(),
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
              
              // Read the file slice as ArrayBuffer to avoid _Response issues
              const fileSlice = file.slice(start, end + 1);
              const arrayBuffer = await fileSlice.arrayBuffer();
              
              return new Response(arrayBuffer, {
                status: 206,
                headers: {
                  'Content-Range': `bytes ${start}-${end}/${size}`,
                  'Accept-Ranges': 'bytes',
                  'Content-Length': chunksize.toString(),
                  'Content-Type': file.type || 'video/mp4',
                },
              });
            }
            
            // Read the full file as ArrayBuffer to avoid _Response issues
            const arrayBuffer = await file.arrayBuffer();
            return new Response(arrayBuffer, {
              headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'Content-Length': file.size.toString(),
                'Accept-Ranges': 'bytes',
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

// Initialize streaming server (only for data management, not as separate server)
const streamingServer = new StreamingServer({
  port: serverPort, // Use the same port as the main server
  host: process.env.STREAMING_HOST || '0.0.0.0',
  name: 'RuneCortex Media Server',
  virtualFolderPath: './virtual'
});

// Make streaming server available to resolvers
(resolvers as any).streamingServer = streamingServer;

// Start SSDP discovery server
const ssdpServer = new SSDPServer(serverPort);
ssdpServer.start();

// Make SSDP server available to streaming server for notifications
streamingServer.setSSDPServer(ssdpServer);

// Start media watcher if watch paths are configured
const watchPaths = process.env.WATCH_PATHS?.split(',').map(p => p.trim()) || [];

if (watchPaths.length > 0) {
  // Use the resolver to start the watcher so it's properly tracked
  await resolvers.Mutation.startWatcher(null, { paths: watchPaths });
  console.log(`👁️  Watching directories: ${watchPaths.join(', ')}`);
} else {
  // If no watch paths configured, use a default
  const defaultPath = '/Users/mathiasboe/Projects/runecortex/images-and-video-folder-for-testing';
  await resolvers.Mutation.startWatcher(null, { paths: [defaultPath] });
  console.log(`👁️  Watching default directory: ${defaultPath}`);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  // Use the resolver to stop the watcher
  await resolvers.Mutation.stopWatcher();
  // Stop SSDP server
  ssdpServer.stop();
  server.stop();
  process.exit(0);
});

console.log(`🚀 Server ready at http://localhost:${server.port}/graphql`);
console.log(`📁 Media files served at http://localhost:${server.port}/media/:id`);
console.log(`🖼️ Thumbnails served at http://localhost:${server.port}/thumbnails/:id.jpg`);