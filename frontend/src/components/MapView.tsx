import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import MarkerClusterGroup from './MarkerClusterGroup';
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
}

interface MapViewProps {
  onMediaClick?: (media: MediaItem) => void;
}

export default function MapView({ onMediaClick }: MapViewProps) {
  const [showMap, setShowMap] = useState(false);
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

  return (
    <div className="map-view-container">
      <div className="map-header">
        <h2>📍 Media Locations</h2>
        <p className="map-stats">
          {mediaWithLocation.length} items with GPS data at {locationGroups.size} locations
        </p>
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
            spiderfyOnMaxZoom={true}
            disableClusteringAtZoom={16}
            animate={true}
          >
            {Array.from(locationGroups.entries()).map(([locationKey, items]) => {
              const [lat, lng] = locationKey.split(',').map(Number);
              
              return (
                <Marker key={locationKey} position={[lat, lng]}>
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
                            onClick={() => onMediaClick?.(item)}
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
    </div>
  );
}