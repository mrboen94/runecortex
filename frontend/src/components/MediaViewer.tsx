import { useEffect, useState, useRef, useCallback } from 'react';
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
  allMedia: MediaItem[];
  onClose: () => void;
  onNavigate: (media: MediaItem) => void;
  viewerSettings?: {
    autoPlay: boolean;
    slideInterval: number;
    mediaFilter: 'all' | 'videos' | 'images';
    sortOrder: 'date-asc' | 'date-desc' | 'name-asc' | 'name-desc';
  };
}

export default function MediaViewer({ media, allMedia, onClose, onNavigate, viewerSettings }: MediaViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const slideInterval = viewerSettings?.slideInterval || 5;
  const autoPlay = viewerSettings?.autoPlay ?? true;
  const [currentMediaIndex, setCurrentMediaIndex] = useState(
    allMedia.findIndex(m => m.id === media.id)
  );
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const currentMedia = allMedia[currentMediaIndex];
  const mediaUrl = `http://localhost:4001/media/${currentMedia.id}`;

  // Navigate to previous/next media
  const navigate = useCallback((direction: 'prev' | 'next') => {
    const newIndex = direction === 'next' 
      ? (currentMediaIndex + 1) % allMedia.length
      : (currentMediaIndex - 1 + allMedia.length) % allMedia.length;
    
    setCurrentMediaIndex(newIndex);
    onNavigate(allMedia[newIndex]);
  }, [currentMediaIndex, allMedia, onNavigate]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          if (isFullscreen) {
            exitFullscreen();
          } else {
            onClose();
          }
          break;
        case 'ArrowLeft':
          navigate('prev');
          break;
        case 'ArrowRight':
          navigate('next');
          break;
        case ' ':
          e.preventDefault();
          if (videoRef.current) {
            if (videoRef.current.paused) {
              videoRef.current.play();
            } else {
              videoRef.current.pause();
            }
          }
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
      }
    };

    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [isFullscreen, navigate, onClose]);

  // Auto-hide controls in fullscreen
  useEffect(() => {
    if (!isFullscreen) {
      setShowControls(true);
      return;
    }

    const handleMouseMove = () => {
      setShowControls(true);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    };

    document.addEventListener('mousemove', handleMouseMove);
    handleMouseMove(); // Initial trigger

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [isFullscreen]);

  // Auto-advance for images
  useEffect(() => {
    if (currentMedia.fileType === 'image' && autoPlay && isFullscreen) {
      slideTimeoutRef.current = setTimeout(() => {
        navigate('next');
      }, slideInterval * 1000);

      return () => {
        if (slideTimeoutRef.current) {
          clearTimeout(slideTimeoutRef.current);
        }
      };
    }
  }, [currentMedia, autoPlay, slideInterval, isFullscreen, navigate]);

  // Handle video ended event
  const handleVideoEnded = useCallback(() => {
    if (autoPlay) {
      navigate('next');
    }
  }, [autoPlay, navigate]);

  // Fullscreen functions
  const enterFullscreen = async () => {
    if (viewerRef.current && viewerRef.current.requestFullscreen) {
      try {
        await viewerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } catch (err) {
        console.error('Error entering fullscreen:', err);
      }
    }
  };

  const exitFullscreen = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
        setIsFullscreen(false);
      } catch (err) {
        console.error('Error exiting fullscreen:', err);
      }
    }
  };

  const toggleFullscreen = () => {
    if (isFullscreen) {
      exitFullscreen();
    } else {
      enterFullscreen();
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  return (
    <div 
      ref={viewerRef}
      className={`media-viewer-overlay ${isFullscreen ? 'fullscreen' : ''}`} 
      onClick={isFullscreen ? undefined : onClose}
    >
      <div 
        className={`media-viewer ${isFullscreen ? 'fullscreen-viewer' : ''}`} 
        onClick={e => e.stopPropagation()}
      >
        {/* Navigation arrows */}
        <button 
          className={`nav-button prev ${showControls || !isFullscreen ? 'show' : ''}`}
          onClick={() => navigate('prev')}
          title="Previous (←)"
        >
          ‹
        </button>
        
        <button 
          className={`nav-button next ${showControls || !isFullscreen ? 'show' : ''}`}
          onClick={() => navigate('next')}
          title="Next (→)"
        >
          ›
        </button>

        {/* Close button */}
        <button 
          className={`close-button ${showControls || !isFullscreen ? 'show' : ''}`} 
          onClick={onClose}
          title="Close (Esc)"
        >
          ×
        </button>

        {/* Fullscreen button */}
        <button 
          className={`fullscreen-button ${showControls || !isFullscreen ? 'show' : ''}`}
          onClick={toggleFullscreen}
          title="Fullscreen (F)"
        >
          {isFullscreen ? '⊡' : '⊞'}
        </button>
        
        {/* Media content */}
        <div className="media-content">
          {currentMedia.fileType === 'video' ? (
            <video 
              ref={videoRef}
              controls 
              autoPlay
              src={mediaUrl}
              onEnded={handleVideoEnded}
              style={{ 
                maxWidth: '100%', 
                maxHeight: isFullscreen ? '100vh' : '80vh',
                width: isFullscreen ? '100%' : 'auto',
                height: isFullscreen ? '100%' : 'auto'
              }}
            />
          ) : (
            <img 
              src={mediaUrl} 
              alt={currentMedia.filename}
              style={{ 
                maxWidth: '100%', 
                maxHeight: isFullscreen ? '100vh' : '80vh',
                width: isFullscreen ? '100%' : 'auto',
                height: isFullscreen ? '100%' : 'auto',
                objectFit: 'contain' 
              }}
            />
          )}
        </div>
        
        {/* Controls panel */}
        <div className={`media-controls ${showControls || !isFullscreen ? 'show' : ''}`}>
          <div className="controls-left">
            <h3>{currentMedia.filename}</h3>
            <p>{currentMediaIndex + 1} / {allMedia.length}</p>
          </div>
          
          <div className="controls-center">
            {autoPlay && (
              <span className="autoplay-info">
                {currentMedia.fileType === 'video' 
                  ? '⏵ Auto-play enabled' 
                  : `⏵ Slideshow: ${slideInterval}s`}
              </span>
            )}
          </div>
          
          <div className="controls-right">
            <p>{new Date(currentMedia.createdAt).toLocaleDateString()}</p>
            {currentMedia.duration && (
              <p>{Math.floor(currentMedia.duration / 60)}:{Math.floor(currentMedia.duration % 60).toString().padStart(2, '0')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}