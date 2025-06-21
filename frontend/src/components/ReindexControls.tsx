import { useState } from 'react';
import { useMutation, useApolloClient } from '@apollo/client';
import { REINDEX_THUMBNAILS, CLEAR_ALL_THUMBNAILS } from '../graphql/queries';
import './ReindexControls.css';

interface ReindexResult {
  success: boolean;
  message: string;
  thumbnailsProcessed: number;
  errors: string[];
}

export default function ReindexControls() {
  const [isReindexing, setIsReindexing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [result, setResult] = useState<ReindexResult | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const apolloClient = useApolloClient();
  const [reindexThumbnails] = useMutation(REINDEX_THUMBNAILS);
  const [clearAllThumbnails] = useMutation(CLEAR_ALL_THUMBNAILS);

  const handleReindex = async () => {
    setIsReindexing(true);
    setResult(null);
    
    try {
      const { data } = await reindexThumbnails();
      setResult(data.reindexThumbnails);
      
      // Clear Apollo cache to refresh thumbnail URLs
      await apolloClient.refetchQueries({
        include: 'active',
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Network error: ${error}`,
        thumbnailsProcessed: 0,
        errors: [String(error)]
      });
    } finally {
      setIsReindexing(false);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    setResult(null);
    setShowClearConfirm(false);
    
    try {
      const { data } = await clearAllThumbnails();
      setResult(data.clearAllThumbnails);
      
      // Clear Apollo cache to refresh thumbnail URLs
      await apolloClient.refetchQueries({
        include: 'active',
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Network error: ${error}`,
        thumbnailsProcessed: 0,
        errors: [String(error)]
      });
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="reindex-controls">
      <div className="reindex-buttons">
        <button 
          onClick={handleReindex}
          disabled={isReindexing || isClearing}
          className="reindex-btn primary"
        >
          {isReindexing ? 'Reindexing...' : '🔄 Fix Thumbnails'}
        </button>
        
        {!showClearConfirm ? (
          <button 
            onClick={() => setShowClearConfirm(true)}
            disabled={isReindexing || isClearing}
            className="reindex-btn secondary"
          >
            🗑️ Clear All
          </button>
        ) : (
          <div className="clear-confirm">
            <span>Delete all thumbnails?</span>
            <button 
              onClick={handleClearAll}
              disabled={isClearing}
              className="reindex-btn danger"
            >
              {isClearing ? 'Clearing...' : 'Yes, Delete All'}
            </button>
            <button 
              onClick={() => setShowClearConfirm(false)}
              disabled={isClearing}
              className="reindex-btn secondary"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <button 
        onClick={() => window.location.reload()}
        className="reindex-btn secondary"
        title="Refresh page to reload thumbnails"
      >
        🔄 Refresh Page
      </button>

      {result && (
        <div className={`reindex-result ${result.success ? 'success' : 'error'}`}>
          <h4>{result.success ? '✅ Success' : '⚠️ Warning'}</h4>
          <p>{result.message}</p>
          
          {result.thumbnailsProcessed > 0 && (
            <p>Processed: {result.thumbnailsProcessed} thumbnails</p>
          )}
          
          {result.success && result.thumbnailsProcessed > 0 && (
            <p><strong>💡 Tip:</strong> If thumbnails don't update immediately, try refreshing the page to clear browser cache.</p>
          )}
          
          {result.errors.length > 0 && (
            <details className="error-details">
              <summary>Errors ({result.errors.length})</summary>
              <ul>
                {result.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </details>
          )}
          
          <button 
            onClick={() => setResult(null)}
            className="close-result"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}