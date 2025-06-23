import { useQuery } from '@apollo/client';
import { useState, useMemo, useEffect } from 'react';
import { GET_ALL_MEDIA } from '../graphql/queries';
import VirtualMediaGrid from './VirtualMediaGrid';
import Navigation from './Navigation';
import { useFolderContext } from '../contexts/FolderContext';
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
  latitude?: number;
  longitude?: number;
  altitude?: number;
  locationName?: string;
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
  const [zoomLevel, setZoomLevel] = useState<number>(() => 
    parseInt(localStorage.getItem('zoomLevel') || '3')
  );
  
  const { currentPath, showAllFolders } = useFolderContext();
  
  const { data, loading, error } = useQuery(GET_ALL_MEDIA, {
    variables: { 
      limit: 1000,
      sourcePath: showAllFolders ? undefined : currentPath
    }
  });

  useEffect(() => {
    localStorage.setItem('viewMode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('groupBy', groupBy);
  }, [groupBy]);

  useEffect(() => {
    localStorage.setItem('zoomLevel', zoomLevel.toString());
  }, [zoomLevel]);

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

  // Get currently visible media based on view mode and selections
  const getCurrentlyVisibleMedia = () => {
    switch (viewMode) {
      case 'timeline':
        return filteredAndSortedMedia;
        
      case 'year':
        // When in year view, show all media for selected year, or all if no year selected
        if (selectedYear) {
          return Object.values(groupedByMonth[selectedYear] || {}).flat();
        }
        return filteredAndSortedMedia;
        
      case 'month':
        if (selectedYear && selectedMonth) {
          return groupedByMonth[selectedYear]?.[selectedMonth] || [];
        } else if (selectedYear) {
          // Show all media for the year if month not selected yet
          return Object.values(groupedByMonth[selectedYear] || {}).flat();
        }
        return [];
        
      case 'day':
        if (selectedYear && selectedMonth && selectedDay) {
          const key = `${selectedMonth}|${selectedDay}`;
          return groupedByDay[selectedYear]?.[key] || [];
        } else if (selectedYear && selectedMonth) {
          // Show all media for the month if day not selected yet
          return groupedByMonth[selectedYear]?.[selectedMonth] || [];
        }
        return [];
        
      default:
        return [];
    }
  };

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

  // Create grouped data structure for timeline view
  const getTimelineGroupedData = () => {
    if (groupBy === 'none') {
      return [{ label: '', items: sortedMedia }];
    }

    const groups = new Map<string, { label: string; items: MediaItem[]; date: Date }>();
    
    sortedMedia.forEach(item => {
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
      
      if (!groups.has(key)) {
        groups.set(key, { label, items: [], date });
      }
      
      groups.get(key)!.items.push(item);
    });
    
    // Sort groups based on viewer settings
    const groupsArray = Array.from(groups.values());
    
    // Sort groups according to the sort order
    switch (viewerSettings.sortOrder) {
      case 'date-asc':
        return groupsArray.sort((a, b) => a.date.getTime() - b.date.getTime());
      case 'date-desc':
        return groupsArray.sort((a, b) => b.date.getTime() - a.date.getTime());
      case 'name-asc':
        return groupsArray.sort((a, b) => a.label.localeCompare(b.label));
      case 'name-desc':
        return groupsArray.sort((a, b) => b.label.localeCompare(a.label));
      default:
        return groupsArray;
    }
  };

  const renderContent = () => {
    // Timeline view mode
    if (viewMode === 'timeline') {
      const groups = getTimelineGroupedData();
      return (
        <div className="media-grid-container">
          <VirtualMediaGrid 
            media={sortedMedia} 
            viewerSettings={viewerSettings}
            groups={groupBy !== 'none' ? groups : undefined}
            zoomLevel={zoomLevel}
          />
        </div>
      );
    }

    // Folder-based views (year, month, day)
    if (!selectedYear) {
      return (
        <div className="grid-wrapper">
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
        return (
          <div className="media-grid-container">
            <VirtualMediaGrid media={groupedByYear[selectedYear]?.all || []} viewerSettings={viewerSettings} zoomLevel={zoomLevel} />
          </div>
        );
      }

      return (
        <div className="grid-wrapper">
          <div className="month-grid">
            {months.map(month => (
              <button
                key={month}
                className="month-card"
                onClick={() => setSelectedMonth(month)}
              >
                <h3>{month}</h3>
                <p>{groupedByMonth[selectedYear]?.[month]?.length || 0} items</p>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (viewMode === 'month' && selectedMonth) {
      return (
        <div className="media-grid-container">
          <VirtualMediaGrid media={groupedByMonth[selectedYear]?.[selectedMonth] || []} viewerSettings={viewerSettings} zoomLevel={zoomLevel} />
        </div>
      );
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
        <div className="grid-wrapper">
          <div className="day-grid">
            {days.map(({ day, key }) => (
              <button
                key={key}
                className="day-card"
                onClick={() => setSelectedDay(day)}
              >
                <h3>{selectedMonth} {day}</h3>
                <p>{groupedByDay[selectedYear]?.[key]?.length || 0} items</p>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (viewMode === 'day' && selectedMonth && selectedDay) {
      const key = `${selectedMonth}|${selectedDay}`;
      return (
        <div className="media-grid-container">
          <VirtualMediaGrid media={groupedByDay[selectedYear]?.[key] || []} viewerSettings={viewerSettings} zoomLevel={zoomLevel} />
        </div>
      );
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
        currentMedia={getCurrentlyVisibleMedia().map(item => ({
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
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
      />

      <main className="timeline-content">
        {renderContent()}
      </main>
    </div>
  );
}