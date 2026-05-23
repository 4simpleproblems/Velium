const API_BASE_URL = '/music-api';

function getDownloadUrl(item) {
    if (item.source === 'MusicAPI' && item.downloadUrl?.[0]?.link) {
        return getProxyUrl(item.downloadUrl[0].link);
    }
    
    let url = '';
    if (item.downloadUrl) { 
        if (Array.isArray(item.downloadUrl) && item.downloadUrl.length > 0) { 
            const b = item.downloadUrl.find(d => d.quality === '320kbps') || item.downloadUrl.find(d => d.quality === '160kbps') || item.downloadUrl[item.downloadUrl.length - 1]; 
            url = b.link || b.url;
        } else if (typeof item.downloadUrl === 'string') {
            url = item.downloadUrl;
        }
    }
    
    if (!url) { 
        const p = item.url || (item.song && item.song.url); 
        if (p) { 
            if (typeof p === 'string' && (p.includes('saavncdn.com') || p.match(/\.(mp3|mp4|m4a)$/i))) {
                url = p; 
            } else if (Array.isArray(p)) { 
                const b = p.find(d => d.quality === '320kbps') || p[p.length - 1]; 
                url = b.link || b.url;
            } else {
                url = `https://argon.global.ssl.fastly.net/api/download?track_url=${encodeURIComponent(p)}`; 
            }
        } 
    }
    
    if (!url && item.media_url) url = item.media_url;
    if (!url) return '';
    return getProxyUrl(url);
}

function getProxyUrl(url, size = null) {
    if (!url) return url;
    if (typeof url !== 'string') return url;
    if (url.startsWith('data:')) return url;

    if (url.includes('saavncdn.com')) {
        if (size) {
            url = url.replace(/_([0-9]+x[0-9]+|150|500)\.jpg/i, `_${size}.jpg`);
        } else {
            url = url.replace(/_([0-9]+x[0-9]+|150|500)\.jpg/i, `_250x250.jpg`);
        }
    }

    if (url.startsWith('//')) url = 'https:' + url;

    const prefix = (window.__uv$config && window.__uv$config.prefix) || "/uv/service/";
    const encode = (window.__uv$config && window.__uv$config.encodeUrl) || (window.Ultraviolet && window.Ultraviolet.codec && window.Ultraviolet.codec.xor && window.Ultraviolet.codec.xor.encode);

    if (encode) {
        const encoded = encode(url);
        if (encoded.startsWith(prefix)) return encoded;
        return prefix + encoded;
    }
    
    return url;
}

let isInitialized = false;
let currentTrack = null;
let playlist = [];
let originalPlaylist = [];
let shuffledIndices = [];
let shuffledCurrentIndex = 0;
let currentIndex = 0;
let isPlaying = false;
let isShuffle = false;
let repeatMode = 'off';
let favorites = [];
let playlists = [];
let player = null;
let progressInterval = null;
let volume = parseInt(localStorage.getItem('velium_volume')) || 70;
let preloadedNextTrack = null;
let preloadedPrevTrack = null;
let currentSearchResults = [];
let searchState = { query: '', tracksOffset: 0, loading: false, hasMoreTracks: true, limit: 24 };
let activeSearchTab = 'songs';
let currentDynamicPlaylist = [];
let artistSearchState = { name: '', offset: 0, loading: false, hasMore: true, limit: 50 };

const popularArtists = [
    'The Weeknd', 'Drake', 'Post Malone', 'Dua Lipa', 'Ed Sheeran', 
    'Ariana Grande', 'Travis Scott', 'Olivia Rodrigo', 'Bad Bunny', 'SZA'
];

const genres = [
    { name: 'Pop', gradient: 'from-pink-500 to-rose-600' },
    { name: 'Hip-Hop', gradient: 'from-amber-500 to-orange-600' },
    { name: 'Rock', gradient: 'from-red-600 to-purple-800' },
    { name: 'Lofi & Study', gradient: 'from-indigo-500 to-indigo-800' },
    { name: 'Electronic', gradient: 'from-cyan-500 to-blue-600' },
    { name: 'Chill', gradient: 'from-teal-400 to-emerald-600' },
    { name: 'Focus', gradient: 'from-violet-600 to-indigo-900' },
    { name: 'Workout', gradient: 'from-orange-600 to-red-600' },
    { name: 'Acoustic', gradient: 'from-yellow-600 to-amber-800' },
    { name: 'Gaming', gradient: 'from-purple-600 to-pink-600' }
];

const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        const img = entry.target;
        if (entry.isIntersecting) {
            if (img.dataset.src) {
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                observer.unobserve(img);
            }
        }
    });
}, {
    rootMargin: "300px 0px", 
    threshold: 0.01
});

function observeImages(container) {
    if (!container) return;
    const images = container.querySelectorAll('img[data-src]');
    images.forEach(img => imageObserver.observe(img));
}

function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function getTrackUid(track) {
    return track.id || `track-${track.title}-${track.artist_name}`;
}

async function loadLibraryData() {
    try {
        const lib = await window.VeliumDB.getLibrary();
        favorites = lib.likedSongs || [];
        playlists = lib.playlists || [];
    } catch (e) {
        console.error(e);
        playlists = JSON.parse(localStorage.getItem('velium_playlists')) || [];
    }
}

async function saveLibraryData() {
    try {
        await window.VeliumDB.saveLibrary({ likedSongs: favorites, playlists });
    } catch (e) {
        console.error(e);
        localStorage.setItem('velium_playlists', JSON.stringify(playlists));
    }
}

function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function saveTrackDuration(track, duration) {
    if (!track) return;
    const key = `dur_${getTrackUid(track)}`;
    localStorage.setItem(key, duration.toString());
}

function getSavedTrackDuration(track) {
    if (!track) return null;
    const val = localStorage.getItem(`dur_${getTrackUid(track)}`);
    return val ? parseFloat(val) : null;
}

function setGreeting() {
    const greeting = document.getElementById('greetingText');
    if (!greeting) return;
    const hr = new Date().getHours();
    if (hr < 12) greeting.textContent = 'Good morning';
    else if (hr < 18) greeting.textContent = 'Good afternoon';
    else greeting.textContent = 'Good evening';
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `px-5 py-3 rounded-xl text-xs font-bold text-white shadow-2xl flex items-center gap-2 transition-all duration-300 translate-y-4 opacity-0 border`;
    if (type === 'success') {
        toast.className += ' bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
        toast.innerHTML = `<i class="fas fa-circle-check"></i> ${message}`;
    } else {
        toast.className += ' bg-rose-500/10 border-rose-500/30 text-rose-400';
        toast.innerHTML = `<i class="fas fa-circle-xmark"></i> ${message}`;
    }
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.remove('translate-y-4', 'opacity-0');
    }, 50);
    setTimeout(() => {
        toast.classList.add('translate-y-4', 'opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(viewId);
    if (view) view.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.dataset.view === viewId) item.classList.add('active');
        else item.classList.remove('active');
    });

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.remove('open');
}

function setThemeAccent(name, color, glow) {
    document.documentElement.style.setProperty('--accent-color', color);
    document.documentElement.style.setProperty('--accent-glow', glow);
    document.documentElement.style.setProperty('--btn-bg', glow.replace('0.3', '0.1'));
    document.documentElement.style.setProperty('--btn-text', color);
    localStorage.setItem('velium_theme_accent', JSON.stringify({ name, color, glow }));
    showToast(`Applied ${name} theme`, 'success');
}

function loadAppliedTheme() {
    const saved = localStorage.getItem('velium_theme_accent');
    if (saved) {
        try {
            const { color, glow } = JSON.parse(saved);
            document.documentElement.style.setProperty('--accent-color', color);
            document.documentElement.style.setProperty('--accent-glow', glow);
            document.documentElement.style.setProperty('--btn-bg', glow.replace('0.3', '0.1'));
            document.documentElement.style.setProperty('--btn-text', color);
        } catch(e) {}
    }
}

function exportLibraryData() {
    const data = JSON.stringify({ likedSongs: favorites, playlists });
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'velium_library_backup.json';
    a.click();
    showToast('Library backup downloaded', 'success');
}

