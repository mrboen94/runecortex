import { useEffect, useState, useRef, useCallback } from 'react';
import { useMutation } from '@apollo/client';
import { gql } from '@apollo/client';
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
  latitude?: number;
  longitude?: number;
  altitude?: number;
  locationName?: string;
}

const LOG_PLAYBACK_ERROR = gql`
  mutation LogPlaybackError($mediaId: Int!, $error: String!, $browserInfo: String) {
    logPlaybackError(mediaId: $mediaId, error: $error, browserInfo: $browserInfo)
  }
`;

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
    showCounter?: boolean;
    showDate?: boolean;
    showLocation?: boolean;
    counterDuration?: number;
    dateDuration?: number;
    locationDuration?: number;
  };
}

export default function MediaViewer({ media, allMedia, onClose, onNavigate, viewerSettings }: MediaViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showCounter, setShowCounter] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [showLocation, setShowLocation] = useState(true);
  const [playbackError, setPlaybackError] = useState(false);
  const slideInterval = viewerSettings?.slideInterval || 5;
  const autoPlay = viewerSettings?.autoPlay ?? true;
  const displayCounter = viewerSettings?.showCounter ?? true;
  const displayDate = viewerSettings?.showDate ?? true;
  const displayLocation = viewerSettings?.showLocation ?? true;
  const counterDuration = viewerSettings?.counterDuration ?? 1;
  const dateDuration = viewerSettings?.dateDuration ?? 0;
  const locationDuration = viewerSettings?.locationDuration ?? 0;
  const [currentMediaIndex, setCurrentMediaIndex] = useState(
    allMedia.findIndex(m => m.id === media.id)
  );
  
  const viewerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slideTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const counterTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dateTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const locationTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  const [logError] = useMutation(LOG_PLAYBACK_ERROR);

  const currentMedia = allMedia[currentMediaIndex];
  const mediaUrl = `http://localhost:4001/media/${currentMedia.id}`;

  // Navigate to previous/next media
  const navigate = useCallback((direction: 'prev' | 'next') => {
    const newIndex = direction === 'next' 
      ? (currentMediaIndex + 1) % allMedia.length
      : (currentMediaIndex - 1 + allMedia.length) % allMedia.length;
    
    setCurrentMediaIndex(newIndex);
    onNavigate(allMedia[newIndex]);
    setPlaybackError(false); // Reset error state when navigating
    
    // Show counter briefly when navigating
    if (displayCounter && counterDuration > 0) {
      setShowCounter(true);
      if (counterTimeoutRef.current) {
        clearTimeout(counterTimeoutRef.current);
      }
      counterTimeoutRef.current = setTimeout(() => {
        setShowCounter(false);
      }, counterDuration * 1000);
    } else if (displayCounter && counterDuration === 0) {
      setShowCounter(true); // Always show
    }
    
    // Show date briefly when navigating
    if (displayDate && dateDuration > 0) {
      setShowDate(true);
      if (dateTimeoutRef.current) {
        clearTimeout(dateTimeoutRef.current);
      }
      dateTimeoutRef.current = setTimeout(() => {
        setShowDate(false);
      }, dateDuration * 1000);
    } else if (displayDate && dateDuration === 0) {
      setShowDate(true); // Always show
    }
    
    // Show location briefly when navigating
    if (displayLocation && locationDuration > 0) {
      setShowLocation(true);
      if (locationTimeoutRef.current) {
        clearTimeout(locationTimeoutRef.current);
      }
      locationTimeoutRef.current = setTimeout(() => {
        setShowLocation(false);
      }, locationDuration * 1000);
    } else if (displayLocation && locationDuration === 0) {
      setShowLocation(true); // Always show
    }
  }, [currentMediaIndex, allMedia, onNavigate, displayCounter, displayDate, displayLocation, counterDuration, dateDuration, locationDuration]);

  // Handle media playback errors
  const handleMediaError = useCallback(async (error: Event | string) => {
    setPlaybackError(true);
    
    const errorMessage = typeof error === 'string' ? error : 'Media playback failed';
    const browserInfo = {
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      mediaType: currentMedia.fileType,
      filename: currentMedia.filename,
      dimensions: `${currentMedia.width}x${currentMedia.height}`,
      duration: currentMedia.duration
    };
    
    try {
      await logError({
        variables: {
          mediaId: currentMedia.id,
          error: errorMessage,
          browserInfo: JSON.stringify(browserInfo)
        }
      });
      console.error('Playback error logged:', errorMessage);
    } catch (logErr) {
      console.error('Failed to log playback error:', logErr);
    }
    
    // Auto-advance after error if autoplay is enabled
    if (autoPlay) {
      setTimeout(() => navigate('next'), 2000);
    }
  }, [currentMedia, logError, autoPlay, navigate]);

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

  // Initial counter display
  useEffect(() => {
    if (displayCounter && counterDuration > 0) {
      setShowCounter(true);
      counterTimeoutRef.current = setTimeout(() => {
        setShowCounter(false);
      }, counterDuration * 1000);
    } else if (displayCounter && counterDuration === 0) {
      setShowCounter(true); // Always show
    } else {
      setShowCounter(false);
    }
    
    return () => {
      if (counterTimeoutRef.current) {
        clearTimeout(counterTimeoutRef.current);
      }
    };
  }, [displayCounter, counterDuration]);

  // Initial date display
  useEffect(() => {
    if (displayDate && dateDuration > 0) {
      setShowDate(true);
      dateTimeoutRef.current = setTimeout(() => {
        setShowDate(false);
      }, dateDuration * 1000);
    } else if (displayDate && dateDuration === 0) {
      setShowDate(true); // Always show
    } else {
      setShowDate(false);
    }
    
    return () => {
      if (dateTimeoutRef.current) {
        clearTimeout(dateTimeoutRef.current);
      }
    };
  }, [displayDate, dateDuration]);

  // Initial location display
  useEffect(() => {
    if (displayLocation && locationDuration > 0) {
      setShowLocation(true);
      locationTimeoutRef.current = setTimeout(() => {
        setShowLocation(false);
      }, locationDuration * 1000);
    } else if (displayLocation && locationDuration === 0) {
      setShowLocation(true); // Always show
    } else {
      setShowLocation(false);
    }
    
    return () => {
      if (locationTimeoutRef.current) {
        clearTimeout(locationTimeoutRef.current);
      }
    };
  }, [displayLocation, locationDuration]);

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
          {playbackError ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              textAlign: 'center',
              padding: '20px'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚠️</div>
              <h3 style={{ margin: '0 0 10px 0' }}>Unable to play media</h3>
              <p style={{ margin: '0 0 20px 0', opacity: 0.8 }}>
                {currentMedia.filename}
              </p>
              {autoPlay && (
                <p style={{ margin: 0, fontSize: '14px', opacity: 0.6 }}>
                  Auto-advancing in 2 seconds...
                </p>
              )}
            </div>
          ) : currentMedia.fileType === 'video' ? (
            <video 
              ref={videoRef}
              controls 
              autoPlay
              src={mediaUrl}
              onEnded={handleVideoEnded}
              onError={handleMediaError}
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
              onError={handleMediaError}
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
        
        {/* Minimal info overlay */}
        <div 
          className="media-info-overlay"
          style={{
            position: 'absolute',
            top: '20px',
            left: '20px',
            color: 'white',
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            fontSize: '14px',
            lineHeight: '1.4',
            zIndex: 5
          }}
        >
          {displayDate && (
            <div 
              style={{ 
                marginBottom: '4px',
                opacity: showDate ? 1 : 0,
                transition: 'opacity 0.3s ease'
              }}
            >
              {new Date(currentMedia.createdAt).toLocaleDateString()}
            </div>
          )}
          {displayCounter && (
            <div 
              style={{ 
                opacity: showCounter ? 1 : 0,
                transition: 'opacity 0.3s ease'
              }}
            >
              {currentMediaIndex + 1} / {allMedia.length}
            </div>
          )}
          {displayLocation && currentMedia.latitude && currentMedia.longitude && (
            <div 
              style={{ 
                marginTop: '8px',
                opacity: showLocation ? 1 : 0,
                transition: 'opacity 0.3s ease',
                fontSize: '12px'
              }}
            >
              📍 {currentMedia.latitude.toFixed(6)}, {currentMedia.longitude.toFixed(6)}
              {currentMedia.altitude && ` • ${currentMedia.altitude.toFixed(0)}m`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}