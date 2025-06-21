import { useState } from 'react'
import Timeline from './components/Timeline'
import ReindexControls from './components/ReindexControls'
import StatusIndicator from './components/StatusIndicator'
import FolderBrowser from './components/FolderBrowser'
import ScanProgress from './components/ScanProgress'
import ViewerSettingsComponent, { type ViewerSettings } from './components/ViewerSettings'
import { FolderProvider } from './contexts/FolderContext'
import './App.css'

function App() {
  const [viewerSettings, setViewerSettings] = useState<ViewerSettings>({
    autoPlay: true,
    slideInterval: 5,
    mediaFilter: 'all',
    sortOrder: 'date-desc',
    showCounter: true,
    showDate: true,
    counterDuration: 1,
    dateDuration: 0 // Always visible by default
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
        <header className="app-header">
          <div className="header-top">
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              <ReindexControls />
              <StatusIndicator />
              <FolderBrowser />
            </div>
            <ViewerSettingsComponent 
              settings={viewerSettings}
              onSettingsChange={setViewerSettings}
              mediaCount={mediaCount}
            />
          </div>
        </header>
        <main className="app-main">
          <Timeline viewerSettings={viewerSettings} onMediaCountUpdate={setMediaCount} />
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
