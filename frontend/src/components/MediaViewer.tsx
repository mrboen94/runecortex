import { useEffect } from 'react';
import './MediaViewer.css';

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

interface MediaViewerProps {
  media: MediaItem;
  onClose: () => void;
}

export default function MediaViewer({ media, onClose }: MediaViewerProps) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const mediaUrl = `http://localhost:4001/media/${media.id}`;

  return (
    <div className="media-viewer-overlay" onClick={onClose}>
      <div className="media-viewer" onClick={e => e.stopPropagation()}>
        <button className="close-button" onClick={onClose}>×</button>
        
        <div className="media-content">
          {media.fileType === 'video' ? (
            <video 
              controls 
              autoPlay
              src={mediaUrl}
              style={{ maxWidth: '100%', maxHeight: '80vh' }}
            />
          ) : (
            <img 
              src={mediaUrl} 
              alt={media.filename}
              style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
            />
          )}
        </div>
        
        <div className="media-details">
          <h3>{media.filename}</h3>
          <p>Created: {new Date(media.createdAt).toLocaleString()}</p>
          <p>Dimensions: {media.width} × {media.height}</p>
          {media.duration && (
            <p>Duration: {Math.floor(media.duration / 60)}:{Math.floor(media.duration % 60).toString().padStart(2, '0')}</p>
          )}
        </div>
      </div>
    </div>
  );
}