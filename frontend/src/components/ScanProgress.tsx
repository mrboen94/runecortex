import { useEffect, useState } from 'react';
import { useQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import './ScanProgress.css';

const GET_SCAN_PROGRESS = gql`
  query GetScanProgress {
    watcherStatus {
      scanProgress {
        isScanning
        currentPath
        totalFiles
        processedFiles
        phase
        message
      }
    }
  }
`;

interface ScanProgressProps {
  onComplete?: () => void;
}

export default function ScanProgress({ onComplete }: ScanProgressProps) {
  const [lastPhase, setLastPhase] = useState<string>('idle');
  
  const { data, loading } = useQuery(GET_SCAN_PROGRESS, {
    pollInterval: 500, // Poll every 500ms while scanning
    fetchPolicy: 'network-only',
  });

  const progress = data?.watcherStatus?.scanProgress;

  useEffect(() => {
    if (progress?.phase === 'complete' && lastPhase !== 'complete') {
      // Scan just completed
      if (onComplete) {
        onComplete();
      }
    }
    setLastPhase(progress?.phase || 'idle');
  }, [progress?.phase, lastPhase, onComplete]);

  if (loading || !progress || !progress.isScanning) {
    return null;
  }

  const percentage = progress.totalFiles > 0 
    ? Math.round((progress.processedFiles / progress.totalFiles) * 100)
    : 0;

  const getPhaseEmoji = (phase: string) => {
    switch (phase) {
      case 'discovering': return '🔍';
      case 'processing': return '⚙️';
      case 'generating_thumbnails': return '🖼️';
      case 'complete': return '✅';
      default: return '📁';
    }
  };

  return (
    <div className="scan-progress">
      <div className="scan-header">
        <span className="scan-emoji">{getPhaseEmoji(progress.phase)}</span>
        <span className="scan-message">{progress.message || 'Scanning...'}</span>
      </div>
      
      {progress.phase === 'processing' && progress.totalFiles > 0 && (
        <>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="progress-text">
            {progress.processedFiles} / {progress.totalFiles} files ({percentage}%)
          </div>
        </>
      )}

      {progress.currentPath && (
        <div className="current-path">
          📂 {progress.currentPath.split('/').pop() || progress.currentPath}
        </div>
      )}
    </div>
  );
}