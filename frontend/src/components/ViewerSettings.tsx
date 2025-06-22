import { useState, useRef, useEffect } from 'react';
import { useMutation, useApolloClient } from '@apollo/client';
import { REINDEX_THUMBNAILS, CLEAR_ALL_THUMBNAILS } from '../graphql/queries';
import './ViewerSettings.css';

export type MediaFilter = 'all' | 'videos' | 'images';
export type SortOrder = 'date-asc' | 'date-desc' | 'name-asc' | 'name-desc';

interface ViewerSettings {
  autoPlay: boolean;
  slideInterval: number;
  mediaFilter: MediaFilter;
  sortOrder: SortOrder;
  showCounter: boolean;
  showDate: boolean;
  showLocation: boolean;
  counterDuration: number; // 0 = always show, -1 = always hide, > 0 = duration in seconds
  dateDuration: number; // 0 = always show, -1 = always hide, > 0 = duration in seconds
  locationDuration: number; // 0 = always show, -1 = always hide, > 0 = duration in seconds
}

interface ViewerSettingsProps {
  settings: ViewerSettings;
  onSettingsChange: (settings: ViewerSettings) => void;
  mediaCount: { total: number; videos: number; images: number };
}

interface ReindexResult {
  success: boolean;
  message: string;
  thumbnailsProcessed: number;
  errors: string[];
}

