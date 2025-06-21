import Timeline from './components/Timeline'
import ReindexControls from './components/ReindexControls'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>RuneCortex Media Viewer</h1>
        <ReindexControls />
      </header>
      <main className="app-main">
        <Timeline />
      </main>
    </div>
  )
}

export default App
