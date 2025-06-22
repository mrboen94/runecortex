import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default markers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

export default function SimpleMap() {
  return (
    <div style={{ width: '100%', height: '100%', minHeight: '500px' }}>
      <h2 style={{ padding: '20px', margin: 0, background: '#222', color: 'white' }}>
        Simple Map Test
      </h2>
      <MapContainer 
        center={[51.505, -0.09]} 
        zoom={13} 
        style={{ width: '100%', height: 'calc(100% - 60px)' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[51.505, -0.09]}>
          <Popup>
            Test marker in London
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
}