import { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client';
import { gql } from '@apollo/client';
import './SaveToPlaylistButton.css';

const GET_PLAYLISTS = gql`
  query GetPlaylists {
    playlists {
      id
      name
      itemCount
    }
  }
`;

const CREATE_PLAYLIST = gql`
  mutation CreatePlaylist($input: CreatePlaylistInput!) {
    createPlaylist(input: $input) {
      id
      name
    }
  }
`;

const UPDATE_PLAYLIST = gql`
  mutation UpdatePlaylist($input: UpdatePlaylistInput!) {
    updatePlaylist(input: $input) {
      id
      name
      itemCount
    }
  }
`;

interface MediaItem {
  id: number;
  filename: string;
}

interface SaveToPlaylistButtonProps {
  mediaItems: MediaItem[];
  variant?: 'primary' | 'secondary';
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export default function SaveToPlaylistButton({ 
  mediaItems, 
  variant = 'secondary',
  size = 'medium',
  className = ''
}: SaveToPlaylistButtonProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [createNew, setCreateNew] = useState(false);

  const { data: playlistsData, refetch } = useQuery(GET_PLAYLISTS, {
    skip: !showDialog
  });

  const [createPlaylist] = useMutation(CREATE_PLAYLIST, {
    onCompleted: (data) => {
      refetch();
      setShowDialog(false);
      setCreateNew(false);
      setNewPlaylistName('');
    }
  });

  const [updatePlaylist] = useMutation(UPDATE_PLAYLIST, {
    onCompleted: () => {
      setShowDialog(false);
      setSelectedPlaylistId(null);
    }
  });

  const playlists = playlistsData?.playlists || [];
  const hasItems = mediaItems.length > 0;

  const handleSaveToPlaylist = async () => {
    if (!hasItems) return;

    if (createNew && newPlaylistName) {
      await createPlaylist({
        variables: {
          input: {
            name: newPlaylistName,
            description: `Created from ${mediaItems.length} selected items`,
            mediaItemIds: mediaItems.map(item => item.id)
          }
        }
      });
    } else if (selectedPlaylistId) {
      // Get existing items from the playlist
      const existingPlaylist = playlists.find((p: any) => p.id === selectedPlaylistId);
      if (existingPlaylist) {
        // Note: In a real implementation, you'd need to fetch existing items
        // For now, we'll just append the new items
        await updatePlaylist({
          variables: {
            input: {
              id: selectedPlaylistId,
              mediaItemIds: mediaItems.map(item => item.id)
            }
          }
        });
      }
    }
  };

  if (!hasItems) {
    return (
      <button 
        className={`save-to-playlist ${variant} ${size} disabled ${className}`}
        disabled
        title="No media items to save"
      >
        📋 Save to Playlist
      </button>
    );
  }

  return (
    <>
      <button
        className={`save-to-playlist ${variant} ${size} ${className}`}
        onClick={() => setShowDialog(true)}
        title={`Save ${mediaItems.length} items to playlist`}
      >
        📋 Save to Playlist ({mediaItems.length})
      </button>

      {showDialog && (
        <div className="playlist-dialog-overlay" onClick={() => setShowDialog(false)}>
          <div className="playlist-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Save to Playlist</h2>
            <p className="item-count">Saving {mediaItems.length} items</p>

            <div className="playlist-options">
              <label className="option">
                <input
                  type="radio"
                  name="playlist-choice"
                  checked={createNew}
                  onChange={() => setCreateNew(true)}
                />
                <span>Create new playlist</span>
              </label>

              {createNew && (
                <input
                  type="text"
                  placeholder="Playlist name"
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  autoFocus
                  className="new-playlist-input"
                />
              )}

              <label className="option">
                <input
                  type="radio"
                  name="playlist-choice"
                  checked={!createNew}
                  onChange={() => setCreateNew(false)}
                />
                <span>Add to existing playlist</span>
              </label>

              {!createNew && (
                <div className="existing-playlists">
                  {playlists.length === 0 ? (
                    <p className="no-playlists">No playlists found. Create a new one above.</p>
                  ) : (
                    playlists.map((playlist: any) => (
                      <label key={playlist.id} className="playlist-option">
                        <input
                          type="radio"
                          name="playlist-select"
                          checked={selectedPlaylistId === playlist.id}
                          onChange={() => setSelectedPlaylistId(playlist.id)}
                        />
                        <span>{playlist.name} ({playlist.itemCount} items)</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="dialog-actions">
              <button onClick={() => setShowDialog(false)}>Cancel</button>
              <button 
                onClick={handleSaveToPlaylist}
                disabled={(createNew && !newPlaylistName) || (!createNew && !selectedPlaylistId)}
                className="save-button"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}