import { useQuery } from '@apollo/client';
import { useState, useMemo, useEffect } from 'react';
import { GET_ALL_MEDIA } from '../graphql/queries';
import MediaGrid from './MediaGrid';
import TimelineView from './TimelineView';
import Navigation from './Navigation';
import type { ViewMode, GroupBy } from './Navigation';
import './Timeline.css';

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

interface GroupedMedia {
  [key: string]: {
    [subKey: string]: MediaItem[];
  };
}

interface TimelineProps {
  viewerSettings: {
    autoPlay: boolean;
    slideInterval: number;
    mediaFilter: 'all' | 'videos' | 'images';
    sortOrder: 'date-asc' | 'date-desc' | 'name-asc' | 'name-desc';
  };
  onMediaCountUpdate: (count: { total: number; videos: number; images: number }) => void;
}

export default function Timeline({ viewerSettings, onMediaCountUpdate }: TimelineProps) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => 
    (localStorage.getItem('viewMode') as ViewMode) || 'timeline'
  );
  const [groupBy, setGroupBy] = useState<GroupBy>(() => 
    (localStorage.getItem('groupBy') as GroupBy) || 'month'
  );
  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  
  const { data, loading, error } = useQuery(GET_ALL_MEDIA, {
    variables: { limit: 1000 }
  });

  useEffect(() => {
    localStorage.setItem('viewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('groupBy', groupBy);
  }, [groupBy]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedYear(null);
    setSelectedMonth(null);
    setSelectedDay(null);
  };

  // Filter and sort media based on viewer settings
  const filteredAndSortedMedia = useMemo(() => {
    if (!data?.allMedia) return [];
    
    // Filter by media type
    let filtered = data.allMedia;
    if (viewerSettings.mediaFilter !== 'all') {
      filtered = data.allMedia.filter((item: MediaItem) => {
        if (viewerSettings.mediaFilter === 'videos') {
          return item.fileType === 'video';
        } else {
          return item.fileType === 'image';
        }
      });
    }
    
    // Sort media
    const sorted = [...filtered].sort((a, b) => {
      switch (viewerSettings.sortOrder) {
        case 'date-asc':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'date-desc':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'name-asc':
          return a.filename.localeCompare(b.filename);
        case 'name-desc':
          return b.filename.localeCompare(a.filename);
        default:
          return 0;
      }
    });
    
    return sorted;
  }, [data, viewerSettings.mediaFilter, viewerSettings.sortOrder]);

  // Update media counts
  useEffect(() => {
    if (data?.allMedia) {
      const videos = data.allMedia.filter((item: MediaItem) => item.fileType === 'video').length;
      const images = data.allMedia.filter((item: MediaItem) => item.fileType === 'image').length;
      onMediaCountUpdate({
        total: data.allMedia.length,
        videos,
        images
      });
    }
  }, [data, onMediaCountUpdate]);

  const groupedByYear = useMemo(() => {
    if (!filteredAndSortedMedia.length) return {};
    
    const grouped: GroupedMedia = {};
    
    filteredAndSortedMedia.forEach((item: MediaItem) => {
      const date = new Date(item.createdAt);
      const year = date.getFullYear().toString();
      
      if (!grouped[year]) grouped[year] = {};
      grouped[year].all = grouped[year].all || [];
      grouped[year].all.push(item);
    });
    
    return grouped;
  }, [filteredAndSortedMedia]);

  const groupedByMonth = useMemo(() => {
    if (!filteredAndSortedMedia.length) return {};
    
    const grouped: GroupedMedia = {};
    
    filteredAndSortedMedia.forEach((item: MediaItem) => {
      const date = new Date(item.createdAt);
      const year = date.getFullYear().toString();
      const month = date.toLocaleString('default', { month: 'long' });
      
      if (!grouped[year]) grouped[year] = {};
      if (!grouped[year][month]) grouped[year][month] = [];
      
      grouped[year][month].push(item);
    });
    
    return grouped;
  }, [filteredAndSortedMedia]);

  const groupedByDay = useMemo(() => {
    if (!filteredAndSortedMedia.length) return {};
    
    const grouped: GroupedMedia = {};
    
    filteredAndSortedMedia.forEach((item: MediaItem) => {
      const date = new Date(item.createdAt);
      const year = date.getFullYear().toString();
      const month = date.toLocaleString('default', { month: 'long' });
      const day = date.getDate().toString();
      const monthDay = `${month}|${day}`;
      
      if (!grouped[year]) grouped[year] = {};
      if (!grouped[year][monthDay]) grouped[year][monthDay] = [];
      
      grouped[year][monthDay].push(item);
    });
    
    return grouped;
  }, [filteredAndSortedMedia]);

  const years = Object.keys(groupedByYear).sort((a, b) => parseInt(b) - parseInt(a));
  const sortedMedia = filteredAndSortedMedia;

  if (loading) return <div className="loading">Loading media...</div>;
  if (error) return <div className="error">Error loading media: {error.message}</div>;

  const renderBreadcrumb = () => {
    if (viewMode === 'timeline' || !selectedYear) return null;
    
    return (
      <nav className="breadcrumb">
        <button onClick={() => { 
          setSelectedYear(null); 
          setSelectedMonth(null); 
          setSelectedDay(null);
        }}>
          All Years
        </button>
        {selectedYear && (
          <>
            <span>/</span>
            <button onClick={() => {
              setSelectedMonth(null);
              setSelectedDay(null);
            }}>
              {selectedYear}
            </button>
          </>
        )}
        {selectedMonth && (
          <>
            <span>/</span>
            <button onClick={() => setSelectedDay(null)}>
              {selectedMonth}
            </button>
          </>
        )}
        {selectedDay && (
          <>
            <span>/</span>
            <span>{selectedDay}</span>
          </>
        )}
      </nav>
    );
  };

  const renderContent = () => {
    if (viewMode === 'timeline') {
      return <TimelineView media={sortedMedia} groupBy={groupBy} viewerSettings={viewerSettings} />;
    }

    // Folder-based views (year, month, day)
    if (!selectedYear) {
      return (
        <div className="year-grid">
          {years.map(year => {
            const totalItems = groupedByYear[year].all.length;
            
            return (
              <button
                key={year}
                className="year-card"
                onClick={() => setSelectedYear(year)}
              >
                <h2>{year}</h2>
                <p>{totalItems} items</p>
              </button>
            );
          })}
        </div>
      );
    }

    if (viewMode === 'year' || (viewMode === 'month' && !selectedMonth) || (viewMode === 'day' && !selectedMonth)) {
      // Show months for selected year
      const months = Object.keys(groupedByMonth[selectedYear] || {})
        .filter(m => m !== 'all')
        .sort((a, b) => {
          const monthOrder = ['January', 'February', 'March', 'April', 'May', 'June',
                             'July', 'August', 'September', 'October', 'November', 'December'];
          return monthOrder.indexOf(a) - monthOrder.indexOf(b);
        });

      if (viewMode === 'year') {
        // Show all items for the year
        return <MediaGrid media={groupedByYear[selectedYear].all} viewerSettings={viewerSettings} />;
      }

      return (
        <div className="month-grid">
          {months.map(month => (
            <button
              key={month}
              className="month-card"
              onClick={() => setSelectedMonth(month)}
            >
              <h3>{month}</h3>
              <p>{groupedByMonth[selectedYear][month].length} items</p>
            </button>
          ))}
        </div>
      );
    }

    if (viewMode === 'month' && selectedMonth) {
      return <MediaGrid media={groupedByMonth[selectedYear][selectedMonth]} viewerSettings={viewerSettings} />;
    }

    if (viewMode === 'day' && selectedMonth && !selectedDay) {
      // Show days for selected month
      const days = Object.keys(groupedByDay[selectedYear] || {})
        .filter(key => key.startsWith(selectedMonth + '|'))
        .map(key => {
          const [, day] = key.split('|');
          return { day, key };
        })
        .sort((a, b) => parseInt(a.day) - parseInt(b.day));

      return (
        <div className="day-grid">
          {days.map(({ day, key }) => (
            <button
              key={key}
              className="day-card"
              onClick={() => setSelectedDay(day)}
            >
              <h3>{selectedMonth} {day}</h3>
              <p>{groupedByDay[selectedYear][key].length} items</p>
            </button>
          ))}
        </div>
      );
    }

    if (viewMode === 'day' && selectedMonth && selectedDay) {
      const key = `${selectedMonth}|${selectedDay}`;
      return <MediaGrid media={groupedByDay[selectedYear][key]} viewerSettings={viewerSettings} />;
    }

    return null;
  };

  return (
    <div className="timeline">
      <Navigation 
        viewMode={viewMode}
        groupBy={groupBy}
        onViewModeChange={handleViewModeChange}
        onGroupByChange={setGroupBy}
        breadcrumb={renderBreadcrumb()}
      />

      <main className="timeline-content">
        {renderContent()}
      </main>
    </div>
  );
}