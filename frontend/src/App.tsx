import { useState } from 'react'
import Timeline from './components/Timeline'
import ReindexControls from './components/ReindexControls'
import StatusIndicator from './components/StatusIndicator'
import ViewerSettingsComponent, { type ViewerSettings } from './components/ViewerSettings'
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
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <ReindexControls />
            <StatusIndicator />
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
    </div>
  )
}

export default App
