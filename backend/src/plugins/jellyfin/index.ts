import { db, schema } from '../../db';
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm';
import { existsSync } from 'fs';
import { join } from 'path';

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


  // Handle Jellyfin API routes
  async handleRequest(request: Request): Promise<Response | null> {
    if (!this.enabled) return null;
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    // Don't handle GraphQL requests - let main server handle them
    if (path === '/graphql') {
      return null;
    }
    
    // Log all Jellyfin requests for debugging
    console.log(`🎭 Jellyfin: ${request.method} ${path}${url.search ? '?' + url.search : ''}`);
    
    // Handle CORS preflight requests
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
    
    // System endpoints
    if (path === '/System/Info/Public') {
      return this.getPublicSystemInfo();
    }
    
    if (path === '/System/Info') {
      return this.getSystemInfo();
    }
    
    // User endpoints (simplified - no auth)
    if (path === '/Users/Public') {
      return this.getPublicUsers();
    }
    
    // Authentication endpoint for Infuse
    if (path === '/Users/AuthenticateByName' && request.method === 'POST') {
      return this.authenticateUser(request);
    }
    
    if (path.match(/^\/Users\/[^\/]+$/)) {
      return this.getUser();
    }
    
    // User views endpoint (library collections)
    if (path.match(/^\/Users\/[^\/]+\/Views$/)) {
      return this.getUserViews();
    }
    
    // User grouping options
    if (path.match(/^\/Users\/[^\/]+\/GroupingOptions$/)) {
      return this.getGroupingOptions();
    }
    
    // Library folder details (e.g., /Users/default-user/Items/library-streaming)
    if (path.match(/^\/Users\/[^\/]+\/Items\/library-[^\/]+$/)) {
      const libraryId = path.split('/')[4];
      return this.getLibraryDetails(libraryId, url);
    }
    
    // Individual item details with user context (e.g., /Users/default-user/Items/12)
    // Must come before the generic Items endpoint
    if (path.match(/^\/Users\/[^\/]+\/Items\/[^\/]+$/) && !path.includes('?') && !isNaN(parseInt(path.split('/')[4]))) {
      const itemId = path.split('/')[4];
      return this.getItem(itemId);
    }
    
    // Items by grouping type (e.g., /Users/{userId}/Items/None)
    if (path.match(/^\/Users\/[^\/]+\/Items\/[^\/]+$/) && isNaN(parseInt(path.split('/')[4]))) {
      const groupingType = path.split('/')[4];
      return this.getItemsByGrouping(url, groupingType);
    }
    
    // Library endpoints (generic - must come after specific routes)
    if (path.match(/^\/Users\/[^\/]+\/Items$/)) {
      return this.getItems(url);
    }
    
    if (path.match(/^\/Items\/[^\/]+$/)) {
      const itemId = path.split('/')[2];
      return this.getItem(itemId);
    }
    
    // Image endpoints
    if (path.match(/^\/Items\/[^\/]+\/Images\/(Primary|Backdrop|Thumb)/)) {
      const parts = path.split('/');
      const itemId = parts[2];
      const imageType = parts[4];
      return this.getImage(itemId, imageType);
    }
    
    // Video streaming
    if (path.match(/^\/Videos\/[^\/]+\/stream/)) {
      const videoId = path.split('/')[2];
      return this.streamVideo(videoId, request);
    }
    
    // Item download
    if (path.match(/^\/Items\/[^\/]+\/Download$/)) {
      const itemId = path.split('/')[2];
      return this.downloadItem(itemId, request);
    }
    
    
    // PlaybackInfo endpoint for streaming details
    if (path.match(/^\/Items\/[^\/]+\/PlaybackInfo$/)) {
      const itemId = path.split('/')[2];
      return this.getPlaybackInfo(itemId, url);
    }
    
    // MediaSegments endpoint (for chapter/segment info)
    if (path.match(/^\/MediaSegments\/[^\/]+$/)) {
      const itemId = path.split('/')[2];
      return this.getMediaSegments(itemId);
    }
    
    // Library structure
    if (path === '/Library/VirtualFolders') {
      return this.getVirtualFolders();
    }
    
    // Server capabilities (Infuse may check this)
    if (path === '/System/Endpoint') {
      return this.getEndpoints();
    }
    
    // Branding configuration
    if (path === '/Branding/Configuration') {
      return this.getBrandingConfiguration();
    }
    
    // Session endpoints
    if (path.match(/^\/Sessions/)) {
      return this.handleSession(request);
    }
    
    // Latest items endpoint
    if (path.match(/^\/Users\/[^\/]+\/Items\/Latest$/)) {
      return this.getLatestItems(url);
    }
    
    // Display preferences
    if (path.match(/^\/DisplayPreferences/)) {
      return this.getDisplayPreferences();
    }
    
    // User settings
    if (path === '/System/Configuration') {
      return this.getSystemConfiguration();
    }
    
    // Health check endpoint
    if (path === '/health' || path === '/System/Ping') {
      return this.getHealthCheck();
    }
    
    // User configuration
    if (path.match(/^\/Users\/[^\/]+\/Configuration$/)) {
      return this.getUserConfiguration();
    }
    
    // Plugins endpoint
    if (path === '/Plugins') {
      return this.getPlugins();
    }
    
    // Shows/NextUp endpoint
    if (path === '/Shows/NextUp') {
      return this.getNextUp(url);
    }
    
    return null;
  }

  // System info for Infuse
  private async getPublicSystemInfo(): Promise<Response> {
    // Get the actual network IP address
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

  private async getSystemInfo(): Promise<Response> {
    // Get the actual network IP address
    const { getLocalIpAddress } = await import('../../utils/network');
    const localIp = getLocalIpAddress();
    const port = process.env.PORT || '4001';
    
    const info = {
      SystemUpdateLevel: 'Release',
      OperatingSystemDisplayName: 'Linux',
      HasPendingRestart: false,
      IsShuttingDown: false,
      SupportsLibraryMonitor: true,
      WebSocketPortNumber: 8096,
      CompletedInstallations: [],
      CanSelfRestart: true,
      CanLaunchWebBrowser: false,
      ProgramDataPath: '/config',
      ItemsByNamePath: '/config/metadata',
      CachePath: '/cache',
      LogPath: '/config/log',
      InternalMetadataPath: '/config/metadata',
      TranscodingTempPath: '/transcode',
      HttpServerPortNumber: parseInt(port),
      SupportsHttps: false,
      HasUpdateAvailable: false,
      SupportsAutoRunAtStartup: false,
      HardwareAccelerationRequiresPremiere: false,
      LocalAddress: `http://${localIp}:${port}`,
      WanAddress: `http://${localIp}:${port}`,
      ServerName: this.serverName,
      Version: '10.8.0',
      OperatingSystem: 'Linux',
      Id: this.serverId,
    };
    
    return new Response(JSON.stringify(info), {
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
        EnableAllFolders: true,
        EnableMediaPlayback: true,
        EnableVideoPlayback: true,
        EnableAudioPlayback: true,
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

  // Handle authentication request from Infuse
  private async authenticateUser(request: Request): Promise<Response> {
    // Since we don't have real authentication, accept any credentials
    const body = await request.json().catch(() => ({}));
    console.log('🔐 Authentication request:', body);
    
    const accessToken = 'runecortex-' + Date.now();
    const sessionId = 'session-' + Date.now();
    const userAgent = request.headers.get('user-agent') || 'Unknown';
    
    console.log('🎭 User-Agent:', userAgent);
    
    // Add a small delay to simulate real server processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Return a successful authentication response compatible with Jellyfin 10.8.x
    return new Response(JSON.stringify({
      User: {
        Name: body.Username || 'guest',
        ServerId: this.serverId,
        Id: 'default-user',
        PrimaryImageTag: null,
        HasPassword: false,
        HasConfiguredPassword: false,
        HasConfiguredEasyPassword: false,
        EnableAutoLogin: false,
        LastLoginDate: new Date().toISOString(),
        LastActivityDate: new Date().toISOString(),
        Configuration: {
          AudioLanguagePreference: '',
          PlayDefaultAudioTrack: true,
          SubtitleLanguagePreference: '',
          DisplayMissingEpisodes: false,
          GroupedFolders: [],
          SubtitleMode: 'Default',
          DisplayCollectionsView: false,
          EnableLocalPassword: false,
          OrderedViews: [],
          LatestItemsExcludes: [],
          MyMediaExcludes: [],
          HidePlayedInLatest: true,
          RememberAudioSelections: true,
          RememberSubtitleSelections: true,
          EnableNextEpisodeAutoPlay: true
        },
        Policy: {
          IsAdministrator: true,
          IsHidden: false,
          IsDisabled: false,
          MaxParentalRating: null,
          BlockedTags: [],
          EnableUserPreferenceAccess: true,
          AccessSchedules: [],
          BlockUnratedItems: [],
          EnableRemoteControlOfOtherUsers: true,
          EnableSharedDeviceControl: true,
          EnableRemoteAccess: true,
          EnableLiveTvManagement: true,
          EnableLiveTvAccess: true,
          EnableMediaPlayback: true,
          EnableAudioPlaybackTranscoding: true,
          EnableVideoPlaybackTranscoding: true,
          EnablePlaybackRemuxing: true,
          ForceRemoteSourceTranscoding: false,
          EnableContentDeletion: false,
          EnableContentDeletionFromFolders: [],
          EnableContentDownloading: true,
          EnableSyncTranscoding: true,
          EnableMediaConversion: true,
          EnabledDevices: [],
          EnableAllDevices: true,
          EnabledChannels: [],
          EnableAllChannels: true,
          EnabledFolders: [],
          EnableAllFolders: true,
          InvalidLoginAttemptCount: 0,
          LoginAttemptsBeforeLockout: -1,
          MaxActiveSessions: 0,
          EnablePublicSharing: true,
          BlockedMediaFolders: [],
          BlockedChannels: [],
          RemoteClientBitrateLimit: 0,
          AuthenticationProviderId: 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
          PasswordResetProviderId: 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
          SyncPlayAccess: 'CreateAndJoinGroups'
        }
      },
      SessionInfo: {
        PlayState: {
          CanSeek: true,
          IsPaused: false,
          IsMuted: false,
          RepeatMode: 'RepeatNone'
        },
        AdditionalUsers: [],
        Capabilities: {
          PlayableMediaTypes: ['Audio', 'Video', 'Photo'],
          SupportedCommands: ['MoveUp', 'MoveDown', 'MoveLeft', 'MoveRight', 'Select'],
          SupportsMediaControl: true,
          SupportsContentUploading: false,
          SupportsPersistentIdentifier: true,
          SupportsSync: false,
          DeviceProfile: {
            MaxStreamingBitrate: 120000000,
            MaxStaticBitrate: 100000000,
            MusicStreamingTranscodingBitrate: 384000
          }
        },
        RemoteEndPoint: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || '127.0.0.1',
        PlayableMediaTypes: ['Audio', 'Video', 'Photo'],
        Id: sessionId,
        UserId: 'default-user',
        UserName: body.Username || 'guest',
        Client: 'Infuse',
        LastActivityDate: new Date().toISOString(),
        DeviceName: 'Infuse',
        DeviceId: 'infuse-device-' + Math.random().toString(36).substring(7),
        ApplicationVersion: '7.8.1',
        IsActive: true,
        SupportsMediaControl: true,
        SupportsRemoteControl: true,
        NowPlayingItem: null,
        NowPlayingQueueFullItems: [],
        HasCustomDeviceName: false,
        ServerId: this.serverId,
        SupportedCommands: ['MoveUp', 'MoveDown', 'MoveLeft', 'MoveRight', 'Select']
      },
      AccessToken: accessToken,
      ServerId: this.serverId
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Emby-Authorization, X-MediaBrowser-Token',
        'Server': 'Jellyfin/10.8.0',
        'X-Response-Time-ms': '50'
      }
    });
  }

  // Get user views (library collections)
  private async getUserViews(): Promise<Response> {
    // Get enabled folders as library views
    const folders = await db.select()
      .from(schema.indexedFolders)
      .where(eq(schema.indexedFolders.enabled, true));
    
    console.log('📁 Jellyfin: Found', folders.length, 'indexed folders');
    if (this.streamingServer) {
    }
    
    // Create views array starting with streaming folder
    const views = [];
    
    // Add streaming folder as first view (if it has items)
    if (this.streamingServer && this.streamingServer.currentStreamingItems.size > 0) {
      views.push({
        Name: '🎬 Now Playing',
        ServerId: this.serverId,
        Id: 'library-streaming',
        Etag: 'library-streaming',
        DateCreated: new Date().toISOString(),
        CanDelete: false,
        CanDownload: true,
        SortName: '!Streaming', // ! to sort first
        ExternalUrls: [],
        Path: '/streaming',
        EnableMediaSourceDisplay: false,
        Taglines: [],
        Genres: [],
        PlayAccess: 'Full',
        RemoteTrailers: [],
        ProviderIds: {},
        IsFolder: true,
        ParentId: null,
        Type: 'CollectionFolder',
        People: [],
        Studios: [],
        GenreItems: [],
        LocalTrailerCount: 0,
        UserData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false,
          Key: 'library-streaming'
        },
        SpecialFeatureCount: 0,
        DisplayPreferencesId: 'library-streaming',
        Tags: [],
        PrimaryImageAspectRatio: 1,
        CollectionType: 'homevideos',
        ImageTags: {},
        BackdropImageTags: [],
        ScreenshotImageTags: [],
        LocationType: 'FileSystem',
        LockedFields: [],
        LockData: false
      });
    }
    
    // Add regular folder views
    const folderViews = folders.length > 0 ? folders.map((folder, index) => ({
      Name: folder.path.split('/').pop() || 'Media',
      ServerId: this.serverId,
      Id: `library-${folder.id}`,
      Etag: `library-${folder.id}`,
      DateCreated: folder.addedAt.toISOString(),
      CanDelete: false,
      CanDownload: true,
      SortName: folder.path.split('/').pop() || 'Media',
      ExternalUrls: [],
      Path: folder.path,
      EnableMediaSourceDisplay: false,
      Taglines: [],
      Genres: [],
      PlayAccess: 'Full',
      RemoteTrailers: [],
      ProviderIds: {},
      IsFolder: true,
      ParentId: null,
      Type: 'CollectionFolder',
      People: [],
      Studios: [],
      GenreItems: [],
      LocalTrailerCount: 0,
      UserData: {
        PlaybackPositionTicks: 0,
        PlayCount: 0,
        IsFavorite: false,
        Played: false,
        Key: `library-${folder.id}`
      },
      SpecialFeatureCount: 0,
      DisplayPreferencesId: `library-${folder.id}`,
      Tags: [],
      PrimaryImageAspectRatio: 1,
      CollectionType: 'homevideos',
      ImageTags: {},
      BackdropImageTags: [],
      ScreenshotImageTags: [],
      LocationType: 'FileSystem',
      LockedFields: [],
      LockData: false
    })) : [{
      Name: 'All Media',
      ServerId: this.serverId,
      Id: 'library-all',
      Etag: 'library-all',
      DateCreated: new Date().toISOString(),
      CanDelete: false,
      CanDownload: true,
      SortName: 'All Media',
      ExternalUrls: [],
      Path: '/',
      EnableMediaSourceDisplay: false,
      Taglines: [],
      Genres: [],
      PlayAccess: 'Full',
      RemoteTrailers: [],
      ProviderIds: {},
      IsFolder: true,
      ParentId: null,
      Type: 'CollectionFolder',
      People: [],
      Studios: [],
      GenreItems: [],
      LocalTrailerCount: 0,
      UserData: {
        PlaybackPositionTicks: 0,
        PlayCount: 0,
        IsFavorite: false,
        Played: false,
        Key: 'library-all'
      },
      SpecialFeatureCount: 0,
      DisplayPreferencesId: 'library-all',
      Tags: [],
      PrimaryImageAspectRatio: 1,
      CollectionType: 'homevideos',
      ImageTags: {},
      BackdropImageTags: [],
      ScreenshotImageTags: [],
      LocationType: 'FileSystem',
      LockedFields: [],
      LockData: false
    }];
    
    // Combine streaming view with folder views
    views.push(...folderViews);
    
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

  // Get grouping options for user
  private async getGroupingOptions(): Promise<Response> {
    // Return available grouping options for organizing media
    return new Response(JSON.stringify([
      {
        Id: 'None',
        Name: 'None'
      },
      {
        Id: 'Name',
        Name: 'Name'
      },
      {
        Id: 'ProductionYear',
        Name: 'Year'
      },
      {
        Id: 'DateCreated',
        Name: 'Date Added'
      },
      {
        Id: 'PremiereDate',
        Name: 'Release Date'
      },
      {
        Id: 'Random',
        Name: 'Random'
      }
    ]), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get items by grouping type
  private async getItemsByGrouping(url: URL, groupingType: string): Promise<Response> {
    const params = url.searchParams;
    const includeItemTypes = params.get('IncludeItemTypes');
    const recursive = params.get('Recursive') === 'true';
    const sortBy = params.get('SortBy') || 'DateCreated';
    const sortOrder = params.get('SortOrder') || 'Descending';
    const startIndex = parseInt(params.get('StartIndex') || '0');
    const limit = parseInt(params.get('Limit') || '100');
    const parentId = params.get('ParentId');
    
    // For "None" grouping, just return regular items
    if (groupingType === 'None') {
      // Check if this is the streaming library
      if (parentId === 'library-streaming') {
        // Get streaming server instance
        if (!this.streamingServer) {
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
        
        // Get streaming items in order
        const streamingItems = this.streamingServer.orderedItemIds
          .map(id => this.streamingServer.currentStreamingItems.get(id))
          .filter(item => item !== undefined);
        
        // Convert to Jellyfin format
        const jellyfinItems = streamingItems.map(item => ({
          Name: item.filename,
          ServerId: this.serverId,
          Id: item.id.toString(),
          DateCreated: item.createdAt,
          PremiereDate: item.createdAt,
          ProductionYear: new Date(item.createdAt).getFullYear(),
          Type: item.fileType === 'video' ? 'Movie' : 'Photo',
          MediaType: item.fileType === 'video' ? 'Video' : 'Photo',
          LocationType: 'FileSystem',
          MediaSources: item.fileType === 'video' ? [{
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
            SupportsProbing: true,
            MediaStreams: [{
              Codec: item.fileType === 'video' ? 'h264' : 'mjpeg',
              Type: 'Video',
              Height: item.height,
              Width: item.width,
              Index: 0,
            }],
          }] : null,
          ImageTags: {
            Primary: item.thumbnailId || null,
          },
          BackdropImageTags: [],
          ParentId: 'library-streaming',
          PlayAccess: 'Full',
          UserData: {
            PlaybackPositionTicks: 0,
            PlayCount: 0,
            IsFavorite: false,
            Played: false,
          },
          Width: item.width,
          Height: item.height,
        }));
        
        // Apply pagination
        const paginatedItems = jellyfinItems.slice(startIndex, startIndex + limit);
        
        return new Response(JSON.stringify({
          Items: paginatedItems,
          TotalRecordCount: jellyfinItems.length,
          StartIndex: startIndex,
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // Get media items from database
      let query = db.select().from(schema.mediaItems);
      
      // If parentId is a library ID, filter by the corresponding folder
      if (parentId && parentId.startsWith('library-')) {
        const folderId = parseInt(parentId.replace('library-', ''));
        if (!isNaN(folderId)) {
          const [folder] = await db.select()
            .from(schema.indexedFolders)
            .where(eq(schema.indexedFolders.id, folderId))
            .limit(1);
          
          if (folder) {
            // Filter items by folder path
            query = query.where(sql`${schema.mediaItems.filepath} LIKE ${folder.path + '%'}`);
          }
        }
      }
      
      // Filter by type if specified
      if (includeItemTypes) {
        const types = includeItemTypes.split(',');
        if (types.includes('Movie') && !types.includes('Photo')) {
          query = query.where(eq(schema.mediaItems.fileType, 'video'));
        } else if (types.includes('Photo') && !types.includes('Movie')) {
          query = query.where(eq(schema.mediaItems.fileType, 'image'));
        }
      }
      
      // Apply sorting
      if (sortOrder === 'Descending') {
        query = query.orderBy(desc(schema.mediaItems.createdAt));
      } else {
        query = query.orderBy(schema.mediaItems.createdAt);
      }
      
      // Get total count with same filters
      let countQuery = db.select({ count: sql<number>`COUNT(*)` }).from(schema.mediaItems);
      
      // Apply same filters to count query
      if (parentId && parentId.startsWith('library-')) {
        const folderId = parseInt(parentId.replace('library-', ''));
        if (!isNaN(folderId)) {
          const [folder] = await db.select()
            .from(schema.indexedFolders)
            .where(eq(schema.indexedFolders.id, folderId))
            .limit(1);
          
          if (folder) {
            countQuery = countQuery.where(sql`${schema.mediaItems.filepath} LIKE ${folder.path + '%'}`);
          }
        }
      }
      
      if (includeItemTypes) {
        const types = includeItemTypes.split(',');
        if (types.includes('Movie') && !types.includes('Photo')) {
          countQuery = countQuery.where(eq(schema.mediaItems.fileType, 'video'));
        } else if (types.includes('Photo') && !types.includes('Movie')) {
          countQuery = countQuery.where(eq(schema.mediaItems.fileType, 'image'));
        }
      }
      
      const [{ count: totalCount }] = await countQuery;
      
      // Apply pagination
      query = query.limit(limit).offset(startIndex);
      
      const items = await query;
      
      // Convert to Jellyfin format  
      const jellyfinItems = items.map(item => {
        const converted = this.convertToJellyfinItem(item);
        // Set correct parent ID for library browsing
        if (parentId) {
          converted.ParentId = parentId;
        }
        return converted;
      });
      
      return new Response(JSON.stringify({
        Items: jellyfinItems,
        TotalRecordCount: totalCount,
        StartIndex: startIndex,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // For other grouping types, return empty for now
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

  // Get media items with Jellyfin format
  private async getItems(url: URL): Promise<Response> {
    // Handle double ?? in URL that some clients send
    const urlString = url.toString().replace('??', '?');
    const fixedUrl = new URL(urlString);
    const params = fixedUrl.searchParams;
    const parentId = params.get('ParentId') || params.get('parentId');
    const includeItemTypes = params.get('IncludeItemTypes');
    const recursive = params.get('Recursive') === 'true';
    const sortBy = params.get('SortBy') || 'DateCreated';
    const sortOrder = params.get('SortOrder') || 'Descending';
    const startIndex = parseInt(params.get('StartIndex') || '0');
    const limit = parseInt(params.get('Limit') || '100');
    
    // Handle streaming library specially
    if (parentId === 'library-streaming') {
      console.log('🎭 Jellyfin: Requested streaming library items');
      
      // Get streaming server instance
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
      
      // Convert to Jellyfin format with minimal required fields
      const jellyfinItems = paginatedItems.map(item => ({
        Name: item.filename,
        ServerId: this.serverId,
        Id: item.id.toString(),
        Etag: item.id.toString(),
        DateCreated: item.createdAt,
        Type: item.fileType === 'video' ? 'Movie' : 'Photo',
        MediaType: item.fileType === 'video' ? 'Video' : 'Photo',
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
          SupportsDirectPlay: true
        }],
        ParentId: 'library-streaming',
        PlayAccess: 'Full',
        UserData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false
        }
      }));
      
      console.log('🎭 Jellyfin: Returning', jellyfinItems.length, 'items to Infuse (total:', streamingItems.length, ')');
      if (jellyfinItems.length > 0) {
        console.log('🎭 Jellyfin: First item sample:', JSON.stringify(jellyfinItems[0], null, 2));
      }
      
      const response = {
        Items: jellyfinItems,
        TotalRecordCount: streamingItems.length,
        StartIndex: startIndex,
      };
      
      return new Response(JSON.stringify(response), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Get media items from database
    let query = db.select().from(schema.mediaItems);
    
    // If parentId is a library ID, filter by the corresponding folder
    if (parentId && parentId.startsWith('library-')) {
      const folderId = parseInt(parentId.replace('library-', ''));
      if (!isNaN(folderId)) {
        const [folder] = await db.select()
          .from(schema.indexedFolders)
          .where(eq(schema.indexedFolders.id, folderId))
          .limit(1);
        
        if (folder) {
          // Filter items by folder path
          query = query.where(sql`${schema.mediaItems.filepath} LIKE ${folder.path + '%'}`);
        }
      }
    }
    
    // Filter by type if specified
    if (includeItemTypes) {
      const types = includeItemTypes.split(',');
      if (types.includes('Movie') && !types.includes('Series')) {
        query = query.where(eq(schema.mediaItems.fileType, 'video'));
      } else if (types.includes('Photo') && !types.includes('Movie')) {
        query = query.where(eq(schema.mediaItems.fileType, 'image'));
      }
    }
    
    // Apply sorting
    if (sortOrder === 'Descending') {
      query = query.orderBy(desc(schema.mediaItems.createdAt));
    } else {
      query = query.orderBy(schema.mediaItems.createdAt);
    }
    
    // Apply pagination
    query = query.limit(limit).offset(startIndex);
    
    const items = await query;
    
    // Convert to Jellyfin format
    const jellyfinItems = items.map(item => this.convertToJellyfinItem(item));
    
    return new Response(JSON.stringify({
      Items: jellyfinItems,
      TotalRecordCount: jellyfinItems.length,
      StartIndex: startIndex,
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get single item
  private async getItem(itemId: string): Promise<Response> {
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }
    
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

  // Convert our media item to Jellyfin format
  private convertToJellyfinItem(item: any) {
    const isVideo = item.fileType === 'video';
    // Use a method to get the base URL that can be overridden
    const baseUrl = this.getBaseUrl();
    
    return {
      Name: item.filename,
      ServerId: this.serverId,
      Id: item.id.toString(),
      DateCreated: item.createdAt,
      PremiereDate: item.createdAt,
      ProductionYear: new Date(item.createdAt).getFullYear(),
      Type: isVideo ? 'Movie' : 'Photo',
      MediaType: isVideo ? 'Video' : 'Photo',
      LocationType: 'FileSystem',
      MediaSources: isVideo ? [{
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
        SupportsProbing: true,
        MediaStreams: [{
          Codec: isVideo ? 'h264' : 'mjpeg',
          CodecTag: isVideo ? 'avc1' : null,
          Language: 'und',
          ColorSpace: null,
          Title: null,
          VideoRange: 'SDR',
          DisplayTitle: item.filename,
          IsInterlaced: false,
          BitRate: null,
          BitDepth: 8,
          RefFrames: 1,
          IsDefault: true,
          IsForced: false,
          Height: item.height,
          Width: item.width,
          RealFrameRate: isVideo ? 30 : null,
          Profile: isVideo ? 'High' : null,
          Type: 'Video',
          AspectRatio: item.width && item.height ? `${item.width}:${item.height}` : null,
          Index: 0,
          IsExternal: false,
          IsTextSubtitleStream: false,
          SupportsExternalStream: false,
          PixelFormat: 'yuv420p',
          Level: isVideo ? 41 : null,
        }],
        Bitrate: null,
        RequiredHttpHeaders: {},
      }] : null,
      ImageTags: {
        Primary: item.thumbnailGenerated ? item.id.toString() : null,
      },
      BackdropImageTags: [],
      ParentId: null,
      PlayAccess: 'Full',
      UserData: {
        PlaybackPositionTicks: 0,
        PlayCount: 0,
        IsFavorite: false,
        Played: false,
      },
      PrimaryImageAspectRatio: item.width && item.height ? item.width / item.height : 1,
      Width: item.width,
      Height: item.height,
    };
  }

  // Get base URL with actual network IP
  private getBaseUrl(): string {
    const { getLocalIpAddress } = require('../../utils/network');
    const localIp = getLocalIpAddress();
    const port = process.env.PORT || '4001';
    return `http://${localIp}:${port}`;
  }

  // Serve images
  private async getImage(itemId: string, imageType: string): Promise<Response> {
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }
    
    // For now, just redirect to our thumbnail endpoint
    const redirectUrl = `${this.getBaseUrl()}/thumbnails/${mediaId}.jpg`;
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

  // Download item endpoint
  private async downloadItem(itemId: string, request: Request): Promise<Response> {
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }
    
    // Redirect to our media serving endpoint
    const redirectUrl = `${this.getBaseUrl()}/media/${mediaId}`;
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Virtual folders for library structure
  private async getVirtualFolders(): Promise<Response> {
    const folders = await db.select()
      .from(schema.indexedFolders)
      .where(eq(schema.indexedFolders.enabled, true));
    
    const virtualFolders = folders.map((folder, index) => ({
      Name: folder.path.split('/').pop() || 'Media',
      Locations: [folder.path],
      CollectionType: 'homevideos',
      LibraryOptions: {
        EnablePhotos: true,
        EnableRealtimeMonitor: false,
        EnableChapterImageExtraction: false,
        ExtractChapterImagesDuringLibraryScan: false,
        PathInfos: [{
          Path: folder.path,
          NetworkPath: folder.path,
        }],
        SaveLocalMetadata: false,
        EnableInternetProviders: false,
        EnableAutomaticSeriesGrouping: false,
        EnableEmbeddedTitles: false,
        EnableEmbeddedEpisodeInfos: false,
        AutomaticRefreshIntervalDays: 0,
        PreferredMetadataLanguage: 'en',
        MetadataCountryCode: 'US',
        SeasonZeroDisplayName: 'Specials',
        SaveLocalThumbnailSets: false,
        EnableExternalContentInSuggestions: false,
      },
      ItemId: `folder-${index}`,
      Id: `folder-${index}`,
      Guid: `folder-${index}`,
      PrimaryImageItemId: null,
      RefreshProgress: null,
      RefreshStatus: 'Idle',
    }));
    
    return new Response(JSON.stringify(virtualFolders), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get server endpoints
  private async getEndpoints(): Promise<Response> {
    const baseUrl = this.getBaseUrl();
    return new Response(JSON.stringify({
      IsLocal: true,
      IsInNetwork: true
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get branding configuration
  private async getBrandingConfiguration(): Promise<Response> {
    return new Response(JSON.stringify({
      LoginDisclaimer: '',
      CustomCss: '',
      SplashscreenEnabled: false
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Handle session endpoints
  private async handleSession(request: Request): Promise<Response> {
    return new Response(JSON.stringify({
      Id: 'session-' + Date.now(),
      UserId: 'default-user',
      UserName: 'Default',
      Client: 'Infuse',
      LastActivityDate: new Date().toISOString(),
      DeviceName: 'Infuse',
      DeviceId: 'infuse-device',
      ApplicationVersion: '1.0.0',
      IsActive: true,
      SupportsMediaControl: true,
      SupportsRemoteControl: true,
      PlayState: {
        CanSeek: true,
        IsPaused: false,
        IsMuted: false,
        RepeatMode: 'RepeatNone'
      },
      ServerId: this.serverId
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get latest items
  private async getLatestItems(url?: URL): Promise<Response> {
    const params = url?.searchParams;
    const parentId = params?.get('parentId');
    const limit = parseInt(params?.get('limit') || '20');
    
    // If requesting latest items for streaming library
    if (parentId === 'library-streaming') {
      if (!this.streamingServer || this.streamingServer.currentStreamingItems.size === 0) {
        return new Response(JSON.stringify([]), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
      
      // Get latest streaming items
      const streamingItems = this.streamingServer.orderedItemIds
        .slice(0, limit)
        .map(id => this.streamingServer.currentStreamingItems.get(id))
        .filter(item => item !== undefined);
      
      const jellyfinItems = streamingItems.map(item => ({
        Name: item.filename,
        ServerId: this.serverId,
        Id: item.id.toString(),
        DateCreated: item.createdAt,
        PremiereDate: item.createdAt,
        ProductionYear: new Date(item.createdAt).getFullYear(),
        Type: item.fileType === 'video' ? 'Movie' : 'Photo',
        MediaType: item.fileType === 'video' ? 'Video' : 'Photo',
        LocationType: 'FileSystem',
        ParentId: parentId,
        PlayAccess: 'Full',
        UserData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false,
        },
        Width: item.width,
        Height: item.height,
      }));
      
      return new Response(JSON.stringify(jellyfinItems), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Regular latest items query
    let query = db.select().from(schema.mediaItems);
    
    // Filter by folder if parentId specified
    if (parentId && parentId.startsWith('library-')) {
      const folderId = parseInt(parentId.replace('library-', ''));
      if (!isNaN(folderId)) {
        const [folder] = await db.select()
          .from(schema.indexedFolders)
          .where(eq(schema.indexedFolders.id, folderId))
          .limit(1);
        
        if (folder) {
          query = query.where(sql`${schema.mediaItems.filepath} LIKE ${folder.path + '%'}`);
        }
      }
    }
    
    const items = await query
      .orderBy(desc(schema.mediaItems.createdAt))
      .limit(limit);
    
    const jellyfinItems = items.map(item => {
      const converted = this.convertToJellyfinItem(item);
      if (parentId) {
        converted.ParentId = parentId;
      }
      return converted;
    });
    
    return new Response(JSON.stringify(jellyfinItems), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get display preferences
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

  // Get system configuration
  private async getSystemConfiguration(): Promise<Response> {
    return new Response(JSON.stringify({
      ServerName: this.serverName,
      Version: '10.8.0',
      LocalAddress: this.getBaseUrl(),
      WanAddress: this.getBaseUrl(),
      EnableExternalContentInSuggestions: false,
      RequireHttps: false,
      PublicHttpsPort: 8920,
      HttpServerPortNumber: parseInt(process.env.PORT || '4001'),
      HttpsPortNumber: 8920,
      EnableHttps: false,
      IsPortAuthorized: true,
      EnableRemoteAccess: true,
      LogFileRetentionDays: 3,
      RunAtStartup: false,
      IsStartupWizardCompleted: true,
      EnableUPnP: false,
      EnableMetrics: false,
      PublicPort: parseInt(process.env.PORT || '4001'),
      EnableCaseSensitiveItemIds: true,
      MetadataPath: '/config/metadata',
      MetadataNetworkPath: '',
      PreferredMetadataLanguage: 'en',
      MetadataCountryCode: 'US',
      SaveMetadataInFolders: false,
      EnableAutomaticSeriesGrouping: false,
      EnableEmbeddedTitles: false,
      EnableEmbeddedEpisodeInfos: false,
      AutomaticRefreshIntervalDays: 0,
      LibraryRefreshInterval: 1440,
      ImageSavingConvention: 'Compatible',
      EnableFolderView: true,
      EnableGroupingIntoCollections: false,
      DisplaySpecialsWithinSeasons: true,
      MinResumePct: 5,
      MaxResumePct: 90,
      MinResumeDurationSeconds: 300,
      RemoteClientBitrateLimit: 0,
      EnableDashboardResponseCaching: true,
      DashboardSourcePath: '',
      ImageExtractionTimeoutMs: 0,
      FindInternetTrailers: false,
      PathSubstitutions: [],
      UninstalledPlugins: [],
      FailedPluginAssemblies: [],
      Plugins: [],
      ChapterImageResolution: 'MatchSource',
      ParallelImageEncodingLimit: 0,
      CastReceiverApplications: [],
      TrickplayOptions: {
        EnableHwAcceleration: false,
        EnableHwEncoding: false,
        ScanBehavior: 'NonBlocking',
        ProcessPriority: 'Normal',
        Interval: 10000,
        WidthResolutions: [320],
        TileWidth: 10,
        TileHeight: 10,
        Qscale: 4,
        JpegQuality: 90,
        ProcessThreads: 1
      }
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Health check endpoint
  private async getHealthCheck(): Promise<Response> {
    return new Response(JSON.stringify({
      status: 'Healthy',
      version: '10.8.0'
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // User configuration endpoint
  private async getUserConfiguration(): Promise<Response> {
    return new Response(JSON.stringify({
      AudioLanguagePreference: '',
      PlayDefaultAudioTrack: true,
      SubtitleLanguagePreference: '',
      DisplayMissingEpisodes: false,
      GroupedFolders: [],
      SubtitleMode: 'Default',
      DisplayCollectionsView: false,
      EnableLocalPassword: false,
      OrderedViews: [],
      LatestItemsExcludes: [],
      MyMediaExcludes: [],
      HidePlayedInLatest: true,
      RememberAudioSelections: true,
      RememberSubtitleSelections: true,
      EnableNextEpisodeAutoPlay: true
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get plugins endpoint
  private async getPlugins(): Promise<Response> {
    return new Response(JSON.stringify([]), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get next up shows (TV series continuation)
  private async getNextUp(url: URL): Promise<Response> {
    // Return empty array since we don't have TV series functionality
    return new Response(JSON.stringify({
      Items: [],
      TotalRecordCount: 0,
      StartIndex: 0
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get playback info for media streaming
  private async getPlaybackInfo(itemId: string, url: URL): Promise<Response> {
    const mediaId = parseInt(itemId);
    if (isNaN(mediaId)) {
      return new Response('Not found', { status: 404 });
    }

    // Check if item is in streaming folder first
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
        MediaStreams: isVideo ? [{
          Codec: item.filepath.split('.').pop(),
          Type: 'Video',
          Index: 0,
          IsDefault: true,
          Width: item.width || 1920,
          Height: item.height || 1080,
        }] : undefined,
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

  // Get media segments (chapters/bookmarks)
  private async getMediaSegments(itemId: string): Promise<Response> {
    // Return empty segments as we don't have chapter/segment functionality
    return new Response(JSON.stringify({
      Items: []
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Get library folder details
  private async getLibraryDetails(libraryId: string, url: URL): Promise<Response> {
    // Handle double ?? in URL that some clients send
    const urlString = url.toString().replace('??', '?');
    const fixedUrl = new URL(urlString);
    
    if (libraryId === 'library-streaming') {
      // Return streaming library folder details
      const itemCount = this.streamingServer ? this.streamingServer.currentStreamingItems.size : 0;
      
      return new Response(JSON.stringify({
        Name: '🎬 Now Playing',
        ServerId: this.serverId,
        Id: 'library-streaming',
        Etag: 'library-streaming',
        DateCreated: new Date().toISOString(),
        CanDelete: false,
        CanDownload: true,
        SortName: '!Streaming',
        ExternalUrls: [],
        Path: '/streaming',
        EnableMediaSourceDisplay: false,
        Taglines: [],
        Genres: [],
        PlayAccess: 'Full',
        RemoteTrailers: [],
        ProviderIds: {},
        IsFolder: true,
        ParentId: null,
        Type: 'CollectionFolder',
        People: [],
        Studios: [],
        GenreItems: [],
        LocalTrailerCount: 0,
        UserData: {
          PlaybackPositionTicks: 0,
          PlayCount: 0,
          IsFavorite: false,
          Played: false,
          Key: 'library-streaming'
        },
        SpecialFeatureCount: 0,
        DisplayPreferencesId: 'library-streaming',
        Tags: [],
        PrimaryImageAspectRatio: 1,
        CollectionType: 'homevideos',
        ImageTags: {},
        BackdropImageTags: [],
        ScreenshotImageTags: [],
        LocationType: 'FileSystem',
        LockedFields: [],
        LockData: false,
        RecursiveItemCount: itemCount,
        ChildCount: itemCount
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
    
    // Handle other library IDs
    const folderId = parseInt(libraryId.replace('library-', ''));
    if (!isNaN(folderId)) {
      const [folder] = await db.select()
        .from(schema.indexedFolders)
        .where(eq(schema.indexedFolders.id, folderId))
        .limit(1);
      
      if (folder) {
        // Get item count for this folder
        const itemCount = await db.select({ count: sql`count(*)` })
          .from(schema.mediaItems)
          .where(sql`${schema.mediaItems.filepath} LIKE ${folder.path + '%'}`);
        
        return new Response(JSON.stringify({
          Name: folder.path.split('/').pop() || 'Media',
          ServerId: this.serverId,
          Id: libraryId,
          Etag: libraryId,
          DateCreated: folder.addedAt.toISOString(),
          CanDelete: false,
          CanDownload: true,
          SortName: folder.path.split('/').pop() || 'Media',
          ExternalUrls: [],
          Path: folder.path,
          EnableMediaSourceDisplay: false,
          Taglines: [],
          Genres: [],
          PlayAccess: 'Full',
          RemoteTrailers: [],
          ProviderIds: {},
          IsFolder: true,
          ParentId: null,
          Type: 'CollectionFolder',
          People: [],
          Studios: [],
          GenreItems: [],
          LocalTrailerCount: 0,
          UserData: {
            PlaybackPositionTicks: 0,
            PlayCount: 0,
            IsFavorite: false,
            Played: false,
            Key: libraryId
          },
          SpecialFeatureCount: 0,
          DisplayPreferencesId: libraryId,
          Tags: [],
          PrimaryImageAspectRatio: 1,
          CollectionType: 'homevideos',
          ImageTags: {},
          BackdropImageTags: [],
          ScreenshotImageTags: [],
          LocationType: 'FileSystem',
          LockedFields: [],
          LockData: false,
          RecursiveItemCount: itemCount[0]?.count || 0,
          ChildCount: itemCount[0]?.count || 0
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    return new Response('Not found', { status: 404 });
  }
}