import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { db, schema } from '../db';
import { eq, sql } from 'drizzle-orm';

export interface StreamingServerConfig {
  port: number;
  host?: string;
  name: string;
  virtualFolderPath: string;
}

interface StreamingMediaItem {
  id: number;
  filename: string;
  filepath: string;
  fileType: string;
  createdAt: string;
  fileSize: number;
  duration?: number;
  width: number;
  height: number;
  thumbnailId?: string;
  isCurrentlyPlaying?: boolean;
}

interface UpdateStreamingFolderRequest {
  mediaItems: StreamingMediaItem[];
  currentlyPlayingId?: number;
}

export class StreamingServer {
  public app: Hono; // Make app public for direct access
  private server: any;
  private config: StreamingServerConfig;
  private isRunning = false;
  public currentStreamingItems: Map<number, StreamingMediaItem> = new Map(); // Make public for direct access
  public orderedItemIds: number[] = []; // Maintain order from frontend
  public currentlyPlayingId: number | null = null; // Make public for direct access
  public systemUpdateId: number = 0; // Track content changes for DLNA
  private ssdpServer: any = null; // Reference to SSDP server for notifications

  constructor(config: StreamingServerConfig) {
    this.config = config;
    this.app = new Hono();
    this.setupRoutes();
  }

  private setupRoutes() {
    // Root directory listing - single streaming folder
    this.app.get('/', async (c) => {
      return c.json({
        name: this.config.name,
        type: 'root',
        children: [
          { name: 'Streaming', path: '/streaming', type: 'folder' }
        ]
      });
    });

    // Current streaming folder - shows dynamically selected media
    this.app.get('/streaming', async (c) => {
      // Get items in the order they were sent from frontend
      const streamingItems = this.orderedItemIds
        .map(id => this.currentStreamingItems.get(id))
        .filter(item => item !== undefined) as StreamingMediaItem[];
      return c.json({
        name: 'Current Selection',
        type: 'folder',
        children: streamingItems.map(item => this.formatStreamingItem(item))
      });
    });

    // Update streaming folder contents
    this.app.post('/streaming/update', async (c) => {
      try {
        const body = await c.req.json() as UpdateStreamingFolderRequest;
        this.updateStreamingFolder(body.mediaItems, body.currentlyPlayingId);
        
        return c.json({
          success: true,
          message: `Updated streaming folder with ${body.mediaItems.length} items`,
          totalItems: this.currentStreamingItems.size,
          currentlyPlaying: this.currentlyPlayingId
        });
      } catch (error) {
        console.error('Failed to update streaming folder:', error);
        return c.json({
          success: false,
          error: 'Failed to update streaming folder'
        }, 400);
      }
    });

    // Get current streaming folder status
    this.app.get('/streaming/status', async (c) => {
      return c.json({
        totalItems: this.currentStreamingItems.size,
        currentlyPlaying: this.currentlyPlayingId,
        items: Array.from(this.currentStreamingItems.values()).map(item => ({
          id: item.id,
          filename: item.filename,
          isCurrentlyPlaying: item.id === this.currentlyPlayingId
        }))
      });
    });

    // Mark media as currently playing
    this.app.post('/streaming/playing/:id', async (c) => {
      const id = parseInt(c.req.param('id'));
      this.currentlyPlayingId = id;
      
      return c.json({
        success: true,
        currentlyPlaying: id
      });
    });

    // Clear currently playing status
    this.app.delete('/streaming/playing', async (c) => {
      this.currentlyPlayingId = null;
      
      return c.json({
        success: true,
        currentlyPlaying: null
      });
    });

    // Media streaming endpoint with range support
    this.app.get('/stream/:id', async (c) => {
      const mediaId = parseInt(c.req.param('id'));
      
      // Check if media is in current streaming items first
      const streamingItem = this.currentStreamingItems.get(mediaId);
      if (streamingItem && existsSync(streamingItem.filepath)) {
        // Mark as currently playing
        this.currentlyPlayingId = mediaId;
        
        try {
          const stats = await stat(streamingItem.filepath);
          const range = c.req.header('range');

          if (range) {
            return this.handleRangeRequest(c, streamingItem.filepath, stats, range);
          } else {
            return this.handleFullRequest(c, streamingItem.filepath, stats);
          }
        } catch (error) {
          console.error('Streaming error:', error);
          return c.json({ error: 'Failed to stream media' }, 500);
        }
      }
      
      // Fallback to database lookup for backward compatibility
      const media = await this.getMediaById(mediaId);
      if (!media || !existsSync(media.filepath)) {
        return c.notFound();
      }

      try {
        const stats = await stat(media.filepath);
        const range = c.req.header('range');

        if (range) {
          return this.handleRangeRequest(c, media.filepath, stats, range);
        } else {
          return this.handleFullRequest(c, media.filepath, stats);
        }
      } catch (error) {
        console.error('Streaming error:', error);
        return c.json({ error: 'Failed to stream media' }, 500);
      }
    });

    // DLNA/UPnP device description
    this.app.get('/device.xml', async (c) => {
      const deviceXml = this.generateDeviceDescription();
      c.header('Content-Type', 'text/xml');
      return c.text(deviceXml);
    });

    // Content directory service description
    this.app.get('/contentdirectory.xml', async (c) => {
      const serviceXml = this.generateContentDirectoryService();
      c.header('Content-Type', 'text/xml');
      return c.text(serviceXml);
    });

    // SOAP endpoint for UPnP actions
    this.app.post('/control', async (c) => {
      const soapAction = c.req.header('soapaction');
      const body = await c.req.text();
      
      if (soapAction?.includes('Browse')) {
        return this.handleBrowseAction(c, body);
      }
      
      return c.json({ error: 'Unsupported SOAP action' }, 400);
    });
  }

