# FFmpeg Setup for Testing

There are three approaches to handle ffmpeg/ffprobe in tests:

## 1. Mock Approach (Default)
The tests use mocked ffmpeg/ffprobe responses by default. This is fast and doesn't require any external dependencies.

## 2. Real FFmpeg (Local Installation)
If you want to use real ffmpeg in tests:

### macOS
```bash
brew install ffmpeg
```

### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

### Windows
Download from https://ffmpeg.org/download.html

Then set the environment variable:
```bash
export USE_REAL_FFMPEG=true
bun test
```

## 3. Docker Approach
Use ffmpeg via Docker container:

```bash
# Pull the ffmpeg image
docker pull jrottenberg/ffmpeg:latest

# Run tests with Docker ffmpeg
export USE_DOCKER_FFMPEG=true
bun test
```

## 4. GitHub Actions
For CI/CD, the workflow already includes ffmpeg:

```yaml
- name: Install ffmpeg
  run: |
    sudo apt-get update
    sudo apt-get install -y ffmpeg
```

## Switching Between Approaches

In your test files:
```typescript
// Use mock (default)
const cleanupFFmpeg = setupFFmpegMocks();

// Use real ffmpeg
if (process.env.USE_REAL_FFMPEG) {
  // No mocking needed
}

// Use Docker
if (process.env.USE_DOCKER_FFMPEG) {
  // Commands will be wrapped in docker run
}
```