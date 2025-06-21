# Test Setup - Keep It Simple!

## Prerequisites

You need ffmpeg installed to run tests (just like you need it to run the app):

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian  
sudo apt install ffmpeg

# Check it's installed
ffmpeg -version
ffprobe -version
```

## Running Tests

```bash
# Run all tests
bun test

# Run specific test
bun test scanner.test.ts

# With coverage
bun test --coverage
```

## That's It!

No complex mocking needed. The tests use real ffmpeg just like the app does.

If a test fails because ffmpeg isn't installed, install ffmpeg. 
Simple as that.

## Why No Mocks?

1. **FFmpeg is a core dependency** - Your app doesn't work without it
2. **It's fast** - FFprobe takes ~50ms, not worth mocking  
3. **It's reliable** - Local binary, no network calls
4. **Real testing is better** - Catch actual integration issues

## For CI/CD

Your GitHub Actions just needs:
```yaml
- name: Install FFmpeg
  run: sudo apt-get update && sudo apt-get install -y ffmpeg
```

Done! No mock maintenance, no fake responses, just real testing.