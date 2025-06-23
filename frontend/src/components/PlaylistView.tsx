import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client';
import { gql } from '@apollo/client';
import './PlaylistView.css';

const GET_PLAYLISTS = gql`
  query GetPlaylists {
    playlists {
      id
      name
      description
      isActive
      itemCount
      createdAt
      updatedAt
    }
  }
`;

const GET_PLAYLIST_DETAILS = gql`
  query GetPlaylistDetails($id: Int!) {
    playlist(id: $id) {
      id
      name
      description
      isActive
      itemCount
      totalDuration
      items {
        id
        position
        mediaItem {
          id
          filename
          duration
          thumbnailUrl
          fileSize
          createdAt
        }
        addedAt
      }
    }
  }
`;

const CREATE_PLAYLIST = gql`
  mutation CreatePlaylist($input: CreatePlaylistInput!) {
    createPlaylist(input: $input) {
      id
      name
      description
    }
  }
`;

const UPDATE_PLAYLIST = gql`
  mutation UpdatePlaylist($input: UpdatePlaylistInput!) {
    updatePlaylist(input: $input) {
      id
      name
      description
    }
  }
`;

const DELETE_PLAYLIST = gql`
  mutation DeletePlaylist($id: Int!) {
    deletePlaylist(id: $id) {
      success
      message
    }
  }
`;

const ACTIVATE_PLAYLIST = gql`
  mutation ActivatePlaylist($id: Int!) {
    activatePlaylist(id: $id) {
      id
      name
      isActive
    }
  }
`;

const DEACTIVATE_PLAYLIST = gql`
  mutation DeactivatePlaylist {
    deactivatePlaylist {
      success
    }
  }
`;

const EXPORT_PLAYLIST = gql`
  mutation ExportPlaylist($id: Int!, $format: String) {
    exportPlaylist(id: $id, format: $format)
  }
`;

interface MediaItem {
  id: number;
  filename: string;
  duration?: number;
  thumbnailUrl?: string;
  fileSize: number;
  createdAt: string;
}

interface PlaylistItem {
  id: number;
  position: number;
  mediaItem: MediaItem;
  addedAt: string;
}

interface Playlist {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
  itemCount: number;
  totalDuration?: number;
  createdAt: string;
  updatedAt: string;
  items?: PlaylistItem[];
}

