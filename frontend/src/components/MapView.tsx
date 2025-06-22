import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from './MarkerClusterGroup';
import MediaViewer from './MediaViewer';
import SendToStreamingButton from './SendToStreamingButton';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import './MapView.css';

// Fix for default markers in React-Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

const GET_MEDIA_WITH_LOCATION = gql`
  query GetMediaWithLocation {
    allMediaUnfiltered {
      id
      filename
      fileType
      createdAt
      thumbnailUrl
      latitude
      longitude
      altitude
      locationName
      width
      height
      duration
    }
  }
`;

interface MediaItem {
  id: number;
  filename: string;
  fileType: string;
  createdAt: string;
  thumbnailUrl?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  locationName?: string;
  width: number;
  height: number;
  duration?: number;
}

interface MapViewProps {
  onMediaClick?: (media: MediaItem) => void;
}

export default function MapView({ onMediaClick }: MapViewProps) {
  const [showMap, setShowMap] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [viewerMedia, setViewerMedia] = useState<MediaItem[]>([]);
  const [clusterPreview, setClusterPreview] = useState<MediaItem[] | null>(null);
  const { data, loading } = useQuery(GET_MEDIA_WITH_LOCATION);
  
  // Filter media with location data
  const mediaWithLocation = useMemo(() => {
    if (!data?.allMediaUnfiltered) return [];
    return data.allMediaUnfiltered.filter((item: MediaItem) => 
      item.latitude !== null && item.longitude !== null
    );
  }, [data]);

  // Calculate center of all markers
  const mapCenter = useMemo(() => {
    if (mediaWithLocation.length === 0) {
      return { lat: 0, lng: 0 }; // Default center
    }
    
    const sumLat = mediaWithLocation.reduce((sum: number, item: MediaItem) => sum + (item.latitude || 0), 0);
    const sumLng = mediaWithLocation.reduce((sum: number, item: MediaItem) => sum + (item.longitude || 0), 0);
    
    return {
      lat: sumLat / mediaWithLocation.length,
      lng: sumLng / mediaWithLocation.length
    };
  }, [mediaWithLocation]);

  // Group media by exact location for popup display
  const locationGroups = useMemo(() => {
    const groups = new Map<string, MediaItem[]>();
    
    mediaWithLocation.forEach((item: MediaItem) => {
      const key = `${item.latitude},${item.longitude}`;
      const existing = groups.get(key) || [];
      groups.set(key, [...existing, item]);
    });
    
    return groups;
  }, [mediaWithLocation]);

  useEffect(() => {
    // Force a small delay to ensure CSS is loaded
    const timer = setTimeout(() => setShowMap(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleClusterClick = (cluster: any) => {
    const markers = cluster.getAllChildMarkers();
    const clusterMedia = markers.map((marker: any) => marker.options.mediaItem).filter(Boolean);
    setClusterPreview(clusterMedia);
  };

  if (loading) {
    return (
      <div className="map-loading">
        <div className="loading-spinner"></div>
        <p>Loading location data...</p>
      </div>
    );
  }

  if (mediaWithLocation.length === 0) {
    return (
      <div className="map-empty">
        <p>No images with location data found</p>
        <p className="map-hint">Images with GPS coordinates will appear here</p>
      </div>
    );
  }

  const handleMediaClick = (media: MediaItem, groupItems?: MediaItem[]) => {
    if (onMediaClick) {
      onMediaClick(media);
    } else {
      // Use internal viewer
      setSelectedMedia(media);
      setViewerMedia(groupItems || [media]);
    }
  };

  const handleStartSlideshow = (items: MediaItem[]) => {
    if (items.length > 0) {
      setSelectedMedia(items[0]);
      setViewerMedia(items);
    }
  };

  const handleClusterSlideshow = () => {
    if (clusterPreview && clusterPreview.length > 0) {
      setSelectedMedia(clusterPreview[0]);
      setViewerMedia(clusterPreview);
      setClusterPreview(null);
    }
  };

  return (
    <div className="map-view-container">
      <div className="map-header compact">
        <div className="map-header-content">
          <h3>📍 {mediaWithLocation.length} items • {locationGroups.size} locations</h3>
          {mediaWithLocation.length > 0 && (
            <SendToStreamingButton 
              mediaItems={mediaWithLocation.map(item => ({
                id: item.id,
                filename: item.filename,
                filepath: '', // Will be populated from database in mutation
                fileType: item.fileType,
                createdAt: item.createdAt,
                fileSize: 0, // Will be populated from database in mutation
                duration: item.duration,
                width: item.width,
                height: item.height
              }))}
              variant="primary"
              size="small"
            />
          )}
        </div>
      </div>
      
      {showMap ? (
        <MapContainer 
          center={[mapCenter.lat, mapCenter.lng]} 
          zoom={5} 
          className="map-container"
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          <MarkerClusterGroup
            chunkedLoading
            showCoverageOnHover={false}
            maxClusterRadius={80}
            spiderfyOnMaxZoom={false}
            disableClusteringAtZoom={16}
            animate={true}
            onClusterClick={handleClusterClick}
          >
            {Array.from(locationGroups.entries()).map(([locationKey, items]) => {
              const [lat, lng] = locationKey.split(',').map(Number);
              
              return (
                <Marker 
                  key={locationKey} 
                  position={[lat, lng]}
                  ref={(ref) => {
                    if (ref) {
                      (ref as any).options.mediaItem = items[0];
                      (ref as any).options.allItems = items;
                    }
                  }}
                >
                  <Popup className="map-popup">
                    <div className="popup-content">
                      <h4>{items.length} item{items.length > 1 ? 's' : ''} at this location</h4>
                      {items[0].locationName && (
                        <p className="location-name">{items[0].locationName}</p>
                      )}
                      <div className="popup-media-grid">
                        {items.slice(0, 6).map((item) => (
                          <div 
                            key={item.id}
                            className="popup-media-item"
                            onClick={() => handleMediaClick(item, items)}
                            title={item.filename}
                          >
                            {item.thumbnailUrl ? (
                              <img 
                                src={`http://localhost:4001${item.thumbnailUrl}`} 
                                alt={item.filename}
                                loading="lazy"
                              />
                            ) : (
                              <div className="media-placeholder">
                                {item.fileType === 'video' ? '🎬' : '🖼️'}
                              </div>
                            )}
                            <span className="media-date">
                              {new Date(item.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                      </div>
                      {items.length > 1 && (
                        <button 
                          className="slideshow-button"
                          onClick={() => handleStartSlideshow(items)}
                          title="Start slideshow with all items at this location"
                        >
                          ▶ Start Slideshow ({items.length} items)
                        </button>
                      )}
                      {items.length > 6 && (
                        <p className="more-items">+{items.length - 6} more</p>
                      )}
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        </MapContainer>
      ) : (
        <div className="map-loading">
          <p>Initializing map...</p>
        </div>
      )}
      
      {/* Cluster Preview Modal */}
      {clusterPreview && (
        <div className="cluster-preview-overlay" onClick={() => setClusterPreview(null)}>
          <div className="cluster-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="cluster-preview-header">
              <h3>📍 {clusterPreview.length} items at this location</h3>
              <button 
                className="close-preview"
                onClick={() => setClusterPreview(null)}
              >
                ✕
              </button>
            </div>
            
            <div className="cluster-preview-grid">
              {clusterPreview.slice(0, 12).map((item) => (
                <div 
                  key={item.id}
                  className="cluster-preview-item"
                  onClick={() => handleMediaClick(item, clusterPreview)}
                >
                  {item.thumbnailUrl ? (
                    <img 
                      src={`http://localhost:4001${item.thumbnailUrl}`} 
                      alt={item.filename}
                      loading="lazy"
                    />
                  ) : (
                    <div className="media-placeholder">
                      {item.fileType === 'video' ? '🎬' : '🖼️'}
                    </div>
                  )}
                  <span className="preview-filename">{item.filename}</span>
                </div>
              ))}
            </div>
            
            {clusterPreview.length > 12 && (
              <p className="more-items">+{clusterPreview.length - 12} more items</p>
            )}
            
            <div className="cluster-preview-actions">
              <button 
                className="slideshow-button primary"
                onClick={handleClusterSlideshow}
              >
                🎬 Start Slideshow ({clusterPreview.length} items)
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedMedia && (
        <MediaViewer
          media={selectedMedia}
          allMedia={viewerMedia}
          onClose={() => {
            setSelectedMedia(null);
            setViewerMedia([]);
          }}
          onNavigate={(media) => setSelectedMedia(media)}
          viewerSettings={{
            autoPlay: true,
            slideInterval: 5,
            mediaFilter: 'all',
            sortOrder: 'date-desc',
            showCounter: true,
            showDate: true,
            showLocation: true,
            counterDuration: 1,
            dateDuration: 0,
            locationDuration: 0
          }}
        />
      )}
    </div>
  );
}