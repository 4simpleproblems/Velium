const MUSIC_API_BASE = 'https://bhindi1.ddns.net/music/api';

let youtubeInstance = null;
let isInitializing = false;

async function getYoutube() {
  if (youtubeInstance) return youtubeInstance;
  if (isInitializing) {
      while (isInitializing) await new Promise(r => setTimeout(r, 100));
      if (youtubeInstance) return youtubeInstance;
  }

  isInitializing = true;
  try {
      const { Innertube } = await import('youtubei.js');
      youtubeInstance = await Innertube.create({
          cache: null,
          generate_session_locally: true
      });
      isInitializing = false;
      return youtubeInstance;
  } catch (e) {
      isInitializing = false;
      console.error(e);
      throw new Error(`Innertube failed: ${e.message}`);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = pathname.split('/').filter(Boolean);
  const endpointFromPath = pathParts[pathParts.length - 1];
  const { q, query, offset, limit, id, endpoint: endpointFromQuery } = req.query;
  const endpoint = (endpointFromQuery || endpointFromPath);

  try {
    if (endpoint === 'suggestions') {
      const searchQuery = q || query;
      if (!searchQuery) return res.status(400).json({ error: 'Missing query' });
      
      try {
          const yt = await getYoutube();
          const suggestions = await yt.music.getSearchSuggestions(searchQuery);
          
          return res.status(200).json({ 
              suggestions: (suggestions || []).map(s => ({
                  name: s.toString(),
                  type: 'Search'
              }))
          });
      } catch (e) {
          return res.status(200).json({ suggestions: [] });
      }
    }

    if (endpoint === 'search') {
      const searchQuery = q || query;
      if (!searchQuery) return res.status(400).json({ error: 'Missing query' });
      
      const [musicApiRes, ytMusicRes, argonRes] = await Promise.all([
        fetch(`${MUSIC_API_BASE}/prepare/${encodeURIComponent(searchQuery)}`)
            .then(r => r.ok ? r.json() : null)
            .then(async data => {
                if (data && data.ID) {
                    const songData = await fetch(`${MUSIC_API_BASE}/fetch/${data.ID}`).then(r => r.ok ? r.json() : null);
                    return songData;
                }
                return null;
            })
            .catch(() => null),
        getYoutube().then(async yt => {
            try {
                const search = await yt.music.search(searchQuery);
                return search;
            } catch (e) {
                return { songs: [], albums: [], artists: [], playlists: [] };
            }
        }).catch(() => ({ songs: [], albums: [], artists: [], playlists: [] })),
        fetch(`https://argon.global.ssl.fastly.net/api/search?query=${encodeURIComponent(searchQuery)}&offset=${offset || 0}&limit=${limit || 25}`)
            .then(r => r.ok ? r.json() : { collection: [] })
            .catch(() => ({ collection: [] }))
      ]);

      let tracks = [];
      
      if (musicApiRes && musicApiRes.SONG_NAME) {
          tracks.push({
              id: `mapi-${musicApiRes.ID}`,
              title: musicApiRes.SONG_NAME,
              artist_name: 'MusicAPI Result',
              artwork_url: musicApiRes.THUMBNAIL,
              duration: musicApiRes.DURATION * 1000,
              downloadUrl: [{ quality: '320kbps', link: musicApiRes.AUDIO_URL }],
              source: 'MusicAPI'
          });
      }

      if (ytMusicRes.songs) {
          const ytTracks = ytMusicRes.songs.map(item => {
              if (!item) return null;
              
              const title = item.title?.toString() || item.name?.toString() || 'Unknown Title';
              const artist = item.artists?.[0]?.name?.toString() || item.author?.name?.toString() || 'YT Music Artist';
              const artistId = item.artists?.[0]?.id || item.author?.id;
              const thumbnail = item.thumbnails?.[0]?.url || item.thumbnail?.url;
              const duration = (item.duration?.seconds || 0) * 1000;
              const rawId = item.id || item.video_id;
              const trackId = rawId ? `ytm-${rawId}` : `ytm-gen-${Math.random().toString(36).substr(2, 9)}`;

              return {
                  id: trackId,
                  title: title,
                  artist_name: artist,
                  artist_id: artistId ? `ytm-${artistId}` : null,
                  artwork_url: thumbnail,
                  duration: duration,
                  youtube_id: rawId,
                  source: 'YTMusic'
              };
          }).filter(Boolean);
          tracks.push(...ytTracks);
      }

      if (argonRes.collection && Array.isArray(argonRes.collection)) {
          const ARGON_BASE = 'https://argon.global.ssl.fastly.net';
          const argonTracks = argonRes.collection.map(item => {
              let artwork = item.song?.img?.big || item.song?.img?.small || (Array.isArray(item.image) ? item.image[item.image.length-1].link : item.image);
              if (artwork && artwork.startsWith('/api/')) artwork = ARGON_BASE + artwork;
              
              return {
                  id: `argon-${item.id}`,
                  title: item.song?.name || item.name,
                  artist_name: item.author?.name || 'Argon Artist',
                  artist_id: item.author?.id ? `argon-${item.author.id}` : null,
                  artwork_url: artwork,
                  duration: (item.song?.duration || 0) * 1000,
                  url: item.song?.url || item.url,
                  source: 'Argon'
              };
          });
          tracks.push(...argonTracks);
      }

      const albums = (ytMusicRes.albums || []).map(item => ({
          id: item.id ? `ytm-${item.id}` : null,
          name: item.title?.toString(),
          artist_name: item.author?.name || item.artists?.[0]?.name?.toString() || 'YT Music Artist',
          artwork_url: item.thumbnails?.[0]?.url
      })).filter(a => a.id);

      const artists = (ytMusicRes.artists || []).map(item => ({
          id: item.id ? `ytm-${item.id}` : null,
          name: item.name?.toString(),
          artwork_url: item.thumbnails?.[0]?.url
      })).filter(a => a.id);

      const playlists = (ytMusicRes.playlists || []).map(item => ({
          id: item.id ? `ytm-${item.id}` : null,
          name: item.title?.toString(),
          artwork_url: item.thumbnails?.[0]?.url,
          song_count: item.song_count || 0
      })).filter(p => p.id);

      return res.status(200).json({
        tracks,
        albums,
        artists,
        playlists
      });
    }

    if (endpoint === 'artist-search' || endpoint === 'album-search') {
        return res.status(404).json({ error: 'Search category disabled' });
    }

    if (endpoint === 'album' || pathname.includes('/album/')) {
        const albumId = id || pathParts[pathParts.length - 1];
        try {
            const yt = await getYoutube();
            const album = await yt.music.getAlbum(albumId.replace('ytm-', ''));
            const tracks = (album.contents || []).map(item => {
                const title = item.title?.toString() || 'Unknown Title';
                const artist = item.artists?.[0]?.name?.toString() || album.header?.artist?.name?.toString() || 'YT Music Artist';
                const artistId = item.artists?.[0]?.id;
                const thumbnail = item.thumbnails?.[0]?.url || album.header?.thumbnails?.[0]?.url;
                const duration = (item.duration?.seconds || 0) * 1000;
                const rawId = item.id || item.video_id;
                return {
                    id: rawId ? `ytm-${rawId}` : `ytm-gen-${Math.random().toString(36).substr(2, 9)}`,
                    title: title,
                    artist_name: artist,
                    artist_id: artistId ? `ytm-${artistId}` : null,
                    artwork_url: thumbnail,
                    duration: duration,
                    youtube_id: rawId,
                    source: 'YTMusic'
                };
            }).filter(Boolean);

            return res.status(200).json({
                id: `ytm-${albumId}`,
                name: album.header?.title?.toString() || 'YT Music Album',
                description: album.header?.description?.toString() || '',
                artwork_url: album.header?.thumbnails?.[0]?.url || '',
                song_count: tracks.length,
                tracks: tracks
            });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to load album details', message: e.message });
        }
    }

    if (endpoint === 'artist' || pathname.includes('/artist/')) {
        const artistId = id || pathParts[pathParts.length - 1];
        try {
            const yt = await getYoutube();
            const artist = await yt.music.getArtist(artistId.replace('ytm-', ''));
            
            const tracks = (artist.songs?.contents || []).map(item => {
                const title = item.title?.toString() || 'Unknown Title';
                const thumbnail = item.thumbnails?.[0]?.url;
                const duration = (item.duration?.seconds || 0) * 1000;
                const rawId = item.id || item.video_id;
                return {
                    id: rawId ? `ytm-${rawId}` : `ytm-gen-${Math.random().toString(36).substr(2, 9)}`,
                    title: title,
                    artist_name: artist.name?.toString() || 'YT Music Artist',
                    artist_id: `ytm-${artistId}`,
                    artwork_url: thumbnail,
                    duration: duration,
                    youtube_id: rawId,
                    source: 'YTMusic'
                };
            }).filter(Boolean);

            return res.status(200).json({
                id: `ytm-${artistId}`,
                name: artist.name?.toString() || 'YT Music Artist',
                description: artist.description?.toString() || '',
                artwork_url: artist.thumbnails?.[0]?.url || '',
                tracks: tracks
            });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to load artist details', message: e.message });
        }
    }

    if (endpoint === 'playlist' || pathname.includes('/playlist/')) {
        const playlistId = id || pathParts[pathParts.length - 1];
        try {
            const yt = await getYoutube();
            const playlist = await yt.music.getPlaylist(playlistId.replace('ytm-', ''));
            const tracks = (playlist.contents || []).map(item => {
                const title = item.title?.toString() || 'Unknown Title';
                const artist = item.artists?.[0]?.name?.toString() || 'YT Music Artist';
                const artistId = item.artists?.[0]?.id;
                const thumbnail = item.thumbnails?.[0]?.url;
                const duration = (item.duration?.seconds || 0) * 1000;
                const rawId = item.id || item.video_id;
                return {
                    id: rawId ? `ytm-${rawId}` : `ytm-gen-${Math.random().toString(36).substr(2, 9)}`,
                    title: title,
                    artist_name: artist,
                    artist_id: artistId ? `ytm-${artistId}` : null,
                    artwork_url: thumbnail,
                    duration: duration,
                    youtube_id: rawId,
                    source: 'YTMusic'
                };
            }).filter(Boolean);

            return res.status(200).json({
                id: `ytm-${playlistId}`,
                name: playlist.header?.title?.toString() || 'YT Music Playlist',
                description: playlist.header?.description?.toString() || '',
                artwork_url: playlist.header?.thumbnails?.[0]?.url || (tracks.length > 0 ? tracks[0].artwork_url : ''),
                song_count: tracks.length,
                tracks: tracks
            });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to load playlist details', message: e.message });
        }
    }

    if (endpoint === 'lyrics' || pathname.includes('/lyrics/')) {
        const songId = id || pathParts[pathParts.length - 1];
        
        if (songId.startsWith('mapi-')) {
            const mapiId = songId.replace('mapi-', '');
            const songData = await fetch(`${MUSIC_API_BASE}/fetch/${mapiId}`).then(r => r.ok ? r.json() : null);
            if (songData && songData.LYRICS) {
                return res.status(200).json({ lyrics: songData.LYRICS, source: 'MusicAPI' });
            }
        }

        try {
            const yt = await getYoutube();
            const lyrics = await yt.music.getLyrics(songId.replace('ytm-', ''));
            if (lyrics && lyrics.description) {
                return res.status(200).json({ lyrics: lyrics.description.toString(), source: 'YTMusic' });
            }
        } catch (e) {
            console.error(e);
        }

        return res.status(404).json({ error: 'Lyrics not found' });
    }

    if (endpoint === 'youtube-search') {
        const searchQuery = q || query;
        if (!searchQuery) return res.status(400).json({ error: 'Missing query' });
        
        try {
            const yt = await getYoutube();
            const searchResults = await yt.search(searchQuery, { type: 'video' });
            
            const results = (searchResults.results || searchResults.videos || []).map(item => ({
                videoId: item.id,
                id: item.id,
                title: item.title?.toString(),
                author: item.author?.name,
                thumbnails: item.thumbnails
            }));

            const firstVideoId = results.length > 0 ? results[0].videoId : null;

            return res.status(200).json({ 
                videoId: firstVideoId,
                results: results 
            });
        } catch (e) {
            return res.status(500).json({ error: 'YouTube search failed', message: e.message });
        }
    }

    return res.status(404).json({ error: 'Endpoint not found' });

  } catch (error) {
    return res.status(500).json({ 
        error: 'Critical API Failure', 
        message: error.message
    });
  }
}
