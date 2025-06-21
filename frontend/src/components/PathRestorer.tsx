import { useEffect } from 'react';
import { useMutation } from '@apollo/client';
import { gql } from '@apollo/client';

const CHANGE_WATCH_PATH = gql`
  mutation ChangeWatchPath($path: String!) {
    changeWatchPath(path: $path) {
      isActive
      watchPaths
    }
  }
`;

export default function PathRestorer() {
  const [changeWatchPath] = useMutation(CHANGE_WATCH_PATH, {
    refetchQueries: ['GetCurrentWatchPath', 'GetAllMedia'],
  });

  useEffect(() => {
    // Try to restore the last used path from localStorage
    const lastPath = localStorage.getItem('lastWatchPath');
    
    if (lastPath) {
      console.log('Restoring last watch path:', lastPath);
      
      // Attempt to change to the last used path
      changeWatchPath({
        variables: { path: lastPath }
      }).catch((error) => {
        console.error('Failed to restore last path:', error);
        // If it fails, the backend will use its default
      });
    }
  }, []); // Only run once on mount

  return null; // This component doesn't render anything
}