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
}

const MarkerClusterGroup = createPathComponent<L.MarkerClusterGroup, MarkerClusterGroupProps>(
  ({ children, ...options }, ctx) => {
    const clusterGroup = (L as any).markerClusterGroup(options);
    return { instance: clusterGroup, context: { ...ctx, layerContainer: clusterGroup } };
  }
);

export default MarkerClusterGroup;