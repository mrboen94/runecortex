import { JellyfinPlugin } from './jellyfin';
import { StreamingServer } from '../services/streamingServer';
import { SSDPServer } from '../services/ssdp';

export interface Plugin {
  name: string;
  enabled: boolean;
  handleRequest?: (request: Request) => Promise<Response | null>;
  start?: () => Promise<void>;
  stop?: () => Promise<void>;
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private jellyfinPlugin: JellyfinPlugin;
  private streamingServer: StreamingServer;
  private ssdpServer: SSDPServer | null = null;
  
  constructor() {
    // Always initialize streaming server for core functionality
    const serverPort = parseInt(process.env.PORT || '4001');
    this.streamingServer = new StreamingServer({
      port: serverPort,
      host: process.env.STREAMING_HOST || '0.0.0.0',
      name: process.env.SERVER_NAME || 'RuneCortex Media Server',
      virtualFolderPath: './virtual'
    });
    
    // Initialize plugins based on environment variables
    this.initializePlugins();
  }
  
  private initializePlugins() {
    // Jellyfin API Plugin
    this.jellyfinPlugin = new JellyfinPlugin();
    // Give Jellyfin plugin access to streaming server
    this.jellyfinPlugin.setStreamingServer(this.streamingServer);
    if (this.jellyfinPlugin.isEnabled()) {
      this.plugins.set('jellyfin', {
        name: 'Jellyfin API',
        enabled: true,
        handleRequest: (req) => this.jellyfinPlugin.handleRequest(req)
      });
    }
    
    // DLNA/UPnP Server Plugin
    const dlnaEnabled = process.env.DLNA_ENABLED !== 'false'; // Default to true for backward compatibility
    if (dlnaEnabled) {
      this.plugins.set('dlna', {
        name: 'DLNA/UPnP Server',
        enabled: true,
        start: async () => {
          // StreamingServer doesn't need separate start anymore
          // It's integrated into the main server
        },
        stop: async () => {
          // No separate stop needed
        }
      });
    }
    
    // M3U Playlist Plugin
    const m3uEnabled = process.env.M3U_ENABLED !== 'false'; // Default to true
    if (m3uEnabled) {
      this.plugins.set('m3u', {
        name: 'M3U/M3U8 Playlist Generator',
        enabled: true,
        // M3U is handled by streaming server routes
      });
    }
    
    // SSDP Discovery Plugin (for DLNA)
    if (dlnaEnabled && process.env.SSDP_ENABLED !== 'false') {
      const serverPort = parseInt(process.env.PORT || '4001');
      this.ssdpServer = new SSDPServer(serverPort);
      
      // Link SSDP server to streaming server
      if (this.streamingServer) {
        this.streamingServer.setSSDPServer(this.ssdpServer);
      }
      
      this.plugins.set('ssdp', {
        name: 'SSDP Discovery Service',
        enabled: true,
        start: async () => {
          if (this.ssdpServer) {
            this.ssdpServer.start();
          }
        },
        stop: async () => {
          if (this.ssdpServer) {
            this.ssdpServer.stop();
          }
        }
      });
    }
  }
  
  // Handle HTTP requests through plugins
  async handleRequest(request: Request): Promise<Response | null> {
    const url = new URL(request.url);
    
    // Try Jellyfin plugin first if enabled
    const jellyfinPlugin = this.plugins.get('jellyfin');
    if (jellyfinPlugin?.enabled && jellyfinPlugin.handleRequest) {
      const response = await jellyfinPlugin.handleRequest(request);
      if (response) return response;
    }
    
    // Handle streaming server routes (always available for core functionality)
    if (this.streamingServer) {
      // Core streaming routes (always available)
      if (url.pathname.startsWith('/streaming') || 
          url.pathname.startsWith('/stream/')) {
        return await this.handleStreamingRequest(request);
      }
      
      // DLNA-specific routes (only if DLNA is enabled)
      if (this.plugins.get('dlna')?.enabled) {
        if (url.pathname === '/device.xml' ||
            url.pathname === '/contentdirectory.xml' ||
            url.pathname === '/control') {
          return await this.handleStreamingRequest(request);
        }
      }
    }
    
    // Handle M3U playlist routes if enabled
    if (this.plugins.get('m3u')?.enabled) {
      if (url.pathname === '/playlist.m3u' ||
          url.pathname === '/playlist.m3u8' ||
          url.pathname === '/playlist.json') {
        return await this.handlePlaylistRequest(request);
      }
    }
    
    return null;
  }
  
