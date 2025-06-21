import { useQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import { useEffect } from 'react';
import './StatusIndicator.css';

const STATUS_QUERY = gql`
  query GetSystemStatus {
    watcherStatus {
      isActive
      watchPaths
      lastProcessed
    }
    thumbnailQueueStatus {
      status
      queueSize
      stats {
        totalQueued
        processed
        failed
        skipped
      }
    }
  }
`;

export default function StatusIndicator() {
  const { data, loading, error, refetch } = useQuery(STATUS_QUERY, {
    pollInterval: 5000, // Poll every 5 seconds
  });

  // Refetch when component mounts
  useEffect(() => {
    refetch();
  }, [refetch]);

  if (loading || error) return null;

  const watcherStatus = data?.watcherStatus;
  const thumbnailStatus = data?.thumbnailQueueStatus;

  const getWatcherStatusClass = () => {
    if (!watcherStatus) return 'status-unknown';
    return watcherStatus.isActive ? 'status-active' : 'status-inactive';
  };

  const getThumbnailStatusClass = () => {
    if (!thumbnailStatus) return 'status-unknown';
    if (thumbnailStatus.status === 'busy') return 'status-busy';
    if (thumbnailStatus.queueSize > 0) return 'status-pending';
    return 'status-idle';
  };

  const getThumbnailStatusText = () => {
    if (!thumbnailStatus) return 'Unknown';
    if (thumbnailStatus.status === 'busy') {
      return `Generating (${thumbnailStatus.stats.processed}/${thumbnailStatus.stats.totalQueued})`;
    }
    if (thumbnailStatus.queueSize > 0) {
      return `Queue: ${thumbnailStatus.queueSize}`;
    }
    return 'Idle';
  };

  return (
    <div className="status-indicator">
      <div className="status-item">
        <span className={`status-dot ${getWatcherStatusClass()}`}></span>
        <span className="status-label">Watcher</span>
        <span className="status-value">
          {watcherStatus?.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
      
      <div className="status-item">
        <span className={`status-dot ${getThumbnailStatusClass()}`}></span>
        <span className="status-label">Thumbnails</span>
        <span className="status-value">
          {getThumbnailStatusText()}
        </span>
      </div>

      {thumbnailStatus?.stats.failed > 0 && (
        <div className="status-item status-error">
          <span className="status-label">Failed</span>
          <span className="status-value">{thumbnailStatus.stats.failed}</span>
        </div>
      )}
    </div>
  );
}