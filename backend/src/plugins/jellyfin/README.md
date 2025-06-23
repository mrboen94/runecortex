# Jellyfin API Plugin for Infuse Compatibility

This plugin provides a Jellyfin-compatible API that allows Infuse and other Jellyfin clients to browse and play media from RuneCortex.

## Features

- **System Info Endpoints**: Provides server identification for clients
- **User Management**: Simplified single-user system (no authentication required)
- **Media Library**: Browse media items with Jellyfin-compatible metadata
- **Image Serving**: Thumbnails served through Jellyfin API endpoints
- **Video Streaming**: Direct streaming with range request support
- **Library Structure**: Virtual folders based on indexed folders

## Configuration

Enable the plugin by setting these environment variables:

```bash
# Enable Jellyfin API
JELLYFIN_ENABLED=true

# Server identification
SERVER_NAME="RuneCortex Media Server"
SERVER_ID="runecortex-001"
```

## Supported Endpoints

### System Endpoints
- `GET /System/Info/Public` - Public server information
- `GET /System/Info` - Detailed server information

### User Endpoints
- `GET /Users/Public` - List public users
- `GET /Users/{userId}` - Get user details

### Library Endpoints
- `GET /Users/{userId}/Items` - Browse media items
  - Query parameters:
    - `IncludeItemTypes`: Filter by type (Movie, Photo)
    - `Recursive`: Include all items
    - `SortBy`: Sort field (DateCreated)
    - `SortOrder`: Ascending/Descending
    - `StartIndex`: Pagination start
    - `Limit`: Items per page

- `GET /Items/{itemId}` - Get single item details
- `GET /Library/VirtualFolders` - Get library structure

### Media Endpoints
- `GET /Items/{itemId}/Images/Primary` - Get thumbnail
- `GET /Videos/{videoId}/stream` - Stream video

## Infuse Setup

1. Enable the Jellyfin plugin in RuneCortex
2. In Infuse, add a new share:
   - Type: Jellyfin
   - Server: `http://your-server-ip:4001`
   - No username/password required
3. Infuse will automatically discover and display your media

## Limitations

- No user authentication (single-user system)
- No transcoding support (direct play only)
- Basic metadata only (no external metadata providers)
- No live TV or recording features

## Technical Details

The plugin translates RuneCortex's internal media format to Jellyfin's expected structure:

```javascript
// RuneCortex media item
{
  id: 123,
  filename: "video.mp4",
  fileType: "video",
  ...
}

// Converted to Jellyfin format
{
  Id: "123",
  Name: "video.mp4",
  Type: "Movie",
  MediaSources: [...],
  ...
}
```

This allows Jellyfin clients to understand and play RuneCortex media without requiring a full Jellyfin server.