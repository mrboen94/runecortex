import { useState } from 'react'
import Timeline from './components/Timeline'
import ReindexControls from './components/ReindexControls'
import ViewerSettingsComponent, { type ViewerSettings } from './components/ViewerSettings'
import './App.css'

function App() {
  const [viewerSettings, setViewerSettings] = useState<ViewerSettings>({
    autoPlay: true,
    slideInterval: 5,
    mediaFilter: 'all',
    sortOrder: 'date-desc'
  });

  // This will be calculated from actual media data
  const mediaCount = {
    total: 0,
    videos: 0,
    images: 0
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <h1>RuneCortex Media Viewer</h1>
          <ViewerSettingsComponent 
            settings={viewerSettings}
            onSettingsChange={setViewerSettings}
            mediaCount={mediaCount}
          />
        </div>
        <ReindexControls />
      </header>
      <main className="app-main">
        <Timeline viewerSettings={viewerSettings} onMediaCountUpdate={(count) => Object.assign(mediaCount, count)} />
      </main>
    </div>
  )
}

export default App
