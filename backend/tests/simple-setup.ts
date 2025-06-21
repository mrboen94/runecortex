import { $ } from 'bun';

/**
 * Simple test setup - just check if ffmpeg is available
 */
export async function checkFFmpegAvailable() {
  try {
    await $`which ffmpeg`.quiet();
    await $`which ffprobe`.quiet();
    return true;
  } catch {
    console.error(`
⚠️  FFmpeg/FFprobe not found!

To run tests, please install ffmpeg:
  
  macOS:    brew install ffmpeg
  Ubuntu:   sudo apt install ffmpeg
  Windows:  Download from https://ffmpeg.org

Or run in Docker:
  docker run --rm -it -v $(pwd):/app -w /app oven/bun:latest sh -c "apt update && apt install -y ffmpeg && bun test"
`);
    process.exit(1);
  }
}

// Run this check when tests start
if (process.env.NODE_ENV === 'test') {
  await checkFFmpegAvailable();
}