function importLibraryData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.likedSongs) favorites = data.likedSongs;
            if (data.playlists) playlists = data.playlists;
            await saveLibraryData();
            renderSidebarPlaylists();
            renderLibrary();
            showToast('Library restored successfully', 'success');
        } catch(err) {
            showToast('Invalid backup file', 'error');
        }
    };
    reader.readAsText(file);
}

function populateCategoriesGrid() {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;
    grid.innerHTML = '';
    genres.forEach(g => {
        const card = document.createElement('div');
        card.className = `bg-gradient-to-br ${g.gradient} aspect-[2/1] rounded-2xl p-5 flex items-end cursor-pointer relative overflow-hidden group border border-white/10 hover:scale-[1.02] transition-all duration-300`;
        card.innerHTML = `
            <span class="text-lg font-black tracking-tight text-white z-10">${g.name}</span>
            <div class="absolute right-[-10px] bottom-[-10px] text-white/10 text-7xl font-bold group-hover:scale-110 transition-transform duration-300">
                <i class="fas fa-music"></i>
            </div>
        `;
        card.addEventListener('click', () => {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = g.name;
                handleSearch(g.name, false);
            }
        });
        grid.appendChild(card);
    });
}

async function loadPopularTracks() {
    const grid = document.getElementById('popularTracks');
    if (!grid) return null;
    grid.innerHTML = '<div class="col-span-full py-20 flex justify-center"><i class="fas fa-circle-notch fa-spin text-3xl text-accent-indigo"></i></div>';
    try {
        const artist = popularArtists[Math.floor(Math.random() * popularArtists.length)];
        const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(artist)}&limit=12`);
        const data = await response.json();
        if (data.tracks) {
            grid.innerHTML = '';
            renderTrackGrid(data.tracks.slice(0, 12), grid);
            observeImages(grid);
            return data.tracks.slice(0, 12);
        }
    } catch (e) { 
        console.error(e); 
        grid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">Failed to load recommendations.</div>';
    }
    return null;
}

function switchSearchTab(tabName) {
    activeSearchTab = tabName;
    document.querySelectorAll('.search-tab-btn').forEach(btn => {
        if (btn.id === `tab-${tabName}`) {
            btn.className = 'search-tab-btn font-bold text-sm px-4 py-2 rounded-full bg-accent-indigo text-white';
        } else {
            btn.className = 'search-tab-btn font-bold text-sm px-4 py-2 rounded-full text-[var(--text-muted)] hover:text-white';
        }
    });

    document.querySelectorAll('.search-tab-content').forEach(content => {
        if (content.id === `${tabName}Tab`) content.classList.add('active');
        else content.classList.remove('active');
    });
}

async function handleSearch(query, append = false, forcedOffset = null) {
    const resultsDiv = document.getElementById('searchResults');
    const categoriesDiv = document.getElementById('browseCategories');
    const tracksGrid = document.getElementById('searchGrid');
    const playlistsGrid = document.getElementById('playlistsSearchGrid');
    const artistsGrid = document.getElementById('artistsSearchGrid');
    const loader = document.getElementById('searchLoader');
    const pagination = document.getElementById('searchPagination');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');

    if (!query || query.trim() === '') {
        if (resultsDiv) resultsDiv.classList.add('hidden');
        if (categoriesDiv) categoriesDiv.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        if (pagination) pagination.classList.add('hidden');
        searchState.query = '';
        return;
    }

    if (!append || query !== searchState.query) {
        const startAt = (forcedOffset !== null) ? forcedOffset : 0;
        searchState = { query: query, tracksOffset: startAt, loading: false, hasMoreTracks: true, limit: 24 };
        currentSearchResults = [];
        if (tracksGrid) tracksGrid.innerHTML = '';
        if (playlistsGrid) playlistsGrid.innerHTML = '';
        if (artistsGrid) artistsGrid.innerHTML = '';
        if (loader) loader.classList.add('hidden');
    }
    
    if (searchState.loading || !searchState.hasMoreTracks) return;
    searchState.loading = true;
    
    if (append && loader) loader.classList.remove('hidden');
    if (resultsDiv) resultsDiv.classList.remove('hidden');
    if (categoriesDiv) categoriesDiv.classList.add('hidden');

    if (!append && tracksGrid) {
        tracksGrid.innerHTML = '<div class="col-span-full py-20 flex justify-center"><i class="fas fa-circle-notch fa-spin text-3xl text-accent-indigo"></i></div>';
    }

    try {
        const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&offset=${searchState.tracksOffset}&limit=${searchState.limit}`);
        const data = await response.json();

        const newTracks = data.tracks || [];
        currentSearchResults.push(...newTracks);
        
        if (!append && tracksGrid) tracksGrid.innerHTML = '';
        if (tracksGrid && newTracks.length > 0) {
            renderTrackGrid(newTracks, tracksGrid);
            observeImages(tracksGrid);
        } else if (!append && tracksGrid) {
            tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">No tracks found.</div>';
        }

        if (playlistsGrid && data.playlists && data.playlists.length > 0) {
            playlistsGrid.innerHTML = '';
            renderPlaylistGrid(data.playlists, playlistsGrid);
        } else if (playlistsGrid && (!data.playlists || data.playlists.length === 0)) {
            playlistsGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">No playlists found.</div>';
        }

        if (artistsGrid && data.artists && data.artists.length > 0) {
            artistsGrid.innerHTML = '';
            data.artists.forEach(art => {
                const card = document.createElement('div');
                card.className = 'track-card p-5 text-center flex flex-col items-center gap-4';
                const artImg = art.artwork_url || '';
                card.innerHTML = `
                    <div class="w-32 h-32 rounded-full overflow-hidden border border-[var(--border-main)] shrink-0">
                        ${artImg ? `<img src="${getProxyUrl(artImg)}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-slate-800 flex items-center justify-center"><i class="fas fa-user text-3xl"></i></div>`}
                    </div>
                    <div class="font-bold truncate max-w-full text-white">${escapeHtml(art.name)}</div>
                `;
                card.addEventListener('click', () => loadArtistView(art.name));
                artistsGrid.appendChild(card);
            });
        } else if (artistsGrid && (!data.artists || data.artists.length === 0)) {
            artistsGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">No artists found.</div>';
        }
        
        searchState.tracksOffset += newTracks.length;
        searchState.hasMoreTracks = newTracks.length === searchState.limit && newTracks.length > 0;

        if (pagination) {
            if (newTracks.length > 0 || searchState.tracksOffset > 0) {
                pagination.classList.remove('hidden');
                const currentPage = Math.ceil(searchState.tracksOffset / searchState.limit) || 1;
                const pageIndicator = document.getElementById('pageIndicator');
                if (pageIndicator) pageIndicator.textContent = `Page ${currentPage}`;
                
                if (prevBtn) {
                    if (searchState.tracksOffset <= searchState.limit) prevBtn.style.visibility = 'hidden';
                    else prevBtn.style.visibility = 'visible';
                }
                if (nextBtn) {
                    if (!searchState.hasMoreTracks) nextBtn.style.visibility = 'hidden';
                    else nextBtn.style.visibility = 'visible';
                }
            } else {
                pagination.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error(e);
        if (tracksGrid) tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">Error searching tracks.</div>';
    } finally {
        searchState.loading = false;
        if (loader) loader.classList.add('hidden');
    }
}

function searchNextPage() {
    if (!searchState.loading && searchState.hasMoreTracks) {
        handleSearch(searchState.query, false, searchState.tracksOffset);
    }
}

function searchPrevPage() {
    if (!searchState.loading && searchState.tracksOffset > searchState.limit) {
        const targetOffset = searchState.tracksOffset - (searchState.limit * 2);
        handleSearch(searchState.query, false, Math.max(0, targetOffset));
    }
}

