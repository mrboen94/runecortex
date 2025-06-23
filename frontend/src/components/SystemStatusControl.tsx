import React, { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { gql } from '@apollo/client';
import './SystemStatusControl.css';

const WATCHER_STATUS_QUERY = gql`
  query GetWatcherStatus {
    watcherStatus {
      isActive
      watchPaths
      watcherEnabled
    }
    thumbnailQueueStatus {
      status
      queueSize
      stats {
        totalQueued
        processed
        failed
        skipped
      }
    }
  }
`;

const TOGGLE_WATCHER = gql`
  mutation ToggleWatcher($enabled: Boolean!) {
    toggleWatcher(enabled: $enabled) {
      isActive
      watcherEnabled
    }
  }
`;

const GET_INDEXED_FOLDERS = gql`
  query GetIndexedFolders {
    indexedFolders {
      id
      path
      enabled
      lastScanned
      totalFiles
      totalFolders
    }
  }
`;

const GET_SUBFOLDERS = gql`
  query GetSubfolders($parentPath: String!) {
    getSubfolders(parentPath: $parentPath) {
      path
      name
      fileCount
      hasSubfolders
      lastModified
    }
  }
`;


const TRIGGER_SCAN = gql`
  mutation TriggerScan($path: String!, $forceDeepScan: Boolean) {
    triggerScan(path: $path, forceDeepScan: $forceDeepScan) {
      processed
      newFiles
      updated
      errors {
        path
        error
      }
    }
  }
`;

export default function SystemStatusControl() {
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  
  const { data, loading, error } = useQuery(WATCHER_STATUS_QUERY, {
    pollInterval: 5000,
    // Always fetch from network to ensure we show current state
    fetchPolicy: 'network-only',
  });

  const [toggleWatcher, { loading: toggling }] = useMutation(TOGGLE_WATCHER, {
    refetchQueries: [{ query: WATCHER_STATUS_QUERY }],
  });

  const { data: foldersData, loading: foldersLoading, refetch: refetchFolders } = useQuery(GET_INDEXED_FOLDERS, {
    skip: !showFolderModal,
    fetchPolicy: 'cache-and-network', // Show cached data immediately, fetch fresh data in background
  });

  const [triggerScan, { loading: scanning }] = useMutation(TRIGGER_SCAN, {
    onCompleted: () => {
      setShowFolderModal(false);
      setSelectedFolders([]);
    },
  });

  // Show the button even if there's an error or loading
  const watcherStatus = data?.watcherStatus;
  const thumbnailStatus = data?.thumbnailQueueStatus;
  const isEnabled = watcherStatus?.watcherEnabled ?? false;
  const isActive = watcherStatus?.isActive ?? false;

  const handleToggle = async () => {
    try {
      await toggleWatcher({ variables: { enabled: !isEnabled } });
    } catch (err) {
      console.error('Failed to toggle watcher:', err);
    }
  };

  const handleButtonClick = () => {
    setShowFolderModal(true);
  };

  const handleFolderToggle = (folderPath: string, isSelected: boolean) => {
    setSelectedFolders(prev => {
      const newSelection = new Set(prev);
      
      if (!isSelected) {
        // Selecting this folder
        newSelection.add(folderPath);
        // Remove any child folders as they're now implicitly selected
        const childFolders = Array.from(newSelection).filter(path => 
          path.startsWith(folderPath + '/') && path !== folderPath
        );
        childFolders.forEach(child => newSelection.delete(child));
        
        // Remove parent folders if all their children would be selected
        const parentPath = folderPath.substring(0, folderPath.lastIndexOf('/'));
        if (parentPath && newSelection.has(parentPath)) {
          newSelection.delete(parentPath);
        }
      } else {
        // Deselecting this folder
        newSelection.delete(folderPath);
        // Also remove any parent folders that were selected
        let currentPath = folderPath;
        while (currentPath.includes('/')) {
          currentPath = currentPath.substring(0, currentPath.lastIndexOf('/'));
          if (newSelection.has(currentPath)) {
            newSelection.delete(currentPath);
          }
        }
      }
      
      return Array.from(newSelection);
    });
  };

  const handleExpandFolder = (folderPath: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
      }
      return newSet;
    });
  };

  const handleScanSelected = async () => {
    if (selectedFolders.length > 0) {
      try {
        // Scan each selected folder
        for (const folderPath of selectedFolders) {
          await triggerScan({ variables: { path: folderPath, forceDeepScan: true } });
        }
      } catch (err) {
        console.error('Failed to scan folders:', err);
      }
    }
  };

  // Component to render a single folder with its subfolders
  const FolderTreeItem = ({ folderPath, level = 0, isRootFolder = false, parentHasSubfolders = false }: { folderPath: string; level?: number; isRootFolder?: boolean; parentHasSubfolders?: boolean }) => {
    const { data: subfoldersData, loading: subfoldersLoading } = useQuery(GET_SUBFOLDERS, {
      variables: { parentPath: folderPath },
      skip: !isRootFolder && !expandedFolders.has(folderPath), // Load if root folder OR expanded
      fetchPolicy: 'cache-and-network', // Show cached data immediately, fetch fresh data in background
    });

    // Check if this folder is selected directly or via parent
    const isDirectlySelected = selectedFolders.includes(folderPath);
    const isSelectedViaParent = selectedFolders.some(selected => 
      folderPath.startsWith(selected + '/') && folderPath !== selected
    );
    const isSelected = isDirectlySelected || isSelectedViaParent;
    
    const isExpanded = expandedFolders.has(folderPath);
    const folderName = folderPath.split('/').pop() || folderPath;
    const subfolders = subfoldersData?.getSubfolders || [];
    
    // Check if this folder has subfolders
    // For non-root folders that haven't been expanded yet, use the parent's hasSubfolders info
    const hasSubfolders = (subfoldersData ? 
      (subfolders.length > 0) : 
      (isRootFolder || parentHasSubfolders)) || subfoldersLoading;

    // For root folders, expand initially but allow closing
    React.useEffect(() => {
      if (isRootFolder && expandedFolders.size === 0) {
        setExpandedFolders(prev => new Set([...prev, folderPath]));
      }
    }, []);

    return (
      <div className="folder-tree-item">
        <div className={`folder-item level-${level}`}>
          <label>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => handleFolderToggle(folderPath, isSelected)}
              disabled={isSelectedViaParent}
            />
            {(hasSubfolders || subfoldersLoading) && (
              <button
                type="button"
                onClick={() => handleExpandFolder(folderPath)}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  cursor: 'pointer',
                  marginRight: '0.25rem',
                  fontSize: '0.8rem'
                }}
              >
                {subfoldersLoading && isExpanded ? '⏳' : (isExpanded ? '▼' : '▶')}
              </button>
            )}
            <span className="folder-path" style={{ 
              opacity: isSelectedViaParent ? 0.7 : 1,
              fontStyle: isSelectedViaParent ? 'italic' : 'normal'
            }}>
              {'  '.repeat(level)}{isRootFolder ? '📁 ' : (hasSubfolders ? '📂 ' : '└─ ')}{folderName}
              {isSelectedViaParent && <span style={{ fontSize: '0.8rem', color: '#666' }}> (via parent)</span>}
            </span>
          </label>
        </div>
        {isExpanded && (
          <div className="folder-children">
            {subfolders.length > 0 ? (
              subfolders.map((subfolder: any) => (
                <FolderTreeItem 
                  key={subfolder.path} 
                  folderPath={subfolder.path} 
                  level={level + 1}
                  isRootFolder={false}
                  parentHasSubfolders={subfolder.hasSubfolders}
                />
              ))
            ) : (
              !subfoldersLoading && (
                <div style={{ padding: '0.5rem', color: '#666', fontSize: '0.9rem' }}>No subfolders</div>
              )
            )}
            {subfoldersLoading && subfolders.length === 0 && (
              <div style={{ padding: '0.5rem', color: '#666' }}>Loading subfolders...</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const getStatusClass = () => {
    if (error) return 'status-error';
    if (loading) return 'status-loading';
    
    // If thumbnails are being processed, show busy status
    if (thumbnailStatus?.status === 'busy') return 'status-busy';
    
    if (!isEnabled) return 'status-disabled';
    return isActive ? 'status-active' : 'status-inactive';
  };

  const getStatusText = () => {
    if (error) return 'Error';
    if (loading) return 'Loading...';
    
    let watcherText = '';
    if (!isEnabled) {
      watcherText = 'Disabled';
    } else {
      watcherText = isActive ? 'Watching' : 'Inactive';
    }
    
    // Add thumbnail status if available
    if (thumbnailStatus) {
      if (thumbnailStatus.status === 'busy') {
        return `${watcherText} • Thumbnails: ${thumbnailStatus.stats.processed}/${thumbnailStatus.stats.totalQueued}`;
      } else if (thumbnailStatus.queueSize > 0) {
        return `${watcherText} • Queue: ${thumbnailStatus.queueSize}`;
      }
    }
    
    return watcherText;
  };


  return (
    <div className="system-status-control">
      <button
        className={`status-button ${getStatusClass()}`}
        onClick={handleButtonClick}
        disabled={toggling}
        title="Click to manage folders and scans"
      >
        <span className={`status-dot ${getStatusClass()}`}></span>
        <span className="status-label">
          {toggling ? 'Updating...' : getStatusText()}
        </span>
      </button>
      
      {watcherStatus?.watchPaths && watcherStatus.watchPaths.length > 0 && (
        <div className="watch-paths-tooltip">
          <span className="tooltip-label">Watching:</span>
          {watcherStatus.watchPaths.map((path: string, index: number) => (
            <span key={index} className="watch-path">
              {path.split('/').pop() || path}
            </span>
          ))}
        </div>
      )}
      
      {thumbnailStatus?.stats.failed > 0 && (
        <>
          <div 
            className="status-item status-error clickable"
            onClick={() => setShowErrorDetails(!showErrorDetails)}
            title="Click to view error details"
          >
            <span className="status-label">Failed</span>
            <span className="status-value">{thumbnailStatus.stats.failed}</span>
            <span className="status-arrow">{showErrorDetails ? '▲' : '▼'}</span>
          </div>
          
          {showErrorDetails && (
            <div className="error-details-overlay" onClick={() => setShowErrorDetails(false)}>
              <div className="error-details-content" onClick={(e) => e.stopPropagation()}>
                <h3>⚠️ Thumbnail Generation Errors</h3>
                <p>{thumbnailStatus.stats.failed} files failed to generate thumbnails</p>
                <p className="error-hint">Common causes:</p>
                <ul>
                  <li>Corrupted or unsupported file formats</li>
                  <li>Missing or moved files</li>
                  <li>Insufficient permissions</li>
                  <li>FFmpeg processing errors</li>
                </ul>
                <p className="error-action">Try "Fix Thumbnails" in Settings to reprocess failed items</p>
                <button 
                  className="close-button"
                  onClick={() => setShowErrorDetails(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}
      
      {showFolderModal && (
        <div className="folder-modal-overlay" onClick={() => setShowFolderModal(false)}>
          <div className="folder-modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Folder Management & Scanning</h3>
              <button 
                onClick={() => {
                  // Clear expanded folders to force refresh
                  setExpandedFolders(new Set());
                  // Force refetch if available
                  if (refetchFolders) refetchFolders();
                }}
                style={{
                  background: 'none',
                  border: '1px solid #666',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  cursor: 'pointer',
                  fontSize: '0.9rem'
                }}
                title="Refresh folder list"
              >
                🔄 Refresh
              </button>
            </div>
            <div className="watcher-controls">
              <div className="watcher-status">
                <label className="watcher-toggle">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={handleToggle}
                    disabled={toggling}
                  />
                  <span>File Watcher {isEnabled ? 'Enabled' : 'Disabled'}</span>
                </label>
                <span className={`watcher-indicator ${getStatusClass()}`}>
                  {getStatusText()}
                </span>
              </div>
            </div>
            <p className="modal-hint">Select folders to rescan. Parent folders include all subfolders.</p>
            
            <div className="folder-list">
              {foldersData?.indexedFolders && foldersData.indexedFolders.length > 0 ? (
                <div className="folder-hierarchy">
                  {foldersData.indexedFolders.map((folder: any) => (
                    <FolderTreeItem 
                      key={folder.path} 
                      folderPath={folder.path} 
                      level={0} 
                      isRootFolder={true}
                    />
                  ))}
                </div>
              ) : (
                !foldersLoading && (
                  <div className="no-folders">No indexed folders found</div>
                )
              )}
              {foldersLoading && (!foldersData?.indexedFolders || foldersData.indexedFolders.length === 0) && (
                <div className="loading-message">Loading folders...</div>
              )}
            </div>
            
            <div className="modal-actions">
              <button 
                className="action-button cancel"
                onClick={() => {
                  setShowFolderModal(false);
                  setSelectedFolders([]);
                }}
              >
                Cancel
              </button>
              <button 
                className="action-button rescan"
                onClick={handleScanSelected}
                disabled={selectedFolders.length === 0 || scanning}
              >
                {scanning ? 'Scanning...' : `Rescan ${selectedFolders.length} folder${selectedFolders.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}