# RuneCortex Backend

A high-performance media server with modular plugin architecture, built with Bun and TypeScript.

## Installation

```bash
bun install
```

## Running the Server

```bash
# Development
bun run index.ts

# Production
bun run start
```

## Plugin Architecture

The backend uses a modular plugin system where features can be enabled/disabled via environment variables. This allows you to run only the services you need, reducing resource usage and improving security.

### Core Features (Always Enabled)
- **Streaming Folder Management**: Dynamic playlist/queue management via GraphQL
- **Media Streaming**: Direct file streaming with range support
- **Thumbnail Serving**: Optimized thumbnail delivery

### Available Plugins

#### 1. Jellyfin API Plugin
Provides Jellyfin-compatible API endpoints for media streaming apps like Infuse.

```bash
JELLYFIN_ENABLED=true  # Enable Jellyfin API (default: true)
```

Features:
- System info endpoints for client discovery
- User endpoints (passwordless)
- Library browsing with year/month organization
- Direct play streaming
- Thumbnail serving

#### 2. DLNA/UPnP Server Plugin
Traditional DLNA server for compatible devices.

```bash
DLNA_ENABLED=true     # Enable DLNA server (default: true)
SSDP_ENABLED=true     # Enable SSDP discovery (default: true)
SSDP_PORT=1900        # SSDP port (default: 1900)
```

Features:
- UPnP device discovery
- Content directory browsing
- Media streaming to DLNA devices
- Real-time content updates

#### 3. M3U Playlist Plugin
Generates M3U/M3U8 playlists for media players.

```bash
M3U_ENABLED=true      # Enable playlist generation (default: true)
```

Features:
- Dynamic M3U playlist generation
- M3U8 (HLS) format support
- VLC and compatible player support

## Configuration

Copy `.env.example` to `.env` and configure as needed:

```bash
cp .env.example .env
```

### Core Settings

```bash
PORT=4001                          # Server port
DATABASE_PATH=./data/runecortex.db # SQLite database location
SERVER_NAME=RuneCortex Media Server # Server display name
```

### Performance Tuning

```bash
# Thumbnail Generation
THUMBNAIL_MAX_CONCURRENT=8         # Concurrent thumbnail operations
THUMBNAIL_BATCH_SIZE=50            # Files per batch
THUMBNAIL_BATCH_WAIT_SECONDS=0     # Delay between batches
THUMBNAIL_DEBOUNCE_SECONDS=5       # Queue debounce time
THUMBNAIL_COOLDOWN_SECONDS=0       # Cooldown after processing

# Media Scanning
WATCHER_ENABLED=true               # Enable file system watcher
PHASH_ENABLED=true                 # Enable perceptual hashing
```

## API Endpoints

### GraphQL API
- **Endpoint**: `/graphql`
- **Documentation**: Available at `/graphql` when server is running

### Media Streaming
- **Original files**: `/media/:id`
- **Thumbnails**: `/thumbnails/:id.jpg`
- **Streaming**: `/stream/:id` (with range support)

### Plugin-Specific Endpoints

#### Jellyfin API (when enabled)
- `/System/Info/Public` - Server information
- `/Users/Public` - User list
- `/Users/{userId}/Items` - Library browsing
- `/Videos/{itemId}/stream` - Video streaming

#### DLNA (when enabled)
- `/device.xml` - Device description
- `/contentdirectory.xml` - Service description
- `/control` - SOAP control endpoint

#### Playlists (when enabled)
- `/playlist.m3u` - M3U playlist
- `/playlist.m3u8` - M3U8 (HLS) playlist
- `/playlist.json` - JSON playlist (debugging)

## Database Schema

The backend uses SQLite with Drizzle ORM. Key tables:

- `media_items` - Media file metadata
- `indexed_folders` - Monitored directories
- `scan_sessions` - Scan history
- `duplicate_files` - Duplicate detection
- `app_config` - Application settings

## Development

### Adding a New Plugin

1. Create plugin in `src/plugins/yourplugin/`
2. Implement the `Plugin` interface
3. Register in `PluginManager`
4. Add environment variables to `.env.example`

### Running Tests

```bash
bun test
```

### Building for Production

```bash
bun build --compile --minify --sourcemap ./src/index.ts --outfile runecortex-server
```

## Troubleshooting

### Plugin Not Loading
- Check environment variables are set correctly
- Look for initialization errors in console
- Verify plugin dependencies are installed

### Performance Issues
- Increase `THUMBNAIL_MAX_CONCURRENT` for faster processing
- Adjust batch sizes based on system resources
- Check database indexes are created

### DLNA Discovery Issues
- Ensure SSDP port (1900) is not blocked
- Check firewall allows UDP traffic
- Verify multicast is enabled on network

## Docker Support

```bash
docker build -t runecortex-backend .
docker run -p 4001:4001 -v /path/to/media:/media runecortex-backend
```

## License

See LICENSE file in repository root.