function renderTrackGrid(tracks, container) {
    if (!container) return;
    tracks.forEach((track, idx) => {
        const card = document.createElement('div');
        card.className = 'track-card relative aspect-square p-0 overflow-hidden group';
        card.innerHTML = `
            <img data-src="${track.local_artwork || getProxyUrl(track.artwork_url)}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">
            <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-end p-4">
                <div class="font-bold text-sm truncate text-white mb-0.5">${escapeHtml(track.title)}</div>
                <div class="text-[10px] text-gray-300 truncate font-medium hover:underline" onclick="event.stopPropagation(); loadArtistView('${escapeHtml(track.artist_name || '').replace(/'/g, "\\'")}')">${escapeHtml(track.artist_name)}</div>
            </div>
            <div class="absolute right-4 bottom-4 w-10 h-10 bg-accent-indigo text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 shadow-2xl transition-all duration-300 z-10">
                <i class="fas fa-play ml-1"></i>
            </div>
        `;
        card.addEventListener('click', () => {
            playlist = tracks;
            originalPlaylist = [...tracks];
            currentIndex = idx;
            preloadedNextTrack = null;
            preloadedPrevTrack = null;
            playTrack(currentIndex);
        });
        container.appendChild(card);
    });
}

function renderPlaylistGrid(playlistsData, container) {
    if (!container) return;
    playlistsData.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'track-card relative aspect-square p-0 overflow-hidden group';
        card.innerHTML = `
            <img src="${getProxyUrl(pl.artwork_url)}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy">
            <div class="absolute inset-x-0 bottom-0 h-1/3 bg-black/20 backdrop-blur-md border-t border-white/10 flex flex-col justify-center px-4 transition-transform duration-300 translate-y-2 group-hover:translate-y-0">
                <div class="font-bold text-sm truncate text-white mb-0.5">${escapeHtml(pl.name)}</div>
                <div class="text-[10px] text-gray-300 truncate uppercase tracking-wider font-medium">${pl.song_count} songs</div>
            </div>
        `;
        card.addEventListener('click', () => loadOfficialPlaylistDetails(pl.id));
        container.appendChild(card);
    });
}

async function loadOfficialPlaylistDetails(playlistId) {
    switchView('dynamic');
    const container = document.getElementById('dynamicView');
    container.innerHTML = '<div class="py-20 flex justify-center"><i class="fas fa-circle-notch fa-spin text-3xl text-accent-indigo"></i></div>';
    try {
        const response = await fetch(`${API_BASE_URL}/playlist/${playlistId}`);
        const data = await response.json();
        container.innerHTML = `
            <div class="flex flex-col md:flex-row items-end gap-8 mb-10">
                <img src="${getProxyUrl(data.artwork_url)}" class="w-56 h-56 rounded-3xl shadow-2xl border border-brand-border">
                <div class="flex-1">
                    <span class="text-xs font-bold uppercase tracking-widest text-gray-400">Playlist</span>
                    <h1 class="text-6xl font-black tracking-tighter mb-4">${escapeHtml(data.name)}</h1>
                    <p class="text-gray-500 mb-4">${data.description || 'Official Playlist'}</p>
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-white">${data.song_count} songs</span>
                    </div>
                </div>
            </div>
            <div class="flex items-center gap-6 mb-8 border-b border-brand-border pb-8">
                <button class="w-16 h-16 bg-accent-indigo rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform" onclick="playAllFromDynamic()">
                    <i class="fas fa-play text-white text-xl"></i>
                </button>
            </div>
            <div id="dynamicList" class="space-y-2"></div>
        `;
        const list = document.getElementById('dynamicList');
        data.tracks.forEach((track, index) => list.appendChild(createTrackRow(track, index, data.tracks, true)));
        currentDynamicPlaylist = data.tracks;
    } catch (e) { 
        console.error(e); 
        container.innerHTML = '<div class="py-20 text-center text-gray-500">Failed to load playlist details.</div>';
    }
}