export default function ViewerSettingsComponent({ settings, onSettingsChange, mediaCount }: ViewerSettingsProps) {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [isReindexing, setIsReindexing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [result, setResult] = useState<ReindexResult | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDisplayOptions, setShowDisplayOptions] = useState(false);
  
  const apolloClient = useApolloClient();
  const [reindexThumbnails] = useMutation(REINDEX_THUMBNAILS);
  const [clearAllThumbnails] = useMutation(CLEAR_ALL_THUMBNAILS);

  const updateSetting = <K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const handleReindex = async () => {
    setIsReindexing(true);
    setResult(null);
    
    try {
      const { data } = await reindexThumbnails();
      setResult(data.reindexThumbnails);
      
      // Clear Apollo cache to refresh thumbnail URLs
      await apolloClient.refetchQueries({
        include: 'active',
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Network error: ${error}`,
        thumbnailsProcessed: 0,
        errors: [String(error)]
      });
    } finally {
      setIsReindexing(false);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    setResult(null);
    setShowClearConfirm(false);
    
    try {
      const { data } = await clearAllThumbnails();
      setResult(data.clearAllThumbnails);
      
      // Clear Apollo cache to refresh thumbnail URLs
      await apolloClient.refetchQueries({
        include: 'active',
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Network error: ${error}`,
        thumbnailsProcessed: 0,
        errors: [String(error)]
      });
    } finally {
      setIsClearing(false);
    }
  };

  // Close settings when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    };

    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSettings]);

  return (
    <div className="viewer-settings" ref={settingsRef}>
      <button 
        className="settings-toggle"
        onClick={() => setShowSettings(!showSettings)}
        title="Viewer Settings"
      >
        ⚙️ Settings
      </button>

      {showSettings && (
        <div className="settings-panel">
          <div className="settings-section">
            <h4>Filter Media</h4>
            <div className="filter-buttons">
              <button 
                className={`filter-btn ${settings.mediaFilter === 'all' ? 'active' : ''}`}
                onClick={() => updateSetting('mediaFilter', 'all')}
              >
                All ({mediaCount.total})
              </button>
              <button 
                className={`filter-btn ${settings.mediaFilter === 'videos' ? 'active' : ''}`}
                onClick={() => updateSetting('mediaFilter', 'videos')}
              >
                🎬 Videos ({mediaCount.videos})
              </button>
              <button 
                className={`filter-btn ${settings.mediaFilter === 'images' ? 'active' : ''}`}
                onClick={() => updateSetting('mediaFilter', 'images')}
              >
                🖼️ Images ({mediaCount.images})
              </button>
            </div>
          </div>

          <div className="settings-section">
            <h4>Sort By</h4>
            <select 
              value={settings.sortOrder}
              onChange={(e) => updateSetting('sortOrder', e.target.value as SortOrder)}
              className="sort-select"
            >
              <option value="date-desc">Date (Newest First)</option>
              <option value="date-asc">Date (Oldest First)</option>
              <option value="name-asc">Name (A-Z)</option>
              <option value="name-desc">Name (Z-A)</option>
            </select>
          </div>

          <div className="settings-section">
            <h4>Autoplay</h4>
            <div className="setting-item with-duration">
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={settings.autoPlay}
                  onChange={(e) => updateSetting('autoPlay', e.target.checked)}
                />
                <span>Auto-advance media</span>
              </label>
              {settings.autoPlay && (
                <input 
                  type="number" 
                  min="1" 
                  max="60" 
                  value={settings.slideInterval}
                  onChange={(e) => updateSetting('slideInterval', parseInt(e.target.value) || 5)}
                  className="duration-input"
                  title="Image interval in seconds"
                />
              )}
            </div>
            <p className="settings-help">Seconds between images in slideshow</p>
          </div>

          <div className="settings-section collapsible">
            <h4 
              className="settings-header collapsible-header" 
              onClick={() => setShowDisplayOptions(!showDisplayOptions)}
            >
              <span className="collapse-icon">{showDisplayOptions ? '▼' : '▶'}</span>
              Display Options
            </h4>
            {showDisplayOptions && (
            <div className="collapsible-content">
            <div className="setting-item with-duration">
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={settings.showDate}
                  onChange={(e) => updateSetting('showDate', e.target.checked)}
                />
                <span>Show date</span>
              </label>
              {settings.showDate && (
                <input 
                  type="number"
                  min="0"
                  value={settings.dateDuration || 0}
                  onChange={(e) => updateSetting('dateDuration', Math.max(0, parseInt(e.target.value) || 0))}
                  className="duration-input"
                  title="Duration in seconds (0 = always visible)"
                />
              )}
            </div>
            
            <div className="setting-item with-duration">
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={settings.showCounter}
                  onChange={(e) => updateSetting('showCounter', e.target.checked)}
                />
                <span>Show position counter</span>
              </label>
              {settings.showCounter && (
                <input 
                  type="number"
                  min="0"
                  value={settings.counterDuration || 1}
                  onChange={(e) => updateSetting('counterDuration', Math.max(0, parseInt(e.target.value) || 0))}
                  className="duration-input"
                  title="Duration in seconds (0 = always visible)"
                />
              )}
            </div>
            
            <div className="setting-item with-duration">
              <label className="checkbox-label">
                <input 
                  type="checkbox" 
                  checked={settings.showLocation}
                  onChange={(e) => updateSetting('showLocation', e.target.checked)}
                />
                <span>Show GPS location</span>
              </label>
              {settings.showLocation && (
                <input 
                  type="number"
                  min="0"
                  value={settings.locationDuration || 0}
                  onChange={(e) => updateSetting('locationDuration', Math.max(0, parseInt(e.target.value) || 0))}
                  className="duration-input"
                  title="Duration in seconds (0 = always visible)"
                />
              )}
            </div>
            <p className="settings-help">Duration in seconds (0 = always visible)</p>
            </div>
            )}
          </div>

          <div className="settings-section">
            <h4>Thumbnail Management</h4>
            <div className="thumbnail-controls">
              <button 
                onClick={handleReindex}
                disabled={isReindexing || isClearing}
                className="settings-btn primary"
              >
                {isReindexing ? 'Reindexing...' : '🔄 Fix Thumbnails'}
              </button>
              
              {!showClearConfirm ? (
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  disabled={isReindexing || isClearing}
                  className="settings-btn secondary"
                >
                  🗑️ Clear All
                </button>
              ) : (
                <div className="clear-confirm">
                  <span>Delete all thumbnails?</span>
                  <button 
                    onClick={handleClearAll}
                    disabled={isClearing}
                    className="settings-btn danger"
                  >
                    {isClearing ? 'Clearing...' : 'Yes, Delete All'}
                  </button>
                  <button 
                    onClick={() => setShowClearConfirm(false)}
                    disabled={isClearing}
                    className="settings-btn secondary"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            
            {result && (
              <div className={`reindex-result ${result.success ? 'success' : 'error'}`}>
                <h5>{result.success ? '✅ Success' : '⚠️ Warning'}</h5>
                <p>{result.message}</p>
                
                {result.thumbnailsProcessed > 0 && (
                  <p>Processed: {result.thumbnailsProcessed} thumbnails</p>
                )}
                
                {result.errors.length > 0 && (
                  <details className="error-details">
                    <summary>Errors ({result.errors.length})</summary>
                    <ul>
                      {result.errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </details>
                )}
                
                <button 
                  onClick={() => setResult(null)}
                  className="close-result"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export type { ViewerSettings };