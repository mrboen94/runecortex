import { useState } from 'react'
import Timeline from './components/Timeline'
import MapView from './components/MapView'
import SimpleMap from './components/SimpleMap'
import ReindexControls from './components/ReindexControls'
import StatusIndicator from './components/StatusIndicator'
import FolderBrowser from './components/FolderBrowser'
import ScanProgress from './components/ScanProgress'
import PathRestorer from './components/PathRestorer'
import ViewerSettingsComponent, { type ViewerSettings } from './components/ViewerSettings'
import { FolderProvider } from './contexts/FolderContext'
import './App.css'

function App() {
  const [currentView, setCurrentView] = useState<'timeline' | 'map'>('timeline');
  const [viewerSettings, setViewerSettings] = useState<ViewerSettings>({
    autoPlay: true,
    slideInterval: 5,
    mediaFilter: 'all',
    sortOrder: 'date-desc',
    showCounter: true,
    showDate: true,
    showLocation: true,
    counterDuration: 1,
    dateDuration: 0, // Always visible by default
    locationDuration: 0 // Always visible by default
  });

  // Use state for media count to persist across renders
  const [mediaCount, setMediaCount] = useState({
    total: 0,
    videos: 0,
    images: 0
  });

  return (
    <FolderProvider>
      <div className="app">
        <PathRestorer />
        <header className="app-header">
          <div className="header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <ReindexControls />
              <StatusIndicator />
              <FolderBrowser />
              <div className="view-switcher">
                <button 
                  className={`view-button ${currentView === 'timeline' ? 'active' : ''}`}
                  onClick={() => setCurrentView('timeline')}
                >
                  📅 Timeline
                </button>
                <button 
                  className={`view-button ${currentView === 'map' ? 'active' : ''}`}
                  onClick={() => setCurrentView('map')}
                >
                  🗺️ Map
                </button>
              </div>
            </div>
            <ViewerSettingsComponent 
              settings={viewerSettings}
              onSettingsChange={setViewerSettings}
              mediaCount={mediaCount}
            />
          </div>
        </header>
        <main className="app-main">
          {currentView === 'timeline' ? (
            <Timeline viewerSettings={viewerSettings} onMediaCountUpdate={setMediaCount} />
          ) : (
            <MapView />
          )}
        </main>
        
        {/* Global scan progress indicator */}
        <div className="scan-progress-global">
          <ScanProgress />
        </div>
      </div>
    </FolderProvider>
  )
}

export default App