async function loadArtistView(artistName, append = false) {
    if (!artistName) return;
    
    if (!append) {
        switchView('dynamic');
        artistSearchState = { name: artistName, offset: 0, loading: false, hasMore: true, limit: 50 };
        const container = document.getElementById('dynamicView');
        container.innerHTML = `
            <div class="relative overflow-hidden rounded-3xl mb-10 min-h-[400px] flex items-end p-8 lg:p-12">
                <div id="artistBackground" class="absolute inset-0 z-0 bg-card-dark opacity-40 transition-all duration-1000 scale-110 blur-3xl"></div>
                <div class="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent z-[1]"></div>
                <div class="relative z-10 flex flex-col md:flex-row items-center md:items-end gap-8 w-full animate-pulse">
                    <div class="w-48 h-48 lg:w-64 lg:h-64 bg-card-dark rounded-full flex items-center justify-center shadow-2xl relative overflow-hidden border border-white/10 shrink-0">
                        <i class="fas fa-user text-gray-700 text-7xl"></i>
                    </div>
                    <div class="flex-1 text-center md:text-left">
                        <span class="text-xs font-bold uppercase tracking-[0.2em] text-accent-indigo mb-3 block">Artist</span>
                        <h1 class="text-5xl lg:text-8xl font-black tracking-tighter mb-4 text-white">${escapeHtml(artistName)}</h1>
                    </div>
                </div>
            </div>
            <div id="dynamicList" class="space-y-1"></div>
            <div id="artistLoader" class="py-10 text-center hidden">
                <i class="fas fa-circle-notch fa-spin text-2xl text-accent-indigo"></i>
            </div>
        `;
    }

    if (artistSearchState.loading || !artistSearchState.hasMore) return;
    artistSearchState.loading = true;
    
    const loader = document.getElementById('artistLoader');
    if (loader) loader.classList.remove('hidden');

    try {
        const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(artistName)}&limit=${artistSearchState.limit}&offset=${artistSearchState.offset}`);
        const data = await response.json();
        
        const rawTracks = data.tracks || [];
        let artistTracks = rawTracks.filter(t => 
            (t.artist_name || '').toLowerCase() === artistName.toLowerCase()
        );

        if (!append && artistTracks.length === 0 && rawTracks.length > 0) {
            artistTracks = rawTracks.slice(0, 20);
        }

        if (rawTracks.length < artistSearchState.limit) {
            artistSearchState.hasMore = false;
        }

        const artwork = artistTracks.length > 0 ? (artistTracks[0].local_artwork || getProxyUrl(artistTracks[0].artwork_url)) : null;

        if (!append) {
            const container = document.getElementById('dynamicView');
            container.innerHTML = `
                <div class="relative overflow-hidden rounded-3xl mb-10 min-h-[400px] flex items-end p-8 lg:p-12">
                    <div id="artistBackground" class="absolute inset-0 z-0 bg-cover bg-center opacity-40 transition-all duration-1000 scale-110 blur-3xl" style="background-image: url('${artwork || ''}')"></div>
                    <div class="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent z-[1]"></div>
                    <div class="relative z-10 flex flex-col md:flex-row items-center md:items-end gap-8 w-full">
                        <div class="w-48 h-48 lg:w-64 lg:h-64 bg-card-dark rounded-full flex items-center justify-center shadow-2xl relative overflow-hidden border border-white/10 shrink-0">
                            ${artwork ? `<img src="${artwork}" class="w-full h-full object-cover">` : `<i class="fas fa-user text-gray-700 text-7xl"></i>`}
                        </div>
                        <div class="flex-1 text-center md:text-left">
                            <span class="text-xs font-bold uppercase tracking-[0.2em] text-accent-indigo mb-3 block">Artist</span>
                            <h1 class="text-5xl lg:text-8xl font-black tracking-tighter mb-4 text-white">${escapeHtml(artistName)}</h1>
                            <div class="flex items-center justify-center md:justify-start gap-4">
                                <button class="w-14 h-14 bg-white text-black rounded-full flex items-center justify-center shadow-xl hover:scale-105 transition-transform" onclick="playAllFromDynamic()">
                                    <i class="fas fa-play text-xl ml-1"></i>
                                </button>
                                <span class="text-sm font-bold text-white/60" id="artistTrackCount">${artistTracks.length} tracks found</span>
                            </div>
                        </div>
                    </div>
                </div>
                <div id="dynamicList" class="space-y-1"></div>
                <div id="artistLoader" class="py-10 text-center hidden">
                    <i class="fas fa-circle-notch fa-spin text-2xl text-accent-indigo"></i>
                </div>
            `;
            currentDynamicPlaylist = [];
        }

        const list = document.getElementById('dynamicList');
        const startIdx = currentDynamicPlaylist.length;
        currentDynamicPlaylist.push(...artistTracks);

        if (artistTracks.length === 0 && !append) {
            list.innerHTML = '<div class="py-20 text-center text-gray-500 font-medium">No tracks found for this artist.</div>';
        } else {
            artistTracks.forEach((track, index) => {
                list.appendChild(createTrackRow(track, startIdx + index, currentDynamicPlaylist, true));
            });
            observeImages(list);
            silentPreloadDurations(artistTracks);
        }
    } catch (e) {
        console.error(e);
    } finally {
        artistSearchState.loading = false;
        if (loader) loader.classList.add('hidden');
    }
}

function renderFavorites() {
    const list = document.getElementById('favoritesList');
    const count = document.getElementById('likedSongsCount');
    if (count) count.textContent = `${favorites.length} songs`;
    if (favorites.length === 0) {
        list.innerHTML = '<div class="py-20 text-center text-gray-500">Your liked songs will appear here.</div>';
        return;
    }
    list.innerHTML = '';
    favorites.forEach((track, index) => list.appendChild(createTrackRow(track, index, favorites, true)));
    observeImages(list);
}

function createTrackRow(track, index, trackList, hideEllipsis = false) {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 group cursor-pointer border border-transparent hover:border-brand-border transition-all';
    
    const isLiked = favorites.some(f => getTrackUid(f) === getTrackUid(track));
    
    div.innerHTML = `
        <div class="w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-white/5 relative">
            <img data-src="${track.local_artwork || getProxyUrl(track.artwork_url)}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" class="w-full h-full object-cover">
            <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <i class="fas fa-play text-white text-xs"></i>
            </div>
        </div>
        <div class="flex-1 min-w-0">
            <div class="font-bold text-sm text-white truncate">${escapeHtml(track.title)}</div>
            <div class="text-[10px] text-gray-500 truncate hover:underline hover:text-white" onclick="event.stopPropagation(); loadArtistView('${escapeHtml(track.artist_name || '').replace(/'/g, "\\'")}')">${escapeHtml(track.artist_name)}</div>
        </div>
        <div class="flex items-center gap-4">
            <button class="text-xs opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-red-500 transition-all" onclick="event.stopPropagation(); toggleLikeTrack(event, ${JSON.stringify(track).replace(/"/g, '&quot;')})">
                <i class="${isLiked ? 'fas fa-heart text-red-500' : 'far fa-heart'}"></i>
            </button>
            <span class="text-xs text-gray-500 font-mono w-10 text-right">${formatTime((getSavedTrackDuration(track) || track.duration || 0) / 1000)}</span>
            ${!hideEllipsis ? `
            <button class="text-gray-500 hover:text-white" onclick="event.stopPropagation(); showAddToPlaylistModal('${getTrackUid(track)}')">
                <i class="fas fa-ellipsis-h"></i>
            </button>` : ''}
        </div>
    `;
    div.addEventListener('click', () => {
        playlist = trackList;
        originalPlaylist = [...trackList];
        currentIndex = index;
        preloadedNextTrack = null;
        preloadedPrevTrack = null;
        playTrack(currentIndex);
    });
    return div;
}

function toggleLikeTrack(event, track) {
    const idx = favorites.findIndex(f => getTrackUid(f) === getTrackUid(track));
    if (idx > -1) {
        favorites.splice(idx, 1);
        event.target.className = 'far fa-heart';
        showToast('Removed from Liked Songs');
    } else {
        favorites.push(track);
        event.target.className = 'fas fa-heart text-red-500';
        showToast('Added to Liked Songs');
    }
    saveLibraryData();
    renderFavorites();
}

let activeSource = 'youtube'; 

async function playTrack(index) {
    currentIndex = index;
    currentTrack = playlist[currentIndex];
    if (isShuffle) {
        const sIndex = shuffledIndices.indexOf(index);
        if (sIndex > -1) shuffledCurrentIndex = sIndex;
        else generateShuffledSequence();
    }

    document.getElementById('currentTrackName').textContent = currentTrack.title;
    const artistNameEl = document.getElementById('currentArtistName');
    artistNameEl.textContent = currentTrack.artist_name;
    artistNameEl.className = 'text-xs text-gray-500 truncate hover:underline hover:text-white cursor-pointer';
    artistNameEl.onclick = () => loadArtistView(currentTrack.artist_name);

    const artwork = document.getElementById('currentArtwork');
    artwork.src = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url);
    artwork.classList.remove('hidden');
    document.getElementById('artworkPlaceholder').classList.add('hidden');

    updateLikeButtonStatus();
    if (!document.getElementById('fullscreenPlayer').classList.contains('hidden')) updateFullscreenUI();

    document.getElementById('progressBarFill').style.width = '0%';
    document.getElementById('currentTimeLabel').textContent = '0:00';
    document.getElementById('durationLabel').textContent = '0:00';

    let preloaded = null;
    if (preloadedNextTrack && preloadedNextTrack.index === index) preloaded = preloadedNextTrack;
    else if (preloadedPrevTrack && preloadedPrevTrack.index === index) preloaded = preloadedPrevTrack;

    if (preloaded) {
        if (preloaded.source === 'audio') loadAudioPlayer(preloaded.url);
        else loadYouTubePlayer(preloaded.videoId);
        preloadedNextTrack = null;
        preloadedPrevTrack = null;
        preloadTracks(); 
        return;
    }

    if (currentTrack.youtube_id || currentTrack.videoId) {
        loadYouTubePlayer(currentTrack.youtube_id || currentTrack.videoId);
        preloadTracks();
        return;
    }

    const directUrl = getDownloadUrl(currentTrack);
    if (directUrl) { 
        loadAudioPlayer(directUrl); 
        preloadTracks();
        return; 
    }

    try {
        const query = `${currentTrack.title} ${currentTrack.artist_name} official audio`;
        const response = await fetch(`${API_BASE_URL}/youtube-search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        if (data.videoId) {
            currentTrack.youtube_id = data.videoId;
            saveLibraryData();
            loadYouTubePlayer(data.videoId);
            preloadTracks();
        }
    } catch (e) { 
        console.error(e); 
    }
}

let audioCtx = null;
let analyser = null;
let sourceNode = null;
let dataArray = null;

function initAudioVisualizer() {
    const audio = document.getElementById('nativeAudio');
    if (!audio) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        
        sourceNode = audioCtx.createMediaElementSource(audio);
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
    } catch (e) {
        console.warn(e);
    }
}

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    const canvas = document.getElementById('visualizerCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    
    const count = 30;
    const barWidth = (w / count) - 4;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent-color').trim() || '#8b5cf6';
    
    if (isPlaying) {
        if (activeSource === 'audio' && analyser && dataArray) {
            if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
            analyser.getByteFrequencyData(dataArray);
            for (let i = 0; i < count; i++) {
                const val = dataArray[i % dataArray.length] || 0;
                const barHeight = (val / 255) * h * 0.9 + 4;
                const x = i * (w / count);
                ctx.fillRect(x, h - barHeight, barWidth, barHeight);
            }
        } else {
            const time = Date.now() * 0.005;
            for (let i = 0; i < count; i++) {
                const base = Math.sin(time + i * 0.3) * 0.4 + 0.6;
                const jitter = Math.random() * 0.15;
                const factor = Math.max(0.1, base + jitter);
                const barHeight = factor * h * 0.8 + 4;
                const x = i * (w / count);
                ctx.fillRect(x, h - barHeight, barWidth, barHeight);
            }
        }
    } else {
        for (let i = 0; i < count; i++) {
            const barHeight = 4;
            const x = i * (w / count);
            ctx.fillRect(x, h - barHeight, barWidth, barHeight);
        }
    }
}

