interface ScanProgress {
  isScanning: boolean;
  currentPath?: string;
  totalFiles: number;
  processedFiles: number;
  phase: 'idle' | 'discovering' | 'processing' | 'generating_thumbnails' | 'complete';
  message?: string;
  startTime?: Date;
}

class ScanProgressTracker {
  private progress: ScanProgress = {
    isScanning: false,
    totalFiles: 0,
    processedFiles: 0,
    phase: 'idle'
  };

  startScan(path: string) {
    this.progress = {
      isScanning: true,
      currentPath: path,
      totalFiles: 0,
      processedFiles: 0,
      phase: 'discovering',
      message: 'Discovering media files...',
      startTime: new Date()
    };
  }

  updateDiscovering(filesFound: number) {
    if (this.progress.isScanning) {
      this.progress.totalFiles = filesFound;
      this.progress.message = `Found ${filesFound} media files...`;
    }
  }

  startProcessing(totalFiles: number) {
    if (this.progress.isScanning) {
      this.progress.phase = 'processing';
      this.progress.totalFiles = totalFiles;
      this.progress.processedFiles = 0;
      this.progress.message = 'Processing media files...';
    }
  }

  updateProcessed(processed: number) {
    if (this.progress.isScanning) {
      this.progress.processedFiles = processed;
      this.progress.message = `Processing file ${processed} of ${this.progress.totalFiles}...`;
    }
  }

  startThumbnailGeneration() {
    if (this.progress.isScanning) {
      this.progress.phase = 'generating_thumbnails';
      this.progress.message = 'Generating thumbnails...';
    }
  }

  complete() {
    const duration = this.progress.startTime ? 
      Math.round((Date.now() - this.progress.startTime.getTime()) / 1000) : 0;
    
    this.progress = {
      isScanning: false,
      phase: 'complete',
      totalFiles: this.progress.totalFiles,
      processedFiles: this.progress.processedFiles,
      message: `Scan complete! Processed ${this.progress.processedFiles} files in ${duration}s`
    };

    // Keep complete status for 5 seconds before resetting
    setTimeout(() => {
      this.reset();
    }, 5000);
  }

  reset() {
    this.progress = {
      isScanning: false,
      totalFiles: 0,
      processedFiles: 0,
      phase: 'idle'
    };
  }

  getProgress(): ScanProgress {
    return { ...this.progress };
  }
}

export const scanProgress = new ScanProgressTracker();