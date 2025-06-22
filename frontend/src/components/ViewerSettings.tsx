import { useState, useRef, useEffect } from 'react';
import { useFolderContext } from '../contexts/FolderContext';
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

export default function ViewerSettingsComponent({ settings, onSettingsChange, mediaCount }: ViewerSettingsProps) {
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const { showAllFolders, setShowAllFolders } = useFolderContext();

  const updateSetting = <K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
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
            <h4>Folder Options</h4>
            <label className="checkbox-label">
              <input 
                type="checkbox" 
                checked={showAllFolders}
                onChange={(e) => setShowAllFolders(e.target.checked)}
              />
              <span>Show all folders</span>
            </label>
            <p className="settings-help">When unchecked, only shows media from the current folder</p>
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
            <h4>Display Options</h4>
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
        </div>
      )}
    </div>
  );
}

export type { ViewerSettings };