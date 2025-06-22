import { createPathComponent } from '@react-leaflet/core';
import L from 'leaflet';
import 'leaflet.markercluster';

interface MarkerClusterGroupProps {
  children: React.ReactNode;
  chunkedLoading?: boolean;
  showCoverageOnHover?: boolean;
  maxClusterRadius?: number;
  spiderfyOnMaxZoom?: boolean;
  disableClusteringAtZoom?: number;
  animate?: boolean;
  onClusterClick?: (cluster: L.MarkerCluster) => void;
}

const MarkerClusterGroup = createPathComponent<L.MarkerClusterGroup, MarkerClusterGroupProps>(
  ({ children, onClusterClick, ...options }, ctx) => {
    const clusterGroup = (L as any).markerClusterGroup(options);
    
    if (onClusterClick) {
      clusterGroup.on('clusterclick', (event: any) => {
        event.originalEvent.preventDefault();
        event.originalEvent.stopPropagation();
        onClusterClick(event.layer);
      });
    }
    
    return { instance: clusterGroup, context: { ...ctx, layerContainer: clusterGroup } };
  }
);

export default MarkerClusterGroup;