function loadAudioPlayer(url) {
    activeSource = 'audio';
    if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
    let audio = document.getElementById('nativeAudio');
    if (!audio) {
        audio = document.createElement('audio'); 
        audio.id = 'nativeAudio';
        audio.crossOrigin = 'anonymous';
        document.getElementById('audioElement').appendChild(audio);
        audio.addEventListener('play', () => { isPlaying = true; updatePlayPauseUI(); startProgressUpdate(); });
        audio.addEventListener('pause', () => { isPlaying = false; updatePlayPauseUI(); stopProgressUpdate(); });
        audio.addEventListener('ended', () => playNext());
        
        let errorCount = 0;
        audio.addEventListener('error', async () => {
            errorCount++;
            if (errorCount === 1) {
                audio.load();
                audio.play().catch(e => {});
                return;
            }

            if (currentTrack) {
                const query = `${currentTrack.title} ${currentTrack.artist_name} official audio`;
                try {
                    const response = await fetch(`${API_BASE_URL}/youtube-search?q=${encodeURIComponent(query)}`);
                    const data = await response.json();
                    if (data.videoId) loadYouTubePlayer(data.videoId);
                } catch (e) { console.error(e); }
            }
        });

        audio.addEventListener('timeupdate', () => {
            if (activeSource === 'audio' && audio.duration) {
                const percent = (audio.currentTime / audio.duration) * 100;
                document.getElementById('progressBarFill').style.width = percent + '%';
                document.getElementById('currentTimeLabel').textContent = formatTime(audio.currentTime);
                document.getElementById('durationLabel').textContent = formatTime(audio.duration);
                const fsBar = document.getElementById('fsProgressBarFill'); if (fsBar) fsBar.style.width = percent + '%';
                const fsCurrent = document.getElementById('fsCurrentTime'); if (fsCurrent) fsCurrent.textContent = formatTime(audio.currentTime);
                const fsDuration = document.getElementById('fsDuration'); if (fsDuration) fsDuration.textContent = formatTime(audio.duration);
                saveTrackDuration(currentTrack, audio.duration);
            }
        });
        
        initAudioVisualizer();
    }
    
    audio.src = url;
    audio.volume = volume / 100;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {});
    }
}

function loadYouTubePlayer(videoId) {
    activeSource = 'youtube';
    let audio = document.getElementById('nativeAudio'); if (audio) audio.pause();
    if (window.YT && window.YT.Player) {
        if (player && typeof player.loadVideoById === 'function') { player.loadVideoById(videoId); player.playVideo(); }
        else {
            player = new YT.Player('audioElement', {
                height: '0', width: '0', videoId: videoId,
                playerVars: { autoplay: 1, controls: 0, disablekb: 1, origin: window.location.origin },
                events: { onReady: (e) => { e.target.setVolume(volume); e.target.playVideo(); }, onStateChange: onPlayerStateChange }
            });
        }
    } else {
        const tag = document.createElement('script'); tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        window.onYouTubeIframeAPIReady = () => loadYouTubePlayer(videoId);
    }
}

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) { isPlaying = true; updatePlayPauseUI(); startProgressUpdate(); }
    else if (event.data === YT.PlayerState.PAUSED) { isPlaying = false; updatePlayPauseUI(); stopProgressUpdate(); }
    else if (event.data === YT.PlayerState.ENDED) playNext();
}

function togglePlayPause() {
    if (activeSource === 'audio') {
        const audio = document.getElementById('nativeAudio');
        if (audio) { if (isPlaying) audio.pause(); else audio.play(); }
    } else if (player && typeof player.pauseVideo === 'function') {
        if (isPlaying) player.pauseVideo(); else player.playVideo();
    }
}

function updatePlayPauseUI() {
    const btns = ['playPauseButton', 'fsPlayPause', 'miniPlayPause'];
    btns.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            if (id === 'fsPlayPause') {
                btn.innerHTML = isPlaying ? '<i class="fas fa-pause text-4xl lg:text-6xl text-black"></i>' : '<i class="fas fa-play text-4xl lg:text-6xl ml-1 text-black"></i>';
            } else {
                btn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play"></i>';
            }
        }
    });
}

function playNext() {
    if (playlist.length === 0) return;
    if (repeatMode === 'one') { playTrack(currentIndex); return; }
    if (isShuffle) {
        shuffledCurrentIndex++;
        if (shuffledCurrentIndex >= shuffledIndices.length) {
            if (repeatMode === 'all') { shuffledCurrentIndex = 0; }
            else { shuffledCurrentIndex = shuffledIndices.length - 1; isPlaying = false; updatePlayPauseUI(); return; }
        }
        playTrack(shuffledIndices[shuffledCurrentIndex]);
    } else {
        let nextIndex = currentIndex + 1;
        if (nextIndex >= playlist.length) {
            if (repeatMode === 'all') nextIndex = 0;
            else { isPlaying = false; updatePlayPauseUI(); return; }
        }
        playTrack(nextIndex);
    }
}

function playPrev() {
    if (playlist.length === 0) return;
    if (isShuffle) {
        if (shuffledCurrentIndex > 0) { shuffledCurrentIndex--; playTrack(shuffledIndices[shuffledCurrentIndex]); }
        else playTrack(currentIndex);
    } else {
        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) {
            if (repeatMode === 'all') prevIndex = playlist.length - 1;
            else prevIndex = 0;
        }
        playTrack(prevIndex);
    }
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    const btn = document.getElementById('shuffleButton');
    const fsBtn = document.getElementById('fsShuffle');
    if (isShuffle) {
        btn.classList.add('active');
        if (fsBtn) fsBtn.classList.add('active');
        generateShuffledSequence();
    } else {
        btn.classList.remove('active');
        if (fsBtn) fsBtn.classList.remove('active');
    }
}

function generateShuffledSequence() {
    shuffledIndices = Array.from({ length: playlist.length }, (_, i) => i);
    for (let i = shuffledIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
    }
    const currentPos = shuffledIndices.indexOf(currentIndex);
    if (currentPos > -1) {
        shuffledIndices.splice(currentPos, 1);
        shuffledIndices.unshift(currentIndex);
    }
    shuffledCurrentIndex = 0;
}

function cycleRepeat() {
    const btn = document.getElementById('repeatButton');
    const fsBtn = document.getElementById('fsRepeat');
    if (repeatMode === 'off') {
        repeatMode = 'all';
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-repeat"></i>';
        if (fsBtn) { fsBtn.classList.add('active'); fsBtn.innerHTML = '<i class="fas fa-repeat"></i>'; }
    } else if (repeatMode === 'all') {
        repeatMode = 'one';
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-repeat-1"></i>';
        if (fsBtn) { fsBtn.classList.add('active'); fsBtn.innerHTML = '<i class="fas fa-repeat-1"></i>'; }
    } else {
        repeatMode = 'off';
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-repeat"></i>';
        if (fsBtn) { fsBtn.classList.remove('active'); fsBtn.innerHTML = '<i class="fas fa-repeat"></i>'; }
    }
}

function toggleLike() {
    if (!currentTrack) return;
    const idx = favorites.findIndex(f => getTrackUid(f) === getTrackUid(currentTrack));
    if (idx > -1) {
        favorites.splice(idx, 1);
        showToast('Removed from Liked Songs');
    } else {
        favorites.push(currentTrack);
        showToast('Added to Liked Songs');
    }
    saveLibraryData();
    updateLikeButtonStatus();
    renderFavorites();
}

function updateLikeButtonStatus() {
    if (!currentTrack) return;
    const isLiked = favorites.some(f => getTrackUid(f) === getTrackUid(currentTrack));
    const btn = document.getElementById('likeButton');
    const fsBtn = document.getElementById('fsLike');
    
    if (isLiked) {
        btn.innerHTML = '<i class="fas fa-heart text-red-500"></i>';
        btn.classList.add('active');
        if (fsBtn) {
            fsBtn.innerHTML = '<i class="fas fa-heart text-red-500"></i>';
            fsBtn.classList.add('active');
        }
    } else {
        btn.innerHTML = '<i class="far fa-heart"></i>';
        btn.classList.remove('active');
        if (fsBtn) {
            fsBtn.innerHTML = '<i class="far fa-heart"></i>';
            fsBtn.classList.remove('active');
        }
    }
}

