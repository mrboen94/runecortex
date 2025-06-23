import { useState, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import MediaViewer from './MediaViewer';
import './MediaGrid.css';
import './VirtualMediaGrid.css';

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

interface MediaGroup {
  label: string;
  items: MediaItem[];
  date?: Date;
}

interface VirtualMediaGridProps {
  media: MediaItem[];
  viewerSettings?: {
    autoPlay: boolean;
    slideInterval: number;
    mediaFilter: 'all' | 'videos' | 'images';
    sortOrder: 'date-asc' | 'date-desc' | 'name-asc' | 'name-desc';
  };
  groups?: MediaGroup[];
  zoomLevel?: number;
}

type VirtualRow = {
  type: 'header';
  content: string;
} | {
  type: 'items';
  content: MediaItem[];
};

/**
 * VirtualMediaGrid - Optimized for millions of items
 * 
 * Strategy:
 * 1. Virtualize by ROWS, not individual items
 * 2. Each row is absolutely positioned (no reflow)
 * 3. Within each row, CSS Grid handles item layout
 * 4. Headers are just special rows
 */
export default function VirtualMediaGrid({ media, viewerSettings, groups, zoomLevel = 3 }: VirtualMediaGridProps) {
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  
  // Convert zoom level to CSS variable
  const gridItemMinWidth = 180 + (zoomLevel - 1) * 43;
  
  // Calculate approximate columns (will be refined by CSS Grid)
  const approximateColumns = Math.max(1, Math.floor(1200 / gridItemMinWidth)); // Assume ~1200px width
  
  // Convert items to rows
  const rows = useMemo(() => {
    const result: VirtualRow[] = [];
    
    if (!groups || groups.length === 0) {
      // No groups - just chunk items into rows
      for (let i = 0; i < media.length; i += approximateColumns) {
        result.push({
          type: 'items',
          content: media.slice(i, i + approximateColumns)
        });
      }
    } else {
      // With groups
      groups.forEach(group => {
        if (group.label) {
          result.push({ type: 'header', content: group.label });
        }
        
        // Chunk group items into rows
        for (let i = 0; i < group.items.length; i += approximateColumns) {
          result.push({
            type: 'items',
            content: group.items.slice(i, i + approximateColumns)
          });
        }
      });
    }
    
    return result;
  }, [media, groups, approximateColumns]);
  
  // Virtual rows - fixed heights for better performance
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      // Fixed heights: header = 60px + 16px margin, items = estimated
      return rows[index].type === 'header' ? 76 : (gridItemMinWidth + 100);
    },
    overscan: 10, // Increase buffer for smoother scrolling
  });

  const handleNavigate = (newMedia: MediaItem) => {
    setSelectedMedia(newMedia);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const renderMediaItem = (item: MediaItem) => (
    <div 
      key={item.id}
      className="media-item"
      onClick={() => setSelectedMedia(item)}
    >
      <div className="media-thumbnail">
        {item.thumbnailUrl && (
          <img 
            src={`http://localhost:4001${item.thumbnailUrl}`} 
            alt={item.filename}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
              const placeholder = (e.target as HTMLImageElement).parentElement?.querySelector('.placeholder') as HTMLElement;
              if (placeholder) placeholder.style.display = 'flex';
            }}
          />
        )}
        <div 
          className="placeholder" 
          style={{ display: item.thumbnailUrl ? 'none' : 'flex' }}
        >
          {item.fileType === 'video' ? '🎬' : '🖼️'}
        </div>
        {item.fileType === 'video' && item.duration && (
          <span className="duration">{formatDuration(item.duration)}</span>
        )}
      </div>
      <div className="media-info">
        <p className="date">{new Date(item.createdAt).toLocaleDateString()}</p>
        {item.locationName && (
          <p className="location">{item.locationName}</p>
        )}
        <p className="filename">{item.filename}</p>
      </div>
    </div>
  );

  return (
    <>
      <div
        ref={parentRef}
        className="virtual-media-grid-container"
        style={{ 
          height: '100%', 
          overflow: 'auto',
          '--grid-item-min-width': `${gridItemMinWidth}px`
        } as React.CSSProperties}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                // Remove dynamic measurement for better performance
                // ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.type === 'header' ? (
                  <div className="timeline-group-header">
                    {row.content}
                  </div>
                ) : (
                  <div className="virtual-grid-row">
                    {row.content.map(item => renderMediaItem(item))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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