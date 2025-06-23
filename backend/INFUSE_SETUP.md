# Connecting Infuse to RuneCortex

## Prerequisites

1. Ensure RuneCortex backend is running with Jellyfin plugin enabled:
   ```bash
   JELLYFIN_ENABLED=true bun run start
   ```

2. Find your server's IP address (shown in server startup logs)

## Infuse Setup

1. Open Infuse on your Apple TV, iOS, or macOS device
2. Go to Settings → Shares → Add Share
3. Select "Other" or "Media Server"
4. Choose "Jellyfin" as the server type
5. Enter your server details:
   - **Address**: Your server IP (e.g., `192.168.0.219`)
   - **Port**: `4001` (or your configured PORT)
   - **Username**: Any username (authentication is disabled)
   - **Password**: Leave blank

## Troubleshooting

### "Unable to connect to server" Error

1. **Check server is running**: Ensure you see the server startup message
2. **Check network connectivity**: Ensure your device can reach the server IP
3. **Check firewall**: Port 4001 must be accessible
4. **Check logs**: Look for incoming requests in the server console

### Common Issues

- **Wrong IP**: Use the IP shown in server logs, not `localhost`
- **Firewall blocking**: Ensure port 4001 is open
- **Plugin disabled**: Verify `JELLYFIN_ENABLED=true` in your `.env`

## Supported Features

- ✅ Browse media library
- ✅ Direct play video files
- ✅ View thumbnails
- ✅ Organize by date
- ❌ Transcoding (not implemented)
- ❌ Subtitles (not implemented)
- ❌ User management (simplified)

## Server Logs

When Infuse connects, you should see:
```
🌐 Request: POST /Users/AuthenticateByName from Infuse-Direct/7.8.1
🔐 Authentication request: { Username: 'your-username' }
```

If you don't see these logs, Infuse cannot reach your server.