async function preloadTracks() {
    if (playlist.length === 0) return;
    const nextIdx = (currentIndex + 1) % playlist.length;
    const prevIdx = (currentIndex - 1 + playlist.length) % playlist.length;
    
    preloadSingleTrack(playlist[nextIdx], 'next', nextIdx);
    preloadSingleTrack(playlist[prevIdx], 'prev', prevIdx);
}

async function preloadSingleTrack(track, type, idx) {
    if (!track) return;
    const directUrl = getDownloadUrl(track);
    if (directUrl) {
        if (type === 'next') preloadedNextTrack = { source: 'audio', url: directUrl, index: idx };
        else preloadedPrevTrack = { source: 'audio', url: directUrl, index: idx };
    } else {
        const cachedId = track.youtube_id || track.videoId;
        if (cachedId) {
            if (type === 'next') preloadedNextTrack = { source: 'youtube', videoId: cachedId, index: idx };
            else preloadedPrevTrack = { source: 'youtube', videoId: cachedId, index: idx };
        } else {
            const query = `${track.title} ${track.artist_name} official audio`;
            fetch(`${API_BASE_URL}/youtube-search?q=${encodeURIComponent(query)}`)
                .then(r => r.json())
                .then(data => {
                    if (data.videoId) {
                        track.youtube_id = data.videoId;
                        if (type === 'next') preloadedNextTrack = { source: 'youtube', videoId: data.videoId, index: idx };
                        else preloadedPrevTrack = { source: 'youtube', videoId: data.videoId, index: idx };
                    }
                }).catch(e => {});
        }
    }
}

function silentPreloadDurations(tracksList) {
    tracksList.forEach(track => {
        if (getSavedTrackDuration(track) === null && !track.duration) {
            const query = `${track.title} ${track.artist_name} official audio`;
            fetch(`${API_BASE_URL}/youtube-search?q=${encodeURIComponent(query)}`)
                .then(r => r.json())
                .then(data => {
                    if (data.results && data.results[0] && data.results[0].id) {
                        track.youtube_id = data.results[0].id;
                    }
                }).catch(e => {});
        }
    });
}

function startProgressUpdate() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (activeSource === 'youtube' && player && typeof player.getCurrentTime === 'function') {
            const current = player.getCurrentTime(), total = player.getDuration();
            if (total > 0) {
                const percent = (current / total) * 100;
                document.getElementById('progressBarFill').style.width = percent + '%';
                document.getElementById('currentTimeLabel').textContent = formatTime(current);
                document.getElementById('durationLabel').textContent = formatTime(total);
                const fsBar = document.getElementById('fsProgressBarFill'); if (fsBar) fsBar.style.width = percent + '%';
                const fsCurrent = document.getElementById('fsCurrentTime'); if (fsCurrent) fsCurrent.textContent = formatTime(current);
                const fsDuration = document.getElementById('fsDuration'); if (fsDuration) fsDuration.textContent = formatTime(total);
                saveTrackDuration(currentTrack, total);
            }
        }
    }, 1000);
}

function stopProgressUpdate() { 
    clearInterval(progressInterval); 
}

function updateVolumeUI() { 
    const bar = document.getElementById('volumeBarFill'); 
    if (bar) bar.style.width = volume + '%'; 
    const slider = document.getElementById('volumeSlider'); 
    if (slider) slider.value = volume; 
}

function toggleFullscreenPlayer(panel = '') {
    const fs = document.getElementById('fullscreenPlayer');
    if (!fs) return;
    if (fs.classList.contains('hidden')) {
        fs.classList.remove('hidden');
        fs.classList.add('flex');
        updateFullscreenUI();
        if (panel === 'lyrics') toggleFsLyrics(true);
    } else {
        fs.classList.add('hidden');
        fs.classList.remove('flex');
    }
}

function updateFullscreenUI() {
    if (!currentTrack) return;
    document.getElementById('fsTrackName').textContent = currentTrack.title;
    document.getElementById('fsArtistName').textContent = currentTrack.artist_name;
    document.getElementById('fsArtwork').src = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url);
    updateFullscreenTint();
    fetchLyrics();
}

function updateFullscreenTint() {
    const fs = document.getElementById('fullscreenPlayer');
    const artworkUrl = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url);
    if (!artworkUrl) return;
    
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        ctx.drawImage(img, 0, 0, 10, 10);
        const data = ctx.getImageData(0, 0, 10, 10).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; }
        r = Math.floor(r / (data.length / 4));
        g = Math.floor(g / (data.length / 4));
        b = Math.floor(b / (data.length / 4));
        
        const tint = `rgb(${r}, ${g}, ${b})`;
        fs.style.setProperty('--tint-color', tint);
        document.getElementById('fsBackground').style.background = `radial-gradient(circle at center, rgba(${r},${g},${b},0.6) 0%, rgba(8,9,12,1) 80%)`;
    };
    img.src = artworkUrl;
}

async function fetchLyrics() {
    const list = document.getElementById('fsLyricsList');
    if (!list) return;
    list.innerHTML = '<div class="py-20 flex justify-center"><i class="fas fa-circle-notch fa-spin text-2xl text-white/40"></i></div>';
    
    try {
        const id = currentTrack.youtube_id || currentTrack.videoId || getTrackUid(currentTrack);
        const response = await fetch(`${API_BASE_URL}/lyrics/${id}`);
        const data = await response.json();
        if (data.lyrics) {
            const lines = data.lyrics.split('\n');
            list.innerHTML = lines.map(line => `<div class="lyrics-line">${escapeHtml(line)}</div>`).join('');
        } else {
            list.innerHTML = '<div class="text-white/40 text-lg">Lyrics not found.</div>';
        }
    } catch (e) {
        list.innerHTML = '<div class="text-white/40 text-lg">Lyrics unavailable.</div>';
    }
}

function toggleFsLyrics(show) {
    const panel = document.getElementById('fsLyricsPanel');
    if (show) panel.classList.remove('translate-x-full');
    else panel.classList.add('translate-x-full');
}

function renderSidebarPlaylists() {
    const container = document.getElementById('sidebar-playlists');
    if (!container) return;
    container.innerHTML = '';
    playlists.forEach(pl => {
        const div = document.createElement('div');
        div.className = 'nav-item py-2 px-4 rounded-xl text-xs font-semibold truncate hover:text-white cursor-pointer';
        div.textContent = pl.name;
        div.addEventListener('click', () => loadLocalPlaylistDetails(pl.id));
        container.appendChild(div);
    });
}

function renderLibrary() {
    const container = document.getElementById('libraryContent');
    if (!container) return;
    container.innerHTML = '';
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'track-card relative aspect-square p-0 overflow-hidden group';
        const cover = pl.cover_url || '';
        card.innerHTML = `
            ${cover ? `<img src="${cover}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110">` : `<div class="w-full h-full bg-slate-800 flex items-center justify-center transition-transform duration-500 group-hover:scale-110"><i class="fas fa-music text-3xl opacity-40"></i></div>`}
            <div class="absolute inset-x-0 bottom-0 h-1/3 bg-black/20 backdrop-blur-md border-t border-white/10 flex flex-col justify-center px-4 transition-transform duration-300 translate-y-2 group-hover:translate-y-0">
                <div class="font-bold text-sm truncate text-white mb-0.5">${escapeHtml(pl.name)}</div>
                <div class="text-[10px] text-gray-300 truncate uppercase tracking-wider font-medium">${pl.tracks.length} songs</div>
            </div>
            <div class="absolute right-3 top-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <button class="w-8 h-8 rounded-full bg-black/60 border border-white/20 flex items-center justify-center hover:bg-black text-white" onclick="event.stopPropagation(); showPlaylistCoverUploadModal('${pl.id}')"><i class="fas fa-camera text-xs"></i></button>
                <button class="w-8 h-8 rounded-full bg-black/60 border border-white/20 flex items-center justify-center hover:bg-black text-white" onclick="event.stopPropagation(); showEditPlaylistModal('${pl.id}')"><i class="fas fa-edit text-xs"></i></button>
                <button class="w-8 h-8 rounded-full bg-black/60 border border-white/20 flex items-center justify-center hover:bg-black hover:text-red-500 text-white" onclick="event.stopPropagation(); deletePlaylist('${pl.id}')"><i class="fas fa-trash text-xs"></i></button>
            </div>
        `;
        card.addEventListener('click', () => loadLocalPlaylistDetails(pl.id));
        container.appendChild(card);
    });
}

