import { db, schema } from '../../db';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';

export class JellyfinPlugin {
  private enabled: boolean;
  private serverName: string;
  private serverId: string;
  private streamingServer: any = null;
  
  constructor() {
    this.enabled = process.env.JELLYFIN_ENABLED === 'true';
    this.serverName = process.env.SERVER_NAME || 'RuneCortex Media Server';
    this.serverId = process.env.SERVER_ID || 'runecortex-' + Math.random().toString(36).substring(7);
    
    if (this.enabled) {
      console.log('🎭 Jellyfin API plugin enabled');
    }
  }
  
  // Set streaming server reference
  setStreamingServer(streamingServer: any) {
    this.streamingServer = streamingServer;
  }

  isEnabled() {
    return this.enabled;
  }
  
  // Simplified codec detection for videos
  private getCodecInfo(item: any): { videoCodec: string; audioCodec: string } {
    const extension = item.filepath.split('.').pop()?.toLowerCase() || '';
    
    // Common codec mappings
    if (extension === 'mov' || extension === 'mp4' || extension === 'm4v') {
      return { videoCodec: 'h264', audioCodec: 'aac' };
    } else if (extension === 'mkv') {
      return { videoCodec: 'h264', audioCodec: 'ac3' };
    } else if (extension === 'avi') {
      return { videoCodec: 'mpeg4', audioCodec: 'mp3' };
    } else if (extension === 'webm') {
      return { videoCodec: 'vp8', audioCodec: 'vorbis' };
    }
    
    // Default fallback
    return { videoCodec: 'h264', audioCodec: 'aac' };
  }