  private async handleRangeRequest(c: any, filepath: string, stats: any, range: string) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
    const chunksize = (end - start) + 1;

    // Use Bun.file() with arrayBuffer to avoid _Response issues
    const file = Bun.file(filepath);
    const fileSlice = file.slice(start, end + 1);
    const arrayBuffer = await fileSlice.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize.toString(),
        'Content-Type': this.getContentType(filepath)
      }
    });
  }

  private async handleFullRequest(c: any, filepath: string, stats: any) {
    // Use Bun.file() with arrayBuffer to avoid _Response issues
    const file = Bun.file(filepath);
    const arrayBuffer = await file.arrayBuffer();

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Length': stats.size.toString(),
        'Content-Type': this.getContentType(filepath),
        'Accept-Ranges': 'bytes'
      }
    });
  }

  private getBaseUrl(requestHost?: string): string {
    // Use the request host if provided, otherwise fall back to configured host
    let host = requestHost;
    
    if (!host) {
      host = this.config.host === '0.0.0.0' ? 'localhost' : (this.config.host || 'localhost');
    }
    
    // Remove port from host if present
    host = host.split(':')[0];
    
    return `http://${host}:${this.config.port}`;
  }

  public getContentType(filepath: string): string {
    const ext = extname(filepath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.mkv': 'video/x-matroska',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.wmv': 'video/x-ms-wmv',
      '.flv': 'video/x-flv',
      '.webm': 'video/webm',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.webp': 'image/webp'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  private formatStreamingItem(item: StreamingMediaItem) {
    return {
      name: item.filename,
      path: `/stream/${item.id}`,
      type: 'media',
      fileType: item.fileType,
      size: item.fileSize,
      duration: item.duration,
      created: item.createdAt,
      mimeType: this.getContentType(item.filepath),
      isCurrentlyPlaying: item.id === this.currentlyPlayingId
    };
  }

  private updateStreamingFolder(newItems: StreamingMediaItem[], currentlyPlayingId?: number, forceRefresh: boolean = false) {
    // Store previous item count to detect significant changes
    const previousItemCount = this.currentStreamingItems.size;
    
    // Preserve currently playing item if it exists
    const preserveCurrentlyPlaying = this.currentlyPlayingId !== null;
    const currentlyPlayingItem = preserveCurrentlyPlaying ? 
      this.currentStreamingItems.get(this.currentlyPlayingId!) : null;

    // Clear the current items map and order array
    this.currentStreamingItems.clear();
    this.orderedItemIds = [];

    // Add all new items preserving the order from frontend
    newItems.forEach(item => {
      this.currentStreamingItems.set(item.id, item);
      this.orderedItemIds.push(item.id);
    });

    // Re-add currently playing item if it's not in the new selection
    if (currentlyPlayingItem && !this.currentStreamingItems.has(currentlyPlayingItem.id)) {
      console.log(`Preserving currently playing item: ${currentlyPlayingItem.filename}`);
      this.currentStreamingItems.set(currentlyPlayingItem.id, currentlyPlayingItem);
      // Add to end of ordered list
      this.orderedItemIds.push(currentlyPlayingItem.id);
    }

    // Update currently playing ID if provided
    if (currentlyPlayingId !== undefined) {
      this.currentlyPlayingId = currentlyPlayingId;
    }

    // Increment systemUpdateId to notify DLNA clients of content change
    this.systemUpdateId++;
    
    // If the content changed significantly (more than 50% different), increment by a larger amount
    // This helps DLNA clients recognize it as a major update
    if (Math.abs(previousItemCount - this.currentStreamingItems.size) > previousItemCount * 0.5) {
      this.systemUpdateId += 100;
    }
    
    console.log(`Updated streaming folder: ${this.currentStreamingItems.size} items (currently playing: ${this.currentlyPlayingId})`);
    console.log(`Order preserved: ${this.orderedItemIds.slice(0, 5).join(', ')}${this.orderedItemIds.length > 5 ? '...' : ''}`);
    
    // Send SSDP notification when content changes
    if (this.ssdpServer && this.currentStreamingItems.size > 0) {
      if (forceRefresh) {
        console.log('📢 Forcing VLC refresh with SSDP byebye + notify');
        this.ssdpServer.sendNotify(true);
      } else {
        console.log('📢 Sending SSDP notification for content update');
        this.ssdpServer.sendNotify(false);
      }
    }
  }

  public getStreamingFolderStatus() {
    // Return items in the order they were sent from frontend
    const orderedItems = this.orderedItemIds
      .map(id => this.currentStreamingItems.get(id))
      .filter(item => item !== undefined)
      .map(item => ({
        id: item!.id,
        filename: item!.filename,
        isCurrentlyPlaying: item!.id === this.currentlyPlayingId
      }));
    
    return {
      totalItems: this.currentStreamingItems.size,
      currentlyPlaying: this.currentlyPlayingId,
      items: orderedItems
    };
  }

  public updateStreamingFolderFromExternal(mediaItems: StreamingMediaItem[], currentlyPlayingId?: number, forceRefresh: boolean = false) {
    this.updateStreamingFolder(mediaItems, currentlyPlayingId, forceRefresh);
    return this.getStreamingFolderStatus();
  }
  
  public forceVLCRefresh() {
    if (this.ssdpServer) {
      console.log('🔄 Forcing VLC refresh');
      this.ssdpServer.sendNotify(true);
    }
  }

  private async getAvailableYears(): Promise<number[]> {
    const result = await db
      .select({
        year: sql<number>`CAST(strftime('%Y', ${schema.mediaItems.createdAt}) AS INTEGER)`
      })
      .from(schema.mediaItems)
      .groupBy(sql`strftime('%Y', ${schema.mediaItems.createdAt})`)
      .orderBy(sql`strftime('%Y', ${schema.mediaItems.createdAt}) DESC`);
    
    return result.map(r => r.year);
  }

  private async getAvailableMonths(year: number): Promise<number[]> {
    const result = await db
      .select({
        month: sql<number>`CAST(strftime('%m', ${schema.mediaItems.createdAt}) AS INTEGER)`
      })
      .from(schema.mediaItems)
      .where(sql`strftime('%Y', ${schema.mediaItems.createdAt}) = ${year.toString()}`)
      .groupBy(sql`strftime('%m', ${schema.mediaItems.createdAt})`)
      .orderBy(sql`strftime('%m', ${schema.mediaItems.createdAt})`);
    
    return result.map(r => r.month);
  }

  private async getAvailableMonthsAcrossYears(): Promise<Array<{month: number, count: number}>> {
    const result = await db
      .select({
        month: sql<number>`CAST(strftime('%m', ${schema.mediaItems.createdAt}) AS INTEGER)`,
        count: sql<number>`COUNT(*)`
      })
      .from(schema.mediaItems)
      .groupBy(sql`strftime('%m', ${schema.mediaItems.createdAt})`)
      .orderBy(sql`strftime('%m', ${schema.mediaItems.createdAt})`);
    
    return result;
  }

  private async getMediaByYearMonth(year: number, month: number) {
    return await db
      .select()
      .from(schema.mediaItems)
      .where(sql`strftime('%Y', ${schema.mediaItems.createdAt}) = ${year.toString()} AND strftime('%m', ${schema.mediaItems.createdAt}) = ${month.toString().padStart(2, '0')}`)
      .orderBy(sql`${schema.mediaItems.createdAt} DESC`);
  }

  private async getMediaByMonth(month: number) {
    return await db
      .select()
      .from(schema.mediaItems)
      .where(sql`strftime('%m', ${schema.mediaItems.createdAt}) = ${month.toString().padStart(2, '0')}`)
      .orderBy(sql`${schema.mediaItems.createdAt} DESC`);
  }

  private async getAllMedia(limit: number, offset: number) {
    return await db
      .select()
      .from(schema.mediaItems)
      .orderBy(sql`${schema.mediaItems.createdAt} DESC`)
      .limit(limit)
      .offset(offset);
  }

  private async getMediaById(id: number) {
    const result = await db
      .select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, id))
      .limit(1);
    
    return result[0] || null;
  }

  public generateDeviceDescription(requestHost?: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <URLBase>${this.getBaseUrl(requestHost)}/</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${this.config.name}</friendlyName>
    <manufacturer>RuneCortex</manufacturer>
    <manufacturerURL>https://github.com/runecortex</manufacturerURL>
    <modelDescription>RuneCortex Media Server</modelDescription>
    <modelName>RuneCortex</modelName>
    <modelNumber>1.0</modelNumber>
    <modelURL>https://github.com/runecortex</modelURL>
    <serialNumber>12345</serialNumber>
    <UDN>uuid:${this.generateUUID()}</UDN>
    <dlna:X_DLNADOC>DMS-1.50</dlna:X_DLNADOC>
    <dlna:X_DLNACAP/>
    <presentationURL>${this.getBaseUrl(requestHost)}/</presentationURL>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <SCPDURL>/contentdirectory.xml</SCPDURL>
        <controlURL>/control</controlURL>
        <eventSubURL>/events</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
  }

  public generateContentDirectoryService(): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <actionList>
    <action>
      <name>Browse</name>
      <argumentList>
        <argument>
          <name>ObjectID</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_ObjectID</relatedStateVariable>
        </argument>
        <argument>
          <name>BrowseFlag</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_BrowseFlag</relatedStateVariable>
        </argument>
        <argument>
          <name>Filter</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_Filter</relatedStateVariable>
        </argument>
        <argument>
          <name>StartingIndex</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_Index</relatedStateVariable>
        </argument>
        <argument>
          <name>RequestedCount</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable>
        </argument>
        <argument>
          <name>SortCriteria</name>
          <direction>in</direction>
          <relatedStateVariable>A_ARG_TYPE_SortCriteria</relatedStateVariable>
        </argument>
        <argument>
          <name>Result</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_Result</relatedStateVariable>
        </argument>
        <argument>
          <name>NumberReturned</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable>
        </argument>
        <argument>
          <name>TotalMatches</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable>
        </argument>
        <argument>
          <name>UpdateID</name>
          <direction>out</direction>
          <relatedStateVariable>A_ARG_TYPE_UpdateID</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
    <action>
      <name>GetSystemUpdateID</name>
      <argumentList>
        <argument>
          <name>Id</name>
          <direction>out</direction>
          <relatedStateVariable>SystemUpdateID</relatedStateVariable>
        </argument>
      </argumentList>
    </action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_ObjectID</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_BrowseFlag</name>
      <dataType>string</dataType>
      <allowedValueList>
        <allowedValue>BrowseMetadata</allowedValue>
        <allowedValue>BrowseDirectChildren</allowedValue>
      </allowedValueList>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Filter</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Index</name>
      <dataType>ui4</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Count</name>
      <dataType>ui4</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_SortCriteria</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="no">
      <name>A_ARG_TYPE_Result</name>
      <dataType>string</dataType>
    </stateVariable>
    <stateVariable sendEvents="yes">
      <name>A_ARG_TYPE_UpdateID</name>
      <dataType>ui4</dataType>
    </stateVariable>
    <stateVariable sendEvents="yes">
      <name>SystemUpdateID</name>
      <dataType>ui4</dataType>
    </stateVariable>
  </serviceStateTable>