function loadLocalPlaylistDetails(playlistId) {
    const pl = playlists.find(p => p.id.toString() === playlistId.toString());
    if (!pl) return;
    switchView('dynamic');
    const container = document.getElementById('dynamicView');
    const cover = pl.cover_url || '';
    container.innerHTML = `
        <div class="flex flex-col md:flex-row items-end gap-8 mb-10">
            <div class="w-56 h-56 rounded-3xl overflow-hidden shadow-2xl border border-brand-border shrink-0 bg-slate-800 flex items-center justify-center relative group">
                ${cover ? `<img src="${cover}" class="w-full h-full object-cover">` : `<i class="fas fa-music text-white text-7xl opacity-40"></i>`}
            </div>
            <div class="flex-1">
                <span class="text-xs font-bold uppercase tracking-widest text-gray-400">Playlist</span>
                <h1 class="text-6xl font-black tracking-tighter mb-4">${escapeHtml(pl.name)}</h1>
                <p class="text-gray-500 mb-4">${escapeHtml(pl.description) || 'Personal Playlist'}</p>
                <div class="flex items-center gap-2">
                    <span class="font-bold text-white" id="dynamicSongCount">${pl.tracks.length} songs</span>
                </div>
            </div>
        </div>
        <div class="flex items-center gap-6 mb-8 border-b border-brand-border pb-8">
            <button class="w-16 h-16 bg-accent-indigo rounded-full flex items-center justify-center shadow-lg hover:scale-105 transition-transform" onclick="playAllFromDynamic()">
                <i class="fas fa-play text-white text-xl"></i>
            </button>
        </div>
        <div id="dynamicList" class="space-y-2"></div>
    `;
    const list = document.getElementById('dynamicList');
    pl.tracks.forEach((track, index) => list.appendChild(createTrackRow(track, index, pl.tracks, false)));
    currentDynamicPlaylist = pl.tracks;
}

function playAllFromDynamic() {
    if (currentDynamicPlaylist.length > 0) {
        playlist = currentDynamicPlaylist;
        originalPlaylist = [...currentDynamicPlaylist];
        preloadedNextTrack = null;
        playTrack(0);
    }
}

function playAllFavorites() {
    if (favorites.length > 0) {
        playlist = favorites;
        originalPlaylist = [...favorites];
        preloadedNextTrack = null;
        playTrack(0);
    }
}

function showCreatePlaylistModal() {
    document.getElementById('createPlaylistModal').style.display = 'flex';
}

function hideCreatePlaylistModal() {
    document.getElementById('createPlaylistModal').style.display = 'none';
}

function createPlaylist() {
    const nameInput = document.getElementById('playlistNameInput');
    const descInput = document.getElementById('playlistDescInput');
    const name = nameInput.value.trim() || `My Playlist #${playlists.length + 1}`;
    const description = descInput.value.trim();
    
    const newPlaylist = {
        id: Date.now().toString(),
        name,
        description,
        tracks: [],
        cover_url: null
    };
    
    playlists.push(newPlaylist);
    saveLibraryData();
    renderSidebarPlaylists();
    renderLibrary();
    hideCreatePlaylistModal();
    nameInput.value = '';
    descInput.value = '';
    showToast('Playlist created');
}

function deletePlaylist(playlistId) {
    playlists = playlists.filter(p => p.id.toString() !== playlistId.toString());
    saveLibraryData();
    renderSidebarPlaylists();
    renderLibrary();
    switchView('libraryView');
    showToast('Playlist deleted');
}

function showEditPlaylistModal(playlistId) {
    const pl = playlists.find(p => p.id.toString() === playlistId.toString());
    if (!pl) return;
    document.getElementById('editPlaylistId').value = pl.id;
    document.getElementById('editPlaylistNameInput').value = pl.name;
    document.getElementById('editPlaylistDescInput').value = pl.description || '';
    document.getElementById('editPlaylistModal').style.display = 'flex';
}

function hideEditPlaylistModal() {
    document.getElementById('editPlaylistModal').style.display = 'none';
}

function confirmEditPlaylist() {
    const id = document.getElementById('editPlaylistId').value;
    const name = document.getElementById('editPlaylistNameInput').value.trim();
    const desc = document.getElementById('editPlaylistDescInput').value.trim();
    
    const pl = playlists.find(p => p.id.toString() === id.toString());
    if (pl) {
        pl.name = name || pl.name;
        pl.description = desc;
        saveLibraryData();
        renderSidebarPlaylists();
        renderLibrary();
        hideEditPlaylistModal();
        showToast('Playlist updated');
    }
}

function updatePlaylist(id, name, desc, coverUrl) {
    const pl = playlists.find(p => p.id.toString() === id.toString());
    if (pl) {
        pl.name = name || pl.name;
        pl.description = desc || pl.description;
        if (coverUrl) pl.cover_url = coverUrl;
        saveLibraryData();
        renderSidebarPlaylists();
        renderLibrary();
        loadLocalPlaylistDetails(pl.id);
    }
}

function showAddToPlaylistModal(trackUid) {
    const modal = document.getElementById('addToPlaylistModal');
    if (!modal) return;
    const list = document.getElementById('playlistSelectionList');
    list.innerHTML = '';
    
    if (playlists.length === 0) {
        list.innerHTML = '<div class="text-center py-4 text-gray-500">Create a playlist first in the sidebar.</div>';
    } else {
        playlists.forEach(pl => {
            const div = document.createElement('div');
            div.className = 'p-3 hover:bg-white/5 rounded-xl cursor-pointer border border-transparent hover:border-brand-border text-white flex items-center justify-between';
            div.innerHTML = `
                <div class="font-bold text-sm">${escapeHtml(pl.name)}</div>
                <div class="text-xs text-gray-500">${pl.tracks.length} songs</div>
            `;
            div.addEventListener('click', () => {
                addTrackToPlaylist(trackUid, pl.id);
            });
            list.appendChild(div);
        });
    }
    modal.style.display = 'flex';
}

function hideAddToPlaylistModal() {
    document.getElementById('addToPlaylistModal').style.display = 'none';
}

function addTrackToPlaylist(trackUid, playlistId) {
    let track = playlist.find(t => getTrackUid(t) === trackUid) || currentTrack;
    if (!track && currentSearchResults.length > 0) {
        track = currentSearchResults.find(t => getTrackUid(t) === trackUid);
    }
    if (!track) return;
    const pl = playlists.find(p => p.id.toString() === playlistId.toString());
    if (pl) {
        if (!pl.tracks.some(t => getTrackUid(t) === trackUid)) {
            pl.tracks.push(track);
            saveLibraryData();
            showToast('Added to playlist');
        } else {
            showToast('Track already in playlist', 'error');
        }
    }
    hideAddToPlaylistModal();
}

let cropperImage = null;
let cropState = { x: 0, y: 0, radius: 100 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };

