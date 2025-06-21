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
  const [showAllFolders, setShowAllFolders] = useState(false);
  const { data, refetch } = useQuery(GET_CURRENT_WATCH_PATH);
  
  const currentPath = data?.getCurrentWatchPath || '';
  
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