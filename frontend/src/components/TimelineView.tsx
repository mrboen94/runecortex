import { useMemo } from 'react';
import MediaGrid from './MediaGrid';
import type { GroupBy } from './Navigation';
import './TimelineView.css';

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

interface TimelineViewProps {
  media: MediaItem[];
  groupBy: GroupBy;
}

interface MediaGroup {
  label: string;
  items: MediaItem[];
  date: Date;
}

export default function TimelineView({ media, groupBy }: TimelineViewProps) {
  const groups = useMemo(() => {
    if (groupBy === 'none') {
      return [{
        label: '',
        items: media,
        date: new Date()
      }];
    }

    const grouped = new Map<string, MediaGroup>();
    
    media.forEach(item => {
      const date = new Date(item.createdAt);
      let key: string;
      let label: string;
      
      switch (groupBy) {
        case 'year':
          key = date.getFullYear().toString();
          label = key;
          break;
        case 'month':
          key = `${date.getFullYear()}-${date.getMonth()}`;
          label = date.toLocaleDateString('default', { year: 'numeric', month: 'long' });
          break;
        case 'day':
          key = date.toDateString();
          label = date.toLocaleDateString('default', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          });
          break;
        default:
          key = '';
          label = '';
      }
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          label,
          items: [],
          date
        });
      }
      
      grouped.get(key)!.items.push(item);
    });
    
    // Sort groups by date (newest first)
    return Array.from(grouped.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [media, groupBy]);

  return (
    <div className="timeline-view">
      {groups.map((group, index) => (
        <div key={index} className="timeline-group">
          {group.label && (
            <h2 className="timeline-group-header">{group.label}</h2>
          )}
          <MediaGrid media={group.items} />
        </div>
      ))}
    </div>
  );
}