  // Handle Jellyfin API routes
  async handleRequest(request: Request): Promise<Response | null> {
    if (!this.enabled) return null;
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Don't handle GraphQL requests
    if (path === '/graphql') {
      return null;
    }
    
    // Log all Jellyfin requests
    console.log(`🎭 Jellyfin: ${request.method} ${path}${url.search ? '?' + url.search : ''}`);
    
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Emby-Authorization, X-MediaBrowser-Token',
          'Access-Control-Max-Age': '86400'
        }
      });
    }
    
    // Essential endpoints for Infuse
    if (path === '/System/Info/Public') {
      return this.getPublicSystemInfo();
    }
    
    if (path === '/Users/Public') {
      return this.getPublicUsers();
    }
    
    if (path === '/Users/AuthenticateByName' && request.method === 'POST') {
      return this.authenticateUser(request);
    }
    
    if (path.match(/^\/Users\/[^\/]+$/)) {
      return this.getUser();
    }
    
    if (path.match(/^\/Users\/[^\/]+\/Views$/)) {
      return this.getUserViews();
    }
    
    if (path.match(/^\/Users\/[^\/]+\/GroupingOptions$/)) {
      return this.getGroupingOptions();
    }
    
    if (path.match(/^\/Users\/[^\/]+\/Items$/)) {
      return this.getItems(url);
    }
    
    if (path.match(/^\/Users\/[^\/]+\/Items\/[^\/]+$/) && !path.includes('?')) {
      const itemId = path.split('/')[4];
      // Handle library folder details request
      if (itemId.startsWith('library-')) {
        return this.getLibraryDetails(itemId, request);
      }
      // Handle grouping type requests (e.g., /Users/{userId}/Items/None)
      if (isNaN(parseInt(itemId))) {
        return this.getItemsByGrouping(url, itemId);
      }
      return this.getItem(itemId);
    }
    
    if (path.match(/^\/Items\/[^\/]+$/)) {
      const itemId = path.split('/')[2];
      return this.getItem(itemId);
    }
    
    if (path.match(/^\/Items\/[^\/]+\/Images\/(Primary|Backdrop|Thumb)/)) {
      const parts = path.split('/');
      const itemId = parts[2];
      const imageType = parts[4];
      return this.getImage(itemId, imageType);
    }
    
    // Handle photo download requests
    if (path.match(/^\/Items\/[^\/]+\/Download$/)) {
      const itemId = path.split('/')[2];
      return this.downloadItem(itemId);
    }
    
    if (path.match(/^\/Videos\/[^\/]+\/stream/)) {
      const videoId = path.split('/')[2];
      return this.streamVideo(videoId, request);
    }
    
    if (path.match(/^\/Items\/[^\/]+\/PlaybackInfo$/)) {
      const itemId = path.split('/')[2];
      return this.getPlaybackInfo(itemId, url);
    }
    
    if (path === '/Library/VirtualFolders') {
      return this.getVirtualFolders();
    }
    
    if (path === '/DisplayPreferences/usersettings') {
      return this.getDisplayPreferences();
    }
    
    return null;
  }

  // System info for Infuse
  private async getPublicSystemInfo(): Promise<Response> {
    const { getLocalIpAddress } = await import('../../utils/network');
    const localIp = getLocalIpAddress();
    const port = process.env.PORT || '4001';
    
    return new Response(JSON.stringify({
      LocalAddress: `http://${localIp}:${port}`,
      ServerName: this.serverName,
      Version: '10.8.0',
      ProductName: 'Jellyfin Server',
      OperatingSystem: 'Linux',
      Id: this.serverId,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Simplified user system for Infuse
  private async getPublicUsers(): Promise<Response> {
    return new Response(JSON.stringify([{
      Name: 'Default',
      ServerId: this.serverId,
      Id: 'default-user',
      HasPassword: false,
      HasConfiguredPassword: false,
    }]), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  private async getUser(): Promise<Response> {
    return new Response(JSON.stringify({
      Name: 'Default',
      ServerId: this.serverId,
      Id: 'default-user',
      HasPassword: false,
      HasConfiguredPassword: false,
      HasConfiguredEasyPassword: false,
      EnableAutoLogin: true,
      Policy: {
        IsAdministrator: true,
        IsHidden: false,
        IsDisabled: false,
        EnableUserPreferenceAccess: true,
        EnableRemoteAccess: true,
        EnableLiveTvAccess: true,
        EnableMediaPlayback: true,
        EnableAudioPlaybackTranscoding: true,
        EnableVideoPlaybackTranscoding: true,
        EnablePlaybackRemuxing: true,
        EnableContentDeletion: false,
        EnableContentDownloading: true,
        EnableSubtitleDownloading: true,
        EnableSubtitleManagement: true,
        EnableSyncTranscoding: true,
        EnableMediaConversion: true,
        EnableAllDevices: true,
        EnableRemoteAccess: true,
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Authenticate endpoint (no-op for local use)
  private async authenticateUser(request: Request): Promise<Response> {
    // Generate a unique token for each authentication to avoid caching issues
    const uniqueToken = `token-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    return new Response(JSON.stringify({
      AccessToken: uniqueToken,
      User: {
        Name: 'Default',
        ServerId: this.serverId,
        Id: 'default-user',
        HasPassword: false,
        HasConfiguredPassword: false,
        HasConfiguredEasyPassword: false,
        EnableAutoLogin: true,
      },
      SessionInfo: {
        PlayableMediaTypes: ['Audio', 'Video', 'Photo'],
        Id: 'session-' + Date.now(),
        UserId: 'default-user',
        UserName: 'Default',
        Client: 'Infuse',
        LastActivityDate: new Date().toISOString(),
        LastPlaybackCheckIn: new Date().toISOString(),
        DeviceName: 'Infuse',
        DeviceId: 'infuse-device',
        ApplicationVersion: '1.0.0',
        IsActive: true,
        SupportsMediaControl: true,
        SupportsRemoteControl: true,
        PlayableMediaTypes: ['Audio', 'Video', 'Photo'],
        SupportedCommands: [],
        ServerId: this.serverId,
      },
      ServerId: this.serverId,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get user views (libraries)
  private async getUserViews(): Promise<Response> {
    const folders = await db.select()
      .from(schema.indexedFolders)
      .where(eq(schema.indexedFolders.enabled, true));
    
    const views = [];
    
    // Add streaming view if available
    if (this.streamingServer && this.streamingServer.currentStreamingItems.size > 0) {
      const itemCount = this.streamingServer.currentStreamingItems.size;
      views.push({
        Name: '🎬 Now Playing',
        ServerId: this.serverId,
        Id: 'library-streaming',
        Etag: `library-streaming-${itemCount}`,
        DateCreated: new Date().toISOString(),
        CanDelete: false,
        CanDownload: true,
        SortName: '!Streaming',
        ParentId: null,
        Path: '/streaming',
        Type: 'CollectionFolder',
        CollectionType: 'homevideos', // Use 'homevideos' for home media collections
        LocationType: 'FileSystem',
        DisplayPreferencesId: 'library-streaming',
        RecursiveItemCount: itemCount,
        ChildCount: itemCount,
        // Include all fields that Infuse might request
        Genres: [],
        MediaSources: [],
        AlternateMediaSources: [],
        Overview: 'Currently playing media items',
        People: [],
        ProviderIds: {},
        IsFolder: true,
        PlayAccess: 'Full',
        UserData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false,
          LastPlayedDate: null,
          Key: `library-streaming-default-user`
        },
        // Add these additional fields that might be required
        ImageTags: {},
        BackdropImageTags: [],
        PrimaryImageTag: null,
        PrimaryImageAspectRatio: null,
        PrimaryImageItemId: null,
        LibraryOptions: null,
        RefreshProgress: null,
        RefreshStatus: null
      });
    }
    
    // Add regular indexed folders as well
    for (const folder of folders) {
      const [mediaCount] = await db.select({ count: sql`count(*)` })
        .from(schema.mediaItems)
        .where(eq(schema.mediaItems.sourcePath, folder.path));
      
      views.push({
        Name: folder.path.split('/').pop() || folder.path,
        ServerId: this.serverId,
        Id: `folder-${folder.id}`,
        Etag: `folder-${folder.id}-${mediaCount.count}`,
        DateCreated: folder.addedAt || new Date().toISOString(),
        CanDelete: false,
        CanDownload: true,
        SortName: folder.path,
        ParentId: null,
        Path: folder.path,
        Type: 'CollectionFolder',
        CollectionType: 'homevideos', // Use 'homevideos' for regular folders
        LocationType: 'FileSystem',
        DisplayPreferencesId: `folder-${folder.id}`,
        RecursiveItemCount: Number(mediaCount.count),
        ChildCount: Number(mediaCount.count),
        Genres: [],
        MediaSources: [],
        AlternateMediaSources: [],
        Overview: `Media from ${folder.path}`,
        People: [],
        ProviderIds: {},
        IsFolder: true,
        PlayAccess: 'Full',
        UserData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false,
          LastPlayedDate: null,
          Key: `folder-${folder.id}-default-user`
        },
        ImageTags: {},
        BackdropImageTags: [],
        PrimaryImageTag: null,
        PrimaryImageAspectRatio: null,
        PrimaryImageItemId: null,
        LibraryOptions: null,
        RefreshProgress: null,
        RefreshStatus: null
      });
    }
    
    console.log(`📁 Jellyfin: Found ${folders.length} indexed folders`);
    console.log('📚 Jellyfin: Returning', views.length, 'views:', views.map(v => v.Name).join(', '));
    
    return new Response(JSON.stringify({
      Items: views,
      TotalRecordCount: views.length,
      StartIndex: 0
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get media items
  private async getItems(url: URL): Promise<Response> {
    // Handle double ?? in URL that some clients send
    const urlString = url.toString().replace('??', '?');
    const fixedUrl = new URL(urlString);
    const params = fixedUrl.searchParams;
    const parentId = params.get('ParentId') || params.get('parentId');
    const startIndex = parseInt(params.get('StartIndex') || '0');
    const limit = parseInt(params.get('Limit') || '100');
    
    // Handle streaming library
    if (parentId === 'library-streaming') {
      console.log('🎭 Jellyfin: Requested streaming library items');
      
      if (!this.streamingServer) {
        console.log('🎭 Jellyfin: No streaming server available');
        return new Response(JSON.stringify({
          Items: [],
          TotalRecordCount: 0,
          StartIndex: 0,
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      console.log('🎭 Jellyfin: Streaming server found, current items:', this.streamingServer.currentStreamingItems.size);
      console.log('🎭 Jellyfin: Ordered item IDs:', this.streamingServer.orderedItemIds);
      
      // Get streaming items in order
      const streamingItems = this.streamingServer.orderedItemIds
        .map(id => this.streamingServer.currentStreamingItems.get(id))
        .filter(item => item !== undefined);
      
      console.log('🎭 Jellyfin: Found', streamingItems.length, 'streaming items');
      
      // Apply pagination
      const paginatedItems = streamingItems.slice(startIndex, startIndex + limit);
      
      // Convert to Jellyfin format
      const jellyfinItems = paginatedItems.map(item => {
        const isVideo = item.fileType === 'video';
        
        // Only get codec info for videos
        let videoCodec, audioCodec;
        if (isVideo) {
          const codecInfo = this.getCodecInfo(item);
          videoCodec = codecInfo.videoCodec;
          audioCodec = codecInfo.audioCodec;
        }
        
        // Base item structure
        const baseItem = {
          Name: item.filename,
          ServerId: this.serverId,
          Id: item.id.toString(),
          Etag: item.id.toString(),
          DateCreated: item.createdAt,
          Type: isVideo ? 'Movie' : 'Photo',
          MediaType: isVideo ? 'Video' : 'Photo',
          LocationType: 'FileSystem',
          Path: item.filepath,
          CanDelete: false,
          CanDownload: true,
          IsFolder: false,
          ParentId: 'library-streaming',
          PlayAccess: 'Full',
          UserData: {
            PlaybackPositionTicks: 0,
            PlayCount: 0,
            IsFavorite: false,
            Played: false
          }
        };
        
        // Add video-specific fields
        if (isVideo) {
          return {
            ...baseItem,
            MediaSources: [{
              Protocol: 'File',
              Id: item.id.toString(),
              Path: item.filepath,
              Type: 'Default',
              Container: item.filepath.split('.').pop(),
              Size: item.fileSize || 0,
              Name: item.filename,
              IsRemote: false,
              SupportsDirectStream: true,
              SupportsDirectPlay: true,
              MediaStreams: [
                {
                  Codec: videoCodec,
                  Type: 'Video',
                  Index: 0,
                  IsDefault: true,
                  Width: item.width || 1920,
                  Height: item.height || 1080
                },
                {
                  Codec: audioCodec,
                  Type: 'Audio',
                  Index: 1,
                  IsDefault: true
                }
              ]
            }]
          };
        } else {
          // Photo-specific fields
          return {
            ...baseItem,
            Width: item.width || undefined,
            Height: item.height || undefined,
            ImageTags: {
              Primary: item.id.toString() // Use media ID as the primary image tag
            },
            // Photos don't have MediaSources in Jellyfin
            MediaSources: null,
            // Add photo-specific metadata
            Orientation: 'TopLeft',
            ImageType: 'Primary',
            HasSubtitles: false,
            IsPlaceHolder: false,
            SupportsSync: true,
            SyncStatus: 'Synced'
          };
        }
      });
      
      console.log('🎭 Jellyfin: Returning', jellyfinItems.length, 'items to Infuse');
      
      return new Response(JSON.stringify({
        Items: jellyfinItems,
        TotalRecordCount: streamingItems.length,
        StartIndex: startIndex,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // For other libraries, return empty for now
    return new Response(JSON.stringify({
      Items: [],
      TotalRecordCount: 0,
      StartIndex: 0,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get single item
  private async getItem(itemId: string): Promise<Response> {
    console.log(`🎭 Jellyfin: Getting item details for ${itemId}`);
    
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }
    
    // Check if item is in streaming folder first
    if (this.streamingServer) {
      const streamingItem = this.streamingServer.currentStreamingItems.get(mediaId);
      if (streamingItem) {
        console.log(`🎭 Jellyfin: Found item ${itemId} in streaming folder`);
        const isVideo = streamingItem.fileType === 'video';
        
        let videoCodec, audioCodec;
        if (isVideo) {
          const codecInfo = this.getCodecInfo(streamingItem);
          videoCodec = codecInfo.videoCodec;
          audioCodec = codecInfo.audioCodec;
        }
        
        const baseItem = {
          Name: streamingItem.filename,
          ServerId: this.serverId,
          Id: streamingItem.id.toString(),
          Etag: streamingItem.id.toString(),
          DateCreated: streamingItem.createdAt,
          Type: isVideo ? 'Movie' : 'Photo',
          MediaType: isVideo ? 'Video' : 'Photo',
          LocationType: 'FileSystem',
          Path: streamingItem.filepath,
          CanDelete: false,
          CanDownload: true,
          IsFolder: false,
          ParentId: 'library-streaming',
          PlayAccess: 'Full',
          UserData: {
            PlaybackPositionTicks: 0,
            PlayCount: 0,
            IsFavorite: false,
            Played: false
          }
        };
        
        let jellyfinItem;
        if (isVideo) {
          jellyfinItem = {
            ...baseItem,
            MediaSources: [{
              Protocol: 'File',
              Id: streamingItem.id.toString(),
              Path: streamingItem.filepath,
              Type: 'Default',
              Container: streamingItem.filepath.split('.').pop(),
              Size: streamingItem.fileSize || 0,
              Name: streamingItem.filename,
              IsRemote: false,
              SupportsDirectStream: true,
              SupportsDirectPlay: true,
              MediaStreams: [
                {
                  Codec: videoCodec,
                  Type: 'Video',
                  Index: 0,
                  IsDefault: true,
                  Width: streamingItem.width || 1920,
                  Height: streamingItem.height || 1080
                },
                {
                  Codec: audioCodec,
                  Type: 'Audio',
                  Index: 1,
                  IsDefault: true
                }
              ]
            }]
          };
        } else {
          // Photo-specific structure
          jellyfinItem = {
            ...baseItem,
            Width: streamingItem.width || undefined,
            Height: streamingItem.height || undefined,
            ImageTags: {
              Primary: streamingItem.id.toString()
            },
            MediaSources: null,
            Orientation: 'TopLeft',
            ImageType: 'Primary',
            HasSubtitles: false,
            IsPlaceHolder: false,
            SupportsSync: true,
            SyncStatus: 'Synced'
          };
        }
        
        return new Response(JSON.stringify(jellyfinItem), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // Fallback to database
    const [item] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId))
      .limit(1);
    
    if (!item) {
      return new Response('Not found', { status: 404 });
    }
    
    const jellyfinItem = this.convertToJellyfinItem(item);
    
    return new Response(JSON.stringify(jellyfinItem), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Convert database item to Jellyfin format
  private convertToJellyfinItem(item: any) {
    const isVideo = item.fileType === 'video';
    const { videoCodec, audioCodec } = this.getCodecInfo(item);
    
    return {
      Name: item.filename,
      ServerId: this.serverId,
      Id: item.id.toString(),
      Etag: item.id.toString(),
      DateCreated: item.createdAt,
      Type: isVideo ? 'Movie' : 'Photo',
      MediaType: isVideo ? 'Video' : 'Photo',
      LocationType: 'FileSystem',
      Path: item.filepath,
      CanDelete: false,
      CanDownload: true,
      IsFolder: false,
      MediaSources: [{
        Protocol: 'File',
        Id: item.id.toString(),
        Path: item.filepath,
        Type: 'Default',
        Container: item.filepath.split('.').pop(),
        Size: item.fileSize || 0,
        Name: item.filename,
        IsRemote: false,
        SupportsDirectStream: true,
        SupportsDirectPlay: true,
        MediaStreams: isVideo ? [
          {
            Codec: videoCodec,
            Type: 'Video',
            Index: 0,
            IsDefault: true,
            Width: item.width || 1920,
            Height: item.height || 1080
          },
          {
            Codec: audioCodec,
            Type: 'Audio',
            Index: 1,
            IsDefault: true
          }
        ] : undefined
      }],
      PlayAccess: 'Full',
      UserData: {
        PlaybackPositionTicks: 0,
        PlayCount: 0,
        IsFavorite: false,
        Played: false
      }
    };
  }

  // Serve images
  private async getImage(itemId: string, imageType: string): Promise<Response> {
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }
    
    // Check if this is a photo in streaming folder
    if (this.streamingServer) {
      const streamingItem = this.streamingServer.currentStreamingItems.get(mediaId);
      if (streamingItem && streamingItem.fileType === 'image') {
        // For photos, serve the original file as the primary image
        const redirectUrl = `${this.getBaseUrl()}/stream/${mediaId}`;
        return new Response(null, {
          status: 302,
          headers: {
            'Location': redirectUrl,
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // For videos or non-streaming items, redirect to thumbnail
    const redirectUrl = `${this.getBaseUrl()}/thumbnails/${mediaId}.jpg`;
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
  
  // Download original item (mainly for photos)
  private async downloadItem(itemId: string): Promise<Response> {
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }
    
    // Redirect to streaming endpoint which will serve the original file
    const redirectUrl = `${this.getBaseUrl()}/stream/${mediaId}`;
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Stream video
  private async streamVideo(videoId: string, request: Request): Promise<Response> {
    const mediaId = parseInt(videoId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }
    
    // Redirect to our streaming endpoint
    const redirectUrl = `${this.getBaseUrl()}/stream/${mediaId}`;
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get playback info
  private async getPlaybackInfo(itemId: string, url: URL): Promise<Response> {
    console.log(`🎭 Jellyfin: PlaybackInfo requested for item ${itemId}`);
    
    // Handle library folder playback info requests (shouldn't happen, but Infuse asks)
    if (itemId.startsWith('library-')) {
      return new Response(JSON.stringify({
        PlaySessionId: null,
        MediaSources: [],
        ErrorCode: 'NotAllowed'
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }

    // Check streaming folder first
    if (this.streamingServer) {
      const streamingItem = this.streamingServer.currentStreamingItems.get(mediaId);
      if (streamingItem) {
        return this.createPlaybackInfo(streamingItem);
      }
    }

    // Fallback to database
    const [item] = await db.select()
      .from(schema.mediaItems)
      .where(eq(schema.mediaItems.id, mediaId))
      .limit(1);

    if (!item) {
      return new Response('Not found', { status: 404 });
    }

    return this.createPlaybackInfo(item);
  }

  // Create playback info response
  private createPlaybackInfo(item: any): Response {
    const isVideo = item.fileType === 'video';
    const { videoCodec, audioCodec } = this.getCodecInfo(item);
    
    const playbackInfo = {
      MediaSources: [{
        Protocol: 'File',
        Id: item.id.toString(),
        Path: item.filepath,
        Type: 'Default',
        Container: item.filepath.split('.').pop(),
        Size: item.fileSize,
        Name: item.filename,
        IsRemote: false,
        RunTimeTicks: item.duration ? item.duration * 10000000 : null,
        SupportsDirectStream: true,
        SupportsDirectPlay: true,
        IsInfiniteStream: false,
        RequiresOpening: false,
        RequiresClosing: false,
        RequiresLooping: false,
        SupportsProbing: true,
        VideoType: isVideo ? 'VideoFile' : undefined,
        MediaStreams: isVideo ? [
          {
            Codec: videoCodec,
            Type: 'Video',
            Index: 0,
            IsDefault: true,
            IsInterlaced: false,
            BitRate: item.bitrate || 5000000,
            BitDepth: 8,
            RefFrames: 1,
            IsAnamorphic: false,
            Width: item.width || 1920,
            Height: item.height || 1080,
            AverageFrameRate: 30,
            RealFrameRate: 30,
            Profile: 'High',
            Level: '4.1',
            PixelFormat: 'yuv420p',
            HasThumbnail: false,
            IsExternal: false,
            IsTextSubtitleStream: false,
            SupportsExternalStream: false,
            Protocol: 'File'
          },
          {
            Codec: audioCodec,
            Type: 'Audio',
            Index: 1,
            IsDefault: true,
            Channels: 2,
            ChannelLayout: 'stereo',
            BitRate: 128000,
            SampleRate: 48000,
            IsInterlaced: false,
            IsAVC: false,
            IsExternal: false,
            IsTextSubtitleStream: false,
            SupportsExternalStream: false,
            Protocol: 'File'
          }
        ] : undefined,
        DirectStreamUrl: `/Videos/${item.id}/stream`,
        TranscodingUrl: `/Videos/${item.id}/stream`,
        TranscodingSubProtocol: 'http',
        TranscodingContainer: item.filepath.split('.').pop(),
        AnalyzeDurationMs: 0,
        DefaultAudioStreamIndex: isVideo ? 0 : undefined,
        DefaultSubtitleStreamIndex: undefined
      }],
      PlaySessionId: `session-${item.id}-${Date.now()}`,
      ErrorCode: 0
    };

    return new Response(JSON.stringify(playbackInfo), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get base URL with actual network IP
  private getBaseUrl(): string {
    const { getLocalIpAddress } = require('../../utils/network');
    const localIp = getLocalIpAddress();
    const port = process.env.PORT || '4001';
    return `http://${localIp}:${port}`;
  }

  // Get grouping options (required by Infuse)
  private async getGroupingOptions(): Promise<Response> {
    return new Response(JSON.stringify([
      {
        Id: 'None',
        Name: 'None'
      }
    ]), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get items by grouping type (required by Infuse)
  private async getItemsByGrouping(url: URL, groupingType: string): Promise<Response> {
    // For "None" grouping, just return empty - Infuse will use the regular Items endpoint
    return new Response(JSON.stringify({
      Items: [],
      TotalRecordCount: 0,
      StartIndex: 0,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get virtual folders (required by Infuse)
  private async getVirtualFolders(): Promise<Response> {
    const folders = [];
    
    // Add streaming folder if available
    if (this.streamingServer) {
      folders.push({
        Name: '🎬 Now Playing',
        Id: 'library-streaming',
        Locations: ['/streaming'],
        CollectionType: 'homevideos', // Use 'homevideos' for home media collections
        LibraryOptions: {
          EnablePhotos: true,
          EnableRealtimeMonitor: false,
          EnableArchiveMediaFiles: false,
          EnableChapterImageExtraction: false,
          ExtractChapterImagesDuringLibraryScan: false,
          DownloadImagesInAdvance: false,
          PathInfos: [{
            Path: '/streaming'
          }],
          SaveLocalMetadata: false,
          EnableInternetProviders: false,
          EnableAutomaticSeriesGrouping: false,
          EnableEmbeddedTitles: false,
          EnableEmbeddedEpisodeInfos: false,
          AutomaticRefreshIntervalDays: 0,
          PreferredMetadataLanguage: '',
          MetadataCountryCode: '',
          SeasonZeroDisplayName: 'Specials',
          MetadataSavers: [],
          DisabledLocalMetadataReaders: [],
          LocalMetadataReaderOrder: [],
          DisabledSubtitleFetchers: [],
          SubtitleFetcherOrder: [],
          SkipSubtitlesIfEmbeddedSubtitlesPresent: false,
          SkipSubtitlesIfAudioTrackMatches: false,
          SubtitleDownloadLanguages: [],
          RequirePerfectSubtitleMatch: false,
          SaveSubtitlesWithMedia: false
        },
        ItemId: 'library-streaming',
        PrimaryImageItemId: null,
        RefreshStatus: 'Idle'
      });
    }
    
    return new Response(JSON.stringify(folders), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get display preferences (required by Infuse)
  private async getDisplayPreferences(): Promise<Response> {
    return new Response(JSON.stringify({
      Id: 'default',
      ViewType: 'Poster',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      IndexBy: 'None',
      RememberIndexing: false,
      PrimaryImageHeight: 250,
      PrimaryImageWidth: 250,
      ScrollDirection: 'Horizontal',
      ShowBackdrop: false,
      RememberSorting: true,
      ShowSidebar: true
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get library details (needed for Infuse to browse the library)
  private async getLibraryDetails(libraryId: string, request: Request): Promise<Response> {
    console.log(`🎭 Jellyfin: Getting library details for ${libraryId}`);
    
    if (libraryId === 'library-streaming') {
      // Return streaming library folder details
      const itemCount = this.streamingServer ? this.streamingServer.currentStreamingItems.size : 0;
      const etag = `W/"library-streaming-${itemCount}"`;
      
      // Check for conditional request
      const ifNoneMatch = request.headers.get('If-None-Match');
      if (ifNoneMatch && ifNoneMatch === etag) {
        console.log(`🎭 Jellyfin: Returning 304 Not Modified for library-streaming`);
        // Content hasn't changed, return 304 Not Modified
        return new Response(null, {
          status: 304,
          headers: {
            'ETag': etag,
            'Cache-Control': 'public, max-age=30',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      console.log(`🎭 Jellyfin: Returning library details with ${itemCount} items`);
      
      // Include all fields that Infuse requests via Fields parameter
      const libraryData = {
        Name: '🎬 Now Playing',
        ServerId: this.serverId,
        Id: 'library-streaming',
        Etag: etag.replace('W/', ''), // Remove weak validator prefix for JSON field
        DateCreated: new Date().toISOString(),
        CanDelete: false,
        CanDownload: true,
        SortName: '!Streaming',
        Path: '/streaming',
        Type: 'CollectionFolder',
        CollectionType: 'homevideos', // Use 'homevideos' for home media collections
        IsFolder: true,
        ParentId: null,
        LocationType: 'FileSystem',
        PlayAccess: 'Full',
        RecursiveItemCount: itemCount,
        ChildCount: itemCount,
        // Additional fields requested by Infuse
        Genres: [], // Empty array for collection folders
        MediaSources: [], // Collection folders don't have media sources
        AlternateMediaSources: [], // No alternate sources for folders
        Overview: 'Currently playing media items', // Description of the folder
        People: [], // No people for collection folders
        ProviderIds: {}, // No external provider IDs
        UserData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false,
          LastPlayedDate: null,
          Key: `library-streaming-default-user`
        },
        // Additional metadata that might help Infuse
        DisplayPreferencesId: 'library-streaming',
        PrimaryImageAspectRatio: null,
        BackdropImageTags: [],
        ScreenshotImageTags: [],
        Chapters: [],
        MediaType: null,
        Width: null,
        Height: null,
        IsPlaceHolder: false,
        Tags: [],
        RunTimeTicks: null,
        Studios: [],
        GenreItems: [],
        // Add these fields that might be expected
        ImageTags: {},
        BackdropImageItemId: null,
        IndexNumber: null,
        ParentIndexNumber: null,
        PremiereDate: null,
        ProductionYear: null,
        Status: null,
        CommunityRating: null,
        OfficialRating: null,
        CustomRating: null,
        OriginalTitle: null,
        SortIndexNumber: null,
        SortParentIndexNumber: null,
        AirTime: null,
        AirDays: null,
        IndexOptions: [],
        PrimaryImageTag: null,
        ThumbImageTag: null,
        ThumbImageItemId: null,
        BackdropImageTag: null,
        ParentLogoImageTag: null,
        SeriesName: null,
        SeriesId: null,
        SeasonId: null,
        SpecialFeatureCount: null,
        SoundtrackIds: null,
        VideoType: null,
        PartCount: null,
        MediaSourceCount: null,
        LocalTrailerCount: null,
        Video3DFormat: null,
        CriticRating: null,
        GameSystem: null,
        CriticRatingSummary: null,
        MultiPartGameFiles: null,
        IsHD: null,
        HasSubtitles: false,
        Container: null,
        IsShortcut: false,
        ShortcutPath: null,
        Taglines: [],
        Keywords: [],
        RemoteTrailers: [],
        ExtraIds: [],
        TmdbCollectionName: null,
        CollectionItems: []
      };
      
      return new Response(JSON.stringify(libraryData), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          // Add cache control to prevent excessive requests
          'Cache-Control': 'public, max-age=30',
          'ETag': etag
        }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
}

// Export plugin interface
export default {
  name: 'jellyfin',
  plugin: JellyfinPlugin,
};