export default function PlaylistView() {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDescription, setNewPlaylistDescription] = useState('');

  const { data: playlistsData, loading: playlistsLoading, refetch: refetchPlaylists } = useQuery(GET_PLAYLISTS);
  
  const { data: playlistDetailsData, loading: detailsLoading, refetch: refetchDetails } = useQuery(GET_PLAYLIST_DETAILS, {
    variables: { id: selectedPlaylistId },
    skip: !selectedPlaylistId
  });

  const [createPlaylist] = useMutation(CREATE_PLAYLIST, {
    onCompleted: () => {
      refetchPlaylists();
      setShowCreateDialog(false);
      setNewPlaylistName('');
      setNewPlaylistDescription('');
    }
  });

  const [updatePlaylist] = useMutation(UPDATE_PLAYLIST, {
    onCompleted: () => {
      refetchPlaylists();
      if (selectedPlaylistId) refetchDetails();
      setEditingPlaylist(null);
    }
  });

  const [deletePlaylist] = useMutation(DELETE_PLAYLIST, {
    onCompleted: () => {
      refetchPlaylists();
      setSelectedPlaylistId(null);
    }
  });

  const [activatePlaylist] = useMutation(ACTIVATE_PLAYLIST, {
    onCompleted: () => {
      refetchPlaylists();
    }
  });

  const [deactivatePlaylist] = useMutation(DEACTIVATE_PLAYLIST, {
    onCompleted: () => {
      refetchPlaylists();
    }
  });

  const [exportPlaylist] = useMutation(EXPORT_PLAYLIST);

  const playlists = playlistsData?.playlists || [];
  const selectedPlaylist = playlistDetailsData?.playlist;

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    
    await createPlaylist({
      variables: {
        input: {
          name: newPlaylistName,
          description: newPlaylistDescription || undefined,
          mediaItemIds: [] // Empty playlist
        }
      }
    });
  };

  const handleUpdatePlaylist = async () => {
    if (!editingPlaylist) return;
    
    await updatePlaylist({
      variables: {
        input: {
          id: editingPlaylist.id,
          name: editingPlaylist.name,
          description: editingPlaylist.description
        }
      }
    });
  };

  const handleDeletePlaylist = async (id: number) => {
    if (confirm('Are you sure you want to delete this playlist?')) {
      await deletePlaylist({ variables: { id } });
    }
  };

  const handleToggleActive = async (playlist: Playlist) => {
    if (playlist.isActive) {
      await deactivatePlaylist();
    } else {
      await activatePlaylist({ variables: { id: playlist.id } });
    }
  };

  const handleExportPlaylist = async (id: number, format: string) => {
    const result = await exportPlaylist({
      variables: { id, format }
    });
    
    const content = result.data?.exportPlaylist;
    if (content) {
      const blob = new Blob([content], { 
        type: format === 'm3u' ? 'audio/x-mpegurl' : 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `playlist.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="playlist-view">
      <div className="playlist-sidebar">
        <div className="sidebar-header">
          <h2>Playlists</h2>
          <button className="create-button" onClick={() => setShowCreateDialog(true)}>
            + New Playlist
          </button>
        </div>
        
        <div className="playlist-list">
          {playlistsLoading ? (
            <div className="loading">Loading playlists...</div>
          ) : (
            playlists.map((playlist: Playlist) => (
              <div
                key={playlist.id}
                className={`playlist-item ${selectedPlaylistId === playlist.id ? 'selected' : ''} ${playlist.isActive ? 'active' : ''}`}
                onClick={() => setSelectedPlaylistId(playlist.id)}
              >
                <div className="playlist-info">
                  <h3>{playlist.name}</h3>
                  <p>{playlist.itemCount} items</p>
                </div>
                {playlist.isActive && (
                  <span className="active-badge">Streaming</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="playlist-content">
        {selectedPlaylist ? (
          <>
            <div className="content-header">
              <div className="playlist-title">
                <h1>{selectedPlaylist.name}</h1>
                {selectedPlaylist.description && (
                  <p className="description">{selectedPlaylist.description}</p>
                )}
              </div>
              <div className="playlist-actions">
                <button 
                  className={`toggle-active ${selectedPlaylist.isActive ? 'active' : ''}`}
                  onClick={() => handleToggleActive(selectedPlaylist)}
                >
                  {selectedPlaylist.isActive ? '⏸ Deactivate' : '▶ Activate'}
                </button>
                <button onClick={() => setEditingPlaylist(selectedPlaylist)}>
                  ✏️ Edit
                </button>
                <button onClick={() => handleExportPlaylist(selectedPlaylist.id, 'm3u')}>
                  📤 Export M3U
                </button>
                <button onClick={() => handleExportPlaylist(selectedPlaylist.id, 'json')}>
                  📤 Export JSON
                </button>
                <button 
                  className="delete-button"
                  onClick={() => handleDeletePlaylist(selectedPlaylist.id)}
                >
                  🗑️ Delete
                </button>
              </div>
            </div>

            <div className="playlist-stats">
              <div className="stat">
                <span className="label">Total Items:</span>
                <span className="value">{selectedPlaylist.itemCount}</span>
              </div>
              <div className="stat">
                <span className="label">Total Duration:</span>
                <span className="value">{formatDuration(selectedPlaylist.totalDuration)}</span>
              </div>
              <div className="stat">
                <span className="label">Created:</span>
                <span className="value">{new Date(selectedPlaylist.createdAt).toLocaleDateString()}</span>
              </div>
            </div>

            <div className="playlist-items">
              {detailsLoading ? (
                <div className="loading">Loading items...</div>
              ) : (
                selectedPlaylist.items?.map((item: PlaylistItem) => (
                  <div key={item.id} className="media-item">
                    <div className="item-number">{item.position + 1}</div>
                    {item.mediaItem.thumbnailUrl && (
                      <img 
                        src={item.mediaItem.thumbnailUrl} 
                        alt={item.mediaItem.filename}
                        className="thumbnail"
                      />
                    )}
                    <div className="item-info">
                      <h4>{item.mediaItem.filename}</h4>
                      <div className="item-meta">
                        <span>{formatDuration(item.mediaItem.duration)}</span>
                        <span>{formatFileSize(item.mediaItem.fileSize)}</span>
                        <span>{new Date(item.mediaItem.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <h2>Select a playlist to view details</h2>
            <p>Create a new playlist or select an existing one from the sidebar</p>
          </div>
        )}
      </div>

      {showCreateDialog && (
        <div className="dialog-overlay" onClick={() => setShowCreateDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Create New Playlist</h2>
            <input
              type="text"
              placeholder="Playlist name"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              autoFocus
            />
            <textarea
              placeholder="Description (optional)"
              value={newPlaylistDescription}
              onChange={(e) => setNewPlaylistDescription(e.target.value)}
            />
            <div className="dialog-actions">
              <button onClick={() => setShowCreateDialog(false)}>Cancel</button>
              <button onClick={handleCreatePlaylist} disabled={!newPlaylistName.trim()}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {editingPlaylist && (
        <div className="dialog-overlay" onClick={() => setEditingPlaylist(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Edit Playlist</h2>
            <input
              type="text"
              placeholder="Playlist name"
              value={editingPlaylist.name}
              onChange={(e) => setEditingPlaylist({ ...editingPlaylist, name: e.target.value })}
              autoFocus
            />
            <textarea
              placeholder="Description (optional)"
              value={editingPlaylist.description || ''}
              onChange={(e) => setEditingPlaylist({ ...editingPlaylist, description: e.target.value })}
            />
            <div className="dialog-actions">
              <button onClick={() => setEditingPlaylist(null)}>Cancel</button>
              <button onClick={handleUpdatePlaylist} disabled={!editingPlaylist.name.trim()}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}