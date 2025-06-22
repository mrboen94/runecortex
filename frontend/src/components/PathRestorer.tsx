import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { gql } from '@apollo/client';

const CHANGE_WATCH_PATH = gql`
  mutation ChangeWatchPath($path: String!) {
    changeWatchPath(path: $path) {
      isActive
      watchPaths
    }
  }
`;

const GET_CURRENT_PATH = gql`
  query GetCurrentWatchPath {
    getCurrentWatchPath
  }
`;

export default function PathRestorer() {
  const hasRestoredRef = useRef(false);
  const { data: currentPathData } = useQuery(GET_CURRENT_PATH);
  const [changeWatchPath] = useMutation(CHANGE_WATCH_PATH, {
    refetchQueries: ['GetCurrentWatchPath', 'GetAllMedia'],
  });

  useEffect(() => {
    // Prevent double execution from StrictMode
    if (hasRestoredRef.current) return;
    
    // Try to restore the last used path from localStorage
    const lastPath = localStorage.getItem('lastWatchPath');
    const currentPath = currentPathData?.getCurrentWatchPath;
    
    // Only restore if we have a lastPath and it's different from current
    if (lastPath && lastPath !== currentPath) {
      console.log('Restoring last watch path:', lastPath);
      hasRestoredRef.current = true;
      
      // Attempt to change to the last used path
      changeWatchPath({
        variables: { path: lastPath }
      }).catch((error) => {
        console.error('Failed to restore last path:', error);
        // If it fails, the backend will use its default
      });
    }
  }, [currentPathData, changeWatchPath]); // Include dependencies

  return null; // This component doesn't render anything
}