  // Handle streaming server requests
  private async handleStreamingRequest(request: Request): Promise<Response | null> {
    if (!this.streamingServer) return null;
    
    const url = new URL(request.url);
    const streamingServerInstance = this.streamingServer;
    
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
    
    // GET /streaming/debug
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
        return new Response(JSON.stringify({ error: 'Failed to update streaming folder' }), {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }
    }
    
    // GET /device.xml - Device description
    if (url.pathname === '/device.xml' && request.method === 'GET') {
      console.log(`📋 DLNA device.xml requested from ${request.headers.get('user-agent') || 'unknown'}`);
      const requestHost = request.headers.get('host');
      const deviceXml = streamingServerInstance.generateDeviceDescription(requestHost || undefined);
      return new Response(deviceXml, {
        headers: {
          'Content-Type': 'text/xml',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    // GET /contentdirectory.xml - Content directory service
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
    
    // POST /control - SOAP endpoint
    if (url.pathname === '/control' && request.method === 'POST') {
      const soapAction = request.headers.get('soapaction');
      console.log(`🎯 DLNA SOAP action requested: ${soapAction} from ${request.headers.get('user-agent') || 'unknown'}`);
      const body = await request.text();
      const requestHost = request.headers.get('host');
      
      if (soapAction?.includes('Browse')) {
        // Create a minimal context object
        const context = {
          header: (name: string, value: string) => {},
          text: (content: string) => new Response(content, {
            headers: {
              'Content-Type': 'text/xml; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          })
        };
        
        const response = await streamingServerInstance.handleBrowseAction(context, body, requestHost || undefined);
        return response;
      }
      
      return new Response('Not implemented', { status: 501 });
    }
    
    return null;
  }
  
  // Handle playlist requests
  private async handlePlaylistRequest(request: Request): Promise<Response | null> {
    if (!this.streamingServer) return null;
    
    const url = new URL(request.url);
    console.log(`🎵 Playlist requested: ${url.pathname} from ${request.headers.get('user-agent') || 'unknown'}`);
    
    return this.streamingServer.handleRequest(request);
  }
  
  // Start all enabled plugins
  async startAll() {
    console.log('🔌 Starting plugins...');
    
    for (const [name, plugin] of this.plugins) {
      if (plugin.enabled && plugin.start) {
        console.log(`  ▶️  Starting ${plugin.name}...`);
        await plugin.start();
      }
    }
    
    // Log enabled plugins
    const enabledPlugins = Array.from(this.plugins.entries())
      .filter(([_, plugin]) => plugin.enabled)
      .map(([_, plugin]) => plugin.name);
    
    if (enabledPlugins.length > 0) {
      console.log(`✅ Enabled plugins: ${enabledPlugins.join(', ')}`);
    }
  }
  
  // Stop all plugins
  async stopAll() {
    for (const [name, plugin] of this.plugins) {
      if (plugin.enabled && plugin.stop) {
        await plugin.stop();
      }
    }
  }
  
  // Get plugin status
  getStatus() {
    const status: Record<string, boolean> = {
      streaming: true  // Core feature, always enabled
    };
    for (const [name, plugin] of this.plugins) {
      status[name] = plugin.enabled;
    }
    return status;
  }
  
  // Get streaming server instance (always available)
  getStreamingServer(): StreamingServer {
    return this.streamingServer;
  }
}