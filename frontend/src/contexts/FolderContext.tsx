import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQuery } from '@apollo/client';
import { gql } from '@apollo/client';

const GET_CURRENT_WATCH_PATH = gql`
  query GetCurrentWatchPath {
    getCurrentWatchPath
  }
`;

interface FolderContextType {
  currentPath: string;
  showAllFolders: boolean;
  setShowAllFolders: (show: boolean) => void;
  refreshCurrentPath: () => void;
}

const FolderContext = createContext<FolderContextType | undefined>(undefined);

export function FolderProvider({ children }: { children: ReactNode }) {
  const [showAllFolders, setShowAllFolders] = useState(() => {
    // Load from localStorage
    const saved = localStorage.getItem('showAllFolders');
    return saved ? JSON.parse(saved) : false;
  });
  
  const { data, refetch } = useQuery(GET_CURRENT_WATCH_PATH);
  
  const currentPath = data?.getCurrentWatchPath || '';
  
  // Save showAllFolders to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('showAllFolders', JSON.stringify(showAllFolders));
  }, [showAllFolders]);
  
  // Save current path to localStorage when it changes
  useEffect(() => {
    if (currentPath) {
      localStorage.setItem('lastWatchPath', currentPath);
      // Also add to path history
      import('../services/pathHistory').then(({ pathHistoryService }) => {
        pathHistoryService.addPath(currentPath);
      });
    }
  }, [currentPath]);
  
  const refreshCurrentPath = () => {
    refetch();
  };
  
  return (
    <FolderContext.Provider value={{
      currentPath,
      showAllFolders,
      setShowAllFolders,
      refreshCurrentPath
    }}>
      {children}
    </FolderContext.Provider>
  );
}

export function useFolderContext() {
  const context = useContext(FolderContext);
  if (!context) {
    throw new Error('useFolderContext must be used within a FolderProvider');
  }
  return context;
}