</scpd>`;
  }


  public async handleBrowseAction(c: any, soapBody: string, requestHost?: string) {
    // Parse the SOAP request to get ObjectID
    const objectIdMatch = soapBody.match(/<ObjectID>([^<]+)<\/ObjectID>/);
    const objectId = objectIdMatch ? objectIdMatch[1] : '0';
    
    let didlLite = '';
    let itemCount = 0;
    
    // Always show all media items at the root level (no folders)
    if (objectId === '0') {
      // Get items in the order they were sent from frontend
      const streamingItems = this.orderedItemIds
        .map(id => this.currentStreamingItems.get(id))
        .filter(item => item !== undefined) as StreamingMediaItem[];
      didlLite = this.generateDIDLLite(streamingItems, requestHost);
      itemCount = streamingItems.length;
    }
    
    const soapResponse = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
      <Result>${this.escapeXml(didlLite)}</Result>
      <NumberReturned>${itemCount}</NumberReturned>
      <TotalMatches>${itemCount}</TotalMatches>
      <UpdateID>${this.systemUpdateId}</UpdateID>
    </u:BrowseResponse>
  </s:Body>
</s:Envelope>`;

    c.header('Content-Type', 'text/xml; charset=utf-8');
    return c.text(soapResponse);
  }

  public generateDIDLLite(mediaItems: StreamingMediaItem[], requestHost?: string): string {
    const items = mediaItems.map(item => {
      const isVideo = item.fileType === 'video';
      const baseUrl = this.getBaseUrl(requestHost);
      
      // Enhanced metadata
      let resElements = '';
      
      // Main resource
      resElements += `
          <res protocolInfo="http-get:*:${this.getContentType(item.filepath)}:*" size="${item.fileSize}"${isVideo && item.duration ? ` duration="${this.formatDuration(item.duration)}"` : ''}${item.width ? ` resolution="${item.width}x${item.height}"` : ''}>${baseUrl}/stream/${item.id}</res>`;
      
      // Add thumbnail if available
      if (item.thumbnailId) {
        resElements += `
          <res protocolInfo="http-get:*:image/jpeg:DLNA.ORG_PN=JPEG_TN">${baseUrl}/thumbnails/${item.thumbnailId}.jpg</res>`;
      }
      
      // Add additional metadata
      const additionalMetadata = [];
      if (item.width && item.height) {
        additionalMetadata.push(`<upnp:resolution>${item.width}x${item.height}</upnp:resolution>`);
      }
      if (isVideo && item.duration) {
        additionalMetadata.push(`<upnp:duration>${this.formatDuration(item.duration)}</upnp:duration>`);
      }
      
      // Get the index of this item in the ordered list for prefix
      const index = this.orderedItemIds.indexOf(item.id);
      const prefix = index >= 0 ? `${(index + 1).toString().padStart(6, '0')} - ` : '';
      
      return `
        <item id="${item.id}" parentID="0">
          <dc:title>${this.escapeXml(prefix + item.filename)}</dc:title>
          <dc:date>${item.createdAt}</dc:date>
          <upnp:class>object.item.${isVideo ? 'videoItem' : 'imageItem'}</upnp:class>
          ${additionalMetadata.join('\n          ')}${resElements}
        </item>`;
    }).join('');

    return `<?xml version="1.0" encoding="utf-8"?>
<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
  ${items}
</DIDL-Lite>`;
  }

  public escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private generateUUID(): string {
    // Use a consistent UUID for the DLNA server
    // This prevents VLC from seeing multiple server instances
    return 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Streaming server is already running');
    }

    try {
      console.log(`🎬 Starting streaming server on ${this.config.host || '0.0.0.0'}:${this.config.port}...`);
      
      this.server = serve({
        fetch: this.app.fetch,
        port: this.config.port,
        hostname: this.config.host || '0.0.0.0'
      });

      // Wait a moment to ensure server is actually listening
      await new Promise(resolve => setTimeout(resolve, 100));
      
      this.isRunning = true;
      console.log(`🎬 Streaming server started on http://${this.config.host || '0.0.0.0'}:${this.config.port}`);
      console.log(`📺 DLNA/UPnP device available as "${this.config.name}"`);
      console.log(`🔗 Test URL: http://localhost:${this.config.port}/streaming`);
    } catch (error) {
      console.error('Failed to start streaming server:', error);
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.server) {
        this.server.close();
        this.server = null;
      }
      this.isRunning = false;
      console.log('🛑 Streaming server stopped');
    } catch (error) {
      console.error('Error stopping streaming server:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.config.port,
      host: this.config.host || '0.0.0.0',
      name: this.config.name,
      url: `http://${this.config.host || 'localhost'}:${this.config.port}`
    };
  }
  
  setSSDPServer(ssdpServer: any) {
    this.ssdpServer = ssdpServer;
  }

  // Handle requests directly for integration with main Bun server
  async handleRequest(request: Request): Promise<Response> {
    try {
      const honoResponse = await this.app.fetch(request);
      
      // Simply clone the response to ensure it's a proper Web API Response
      // This handles all content types correctly
      return new Response(honoResponse.body, {
        status: honoResponse.status,
        statusText: honoResponse.statusText,
        headers: honoResponse.headers
      });
    } catch (error) {
      console.error('Error in streaming server handleRequest:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
}