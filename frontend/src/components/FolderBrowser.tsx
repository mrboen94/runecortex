import { useState, useEffect } from 'react';
import { useMutation, useQuery, useLazyQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import { useFolderContext } from '../contexts/FolderContext';
import ScanProgress from './ScanProgress';
import './FolderBrowser.css';

const GET_CURRENT_PATH = gql`
  query GetCurrentWatchPath {
    getCurrentWatchPath
  }
`;

const GET_PATH_HISTORY = gql`
  query GetWatchPathHistory {
    getWatchPathHistory
  }
`;

const VALIDATE_PATH = gql`
  query ValidatePath($path: String!) {
    validatePath(path: $path) {
      isValid
      exists
      isDirectory
      hasMediaFiles
      mediaFileCount
      error
    }
  }
`;

const CHANGE_WATCH_PATH = gql`
  mutation ChangeWatchPath($path: String!) {
    changeWatchPath(path: $path) {
      isActive
      watchPaths
    }
  }
`;

interface FolderBrowserProps {
  onPathChange?: (path: string) => void;
}

export default function FolderBrowser({ onPathChange }: FolderBrowserProps) {
  const [showBrowser, setShowBrowser] = useState(false);
  const [selectedPath, setSelectedPath] = useState('');
  const [isChanging, setIsChanging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [showScanProgress, setShowScanProgress] = useState(false);
  
  const { refreshCurrentPath } = useFolderContext();
  const { data: currentPathData } = useQuery(GET_CURRENT_PATH);
  const { data: historyData, refetch: refetchHistory } = useQuery(GET_PATH_HISTORY);
  const [validatePath] = useLazyQuery(VALIDATE_PATH);
  const [changeWatchPath] = useMutation(CHANGE_WATCH_PATH, {
    refetchQueries: ['GetAllMedia', 'GetSystemStatus', 'GetWatchPathHistory', 'GetCurrentWatchPath'],
  });

  useEffect(() => {
    if (currentPathData?.getCurrentWatchPath) {
      setSelectedPath(currentPathData.getCurrentWatchPath);
    }
  }, [currentPathData]);

  const handleBrowse = () => {
    setShowBrowser(true);
    setValidationError(null);
    refetchHistory();
  };

  const handleOSDialog = async () => {
    // Check if we're running in Electron or have file dialog API access
    if ('showDirectoryPicker' in window) {
      try {
        // @ts-ignore - showDirectoryPicker is not in TypeScript types yet
        const dirHandle = await window.showDirectoryPicker();
        const path = await dirHandle.name;
        // Note: This won't give us the full path in browser for security reasons
        // In a real app, you'd need Electron or a backend file browser API
        alert('Web File API selected: ' + path + '\nNote: Full path access requires desktop app integration.');
      } catch (err) {
        console.log('User cancelled or error:', err);
      }
    } else {
      alert('OS file browser requires desktop app integration (Electron) or browser with File System Access API support.');
    }
  };

  const validateAndSetPath = async (path: string) => {
    setIsValidating(true);
    setValidationError(null);
    
    try {
      const { data } = await validatePath({ variables: { path } });
      const validation = data?.validatePath;
      
      if (!validation) {
        setValidationError('Failed to validate path');
        return false;
      }
      
      if (!validation.isValid) {
        setValidationError(validation.error || 'Invalid path');
        return false;
      }
      
      if (!validation.hasMediaFiles) {
        setValidationError(`No media files found in this directory (checked ${validation.mediaFileCount} files)`);
        return false;
      }
      
      return true;
    } catch (error) {
      setValidationError('Failed to validate path: ' + error);
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handlePathSubmit = async () => {
    if (!selectedPath || selectedPath === currentPathData?.getCurrentWatchPath) {
      setShowBrowser(false);
      return;
    }

    const isValid = await validateAndSetPath(selectedPath);
    if (!isValid) {
      return;
    }

    setIsChanging(true);
    try {
      await changeWatchPath({
        variables: { path: selectedPath }
      });
      
      // Refresh the current path in the context
      refreshCurrentPath();
      
      if (onPathChange) {
        onPathChange(selectedPath);
      }
      
      // Show scan progress
      setShowScanProgress(true);
      setShowBrowser(false);
      setValidationError(null);
    } catch (error: any) {
      setValidationError('Failed to change watch path: ' + error.message);
    } finally {
      setIsChanging(false);
    }
  };

  const handleHistorySelect = (path: string) => {
    setSelectedPath(path);
    setValidationError(null);
  };

  const handlePathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedPath(e.target.value);
    setValidationError(null);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isChanging && !isValidating) {
      handlePathSubmit();
    }
  };

  return (
    <div className="folder-browser">
      <button 
        className="browse-button"
        onClick={handleBrowse}
        title="Change media folder"
      >
        📁 Browse
      </button>

      {showBrowser && (
        <div className="browser-modal-overlay" onClick={() => setShowBrowser(false)}>
          <div className="browser-modal" onClick={e => e.stopPropagation()}>
            <h3>Change Media Folder</h3>
            <p className="current-path">
              <strong>Current:</strong> {currentPathData?.getCurrentWatchPath || 'Loading...'}
            </p>
            
            <div className="path-input-section">
              <div className="path-input-group">
                <input
                  type="text"
                  value={selectedPath}
                  onChange={handlePathChange}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter folder path"
                  className={`path-input ${validationError ? 'error' : ''}`}
                  disabled={isChanging || isValidating}
                />
                <button 
                  onClick={handleOSDialog}
                  className="os-browse-button"
                  title="Open OS file browser"
                  disabled={isChanging || isValidating}
                >
                  📂
                </button>
              </div>
              
              {validationError && (
                <div className="validation-error">
                  ⚠️ {validationError}
                </div>
              )}
            </div>
            
            <div className="browser-actions">
              <button 
                onClick={() => setShowBrowser(false)}
                className="cancel-button"
                disabled={isChanging}
              >
                Cancel
              </button>
              <button 
                onClick={handlePathSubmit}
                className="submit-button"
                disabled={!selectedPath || isChanging || isValidating}
              >
                {isChanging ? 'Changing...' : isValidating ? 'Validating...' : 'Confirm'}
              </button>
            </div>

            {historyData?.getWatchPathHistory && historyData.getWatchPathHistory.length > 1 && (
              <div className="path-history-section">
                <h4>Recent Folders</h4>
                <div className="path-history-list">
                  {historyData.getWatchPathHistory.slice(1).map((path: string, index: number) => (
                    <button
                      key={index}
                      className="history-item"
                      onClick={() => handleHistorySelect(path)}
                      title={path}
                    >
                      📁 {path.split('/').pop() || path.split('\\').pop() || path}
                      <span className="history-path">{path}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <p className="browser-note">
              Thumbnails from previous folders are preserved for quick access when switching back.
            </p>
          </div>
        </div>
      )}
      
      {showScanProgress && (
        <div className="scan-progress-container">
          <ScanProgress 
            onComplete={() => {
              setShowScanProgress(false);
              refreshCurrentPath();
            }}
          />
        </div>
      )}
    </div>
  );
}