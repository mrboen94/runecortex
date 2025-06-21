import { useState } from 'react';
import './ViewerSettings.css';

export type MediaFilter = 'all' | 'videos' | 'images';
export type SortOrder = 'date-asc' | 'date-desc' | 'name-asc' | 'name-desc';

interface ViewerSettings {
  autoPlay: boolean;
  slideInterval: number;
  mediaFilter: MediaFilter;
  sortOrder: SortOrder;
}

interface ViewerSettingsProps {
  settings: ViewerSettings;
  onSettingsChange: (settings: ViewerSettings) => void;
  mediaCount: { total: number; videos: number; images: number };
}

export default function ViewerSettingsComponent({ settings, onSettingsChange, mediaCount }: ViewerSettingsProps) {
  const [showSettings, setShowSettings] = useState(false);

  const updateSetting = <K extends keyof ViewerSettings>(key: K, value: ViewerSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="viewer-settings">
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
            <h4>Autoplay</h4>
            <label className="setting-item">
              <input 
                type="checkbox" 
                checked={settings.autoPlay}
                onChange={(e) => updateSetting('autoPlay', e.target.checked)}
              />
              <span>Auto-advance media</span>
            </label>
            
            <label className="setting-item">
              <span>Image interval:</span>
              <input 
                type="number" 
                min="1" 
                max="60" 
                value={settings.slideInterval}
                onChange={(e) => updateSetting('slideInterval', parseInt(e.target.value) || 5)}
                disabled={!settings.autoPlay}
              />
              <span>seconds</span>
            </label>
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
        </div>
      )}
    </div>
  );
}

export type { ViewerSettings };