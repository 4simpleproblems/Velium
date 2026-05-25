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

function optimizeThumbnailUrl(url) {
  if (!url) return url;
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
      return url.split('=')[0] + '=w544-h544-l90-rj';
  }
  if (url.includes('i.ytimg.com')) {
      if (url.includes('/vi/')) {
          const videoId = url.split('/vi/')[1].split('/')[0];
          return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
      }
  }
  return url;
}

async function fetchJioSaavn(searchQuery, limitVal) {
  const bases = [
    'https://saavn.me',
    'https://jiosaavn-api-liart.vercel.app',
    'https://jiosaavn-api-2-0.vercel.app',
    'https://nepotuneapi.vercel.app'
  ];
  const urls = [];
  const reqLimit = limitVal ? parseInt(limitVal) : 40;
  const countParam = reqLimit > 0 ? reqLimit : 40;

  bases.forEach(base => {
    urls.push(`${base}/api/search/songs?query=${encodeURIComponent(searchQuery)}&limit=${countParam}`);
    urls.push(`${base}/search/songs?query=${encodeURIComponent(searchQuery)}&limit=${countParam}`);
  });
  const fetchWithTimeout = async (url) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2500);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (!response.ok) throw new Error('Failed');
      const data = await response.json();
      if (data && (data.data || Array.isArray(data))) {
        return data;
      }
      throw new Error('Invalid');
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };
  try {
    return await Promise.any(urls.map(url => fetchWithTimeout(url)));
  } catch (e) {
    return null;
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
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
    if (endpoint === 'proxy-image') {
      const imageUrl = req.query.url;
      if (!imageUrl) return res.status(400).json({ error: 'Missing url' });
      try {
        const imageRes = await fetch(imageUrl);
        if (!imageRes.ok) throw new Error(`Failed to fetch: ${imageRes.statusText}`);
        const contentType = imageRes.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const arrayBuffer = await imageRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return res.status(200).send(buffer);
      } catch (e) {
        return res.status(500).json({ error: 'Proxy failed', message: e.message });
      }
    }

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
      
      const [musicApiRes, ytMusicRes, argonRes, saavnRes] = await Promise.all([
        fetchWithTimeout(`${MUSIC_API_BASE}/prepare/${encodeURIComponent(searchQuery)}`)
            .then(r => r.ok ? r.json() : null)
            .then(async data => {
                if (data && data.ID) {
                    const songData = await fetchWithTimeout(`${MUSIC_API_BASE}/fetch/${data.ID}`).then(r => r.ok ? r.json() : null);
                    return songData;
                }
                return null;
            })
            .catch(() => null),
        getYoutube().then(async yt => {
            try {
                const searchPromise = yt.music.search(searchQuery);
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000));
                return await Promise.race([searchPromise, timeoutPromise]);
            } catch (e) {
                return null;
            }
        }).catch(() => null),
        fetchWithTimeout(`https://argon.global.ssl.fastly.net/api/search?query=${encodeURIComponent(searchQuery)}&offset=${offset || 0}&limit=${limit || 25}`)
            .then(r => r.ok ? r.json() : { collection: [] })
            .catch(() => ({ collection: [] })),
        fetchJioSaavn(searchQuery, limit).catch(() => null)
      ]);

      let tracks = [];
      let ytSongs = [];
      let ytAlbums = [];
      let ytArtists = [];
      let ytPlaylists = [];

      if (ytMusicRes && ytMusicRes.contents) {
          const shelves = ytMusicRes.contents || [];
          shelves.forEach(shelf => {
              const shelfTitle = shelf.title?.toString().toLowerCase() || shelf.header?.title?.toString().toLowerCase() || '';
              const items = shelf.contents || [];
              
              if (shelf.type === 'MusicCardShelf') {
                  const subtitle = shelf.subtitle?.toString().toLowerCase() || '';
                  const title = shelf.title?.toString() || '';
                  if (subtitle.includes('song')) {
                      ytSongs.push({
                          id: shelf.id ? `ytm-${shelf.id}` : null,
                          title: title,
                          artist_name: shelf.header?.title?.toString() || 'Unknown Artist',
                          artwork_url: shelf.thumbnail?.contents?.[0]?.url,
                          duration: 0,
                          youtube_id: shelf.id,
                          source: 'YTMusic'
                      });
                  } else if (subtitle.includes('artist')) {
                      ytArtists.push({
                          id: shelf.id ? `ytm-${shelf.id}` : (shelf.endpoint?.payload?.browseId ? `ytm-${shelf.endpoint.payload.browseId}` : null),
                          name: title,
                          artwork_url: shelf.thumbnail?.contents?.[0]?.url
                      });
                  }
              }

              items.forEach(item => {
                  const itemType = item.item_type?.toLowerCase() || '';
                  let targetGroup = null;
                  if (itemType.includes('song') || shelfTitle.includes('song')) targetGroup = ytSongs;
                  else if (itemType.includes('album') || shelfTitle.includes('album')) targetGroup = ytAlbums;
                  else if (itemType.includes('artist') || shelfTitle.includes('artist')) targetGroup = ytArtists;
                  else if (itemType.includes('playlist') || shelfTitle.includes('playlist')) targetGroup = ytPlaylists;
                  else if (item.duration) targetGroup = ytSongs;
                  else if (item.song_count) targetGroup = ytPlaylists;
                  
                  if (targetGroup) {
                      targetGroup.push(item);
                  }
              });
          });
      }

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

      if (saavnRes) {
          let songs = [];
          if (saavnRes.data) {
              songs = saavnRes.data.results || saavnRes.data || [];
          } else if (Array.isArray(saavnRes)) {
              songs = saavnRes;
          } else if (saavnRes.results) {
              songs = saavnRes.results;
          }
          if (Array.isArray(songs)) {
              const saavnTracks = songs.map(song => {
                  if (!song) return null;
                  const title = song.name || song.title || 'Unknown Title';
                  let artist = 'Unknown Artist';
                  if (typeof song.primaryArtists === 'string' && song.primaryArtists.trim()) {
                      artist = song.primaryArtists;
                  } else if (Array.isArray(song.primaryArtists)) {
                      artist = song.primaryArtists.map(a => typeof a === 'string' ? a : a.name).join(', ') || 'Unknown Artist';
                  } else if (song.artists) {
                      if (Array.isArray(song.artists)) {
                          artist = song.artists.map(a => a.name).join(', ') || 'Unknown Artist';
                      } else if (song.artists.primary && Array.isArray(song.artists.primary)) {
                          artist = song.artists.primary.map(a => a.name).join(', ') || 'Unknown Artist';
                      } else if (song.artists.all && Array.isArray(song.artists.all)) {
                          artist = song.artists.all.map(a => a.name).join(', ') || 'Unknown Artist';
                      } else if (song.artists[0] && song.artists[0].name) {
                          artist = song.artists[0].name;
                      }
                  } else if (song.artist) {
                      artist = song.artist;
                  }

                  let artistId = null;
                  if (song.primaryArtistsId) {
                      artistId = song.primaryArtistsId;
                  } else if (song.artists) {
                      if (Array.isArray(song.artists) && song.artists[0]) {
                          artistId = song.artists[0].id;
                      } else if (song.artists.primary && Array.isArray(song.artists.primary) && song.artists.primary[0]) {
                          artistId = song.artists.primary[0].id;
                      }
                  }
                  let artwork = '';
                  if (Array.isArray(song.image)) {
                      artwork = song.image[song.image.length - 1]?.link || song.image[song.image.length - 1]?.url || song.image[0]?.link || '';
                  } else if (typeof song.image === 'string') {
                      artwork = song.image;
                  }
                  const duration = parseInt(song.duration || 0) * 1000;
                  let downloadUrl = song.downloadUrl;
                  if (typeof downloadUrl === 'string') {
                      downloadUrl = [{ quality: '320kbps', link: downloadUrl }];
                  } else if (Array.isArray(downloadUrl)) {
                      downloadUrl = downloadUrl.map(d => ({
                          quality: d.quality || '320kbps',
                          link: d.link || d.url || ''
                      }));
                  }
                  return {
                      id: `saavn-${song.id}`,
                      title: title,
                      artist_name: artist,
                      artist_id: artistId ? `saavn-${artistId}` : null,
                      artwork_url: optimizeThumbnailUrl(artwork),
                      duration: duration,
                      downloadUrl: downloadUrl,
                      source: 'Saavn'
                  };
              }).filter(Boolean);
              tracks.push(...saavnTracks);
          }
      }

      if (ytSongs.length > 0) {
          const ytTracks = ytSongs.map(item => {
              if (!item) return null;
              const title = item.title?.toString() || item.name?.toString() || 'Unknown Title';
              const artist = item.artists?.[0]?.name?.toString() || item.author?.name?.toString() || 'Unknown Artist';
              const artistId = item.artists?.[0]?.id || item.author?.id;
              const thumbnail = optimizeThumbnailUrl(item.thumbnails?.[0]?.url || item.thumbnail?.url || item.artwork_url);
              const duration = (item.duration?.seconds || 0) * 1000;
              const rawId = item.id || item.video_id || item.youtube_id;
              const trackId = rawId ? `ytm-${rawId}` : `ytm-gen-${Math.random().toString(36).substr(2, 9)}`;

              if (artist === 'YT Music Artist') return null;

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
              const songUrl = item.song?.url || item.url || '';
              const encodedId = Buffer.from(songUrl).toString('base64url');
              const durationSecs = (item.song?.duration?.hours || 0) * 3600 + (item.song?.duration?.minutes || 0) * 60 + (item.song?.duration?.seconds || 0);

              const artist = item.author?.name || 'Argon Artist';
              if (artist === 'YT Music Artist') return null;

              return {
                  id: `argon-${encodedId}`,
                  title: item.song?.name || item.name,
                  artist_name: artist,
                  artist_id: item.author?.id ? `argon-${item.author.id}` : null,
                  artwork_url: optimizeThumbnailUrl(artwork),
                  duration: durationSecs * 1000,
                  url: songUrl,
                  source: 'Argon'
              };
          }).filter(Boolean);
          tracks.push(...argonTracks);
      }

      const albums = ytAlbums.map(item => {
          const artist = item.author?.name || item.artists?.[0]?.name?.toString() || 'Unknown Artist';
          if (artist === 'YT Music Artist') return null;
          return {
              id: item.id ? `ytm-${item.id}` : null,
              name: item.title?.toString() || item.name?.toString(),
              artist_name: artist,
              artwork_url: optimizeThumbnailUrl(item.thumbnails?.[0]?.url || item.thumbnail?.url)
          };
      }).filter(a => a && a.id);

      const artists = ytArtists.map(item => ({
          id: item.id ? `ytm-${item.id}` : null,
          name: item.name?.toString() || item.title?.toString(),
          artwork_url: optimizeThumbnailUrl(item.thumbnails?.[0]?.url || item.thumbnail?.url || item.artwork_url)
      })).filter(a => a.id);

      const playlists = ytPlaylists.map(item => ({
          id: item.id ? `ytm-${item.id}` : null,
          name: item.title?.toString() || item.name?.toString(),
          artwork_url: optimizeThumbnailUrl(item.thumbnails?.[0]?.url || item.thumbnail?.url),
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
                const artist = item.artists?.[0]?.name?.toString() || album.header?.artist?.name?.toString() || 'Unknown Artist';
                const artistId = item.artists?.[0]?.id;
                const thumbnail = optimizeThumbnailUrl(item.thumbnails?.[0]?.url || album.header?.thumbnails?.[0]?.url);
                const duration = (item.duration?.seconds || 0) * 1000;
                const rawId = item.id || item.video_id;

                if (artist === 'YT Music Artist') return null;

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
                name: album.header?.title?.toString() || 'Unknown Album',
                description: album.header?.description?.toString() || '',
                artwork_url: optimizeThumbnailUrl(album.header?.thumbnails?.[0]?.url || ''),
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
                const thumbnail = optimizeThumbnailUrl(item.thumbnails?.[0]?.url);
                const duration = (item.duration?.seconds || 0) * 1000;
                const rawId = item.id || item.video_id;
                
                const artistName = artist.name?.toString() || 'Unknown Artist';
                if (artistName === 'YT Music Artist') return null;

                return {
                    id: rawId ? `ytm-${rawId}` : `ytm-gen-${Math.random().toString(36).substr(2, 9)}`,
                    title: title,
                    artist_name: artistName,
                    artist_id: `ytm-${artistId}`,
                    artwork_url: thumbnail,
                    duration: duration,
                    youtube_id: rawId,
                    source: 'YTMusic'
                };
            }).filter(Boolean);

            return res.status(200).json({
                id: `ytm-${artistId}`,
                name: (artist.name?.toString() || 'Unknown Artist') === 'YT Music Artist' ? 'Unknown Artist' : (artist.name?.toString() || 'Unknown Artist'),
                description: artist.description?.toString() || '',
                artwork_url: optimizeThumbnailUrl(artist.thumbnails?.[0]?.url || ''),
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
                const artist = item.artists?.[0]?.name?.toString() || 'Unknown Artist';
                const artistId = item.artists?.[0]?.id;
                const thumbnail = optimizeThumbnailUrl(item.thumbnails?.[0]?.url);
                const duration = (item.duration?.seconds || 0) * 1000;
                const rawId = item.id || item.video_id;

                if (artist === 'YT Music Artist') return null;

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
                name: playlist.header?.title?.toString() || 'Unknown Playlist',
                description: playlist.header?.description?.toString() || '',
                artwork_url: optimizeThumbnailUrl(playlist.header?.thumbnails?.[0]?.url || (tracks.length > 0 ? tracks[0].artwork_url : '')),
                song_count: tracks.length,
                tracks: tracks
            });
        } catch (e) {
            return res.status(500).json({ error: 'Failed to load playlist details', message: e.message });
        }
    }

    if (endpoint === 'lyrics' || pathname.includes('/lyrics/')) {
        const songId = id || pathParts[pathParts.length - 1];
        const { title, artist, duration } = req.query;
        
        if (songId.startsWith('mapi-')) {
            const mapiId = songId.replace('mapi-', '');
            const songData = await fetch(`${MUSIC_API_BASE}/fetch/${mapiId}`).then(r => r.ok ? r.json() : null);
            if (songData && songData.LYRICS) {
                return res.status(200).json({ lyrics: songData.LYRICS, source: 'MusicAPI' });
            }
        }

        if (title && artist) {
            try {
                let lrclibUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
                if (duration && parseInt(duration) > 0) {
                    lrclibUrl += `&duration=${Math.round(parseInt(duration))}`;
                }
                const lrclibRes = await fetch(lrclibUrl);
                if (lrclibRes.ok) {
                    const lrclibData = await lrclibRes.json();
                    const lyrics = lrclibData.syncedLyrics || lrclibData.plainLyrics;
                    if (lyrics) {
                        return res.status(200).json({ lyrics, source: 'LrcLib' });
                    }
                }

                const lrclibSearchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(title + ' ' + artist)}`);
                if (lrclibSearchRes.ok) {
                    const searchResults = await lrclibSearchRes.json();
                    if (searchResults && searchResults.length > 0) {
                        const lyrics = searchResults[0].syncedLyrics || searchResults[0].plainLyrics;
                        if (lyrics) {
                            return res.status(200).json({ lyrics, source: 'LrcLib-Search' });
                        }
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }

        if (songId && !songId.includes('f-') && !songId.startsWith('mapi-') && !songId.startsWith('saavn-') && !songId.startsWith('argon-')) {
            try {
                const yt = await getYoutube();
                const lyrics = await yt.music.getLyrics(songId.replace('ytm-', ''));
                
                if (lyrics) {
                    if (lyrics.content && Array.isArray(lyrics.content.lines)) {
                        const lrcLines = lyrics.content.lines.map(line => {
                            const start = line.start_time_ms || 0;
                            const min = Math.floor(start / 60000);
                            const sec = ((start % 60000) / 1000).toFixed(2);
                            return `[${min.toString().padStart(2, '0')}:${sec.padStart(5, '0')}]${line.text}`;
                        });
                        return res.status(200).json({ lyrics: lrcLines.join('\n'), source: 'YTMusic-Timed' });
                    }

                    if (lyrics.description) {
                        return res.status(200).json({ lyrics: lyrics.description.toString(), source: 'YTMusic' });
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }

        return res.status(200).json({ lyrics: null, error: 'Lyrics not found' });
    }

    if (endpoint === 'youtube-search') {
        const searchQuery = q || query;
        if (!searchQuery) return res.status(400).json({ error: 'Missing query' });
        
        try {
            const yt = await getYoutube();
            const search = await yt.music.search(searchQuery);
            
            const songs = search.songs?.contents || [];
            const videos = search.videos?.contents || [];
            
            const results = [...songs, ...videos].map(item => ({
                videoId: item.id || item.videoId || item.video_id,
                id: item.id || item.videoId || item.video_id,
                title: item.title?.toString(),
                author: item.artists?.[0]?.name?.toString() || item.author?.name?.toString()
            })).filter(r => r.videoId);

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
