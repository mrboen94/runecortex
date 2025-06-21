import { useState } from 'react';
import MediaViewer from './MediaViewer';
import './MediaGrid.css';

interface MediaItem {
  id: number;
  filename: string;
  fileType: string;
  createdAt: string;
  width: number;
  height: number;
  duration?: number;
  thumbnailUrl?: string;
}

interface MediaGridProps {
  media: MediaItem[];
  viewerSettings?: {
    autoPlay: boolean;
    slideInterval: number;
    mediaFilter: 'all' | 'videos' | 'images';
    sortOrder: 'date-asc' | 'date-desc' | 'name-asc' | 'name-desc';
  };
}

export default function MediaGrid({ media, viewerSettings }: MediaGridProps) {
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  
  const handleNavigate = (newMedia: MediaItem) => {
    setSelectedMedia(newMedia);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      <div className="media-grid">
        {media.map(item => (
          <div 
            key={item.id} 
            className="media-item"
            onClick={() => setSelectedMedia(item)}
          >
            <div className="media-thumbnail">
              {item.thumbnailUrl ? (
                <img 
                  src={`http://localhost:4001${item.thumbnailUrl}`} 
                  alt={item.filename}
                  loading="lazy"
                  onError={(e) => {
                    // Hide the image and show placeholder when thumbnail fails to load
                    (e.target as HTMLImageElement).style.display = 'none';
                    const placeholder = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                    if (placeholder) placeholder.style.display = 'flex';
                  }}
                />
              ) : null}
              <div 
                className="placeholder" 
                style={{ 
                  display: item.thumbnailUrl ? 'none' : 'flex',
                  pointerEvents: 'none'
                }}
              >
                {item.fileType === 'video' ? '🎬' : '🖼️'}
              </div>
              {item.fileType === 'video' && item.duration && (
                <span className="duration">{formatDuration(item.duration)}</span>
              )}
            </div>
            <div className="media-info">
              <p className="filename">{item.filename}</p>
              <p className="date">{new Date(item.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        ))}
      </div>

      {selectedMedia && (
        <MediaViewer
          media={selectedMedia}
          allMedia={media}
          onClose={() => setSelectedMedia(null)}
          onNavigate={handleNavigate}
          viewerSettings={viewerSettings}
        />
      )}
    </>
  );
}