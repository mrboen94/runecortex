# RuneCortex

A self-hosted, timeline-based media viewer for organizing home videos and photos.

## Tech Stack

- **Backend**: Bun + TypeScript
- **Frontend**: React + Vite + TypeScript
- **Database**: SQLite with Drizzle ORM
- **API**: GraphQL
- **Media Processing**: FFmpeg, ExifTool

## Quick Start

### Prerequisites
- Bun (latest version)
- FFmpeg and ExifTool installed on your system

### Backend Setup

```bash
cd backend
bun install
bun run db:push  # Create database tables
bun run dev      # Start development server
```

The backend will start at http://localhost:4000

### Frontend Setup

```bash
cd frontend
bun install
bun run dev
```

The frontend will start at http://localhost:5173

## API Endpoints

- GraphQL Playground: http://localhost:4000/graphql
- Media files: http://localhost:4000/media/:id
- Thumbnails: http://localhost:4000/thumbnails/:id.jpg

## Directory Structure

```
runecortex/
├── backend/          # Bun + TypeScript API server
├── frontend/         # React + Vite application
├── media/           # Your media files (configure path)
├── thumbnails/      # Generated thumbnails
└── data/           # SQLite database
```

## Scanning Media

### Manual Scan
To manually scan your media directory, use the GraphQL mutation:

```graphql
mutation {
  triggerScan(path: "/path/to/your/media") {
    processed
    newFiles
    updated
    errors {
      path
      error
    }
  }
}
```

### Automatic File Watching
RuneCortex can automatically watch directories for changes:

#### Start watching via environment variable:
```bash
WATCH_PATHS="/path/to/media1,/path/to/media2" bun run dev
```

#### Or start watching via GraphQL:
```graphql
mutation {
  startWatcher(paths: ["/path/to/your/media"]) {
    isActive
    watchPaths
    lastProcessed
  }
}
```

#### Check watcher status:
```graphql
query {
  watcherStatus {
    isActive
    watchPaths
    lastProcessed
  }
}
```

#### Stop watching:
```graphql
mutation {
  stopWatcher
}
```

The watcher will:
- Automatically detect new media files
- Process metadata using FFmpeg/FFprobe
- Generate thumbnails for new videos
- Update the database in real-time
- Batch process changes with a 2-second debounce