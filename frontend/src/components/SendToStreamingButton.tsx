import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import './SendToStreamingButton.css';

const GET_STREAMING_SERVER_STATUS = gql`
  query GetStreamingServerStatus {
    streamingServerStatus {
      isRunning
    }
  }
`;

const UPDATE_STREAMING_FOLDER = gql`
  mutation UpdateStreamingFolder($mediaItems: [StreamingMediaInput!]!, $currentlyPlayingId: Int, $forceRefresh: Boolean) {
    updateStreamingFolder(mediaItems: $mediaItems, currentlyPlayingId: $currentlyPlayingId, forceRefresh: $forceRefresh) {
      totalItems
      currentlyPlaying
    }
  }
`;

interface MediaItem {
  id: number;
  filename: string;
  filepath: string;
  fileType: string;
  createdAt: string;
  fileSize: number;
  duration?: number;
  width: number;
  height: number;
}

interface SendToStreamingButtonProps {
  mediaItems: MediaItem[];
  currentlyPlayingId?: number;
  variant?: 'primary' | 'secondary';
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export default function SendToStreamingButton({ 
  mediaItems, 
  currentlyPlayingId, 
  variant = 'primary',
  size = 'medium',
  className = ''
}: SendToStreamingButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [lastSent, setLastSent] = useState<number | null>(null);
  
  const { data: serverStatus } = useQuery(GET_STREAMING_SERVER_STATUS, {
    pollInterval: 5000,
  });

  const [updateStreamingFolder] = useMutation(UPDATE_STREAMING_FOLDER, {
    onCompleted: () => {
      setIsLoading(false);
      setLastSent(Date.now());
    },
    onError: (error) => {
      console.error('Failed to update streaming folder:', error);
      setIsLoading(false);
    },
  });

  const isServerRunning = serverStatus?.streamingServerStatus?.isRunning || false;
  const hasItems = mediaItems.length > 0;

  const handleSendToStreaming = async () => {
    if (!hasItems || !isServerRunning) {
      console.log('Cannot send to streaming:', { hasItems, isServerRunning });
      return;
    }

    console.log(`Sending ${mediaItems.length} items to streaming server`, mediaItems);
    setIsLoading(true);
    
    try {
      const streamingMediaItems = mediaItems.map(item => ({
        id: item.id,
        filename: item.filename,
        filepath: item.filepath,
        fileType: item.fileType,
        createdAt: item.createdAt,
        fileSize: item.fileSize || 0,
        duration: item.duration || undefined,
        width: item.width || 0,
        height: item.height || 0,
      }));

      console.log('Prepared streaming media items:', streamingMediaItems);

      const result = await updateStreamingFolder({
        variables: {
          mediaItems: streamingMediaItems,
          currentlyPlayingId: currentlyPlayingId || null,
          forceRefresh: false,  // Don't force refresh by default
        },
      });
      
      console.log('Streaming folder update result:', result);
    } catch (error) {
      console.error('Error sending to streaming server:', error);
      setIsLoading(false);
    }
  };

  if (!isServerRunning) {
    return (
      <button 
        className={`send-to-streaming ${variant} ${size} disabled ${className}`}
        disabled
        title="Streaming server is not running"
      >
        📺 Server Offline
      </button>
    );
  }

  if (!hasItems) {
    return (
      <button 
        className={`send-to-streaming ${variant} ${size} disabled ${className}`}
        disabled
        title="No media items to stream"
      >
        📺 No Media
      </button>
    );
  }

  const buttonText = lastSent && (Date.now() - lastSent < 3000) 
    ? `✅ Sent (${mediaItems.length})` 
    : `📺 Stream (${mediaItems.length})`;

  return (
    <button
      className={`send-to-streaming ${variant} ${size} ${isLoading ? 'loading' : ''} ${className}`}
      onClick={handleSendToStreaming}
      disabled={isLoading}
      title={`Send current view (${mediaItems.length} items) to streaming server`}
    >
      {isLoading ? '⏳ Sending...' : buttonText}
    </button>
  );
}