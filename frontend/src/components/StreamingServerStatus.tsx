import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { gql } from '@apollo/client';
import './StreamingServerStatus.css';

const GET_STREAMING_SERVER_STATUS = gql`
  query GetStreamingServerStatus {
    streamingServerStatus {
      isRunning
      port
      host
      name
      url
      totalItems
      currentlyPlaying
      localIp
    }
  }
`;

const GET_STREAMING_FOLDER_STATUS = gql`
  query GetStreamingFolderStatus {
    streamingFolderStatus {
      totalItems
      currentlyPlaying
      items {
        id
        filename
        isCurrentlyPlaying
      }
    }
  }
`;

const UPDATE_STREAMING_FOLDER = gql`
  mutation UpdateStreamingFolder($mediaItems: [StreamingMediaInput!]!, $currentlyPlayingId: Int) {
    updateStreamingFolder(mediaItems: $mediaItems, currentlyPlayingId: $currentlyPlayingId) {
      totalItems
      currentlyPlaying
      items {
        id
        filename
        isCurrentlyPlaying
      }
    }
  }
`;

const START_STREAMING_SERVER = gql`
  mutation StartStreamingServer {
    startStreamingServer {
      isRunning
      port
      host
      name
      url
    }
  }
`;

const STOP_STREAMING_SERVER = gql`
  mutation StopStreamingServer {
    stopStreamingServer
  }
`;

const FORCE_VLC_REFRESH = gql`
  mutation ForceVLCRefresh {
    forceVLCRefresh {
      success
    }
  }
`;

interface StreamingServerStatus {
  isRunning: boolean;
  port: number;
  host: string;
  name: string;
  url: string;
  totalItems: number;
  currentlyPlaying?: number;
  localIp?: string;
}

interface StreamingFolderStatus {
  totalItems: number;
  currentlyPlaying?: number;
  items: Array<{
    id: number;
    filename: string;
    isCurrentlyPlaying: boolean;
  }>;
}

export default function StreamingServerStatus() {
  const [isExpanded, setIsExpanded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data, loading, refetch } = useQuery(GET_STREAMING_SERVER_STATUS, {
    pollInterval: 5000, // Poll every 5 seconds
  });

  const [startServer, { loading: starting }] = useMutation(START_STREAMING_SERVER, {
    onCompleted: () => {
      refetch();
    },
    onError: (error) => {
      console.error('Failed to start streaming server:', error);
    },
  });

  const [stopServer, { loading: stopping }] = useMutation(STOP_STREAMING_SERVER, {
    onCompleted: () => {
      refetch();
    },
    onError: (error) => {
      console.error('Failed to stop streaming server:', error);
    },
  });

  const [forceVLCRefresh, { loading: refreshing }] = useMutation(FORCE_VLC_REFRESH, {
    onCompleted: () => {
      console.log('VLC refresh forced successfully');
    },
    onError: (error) => {
      console.error('Failed to force VLC refresh:', error);
    },
  });

  const status: StreamingServerStatus | null = data?.streamingServerStatus || null;

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isExpanded]);

  const handleToggleServer = async () => {
    if (!status) return;

    if (status.isRunning) {
      await stopServer();
    } else {
      await startServer();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could show a toast notification here
    });
  };

  if (loading) {
    return (
      <div className="streaming-status loading">
        <div className="streaming-indicator">
          <div className="status-dot loading"></div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="streaming-status" ref={dropdownRef}>
      <button 
        className="streaming-indicator" 
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <div className={`status-dot ${status?.isRunning ? 'running' : 'stopped'}`}></div>
        <span className="status-text">
          📺 {status?.isRunning ? 'Streaming' : 'Offline'}
        </span>
        <span className="expand-toggle" aria-label={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? '▼' : '▶'}
        </span>
      </button>

      {isExpanded && status && (
        <div className="streaming-dropdown">
          <div className="streaming-details">
            <div className="server-info">
              <h4>{status.name}</h4>
              <div className="info-row">
                <span className="label">Status:</span>
                <span className={`value ${status.isRunning ? 'running' : 'stopped'}`}>
                  {status.isRunning ? 'Running' : 'Stopped'}
                </span>
              </div>
              <div className="info-row">
                <span className="label">Port:</span>
                <span className="value">{status.port}</span>
              </div>
              {status.localIp && (
                <div className="info-row">
                  <span className="label">Local IP:</span>
                  <span className="value">{status.localIp}</span>
                </div>
              )}
              {status.isRunning && (
                <div className="info-row">
                  <span className="label">URL:</span>
                  <span 
                    className="value url clickable" 
                    onClick={() => copyToClipboard(status.url)}
                    title="Click to copy"
                  >
                    {status.url}
                  </span>
                </div>
              )}
            </div>

            <div className="server-controls">
              <button
                className={`control-button ${status.isRunning ? 'stop' : 'start'}`}
                onClick={handleToggleServer}
                disabled={starting || stopping}
              >
                {starting || stopping ? (
                  <span>⏳ {status.isRunning ? 'Stopping...' : 'Starting...'}</span>
                ) : (
                  <span>{status.isRunning ? '⏹ Stop Server' : '▶ Start Server'}</span>
                )}
              </button>
              {status.isRunning && (
                <button
                  className="control-button refresh"
                  onClick={() => forceVLCRefresh()}
                  disabled={refreshing}
                  title="Force VLC to refresh and re-read the content list"
                >
                  {refreshing ? (
                    <span>⏳ Refreshing...</span>
                  ) : (
                    <span>🔄 Refresh VLC</span>
                  )}
                </button>
              )}
            </div>

            {status.isRunning && (
              <div className="streaming-folder-info">
                <div className="info-row">
                  <span className="label">Streaming folder:</span>
                  <span className="value">{status.totalItems} items</span>
                </div>
                {status.currentlyPlaying && (
                  <div className="info-row">
                    <span className="label">Currently playing:</span>
                    <span className="value playing">ID: {status.currentlyPlaying}</span>
                  </div>
                )}
              </div>
            )}

            {status.isRunning && (
              <div className="usage-info">
                <p className="info-text">
                  🎬 Connect external players to <strong>{status.url}</strong>
                </p>
                <p className="info-text">
                  📱 Compatible with Infuse, VLC, DLNA players, and more
                </p>
                <p className="info-text">
                  💡 Use "Send to Streaming" in Timeline or Map view to update content
                </p>
                <p className="info-text">
                  🔄 Use "Refresh VLC" if VLC doesn't show updated content
                </p>
                <div className="playlist-urls">
                  <h5>Direct Playlist URLs:</h5>
                  <div className="url-item">
                    <span className="url-label">M3U:</span>
                    <span 
                      className="url-value clickable" 
                      onClick={() => copyToClipboard(`http://${status.localIp}:${status.port}/playlist.m3u`)}
                      title="Click to copy M3U playlist URL"
                    >
                      http://{status.localIp}:{status.port}/playlist.m3u
                    </span>
                  </div>
                  <div className="url-item">
                    <span className="url-label">M3U8:</span>
                    <span 
                      className="url-value clickable" 
                      onClick={() => copyToClipboard(`http://${status.localIp}:${status.port}/playlist.m3u8`)}
                      title="Click to copy M3U8 playlist URL"
                    >
                      http://{status.localIp}:{status.port}/playlist.m3u8
                    </span>
                  </div>
                  <p className="info-text small">
                    📝 In VLC: Media → Open Network Stream → Paste URL
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}