function initCropper() {
    const cropperCanvas = document.getElementById('cropperCanvas');
    if (!cropperCanvas) return;
    const ctx = cropperCanvas.getContext('2d');

    const drawCropper = () => {
        if (!cropperImage) return;
        const w = cropperCanvas.width;
        const h = cropperCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(cropperImage, 0, 0, w, h);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        const r = cropState.radius;
        const size = r * 2;
        const cornerRadius = size * 0.15;
        if (ctx.roundRect) ctx.roundRect(cropState.x - r, cropState.y - r, size, size, cornerRadius);
        else ctx.rect(cropState.x - r, cropState.y - r, size, size);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cropState.x - r, cropState.y - r, size, size, cornerRadius);
        else ctx.rect(cropState.x - r, cropState.y - r, size, size);
        ctx.stroke();
        ctx.setLineDash([]);
    };

    const handleStart = (x, y) => {
        const r = cropState.radius;
        if (x >= cropState.x - r && x <= cropState.x + r && y >= cropState.y - r && y <= cropState.y + r) {
            isDragging = true;
            dragStart = { x, y };
        }
    };
    const handleMove = (x, y) => {
        if (isDragging) {
            const dx = x - dragStart.x;
            const dy = y - dragStart.y;
            let newX = cropState.x + dx;
            let newY = cropState.y + dy;
            const r = cropState.radius;
            const w = cropperCanvas.width;
            const h = cropperCanvas.height;
            newX = Math.max(r, Math.min(newX, w - r));
            newY = Math.max(r, Math.min(newY, h - r));
            cropState.x = newX;
            cropState.y = newY;
            dragStart = { x, y };
            requestAnimationFrame(drawCropper);
        }
    };
    const handleEnd = () => { isDragging = false; };
    const handleScroll = (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -5 : 5;
        let newRadius = cropState.radius + delta;
        const w = cropperCanvas.width, h = cropperCanvas.height;
        const maxPossibleRadius = Math.min(w, h) / 2;
        newRadius = Math.max(20, Math.min(newRadius, maxPossibleRadius));
        const minX = newRadius, maxX = w - newRadius, minY = newRadius, maxY = h - newRadius;
        cropState.x = Math.max(minX, Math.min(cropState.x, maxX));
        cropState.y = Math.max(minY, Math.min(cropState.y, maxY));
        cropState.radius = newRadius;
        requestAnimationFrame(drawCropper);
    };

    cropperCanvas.addEventListener('mousedown', e => handleStart(e.offsetX, e.offsetY));
    cropperCanvas.addEventListener('mousemove', e => handleMove(e.offsetX, e.offsetY));
    cropperCanvas.addEventListener('mouseup', handleEnd);
    cropperCanvas.addEventListener('mouseleave', handleEnd);
    cropperCanvas.addEventListener('wheel', handleScroll);

    document.getElementById('playlistCoverInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            cropperImage = new Image();
            cropperImage.onload = () => {
                const fixedHeight = 400;
                const scale = fixedHeight / cropperImage.height;
                cropperCanvas.height = fixedHeight;
                cropperCanvas.width = cropperImage.width * scale;
                cropState = { x: cropperCanvas.width / 2, y: cropperCanvas.height / 2, radius: Math.min(cropperCanvas.width, cropperCanvas.height) / 3 };
                document.getElementById('cropperModal').style.display = 'flex';
                requestAnimationFrame(drawCropper);
            };
            cropperImage.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('cancelCropBtn').addEventListener('click', () => {
        document.getElementById('cropperModal').style.display = 'none';
        document.getElementById('playlistCoverInput').value = '';
    });

    document.getElementById('submitCropBtn').addEventListener('click', async () => {
        const tempCanvas = document.createElement('canvas');
        const size = 512;
        tempCanvas.width = size;
        tempCanvas.height = size;
        const tCtx = tempCanvas.getContext('2d');
        const scale = cropperCanvas.height / cropperImage.height;
        const sourceX = (cropState.x - cropState.radius) / scale;
        const sourceY = (cropState.y - cropState.radius) / scale;
        const sourceSize = (cropState.radius * 2) / scale;
        tCtx.drawImage(cropperImage, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        const base64 = tempCanvas.toDataURL('image/jpeg', 0.8);
        
        const id = document.getElementById('uploadPlaylistId').value;
        const pl = playlists.find(p => p.id.toString() === id.toString());
        if (pl) {
            updatePlaylist(pl.id, pl.name, pl.description, base64);
            document.getElementById('cropperModal').style.display = 'none';
        }
    });
}

function showPlaylistCoverUploadModal(id) { 
    document.getElementById('uploadPlaylistId').value = id; 
    document.getElementById('playlistCoverInput').click(); 
}

function setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view) switchView(view);
        });
    });

    const mainView = document.querySelector('.main-view');
    if (mainView) {
        mainView.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = mainView;
            if (scrollHeight - scrollTop - clientHeight < 200) {
                if (document.getElementById('searchView').classList.contains('active')) {
                    if (searchState.query && !searchState.loading && searchState.hasMoreTracks) {
                        handleSearch(searchState.query, true);
                    }
                } else if (document.getElementById('dynamicView').classList.contains('active')) {
                    if (artistSearchState.name && !artistSearchState.loading && artistSearchState.hasMore) {
                        loadArtistView(artistSearchState.name, true);
                    }
                }
            }
        });
    }

    const searchInput = document.getElementById('searchInput');
    let searchTimeout;
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            const query = e.target.value.trim();
            if (query) {
                searchTimeout = setTimeout(() => handleSearch(query, false), 500);
            } else {
                document.getElementById('searchResults').classList.add('hidden');
                document.getElementById('browseCategories').classList.remove('hidden');
            }
        });
    }

    const nextBtn = document.getElementById('nextPageBtn');
    const prevBtn = document.getElementById('prevPageBtn');
    if (nextBtn) nextBtn.addEventListener('click', searchNextPage);
    if (prevBtn) prevBtn.addEventListener('click', searchPrevPage);

    document.getElementById('playPauseButton').addEventListener('click', togglePlayPause);
    document.getElementById('nextButton').addEventListener('click', playNext);
    document.getElementById('prevButton').addEventListener('click', playPrev);
    document.getElementById('shuffleButton').addEventListener('click', toggleShuffle);
    document.getElementById('repeatButton').addEventListener('click', cycleRepeat);
    document.getElementById('likeButton').addEventListener('click', toggleLike);

    document.getElementById('fsPlayPause').addEventListener('click', togglePlayPause);
    document.getElementById('fsNext').addEventListener('click', playNext);
    document.getElementById('fsPrev').addEventListener('click', playPrev);
    document.getElementById('fsShuffle').addEventListener('click', toggleShuffle);
    document.getElementById('fsRepeat').addEventListener('click', cycleRepeat);
    document.getElementById('fsLike').addEventListener('click', toggleLike);

    const progressTrack = document.getElementById('progressTrack');
    if (progressTrack) {
        progressTrack.addEventListener('click', (e) => {
            const rect = progressTrack.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio && audio.duration) audio.currentTime = pos * audio.duration;
            } else if (player && typeof player.seekTo === 'function') {
                const total = player.getDuration();
                if (total > 0) player.seekTo(pos * total);
            }
        });
    }

    const fsProgressTrack = document.getElementById('fsProgressTrack');
    if (fsProgressTrack) {
        fsProgressTrack.addEventListener('click', (e) => {
            const rect = fsProgressTrack.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio && audio.duration) audio.currentTime = pos * audio.duration;
            } else if (player && typeof player.seekTo === 'function') {
                const total = player.getDuration();
                if (total > 0) player.seekTo(pos * total);
            }
        });
    }

    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            volume = parseInt(e.target.value);
            localStorage.setItem('velium_volume', volume.toString());
            updateVolumeUI();
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio) audio.volume = volume / 100;
            } else if (player && typeof player.setVolume === 'function') {
                player.setVolume(volume);
            }
        });
    }

    document.getElementById('sidebarToggle').addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.classList.toggle('open');
    });

    document.getElementById('savePlaylistBtn').addEventListener('click', createPlaylist);
    document.getElementById('confirmEditPlaylistBtn').addEventListener('click', confirmEditPlaylist);
}

async function initApp() {
    if (isInitialized) return;
    isInitialized = true;

    loadAppliedTheme();
    await loadLibraryData();
    setGreeting();
    setupEventListeners();
    populateCategoriesGrid();
    loadPopularTracks().then(tracks => {
        if (tracks) silentPreloadDurations(tracks);
    });
    renderSidebarPlaylists();
    renderLibrary();
    updateVolumeUI();
    initCropper();

    if (favorites.length > 0) {
        silentPreloadDurations(favorites);
    }
    
    requestAnimationFrame(drawVisualizer);

    const loader = document.getElementById('startup-loader');
    if (loader) {
        loader.classList.add('hidden');
        setTimeout(() => loader.remove(), 600);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        initApp();
    } else {
        setTimeout(initApp, 1000);
    }
});
