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

    // Default high-res for Saavn
    if (url.includes('saavncdn.com')) {
        if (size) {
            url = url.replace(/_([0-9]+x[0-9]+|150|500)\.jpg/i, `_${size}.jpg`);
        } else {
            url = url.replace(/_([0-9]+x[0-9]+|150|500)\.jpg/i, `_500x500.jpg`);
        }
    }

    // Default high-res for Google/YouTube images
    if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
        const targetSize = (size === '50x50') ? 's50' : 'w1000-h1000-l90-rj';
        if (url.includes('=')) {
            url = url.split('=')[0] + '=' + targetSize;
        } else {
            url += '=' + targetSize;
        }
    }

    // Default high-res for i.ytimg.com
    if (url.includes('i.ytimg.com')) {
        url = url.replace('/default.jpg', '/maxresdefault.jpg')
                 .replace('/mqdefault.jpg', '/maxresdefault.jpg')
                 .replace('/hqdefault.jpg', '/maxresdefault.jpg')
                 .replace('/sddefault.jpg', '/maxresdefault.jpg');
    }

    if (url.startsWith('//')) url = 'https:' + url;
    const prefix = (window.__uv$config && window.__uv$config.prefix) || "/v-proxy/service/";
    const encode = (window.__uv$config && window.__uv$config.encodeUrl) || (window.Ultraviolet && window.Ultraviolet.codec && window.Ultraviolet.codec.xor && window.Ultraviolet.codec.xor.encode);
    if (encode) {
        const encoded = encode(url);
        if (encoded.startsWith(prefix)) return encoded;
        return prefix + encoded;
    }
    return url;
}let isInitialized = false;
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
let volume = parseInt(localStorage.getItem('velium_v2_volume')) || 70;
let preloadedNextTrack = null;
let preloadedPrevTrack = null;
let currentSearchResults = [];
const popularArtists = [
    'The Weeknd', 'Drake', 'Post Malone', 'Dua Lipa', 'Ed Sheeran',
    'Ariana Grande', 'Travis Scott', 'Olivia Rodrigo', 'Bad Bunny', 'SZA'
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
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    // Check if same toast is already visible
    const existingToasts = Array.from(container.querySelectorAll('.velium-toast'));
    if (existingToasts.some(t => t.querySelector('.toast-msg')?.textContent === message)) return;

    const toast = document.createElement('div');
    
    let iconClass = 'fa-info-circle text-blue-400';
    let borderColor = 'border-white/10';
    if (type === 'success') {
        iconClass = 'fa-check-circle text-green-400';
        borderColor = 'border-green-500/30';
    } else if (type === 'error') {
        iconClass = 'fa-exclamation-circle text-red-400';
        borderColor = 'border-red-500/30';
    }

    toast.className = `velium-toast flex items-center gap-3 px-5 py-3 rounded-xl bg-black/80 backdrop-blur-xl border ${borderColor} text-white shadow-2xl animate-in slide-in-from-right-10 duration-500 pointer-events-auto cursor-pointer`;
    
    toast.innerHTML = `
        <i class="fa-solid ${iconClass} text-lg"></i>
        <div class="toast-msg text-sm font-semibold tracking-wide">${message}</div>
    `;

    toast.onclick = () => {
        toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-10');
        setTimeout(() => toast.remove(), 500);
    };

    container.appendChild(toast);
    
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('animate-out', 'fade-out', 'slide-out-to-right-10');
            setTimeout(() => toast.remove(), 500);
        }
    }, 4000);
}
function getTrackUid(track) {
    if (!track) return null;
    
    // Stable ID if it already exists
    if (track.stable_id) return track.stable_id;
    if (track.id && !track.id.includes('gen-')) return track.id;
    if (track.youtube_id) return `ytm-${track.youtube_id}`;
    if (track.videoId) return `ytm-${track.videoId}`;

    // Fallback to title/artist/album if no unique ID is found
    const title = (track.title || track.name || '').trim().toLowerCase();
    const artist = (track.artist_name || track.artist || '').trim().toLowerCase();
    const album = (track.album_name || track.album || '').trim().toLowerCase();
    return `f-${title}-${artist}-${album}`.replace(/[^a-z0-9]/g, '');
}
async function preloadTracks() {
    if (playlist.length === 0) return;
    let nextIndex = -1;
    if (isShuffle) {
        if (shuffledCurrentIndex < shuffledIndices.length - 1) nextIndex = shuffledIndices[shuffledCurrentIndex + 1];
        else if (repeatMode === 'all') nextIndex = shuffledIndices[0];
    } else {
        if (currentIndex < playlist.length - 1) nextIndex = currentIndex + 1;
        else if (repeatMode === 'all') nextIndex = 0;
    }
    let prevIndex = -1;
    if (isShuffle) {
        if (shuffledCurrentIndex > 0) prevIndex = shuffledIndices[shuffledCurrentIndex - 1];
        else if (repeatMode === 'all') prevIndex = shuffledIndices[shuffledIndices.length - 1];
    } else {
        if (currentIndex > 0) prevIndex = currentIndex - 1;
        else if (repeatMode === 'all') prevIndex = playlist.length - 1;
    }
    const tasks = [];
    if (nextIndex !== -1 && nextIndex !== currentIndex) {
        tasks.push(preloadSingleTrack(nextIndex, 'next'));
    }
    if (prevIndex !== -1 && prevIndex !== currentIndex && prevIndex !== nextIndex) {
        tasks.push(preloadSingleTrack(prevIndex, 'prev'));
    }
    await Promise.all(tasks);
}
async function preloadSingleTrack(index, type) {
    const track = playlist[index];
    if (!track) return;
    const trackUid = getTrackUid(track);
    const cache = type === 'next' ? preloadedNextTrack : preloadedPrevTrack;
    if (cache && cache.uid === trackUid) return;
    try {
        if (track.youtube_id || track.videoId) {
            const data = { index, uid: trackUid, source: 'youtube', videoId: track.youtube_id || track.videoId };
            if (type === 'next') preloadedNextTrack = data; else preloadedPrevTrack = data;
            return;
        }
        const directUrl = getDownloadUrl(track);
        if (directUrl) {
            const data = { index, uid: trackUid, source: 'audio', url: directUrl };
            if (type === 'next') preloadedNextTrack = data; else preloadedPrevTrack = data;
            let preloadElId = type === 'next' ? 'preloadAudioNext' : 'preloadAudioPrev';
            let preloadAudio = document.getElementById(preloadElId);
            if (!preloadAudio) {
                preloadAudio = document.createElement('audio');
                preloadAudio.id = preloadElId;
                preloadAudio.preload = 'auto';
                preloadAudio.style.display = 'none';
                document.body.appendChild(preloadAudio);
            }
            preloadAudio.src = directUrl;
            preloadAudio.load();
        } else {
            const query = `${track.title} ${track.artist_name} official audio`;
            const response = await fetch(`${API_BASE_URL}/youtube-search?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            if (data.videoId) {
                track.youtube_id = data.videoId;
                saveLibraryData();
                const cacheData = { index, uid: trackUid, source: 'youtube', videoId: data.videoId };
                if (type === 'next') preloadedNextTrack = cacheData; else preloadedPrevTrack = cacheData;
            }
        }
    } catch (e) { console.warn(`Preload ${type} failed`, e); }
}
async function silentPreloadDurations(tracks) {
    if (!tracks || tracks.length === 0) return;
    const tracksToLoad = tracks.filter(t => !t.duration || t.duration <= 0);
    if (tracksToLoad.length === 0) return;
    let preloadAudio = document.getElementById('silentPreloadAudio');
    if (!preloadAudio) {
        preloadAudio = document.createElement('audio');
        preloadAudio.id = 'silentPreloadAudio';
        preloadAudio.style.display = 'none';
        preloadAudio.muted = true;
        document.body.appendChild(preloadAudio);
    }
    for (let i = 0; i < tracksToLoad.length; i++) {
        const track = tracksToLoad[i];
        const url = getDownloadUrl(track);
        if (!url) continue;
        try {
            await new Promise((resolve, reject) => {
                preloadAudio.src = url;
                const timeout = setTimeout(() => {
                    preloadAudio.src = "";
                    resolve();
                }, 10000);
                preloadAudio.onloadedmetadata = () => {
                    clearTimeout(timeout);
                    if (preloadAudio.duration) {
                        saveTrackDuration(track, preloadAudio.duration);
                        document.querySelectorAll(`[data-track-uid="${getTrackUid(track)}"] .duration-label`).forEach(el => {
                            el.textContent = formatTime(preloadAudio.duration);
                        });
                    }
                    resolve();
                };
                preloadAudio.onerror = () => {
                    clearTimeout(timeout);
                    resolve();
                };
            });
            await new Promise(r => setTimeout(r, 500));
        } catch (e) { console.warn("Silent preload failed for track", track.title, e); }
    }
}
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
async function saveTrackDuration(track, duration) {
    if (!track || !duration || duration <= 0) return;
    const durationSec = duration > 10000 ? duration / 1000 : duration;
    if (track.duration && Math.abs(track.duration - durationSec) < 2) return;
    track.duration = durationSec;
    const trackUid = getTrackUid(track);
    const favIndex = favorites.findIndex(f => getTrackUid(f) === trackUid);
    if (favIndex > -1) favorites[favIndex].duration = durationSec;
    playlists.forEach(pl => {
        pl.tracks.forEach(t => {
            if (getTrackUid(t) === trackUid) t.duration = durationSec;
        });
    });
    await saveLibraryData();
}
async function urlToBase64(url) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
        const response = await fetch(getProxyUrl(url));
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Failed to convert image to base64', e);
        return null;
    }
}
function generateShuffledSequence() {
    if (playlist.length === 0) return;
    let indices = playlist.map((_, i) => i);
    const currentPos = indices.indexOf(currentIndex);
    if (currentPos > -1) indices.splice(currentPos, 1);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < indices.length - 1; i++) {
        if (playlist[indices[i]].artist_name === playlist[indices[i+1]].artist_name) {
            for (let j = i + 2; j < indices.length; j++) {
                if (playlist[indices[j]].artist_name !== playlist[indices[i]].artist_name) {
                    [indices[i+1], indices[j]] = [indices[j], indices[i+1]];
                    break;
                }
            }
        }
    }
    shuffledIndices = [currentIndex, ...indices];
    shuffledCurrentIndex = 0;
}
document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(() => initApp());
        setTimeout(() => { if (!currentTrack && playlist.length === 0) initApp(); }, 2000);
    } else {
        initApp();
    }
});
async function initApp() {
    if (isInitialized) return;
    isInitialized = true;
    await loadLibraryData();
    setGreeting();
    setupEventListeners();
    loadPopularTracks().then(tracks => {
        if (tracks) silentPreloadDurations(tracks);
    });
    renderSidebarPlaylists();
    renderLibrary();
    renderBrowseCategories();
    updateVolumeUI();
    initCropper();
    if (favorites.length > 0) {
        silentPreloadDurations(favorites);
    }
    if (window.isAdmin) {
        const adminTab = document.getElementById('admin-test-tab');
        if (adminTab) adminTab.classList.remove('hidden');
    }
    const loader = document.getElementById('startup-loader');
    if (loader) {
        loader.classList.add('hidden');
        console.log("VELIUM: App Ready, hiding loader");
    }
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
                }
                else if (document.getElementById('dynamicView').classList.contains('active')) {
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
    const nextBtn = document.getElementById('nextButton');
    const prevBtn = document.getElementById('prevPageBtn');
    if (nextBtn) nextBtn.addEventListener('click', searchNextPage);
    if (prevBtn) prevBtn.addEventListener('click', searchPrevPage);

    const progressTrack = document.getElementById('progressTrack');
    if (progressTrack) {
        progressTrack.addEventListener('click', (e) => {
            const rect = progressTrack.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio && audio.duration) audio.currentTime = audio.duration * percent;
            } else if (player && typeof player.getDuration === 'function') {
                player.seekTo(player.getDuration() * percent);
            }
        });
    }

    const volumeSlider = document.getElementById('volumeSlider');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            volume = parseInt(e.target.value);
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio) audio.volume = volume / 100;
            } else if (player && typeof player.setVolume === 'function') {
                player.setVolume(volume);
            }
            const volumeBarFill = document.getElementById('volumeBarFill');
            if (volumeBarFill) volumeBarFill.style.width = volume + '%';
            saveToStorage('volume', volume);
        });
    }

    const volumeTrack = document.getElementById('volumeTrack');
    if (volumeTrack) {
        volumeTrack.addEventListener('click', (e) => {
            const rect = volumeTrack.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            volume = Math.round(percent * 100);
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio) audio.volume = volume / 100;
            } else if (player && typeof player.setVolume === 'function') {
                player.setVolume(volume);
            }
            const volumeBarFill = document.getElementById('volumeBarFill');
            if (volumeBarFill) volumeBarFill.style.width = volume + '%';
            saveToStorage('volume', volume);
        });
    }
    const createPlaylistBtn = document.querySelector('.create-playlist-btn');
    if (createPlaylistBtn) createPlaylistBtn.addEventListener('click', showCreatePlaylistModal);
    const savePlBtn = document.getElementById('savePlaylistBtn');
    if (savePlBtn) {
        savePlBtn.addEventListener('click', () => {
            createPlaylist(document.getElementById('playlistNameInput').value.trim(), document.getElementById('playlistDescInput').value.trim(), '', document.getElementById('createPlaylistColor').value);
            hideCreatePlaylistModal();
        });
    }

    const editPlBtn = document.getElementById('confirmEditPlaylistBtn');
    if (editPlBtn) editPlBtn.addEventListener('click', confirmEditPlaylist);

    const fsProgressTrack = document.getElementById('fsProgressTrack');
    if (fsProgressTrack) {
        fsProgressTrack.addEventListener('click', (e) => {
            const rect = fsProgressTrack.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            if (activeSource === 'audio') {
                const audio = document.getElementById('nativeAudio');
                if (audio && audio.duration) audio.currentTime = audio.duration * percent;
            } else if (player && typeof player.getDuration === 'function') {
                player.seekTo(player.getDuration() * percent);
            }
        });
    }
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) {
            const fs = document.getElementById('fsPlayer');
            if (fs && fs.style.display === 'flex') {
                fs.style.display = 'none';
                document.body.style.overflow = '';
            }
        }
    });
    const sidebarToggleBtn = document.getElementById('sidebarToggle');
    const sidebar = document.querySelector('.sidebar');
    const appContainer = document.querySelector('.app-container');
    if (sidebarToggleBtn && sidebar && appContainer) {
        sidebarToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
        });
        appContainer.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 && sidebar.classList.contains('open') && !sidebar.contains(e.target) && !sidebarToggleBtn.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            const active = document.activeElement;
            const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
            if (!isInput) {
                e.preventDefault();
                togglePlayPause();
            }
        }
    });
}
window.toggleFullscreenPlayer = function() {
    const fs = document.getElementById('fsPlayer');
    if (!fs) return;
    if (fs.style.display !== 'flex') {
        if (!currentTrack) {
            showToast('No track playing', 'info');
            return;
        }
        fs.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
        updateFullscreenUI();
    } else {
        fs.style.display = 'none';
        document.body.style.overflow = '';
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
};
function closeFullscreenIfNoTrack() {
    const fs = document.getElementById('fsPlayer');
    if (fs && fs.style.display === 'flex') {
        window.toggleFullscreenPlayer();
    }
}
function updateFullscreenUI() {
    if (!currentTrack) return;
    document.getElementById('fsTrackName').textContent = currentTrack.title;
    const artistEl = document.getElementById('fsArtistName');
    artistEl.textContent = currentTrack.artist_name;
    artistEl.classList.add('hover:underline', 'cursor-pointer');
    artistEl.onclick = () => {
        window.toggleFullscreenPlayer();
        loadArtistView(currentTrack.artist_name);
    };
    
    // High quality for foreground artwork
    const artworkUrl = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url, '500x500');
    document.getElementById('fsArtwork').src = artworkUrl;
    
    // Lower quality for blurred background
    const bgUrl = currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url, '50x50');
    const bg = document.getElementById('fsBackground');
    if (bg) {
        bg.style.backgroundImage = `url('${bgUrl}')`;
        bg.style.backgroundSize = 'cover';
        bg.style.backgroundPosition = 'center';
    }
    
    updateFullscreenTint(artworkUrl);
    document.getElementById('fsShuffle').classList.toggle('active', isShuffle);
    const fsRepeat = document.getElementById('fsRepeat');
    fsRepeat.classList.toggle('active', repeatMode !== 'off');
    fsRepeat.innerHTML = repeatMode === 'one' ? '<i class="fas fa-repeat"></i><span class="absolute text-[8px] font-bold mt-1 ml-1">1</span>' : '<i class="fas fa-repeat"></i>';
    const fsPlayBtn = document.getElementById('fsPlayPause');
    if (fsPlayBtn) fsPlayBtn.innerHTML = isPlaying ? '<i class="fas fa-pause text-4xl lg:text-6xl text-black"></i>' : '<i class="fas fa-play text-4xl lg:text-6xl ml-1 text-black"></i>';
}
function updateFullscreenTint(imageUrl) {
    const fs = document.getElementById('fsPlayer');
    if (!fs || !imageUrl) return;
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 50; canvas.height = 50;
        ctx.drawImage(img, 0, 0, 50, 50);
        const data = ctx.getImageData(0, 0, 50, 50).data;
        let r=0, g=0, b=0, count=0;
        for(let i=0; i<data.length; i+=4) {
            r += data[i]; g += data[i+1]; b += data[i+2]; count++;
        }
        r = Math.round(r/count); g = Math.round(g/count); b = Math.round(b/count);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const maxComponent = Math.max(r, g, b);
        
        // Trigger bright-bg if brightness is high OR if color is very vibrant
        if (brightness > 175 || (maxComponent > 220 && brightness > 100)) {
            fs.classList.add('bright-bg');
        } else {
            fs.classList.remove('bright-bg');
        }
        
        let tintColor, progressBg, accentColor;
        if (brightness < 160) {
            tintColor = 'rgba(255, 255, 255, 1)';
            progressBg = 'rgba(255, 255, 255, 0.2)';
            accentColor = `rgba(${Math.min(255, r+40)}, ${Math.min(255, g+40)}, ${Math.min(255, b+40)}, 1)`;
        } else {
            const factor = 0.15;
            tintColor = `rgba(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)}, 1)`;
            progressBg = `rgba(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)}, 0.2)`;
            accentColor = `rgba(${Math.round(r * 0.5)}, ${Math.round(g * 0.5)}, ${Math.round(b * 0.5)}, 1)`;
        }
        fs.style.setProperty('--tint-color', tintColor);
        fs.style.setProperty('--progress-bg', progressBg);
        fs.style.setProperty('--accent-color', accentColor);
        fs.style.setProperty('--bg-base', `rgb(${r}, ${g}, ${b})`);
    };
}
function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const targetView = document.getElementById(viewName + 'View') || document.getElementById(viewName);
    if (targetView) {
        targetView.classList.add('active');
        // Ensure scroll to top
        document.querySelector('.main-view')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    const navItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (navItem) navItem.classList.add('active');
    
    if (viewName === 'favorites') renderFavorites();
    if (viewName === 'library') renderLibrary();
}
let artistSearchState = { name: '', offset: 0, loading: false, hasMore: true, limit: 50 };
async function loadArtistView(artistName, append = false) {
    if (!artistName) return;
    if (!append) {
        switchView('dynamic');
        artistSearchState = { name: artistName, offset: 0, loading: false, hasMore: true, limit: 50 };
        const container = document.getElementById('dynamicView');
        container.innerHTML = `
            <header class="hero-header" style="background: linear-gradient(to bottom, rgba(80,80,80,1) 0%, var(--bg-elevated) 100%);">
                <div class="artist-img">
                    <i class="fa-solid fa-user"></i>
                </div>
                <div class="hero-meta">
                    <h1 class="artist-header">${escapeHtml(artistName)}</h1>
                    <div class="monthly-listeners" id="artistTrackCount">Loading tracks...</div>
                </div>
            </header>
            <div class="action-bar">
                <button class="btn-play-large" onclick="playAllFromDynamic()"><i class="fa-solid fa-play" style="margin-left: 4px;"></i></button>
            </div>
            <div class="track-section">
                <div class="track-grid" id="dynamicList"></div>
            </div>
            <div id="artistLoader" style="display: none; text-align: center; padding: 20px 0;">
                <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 24px; color: var(--text-main);"></i>
            </div>
        `;
    }
    if (artistSearchState.loading || !artistSearchState.hasMore) return;
    artistSearchState.loading = true;
    const loader = document.getElementById('artistLoader');
    if (loader) loader.style.display = 'block';
    try {
        const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(artistName)}&limit=${artistSearchState.limit}&offset=${artistSearchState.offset}`);
        const data = await response.json();
        const rawTracks = (data.tracks || []).filter(t => (t.artist_name || t.artist || '').trim() !== 'YT Music Artist');
        let artistTracks = rawTracks.filter(t => {
            const trackArtist = (t.artist_name || t.artist || '').toLowerCase();
            const targetArtist = artistName.toLowerCase();
            return trackArtist.includes(targetArtist) || targetArtist.includes(trackArtist);
        });
        if (!append && artistTracks.length === 0 && rawTracks.length > 0) {
            artistTracks = rawTracks.slice(0, 20);
        }
        if (rawTracks.length < artistSearchState.limit) {
            artistSearchState.hasMore = false;
        }
        const artwork = artistTracks.length > 0 ? (artistTracks[0].local_artwork || getProxyUrl(artistTracks[0].artwork_url)) : null;
        if (!append) {
            const header = document.querySelector('#dynamicView .hero-header');
            if (header && artwork) {
                header.style.background = `linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, var(--bg-elevated) 100%), url('${artwork}')`;
                header.style.backgroundSize = 'cover';
                header.style.backgroundPosition = 'center';
                const imgContainer = header.querySelector('.artist-img');
                if (imgContainer) {
                    imgContainer.innerHTML = `<img src="${artwork}">`;
                }
            }
            currentDynamicPlaylist = [];
        }
        const list = document.getElementById('dynamicList');
        const startIdx = currentDynamicPlaylist.length;
        currentDynamicPlaylist.push(...artistTracks);
        if (artistTracks.length === 0 && !append) {
            list.innerHTML = '<div style="padding: 40px 0; text-align: center; opacity: 0.5;">No tracks found for this artist.</div>';
        } else {
            artistTracks.forEach((track, index) => {
                list.appendChild(createTrackRow(track, startIdx + index, currentDynamicPlaylist, true));
            });
            observeImages(list);
            silentPreloadDurations(artistTracks);
        }
        const countEl = document.getElementById('artistTrackCount');
        if (countEl) countEl.textContent = `${currentDynamicPlaylist.length} tracks found`;
        artistSearchState.offset += artistSearchState.limit;
        artistSearchState.loading = false;
        if (loader) loader.style.display = 'none';
    } catch (e) {
        console.error("Error loading artist view:", e);
        artistSearchState.loading = false;
        if (loader) loader.style.display = 'none';
        if (!append) {
            document.getElementById('dynamicView').innerHTML = `<div style="padding: 40px 0; text-align: center; color: #ef4444;">Failed to load artist data.</div>`;
        }
    }
}
function setGreeting() {
    const hour = new Date().getHours();
    let greeting = 'Good evening';
    if (hour >= 5 && hour < 12) greeting = 'Good morning';
    else if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    const el = document.getElementById('greetingText');
    if (el) el.textContent = greeting;
}
async function loadPopularTracks() {
    const grid = document.getElementById('popularTracks');
    if (!grid) return null;
    try {
        const query = "Travis Scott 2025";
        const response = await fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(query)}&limit=12`);
        const data = await response.json();
        if (data.tracks) {
            const filteredTracks = data.tracks.filter(t => (t.artist_name || t.artist || '').trim() !== 'YT Music Artist').slice(0, 12);
            renderTrackGrid(filteredTracks, grid);
            observeImages(grid);
            return filteredTracks;
        }
    } catch (e) { console.error('Failed to load popular tracks', e); }
    return null;
}
let searchState = { query: '', tracksOffset: 0, loading: false, hasMoreTracks: true, limit: 24 };
async function handleSearch(query, append = false, forcedOffset = null) {
    const resultsDiv = document.getElementById('searchResults');
    const categoriesDiv = document.getElementById('browseCategories');
    const tracksGrid = document.getElementById('searchGrid');
    const loader = document.getElementById('searchLoader');
    const pagination = document.getElementById('searchPagination');
    const prevBtn = document.getElementById('prevPageBtn');
    const nextBtn = document.getElementById('nextPageBtn');
    if (!query || query.trim() === '') {
        if (resultsDiv) resultsDiv.classList.add('hidden');
        if (categoriesDiv) categoriesDiv.classList.remove('hidden');
        if (loader) loader.classList.add('hidden');
        if (pagination) {
            pagination.classList.add('hidden');
            pagination.style.display = 'none';
        }
        searchState.query = '';
        return;
    }
    if (!append || query !== searchState.query) {
        const startAt = (forcedOffset !== null) ? forcedOffset : 0;
        searchState = { query: query, tracksOffset: startAt, loading: false, hasMoreTracks: true, limit: 25 };
        currentSearchResults = [];
        if (tracksGrid) tracksGrid.innerHTML = '';
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
        const newTracks = (data.tracks || []).filter(t => (t.artist_name || t.artist || '').trim() !== 'YT Music Artist');
        currentSearchResults.push(...newTracks);
        if (!append && tracksGrid) tracksGrid.innerHTML = '';
        if (tracksGrid && newTracks.length > 0) {
            const filteredTracks = newTracks.filter(track => {
                const trackUid = getTrackUid(track);
                return !Array.from(tracksGrid.querySelectorAll('.track-card')).some(card => card.dataset.uid === trackUid);
            });
            renderTrackGrid(filteredTracks, tracksGrid, currentSearchResults);
            observeImages(tracksGrid);
        } else if (!append && tracksGrid) {
            tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-gray-500">No tracks found for this query.</div>';
        }
        searchState.tracksOffset += newTracks.length;
        searchState.hasMoreTracks = newTracks.length === searchState.limit && newTracks.length > 0;
        if (pagination) {
            if (newTracks.length > 0 || searchState.tracksOffset > 0) {
                pagination.classList.remove('hidden');
                pagination.style.display = 'flex';
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
                pagination.style.display = 'none';
            }
        }
    } catch (e) {
        console.error('Search failed', e);
        if (!append && tracksGrid) tracksGrid.innerHTML = '<div class="col-span-full py-20 text-center text-red-500">Failed to load search results.</div>';
    } finally {
        searchState.loading = false;
        if (loader) loader.classList.add('hidden');
    }
}
async function searchNextPage() {
    if (searchState.loading || !searchState.hasMoreTracks) return;
    handleSearch(searchState.query, false, searchState.tracksOffset);
    document.querySelector('.main-view')?.scrollTo({ top: 0, behavior: 'smooth' });
}
async function searchPrevPage() {
    if (searchState.loading || searchState.tracksOffset <= searchState.limit) return;
    const target = searchState.tracksOffset - (searchState.limit * 2);
    handleSearch(searchState.query, false, Math.max(0, target));
    document.querySelector('.main-view')?.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderTrackGrid(tracks, container, parentList = null) {
    if (!container) return;
    const isSearchView = container.id === 'searchGrid';
    const isHomeView = container.id === 'popularTracks';
    
    tracks.forEach((track) => {
        // Filter out undesirable artists
        const artist = (track.artist_name || track.artist || '').trim();
        if (artist === 'YT Music Artist') return;

        const trackUid = getTrackUid(track);
        const card = document.createElement('div');
        card.className = 'track-card';
        card.dataset.uid = trackUid;
        const artworkUrl = track.local_artwork || getProxyUrl(track.artwork_url);
        card.innerHTML = `
            <div style="position: relative; overflow: hidden; margin-bottom: 16px;">
                <img data-src="${artworkUrl}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="card-thumb" loading="lazy" style="margin-bottom: 0;">
                ${(isSearchView || isHomeView) ? '' : `
                <button class="card-plus-btn" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6); border: none; border-radius: 50% !important; width: 30px; height: 30px; color: #fff; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.2s; cursor: pointer;" title="Add to Playlist">
                    <i class="fa-solid fa-plus" style="font-size: 14px;"></i>
                </button>
                `}
            </div>
            <div class="card-title">${escapeHtml(track.title)}</div>
            <div class="card-subtitle" onclick="event.stopPropagation(); loadArtistView('${escapeHtml(track.artist_name || '').replace(/'/g, "\\'")}')">${escapeHtml(track.artist_name)}</div>
        `;
        
        const plusBtn = card.querySelector('.card-plus-btn');
        if (plusBtn) {
            plusBtn.onclick = (e) => { e.stopPropagation(); showAddToPlaylistModal(track); };
            card.onmouseenter = () => { plusBtn.style.opacity = '1'; };
            card.onmouseleave = () => { plusBtn.style.opacity = '0'; };
        }

        card.addEventListener('click', () => {
            if (container.id === 'searchGrid') {
                playlist = [...currentSearchResults];
                originalPlaylist = [...currentSearchResults];
            } else if (parentList) {
                playlist = parentList;
                originalPlaylist = [...parentList];
            } else {
                playlist = tracks;
                originalPlaylist = [...tracks];
            }
            
            const freshIndex = playlist.findIndex(t => getTrackUid(t) === trackUid);
            if (freshIndex > -1) {
                currentIndex = freshIndex;
                playTrack(currentIndex);
            }
        });
        container.appendChild(card);
    });
    observeImages(container);
}

function renderBrowseCategories() {
    const grid = document.getElementById('categoriesGrid');
    if (!grid) return;
    
    const categories = [
        { title: 'Pop', color: '#E13300', icon: 'fa-music' },
        { title: 'Hip-Hop', color: '#1E3264', icon: 'fa-microphone' },
        { title: 'Rock', color: '#E91429', icon: 'fa-guitar' },
        { title: 'Latin', color: '#E1118C', icon: 'fa-fire' },
        { title: 'Dance/Electronic', color: '#D84000', icon: 'fa-bolt' },
        { title: 'R&B', color: '#DC148C', icon: 'fa-heart' },
        { title: 'Indie', color: '#608108', icon: 'fa-leaf' },
        { title: 'Country', color: '#D84000', icon: 'fa-hat-cowboy' }
    ];
    
    grid.innerHTML = '';
    categories.forEach(cat => {
        const card = document.createElement('div');
        card.className = 'category-card';
        card.style.backgroundColor = cat.color;
        card.innerHTML = `
            <span class="category-title">${cat.title}</span>
            <i class="fa-solid ${cat.icon} category-icon"></i>
        `;
        card.onclick = () => {
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = cat.title;
                handleSearch(cat.title);
            }
        };
        grid.appendChild(card);
    });
}
function renderPlaylistGrid(playlistsData, container) {
    if (!container) return;
    container.innerHTML = '';
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
    container.innerHTML = '<div class="py-20 flex justify-center"><i class="fa-solid fa-circle-notch fa-spin text-3xl"></i></div>';
    try {
        const response = await fetch(`${API_BASE_URL}/playlist/${playlistId}`);
        const data = await response.json();
        container.innerHTML = `
            <header class="hero-header" style="background: linear-gradient(to bottom, #4f46e5 0%, var(--bg-elevated) 100%);">
                <div class="artist-img" style="border-radius: 0% !important;">
                    <img src="${getProxyUrl(data.artwork_url)}">
                </div>
                <div class="hero-meta">
                    <h1 class="artist-header">${escapeHtml(data.name)}</h1>
                    <div class="monthly-listeners">${escapeHtml(data.description || 'Official Playlist')}</div>
                    <div class="monthly-listeners" style="margin-top: 4px; font-weight: bold;">${data.song_count} songs</div>
                </div>
            </header>
            <div class="action-bar">
                <button class="btn-play-large" onclick="playAllFromDynamic()"><i class="fa-solid fa-play" style="margin-left: 4px;"></i></button>
            </div>
            <div class="track-section">
                <div class="track-grid" id="dynamicList"></div>
            </div>
        `;
        const list = document.getElementById('dynamicList');
        data.tracks.forEach((track, index) => list.appendChild(createTrackRow(track, index, data.tracks, true)));
        currentDynamicPlaylist = data.tracks;
    } catch (e) { console.error('Failed to load playlist details', e); }
}
function renderFavorites() {
    const list = document.getElementById('favoritesList');
    const count = document.getElementById('likedSongsCount');
    if (count) count.textContent = `${favorites.length} songs`;
    if (favorites.length === 0) {
        list.innerHTML = '<div style="padding: 40px 0; text-align: center; opacity: 0.5;">Your liked songs will appear here.</div>';
        return;
    }
    list.innerHTML = '';
    favorites.forEach((track, index) => list.appendChild(createTrackRow(track, index, favorites, true, 'favorites')));
    observeImages(list);
}
function createTrackRow(track, index, trackList, hideEllipsis = false, playlistId = null) {
    const div = document.createElement('div');
    const trackUid = getTrackUid(track);
    const isCurrentlyPlaying = currentTrack && getTrackUid(currentTrack) === trackUid;
    
    div.className = 'track-row' + (isCurrentlyPlaying ? ' is-playing' : '') + (isCurrentlyPlaying && !isPlaying ? ' paused' : '');
    div.dataset.trackUid = trackUid;
    let durationSec = 0;
    if (track.duration) durationSec = track.duration > 10000 ? track.duration / 1000 : track.duration;
    else if (track.duration_seconds) durationSec = track.duration_seconds;
    
    const isPlaylistView = playlistId !== null;
    const isSearchView = document.getElementById('searchView')?.classList.contains('active');

    div.innerHTML = `
        <div class="track-num-col">
            <span class="row-num">${index + 1}</span>
            <i class="fa-solid fa-play row-play"></i>
        </div>
        <div class="track-info">
            <div style="position: relative; width: 40px; height: 40px; flex-shrink: 0;">
                <img data-src="${track.local_artwork || getProxyUrl(track.artwork_url)}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" class="track-thumb" style="width: 100%; height: 100%;">
                <div class="playing-bars" style="z-index: 6;"><div></div><div></div><div></div></div>
            </div>
            <div class="track-name-stack">
                <span class="track-name">${escapeHtml(track.title)}</span>
                <span class="np-artist" onclick="event.stopPropagation(); loadArtistView('${escapeHtml(track.artist_name || '').replace(/'/g, "\\'")}')">${escapeHtml(track.artist_name)}</span>
            </div>
        </div>
        <div class="track-album">${escapeHtml(track.album_name || track.album || '')}</div>
        <div class="track-plus-col" style="display: flex; align-items: center; gap: 12px; justify-content: flex-end;">
            <button class="track-heart-btn" title="Like Song">
                <i class="fa-regular fa-heart"></i>
            </button>
            ${(isPlaylistView && playlistId !== 'favorites') ? `
            <button class="row-action-btn" style="background: none; border: none; color: var(--text-subdued); cursor: pointer; opacity: 0; transition: opacity 0.2s;" title="Remove from Playlist">
                <i class="fa-solid fa-trash" style="color: #ef4444;"></i>
            </button>
            ` : (isPlaylistView ? `
            <button class="row-action-btn" style="background: none; border: none; color: var(--text-subdued); cursor: pointer; opacity: 0; transition: opacity 0.2s;" title="Add to Playlist">
                <i class="fa-solid fa-plus"></i>
            </button>
            ` : '')}
        </div>
        <div class="track-duration">${formatTime(durationSec)}</div>
    `;

    const heartBtn = div.querySelector('.track-heart-btn');
    if (heartBtn) {
        const isLiked = favorites.some(f => getTrackUid(f) === trackUid);
        if (isLiked) {
            heartBtn.classList.add('active');
            heartBtn.innerHTML = '<i class="fa-solid fa-heart"></i>';
        }
        heartBtn.onclick = (e) => {
            e.stopPropagation();
            window.toggleLikeTrack(track, heartBtn);
        };
    }

    const actionBtn = div.querySelector('.row-action-btn');
    if (actionBtn) {
        actionBtn.onclick = (e) => { 
            e.stopPropagation(); 
            if (isPlaylistView && playlistId !== 'favorites') {
                removeFromPlaylist(trackUid, playlistId);
            } else {
                showAddToPlaylistModal(track); 
            }
        };
    }

    div.addEventListener('click', (e) => {
        if (e.target.closest('.np-artist') || e.target.closest('.row-action-btn')) return;
        playlist = trackList;
        originalPlaylist = [...trackList];
        
        const freshIndex = playlist.findIndex(t => getTrackUid(t) === trackUid);
        const isCurrent = currentTrack && getTrackUid(currentTrack) === trackUid;
        if (isCurrent) {
            togglePlayPause();
        } else {
            playTrack(freshIndex > -1 ? freshIndex : index);
        }
    });
    return div;
}

function removeFromPlaylist(trackUid, playlistId) {
    if (playlistId === 'favorites') {
        const track = favorites.find(t => getTrackUid(t) === trackUid);
        if (track) window.toggleLikeTrack(track);
        return;
    }
    const plIndex = playlists.findIndex(p => p.id.toString() === playlistId.toString());
    if (plIndex > -1) {
        playlists[plIndex].tracks = playlists[plIndex].tracks.filter(t => getTrackUid(t) !== trackUid);
        saveLibraryData();
        renderSidebarPlaylists();
        renderLibrary();
        loadPlaylistView(playlistId);
        showToast('Removed from playlist', 'info');
    }
}
let activeSource = 'youtube';
function setPlaybackLoading(isLoading) {
    const pbControls = document.getElementById('playbackControls');
    const pbLoading = document.getElementById('playbackLoading');
    if (isLoading) {
        if (pbControls) pbControls.classList.add('hidden');
        if (pbLoading) pbLoading.classList.remove('hidden');
    } else {
        if (pbControls) pbControls.classList.remove('hidden');
        if (pbLoading) pbLoading.classList.add('hidden');
    }
}

async function playTrack(index) {
    currentIndex = index;
    currentTrack = playlist[currentIndex];
    
    // Clear current lyrics UI and state immediately
    parsedLyrics = [];
    const panelContent = document.getElementById('panelContent');
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    const loadingHtml = '<div class="py-10 text-center"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
    if (panelContent && currentPanel === 'lyrics') panelContent.innerHTML = loadingHtml;
    if (fsLyrics) fsLyrics.innerHTML = loadingHtml;

    // Show loading state in bottom bar
    setPlaybackLoading(true);

    if (isShuffle) {
        const sIndex = shuffledIndices.indexOf(index);
        if (sIndex > -1) shuffledCurrentIndex = sIndex;
        else generateShuffledSequence();
    }
    
    document.querySelectorAll('.track-row').forEach(row => {
        const isCurrent = row.dataset.trackUid === getTrackUid(currentTrack);
        row.classList.toggle('is-playing', isCurrent);
        if (isCurrent) {
            row.classList.toggle('paused', !isPlaying);
        } else {
            row.classList.remove('paused');
        }
    });

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
    if (document.getElementById('fsPlayer').style.display === 'flex') updateFullscreenUI();
    
    // Background fetch lyrics
    fetchLyrics();
    
    if (window.currentPanel === 'queue') renderQueue();
    document.getElementById('progressBarFill').style.width = '0%';
    document.getElementById('currentTimeLabel').textContent = '0:00';
    document.getElementById('durationLabel').textContent = '0:00';
    
    let preloaded = null;
    const currentUid = getTrackUid(currentTrack);
    if (preloadedNextTrack && preloadedNextTrack.uid === currentUid) preloaded = preloadedNextTrack;
    else if (preloadedPrevTrack && preloadedPrevTrack.uid === currentUid) preloaded = preloadedPrevTrack;
    
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
    } catch (e) { console.error('Failed to get video ID', e); setPlaybackLoading(false); }
}
function loadAudioPlayer(url) {
    activeSource = 'audio';
    if (player && typeof player.pauseVideo === 'function') player.pauseVideo();
    let audio = document.getElementById('nativeAudio');
    if (!audio) {
        audio = document.createElement('audio'); audio.id = 'nativeAudio';
        document.getElementById('audioElement').appendChild(audio);
        
        audio.addEventListener('playing', () => { 
            isPlaying = true; 
            updatePlayPauseUI(); 
            startProgressUpdate(); 
            setPlaybackLoading(false);
        });
        audio.addEventListener('pause', () => { 
            isPlaying = false; 
            updatePlayPauseUI(); 
            stopProgressUpdate(); 
        });
        audio.addEventListener('waiting', () => setPlaybackLoading(true));
        audio.addEventListener('canplay', () => setPlaybackLoading(false));
        audio.addEventListener('ended', () => playNext());
        
        let errorCount = 0;
        audio.addEventListener('error', async () => {
            errorCount++;
            const currentUrl = audio.src || '';
            const isArgon = currentUrl.includes('argon');
            
            console.warn(`Audio playback error (attempt ${errorCount}) for ${currentUrl}`);
            
            // If it's Argon and it failed, skip retry and go straight to fallback
            if (errorCount === 1 && !isArgon) {
                console.log("Retrying audio fetch...");
                audio.load();
                audio.play().catch(e => {
                    if (e.name !== 'AbortError') console.warn("Retry play failed", e);
                });
                return;
            }
            
            if (currentTrack) {
                showToast("Direct audio failed, falling back to YouTube...", "info");
                const query = `${currentTrack.title} ${currentTrack.artist_name} official audio`;
                try {
                    const response = await fetch(`${API_BASE_URL}/youtube-search?q=${encodeURIComponent(query)}`);
                    const data = await response.json();
                    if (data.videoId) {
                        loadYouTubePlayer(data.videoId);
                    } else {
                        showToast("Playback failed: No YouTube alternative found.", "error");
                        setPlaybackLoading(false);
                    }
                } catch (e) { 
                    console.error('Fallback failed', e); 
                    showToast("Playback failed: Connection error.", "error");
                    setPlaybackLoading(false); 
                }
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
                updateLyricsSync(audio.currentTime);
            }
        });
    }
    audio.src = url;
    audio.volume = volume / 100;
    
    setPlaybackLoading(true);
    const loadTimeout = setTimeout(() => {
        if (audio.readyState < 2 && activeSource === 'audio') {
            console.warn("Audio loading timed out, triggering fallback...");
            audio.dispatchEvent(new Event('error'));
        }
    }, 15000);
    audio.oncanplay = () => { clearTimeout(loadTimeout); setPlaybackLoading(false); };
    
    const playPromise = audio.play();
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            if (error.name !== 'AbortError') {
                console.error('Playback failed:', error);
                setPlaybackLoading(false);
            }
        });
    }
}
function loadYouTubePlayer(videoId) {
    activeSource = 'youtube';
    if (currentTrack) {
        currentTrack.youtube_id = videoId;
        currentTrack.videoId = videoId;
    }
    let audio = document.getElementById('nativeAudio'); if (audio) audio.pause();
    if (window.YT && window.YT.Player) {
        if (player && typeof player.loadVideoById === 'function') { player.loadVideoById(videoId); player.playVideo(); }
        else {
            player = new YT.Player('audioElement', {
                height: '0', width: '0', videoId: videoId,
                playerVars: { autoplay: 1, controls: 0, disablekb: 1, origin: window.location.origin },
                events: { 
                    onReady: (e) => { 
                        e.target.setVolume(volume); 
                        e.target.playVideo(); 
                        const pbControls = document.getElementById('playbackControls');
                        const pbLoading = document.getElementById('playbackLoading');
                        if (pbControls) pbControls.classList.remove('hidden');
                        if (pbLoading) pbLoading.classList.add('hidden');
                    }, 
                    onStateChange: onPlayerStateChange 
                }
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
    if (event.data === YT.PlayerState.PLAYING) { 
        isPlaying = true; 
        updatePlayPauseUI(); 
        startProgressUpdate(); 
        setPlaybackLoading(false);
    }
    else if (event.data === YT.PlayerState.BUFFERING) {
        setPlaybackLoading(true);
    }
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
    const btn = document.getElementById('playPauseButton');
    if (btn) btn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left:2px;"></i>';
    const fsBtn = document.getElementById('fsPlayPause');
    if (fsBtn) fsBtn.innerHTML = isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play" style="margin-left:4px;"></i>';
    
    document.querySelectorAll('.track-row').forEach(row => {
        if (row.classList.contains('is-playing')) {
            row.classList.toggle('paused', !isPlaying);
        } else {
            row.classList.remove('paused');
        }
    });
}
function playNext() {
    if (playlist.length === 0) {
        closeFullscreenIfNoTrack();
        return;
    }
    if (repeatMode === 'one') { playTrack(currentIndex); return; }
    if (isShuffle) {
        shuffledCurrentIndex++;
        if (shuffledCurrentIndex >= shuffledIndices.length) {
            if (repeatMode === 'all') { generateShuffledSequence(); shuffledCurrentIndex = 0; }
            else {
                closeFullscreenIfNoTrack();
                return;
            }
        }
        playTrack(shuffledIndices[shuffledCurrentIndex]);
    } else {
        let nextIndex = (currentIndex + 1) % playlist.length;
        if (nextIndex === 0 && repeatMode !== 'all') {
            closeFullscreenIfNoTrack();
            return;
        }
        playTrack(nextIndex);
    }
}
function playPrev() {
    if (playlist.length === 0) {
        closeFullscreenIfNoTrack();
        return;
    }
    if (isShuffle) {
        if (shuffledCurrentIndex > 0) { shuffledCurrentIndex--; playTrack(shuffledIndices[shuffledCurrentIndex]); }
        else playTrack(currentIndex);
    } else {
        let prevIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
        playTrack(prevIndex);
    }
}
function toggleShuffle() {
    isShuffle = !isShuffle;
    document.getElementById('shuffleButton').classList.toggle('active', isShuffle);
    document.getElementById('fsShuffle').classList.toggle('active', isShuffle);
    if (isShuffle) generateShuffledSequence();
}
function cycleRepeat() {
    const modes = ['off', 'all', 'one'];
    repeatMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    const updateUI = (id, fontSize) => {
        const btn = document.getElementById(id); if (!btn) return;
        btn.classList.toggle('active', repeatMode !== 'off');
        btn.innerHTML = repeatMode === 'one' ? `<i class="fas fa-repeat"></i><span class="absolute text-[${fontSize}px] font-bold mt-1">1</span>` : '<i class="fas fa-repeat"></i>';
    };
    updateUI('repeatButton', 8); updateUI('fsRepeat', 10);
}
async function loadLibraryData() {
    try {
        if (window.VeliumDB) {
            const lib = await window.VeliumDB.getLibrary();
            favorites = lib.likedSongs || []; playlists = lib.playlists || [];
        } else {
            favorites = JSON.parse(localStorage.getItem('velium_v2_favorites')) || [];
            playlists = JSON.parse(localStorage.getItem('velium_v2_playlists')) || [];
        }
    } catch (e) { console.error("Error loading library", e); }
}
async function saveLibraryData() {
    try {
        if (window.VeliumDB) await window.VeliumDB.saveLibrary({ likedSongs: favorites, playlists: playlists });
        else {
            localStorage.setItem('velium_v2_favorites', JSON.stringify(favorites));
            localStorage.setItem('velium_v2_playlists', JSON.stringify(playlists));
        }
    } catch (e) { console.error("Error saving library", e); }
}
function saveToStorage(key, value) { localStorage.setItem(`velium_v2_${key}`, JSON.stringify(value)); }
window.toggleLikeTrack = async function(track, btnEl) {
    const trackUid = getTrackUid(track);
    const index = favorites.findIndex(t => getTrackUid(t) === trackUid);
    const isLiking = index === -1;
    
    const originalFavorites = [...favorites];
    
    if (isLiking) {
        favorites.push(track);
    } else {
        favorites.splice(index, 1);
    }

    try {
        await saveLibraryData();
        
        // UI Update after successful save
        updateLikeButtonStatus();
        renderSidebarPlaylists();
        if (document.getElementById('favoritesView').classList.contains('active')) renderFavorites();
        
        if (isLiking && track.artwork_url && !track.local_artwork) {
            const b64 = await urlToBase64(track.artwork_url);
            if (b64) {
                track.local_artwork = b64;
                const favIdx = favorites.findIndex(t => getTrackUid(t) === trackUid);
                if (favIdx > -1) favorites[favIdx].local_artwork = b64;
                await saveLibraryData();
            }
        }
    } catch (e) {
        console.error("Failed to save like state", e);
        favorites = originalFavorites; // Revert
        showToast('Failed to save like state', 'error');
    }
};
async function toggleLike() {
    if (!currentTrack) return;
    const btn = document.getElementById('likeButton');
    const fsBtn = document.getElementById('fsLike');
    await window.toggleLikeTrack(currentTrack, btn);
}
function updateLikeButtonStatus() {
    if (!currentTrack) return;
    const trackUid = getTrackUid(currentTrack);
    const isLiked = favorites.some(t => getTrackUid(t) === trackUid);
    
    // Bottom bar heart
    const btn = document.getElementById('likeButton');
    if (btn) {
        btn.innerHTML = isLiked ? '<i class="fa-solid fa-heart" style="color: #ef4444;"></i>' : '<i class="fa-regular fa-heart"></i>';
        btn.classList.toggle('active', isLiked);
    }
    
    // Fullscreen heart
    const fsBtn = document.getElementById('fsLike');
    if (fsBtn) {
        fsBtn.innerHTML = isLiked ? '<i class="fa-solid fa-heart" style="color: #ef4444;"></i>' : '<i class="fa-regular fa-heart"></i>';
        fsBtn.classList.toggle('active', isLiked);
    }

    // List row hearts
    document.querySelectorAll('.track-row').forEach(row => {
        const rowUid = row.dataset.trackUid;
        const heartBtn = row.querySelector('.track-heart-btn');
        if (heartBtn) {
            const rowIsLiked = favorites.some(t => getTrackUid(t) === rowUid);
            heartBtn.innerHTML = rowIsLiked ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>';
            heartBtn.classList.toggle('active', rowIsLiked);
        }
    });
}

function toggleFsLyrics() {
    const fsMain = document.querySelector('.fs-main');
    const toggleBtn = document.getElementById('fsLyricsToggle');
    if (!fsMain || !toggleBtn) return;
    
    const isHidden = fsMain.classList.toggle('lyrics-hidden');
    toggleBtn.classList.toggle('active', !isHidden);
    localStorage.setItem('velium_fs_lyrics_hidden', isHidden);
}
function renderSidebarPlaylists() {
    const container = document.getElementById('sidebar-playlists'); if (!container) return;
    container.innerHTML = '';
    
    // Liked Songs entry
    const likedItem = document.createElement('div');
    likedItem.className = 'playlist-item';
    likedItem.innerHTML = `
        <div class="pl-img" style="background: linear-gradient(135deg, #4f46e5, #7c3aed); display: flex; align-items: center; justify-content: center; border-radius: 4px;">
            <i class="fa-solid fa-heart" style="color: white; font-size: 16px;"></i>
        </div>
        <div class="pl-info">
            <div class="pl-name truncate" style="max-width: 140px;">Liked Songs</div>
            <div class="pl-type">Playlist • ${favorites.length} songs</div>
        </div>
    `;
    likedItem.onclick = () => switchView('favorites');
    container.appendChild(likedItem);

    playlists.forEach(pl => {
        // Skip any manual playlist that might be named "Liked Songs" to prevent duplicates
        if (pl.name === 'Liked Songs') return;

        const item = document.createElement('div');
        item.className = 'playlist-item';
        item.innerHTML = `
            <div class="pl-img" style="${pl.color ? `background: linear-gradient(135deg, ${pl.color}, var(--bg-highlight));` : ''}; border-radius: 4px; overflow: hidden;">${pl.cover_url ? `<img src="${getProxyUrl(pl.cover_url)}" style="width:100%; height:100%; object-fit: cover;">` : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background-color: var(--bg-highlight);"><i class="fa-solid fa-list" style="font-size:16px;"></i></div>`}</div>
            <div class="pl-info">
                <div class="pl-name truncate" style="max-width: 140px;">${escapeHtml(pl.name)}</div>
                <div class="pl-type">Playlist • ${pl.tracks.length} songs</div>
            </div>
        `;
        item.onclick = () => loadPlaylistView(pl.id);
        container.appendChild(item);
    });
}
function renderLibrary() {
    const container = document.getElementById('libraryContent'); if (!container) return;
    container.innerHTML = '';
    const likedCard = document.createElement('div');
    likedCard.className = 'track-card';
    likedCard.innerHTML = `
        <div class="card-thumb" style="background: linear-gradient(135deg, #4f46e5, #8b5cf6); display:flex; align-items:center; justify-content:center; color:#fff; font-size:48px;"><i class="fa-solid fa-heart"></i></div>
        <div class="card-title">Liked Songs</div>
        <div class="card-subtitle">Playlist • ${favorites.length} songs</div>
    `;
    likedCard.onclick = () => switchView('favorites');
    container.appendChild(likedCard);
    playlists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'track-card';
        card.innerHTML = `
            <div class="card-thumb" style="display:flex; align-items:center; justify-content:center;">
                ${pl.cover_url ? `<img src="${getProxyUrl(pl.cover_url)}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fa-solid fa-music" style="font-size:48px; color: var(--text-subdued); opacity:0.4;"></i>`}
            </div>
            <div class="card-title">${escapeHtml(pl.name)}</div>
            <div class="card-subtitle">Playlist • ${pl.tracks.length} songs</div>
        `;
        card.onclick = () => loadPlaylistView(pl.id);
        container.appendChild(card);
    });
}
async function loadPlaylistView(playlistId) {
    const pl = playlists.find(p => p.id === playlistId); if (!pl) return;
    artistSearchState.name = ''; // Clear artist search state when entering playlist view
    switchView('dynamic'); const container = document.getElementById('dynamicView');
    const playlistColor = pl.color || '#4f46e5';
    container.innerHTML = `
        <header class="hero-header" style="background: linear-gradient(to bottom, ${playlistColor} 0%, var(--bg-elevated) 100%);">
            <div class="artist-img playlist-art-container" style="border-radius: 0% !important; position: relative; overflow: hidden; cursor: pointer;" onclick="showPlaylistCoverUploadModal('${pl.id}')">
                ${pl.cover_url ? `<img src="${getProxyUrl(pl.cover_url)}" class="w-full h-full object-cover">` : `<div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%;"><i class="fa-solid fa-music"></i></div>`}
                <div class="art-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.3s ease;">
                    <i class="fas fa-camera text-white text-3xl"></i>
                </div>
            </div>
            <style>
                .playlist-art-container:hover .art-overlay { opacity: 1 !important; }
            </style>
            <div class="hero-meta">
                <h1 class="artist-header">${escapeHtml(pl.name)}</h1>
                <div class="monthly-listeners">${escapeHtml(pl.description || 'No description')}</div>
                <div class="monthly-listeners" style="margin-top: 4px; font-weight: bold;">${pl.tracks.length} songs</div>
            </div>
        </header>
        <div class="action-bar">
            <button class="btn-play-large" onclick="playAllFromDynamic()"><i class="fa-solid fa-play" style="margin-left: 4px;"></i></button>
            <button class="btn-follow" onclick="showEditPlaylistModal('${pl.id}')">Edit</button>
            <button class="btn-follow" style="border-color: #ef4444; color: #ef4444;" onclick="deletePlaylist('${pl.id}')">Delete</button>
        </div>
        <div class="track-section">
            <div class="track-grid" id="dynamicList"></div>
        </div>
    `;
    const list = document.getElementById('dynamicList');
    if (pl.tracks.length === 0) list.innerHTML = '<div style="padding: 40px 0; text-align: center; opacity: 0.5;">This playlist is empty. Add some songs!</div>';
    else {
        pl.tracks.forEach((track, index) => list.appendChild(createTrackRow(track, index, pl.tracks, true, pl.id)));
        observeImages(list);
    }
    currentDynamicPlaylist = pl.tracks;
}
let currentDynamicPlaylist = [];
function playAllFromDynamic() { if (currentDynamicPlaylist.length > 0) { playlist = currentDynamicPlaylist; originalPlaylist = [...currentDynamicPlaylist]; preloadedNextTrack = null; playTrack(0); } }
function playAllFavorites() { if (favorites.length > 0) { playlist = favorites; originalPlaylist = [...favorites]; preloadedNextTrack = null; playTrack(0); } }
function createPlaylist(name, description = '', cover_url = '', color = '#4f46e5') {
    const newPlaylist = { id: Date.now().toString(), name: name || 'My Playlist', description: description, tracks: [], cover_url: cover_url, color: color, createdAt: new Date().toISOString() };
    playlists.push(newPlaylist); saveLibraryData(); renderSidebarPlaylists(); renderLibrary(); return newPlaylist.id;
}
function updatePlaylist(playlistId, name, description, cover_url, color) {
    const plIndex = playlists.findIndex(p => p.id === playlistId);
    if (plIndex > -1) {
        playlists[plIndex].name = name;
        playlists[plIndex].description = description;
        playlists[plIndex].cover_url = cover_url;
        if (color) playlists[plIndex].color = color;
        saveLibraryData(); renderSidebarPlaylists(); renderLibrary();
        if (document.getElementById('dynamicView').classList.contains('active')) {
            loadPlaylistView(playlistId);
        }
        return true;
    }
    return false;
}
function deletePlaylist(playlistId) {
    if (confirm('Are you sure you want to delete this playlist?')) {
        playlists = playlists.filter(pl => pl.id !== playlistId);
        saveLibraryData(); renderSidebarPlaylists(); renderLibrary();
        switchView('home');
    }
}
function showCreatePlaylistModal() { 
    document.getElementById('createPlaylistModal').style.display = 'flex'; 
    document.getElementById('playlistNameInput').value = ''; 
    document.getElementById('playlistDescInput').value = ''; 
    document.getElementById('createPlaylistColor').value = '#4f46e5';
    renderColorPicker('createPlaylistColorPicker', 'createPlaylistColor', 'createPlaylistColorHex', '#4f46e5', null);
}
function hideCreatePlaylistModal() { document.getElementById('createPlaylistModal').style.display = 'none'; }
function showEditPlaylistModal(playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const modal = document.getElementById('editPlaylistModal');
    modal.style.display = 'flex';
    document.getElementById('editPlaylistId').value = pl.id;
    document.getElementById('editPlaylistNameInput').value = pl.name;
    document.getElementById('editPlaylistDescInput').value = pl.description;
    document.getElementById('editPlaylistColor').value = pl.color || '#4f46e5';
    
    const artPreview = document.getElementById('editPlaylistArtPreview');
    const artPlaceholder = document.getElementById('editPlaylistArtPlaceholder');
    const removeBtn = document.getElementById('removeArtBtn');
    
    if (pl.cover_url) {
        artPreview.src = pl.cover_url;
        artPreview.style.display = 'block';
        artPlaceholder.style.display = 'none';
        removeBtn.classList.add('show');
    } else {
        artPreview.src = '';
        artPreview.style.display = 'none';
        artPlaceholder.style.display = 'flex';
        removeBtn.classList.remove('show');
    }
    
    renderColorPicker('editPlaylistColorPicker', 'editPlaylistColor', 'editPlaylistColorHex', pl.color || '#4f46e5', pl.cover_url);
}
function hideEditPlaylistModal() { document.getElementById('editPlaylistModal').style.display = 'none'; }
async function confirmEditPlaylist() {
    const id = document.getElementById('editPlaylistId').value;
    const name = document.getElementById('editPlaylistNameInput').value.trim();
    const desc = document.getElementById('editPlaylistDescInput').value.trim();
    const color = document.getElementById('editPlaylistColor').value;
    const artPreview = document.getElementById('editPlaylistArtPreview');
    const cover_url = artPreview.style.display === 'block' ? artPreview.src : '';
    
    if (name) {
        updatePlaylist(id, name, desc, cover_url, color);
        hideEditPlaylistModal();
    }
}

function renderColorPicker(containerId, hiddenInputId, hexInputId, activeColor, imageUrl, customColor = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    
    const defaultColors = ['#4f46e5', '#ef4444', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];
    if (customColor && !defaultColors.includes(customColor)) {
        defaultColors.unshift(customColor);
    }
    
    const hexInput = document.getElementById(hexInputId);
    if (hexInput) {
        hexInput.value = activeColor.toUpperCase();
        hexInput.oninput = (e) => {
            let val = e.target.value.trim();
            if (val && !val.startsWith('#')) val = '#' + val;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                document.getElementById(hiddenInputId).value = val;
                container.querySelectorAll('.color-option').forEach(el => {
                    const bg = el.style.backgroundColor;
                    if (bg) {
                        const rgbMatch = bg.match(/\d+/g);
                        if (rgbMatch) {
                            const r = parseInt(rgbMatch[0]), g = parseInt(rgbMatch[1]), b = parseInt(rgbMatch[2]);
                            const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
                            if (hex.toLowerCase() === val.toLowerCase()) el.classList.add('active');
                            else el.classList.remove('active');
                        }
                    }
                });
            }
        };
    }

    const render = (allColors) => {
        container.innerHTML = '';
        const uniqueColors = [...new Set(allColors)];
        uniqueColors.forEach(color => {
            const opt = document.createElement('div');
            opt.className = 'color-option' + (color.toLowerCase() === activeColor.toLowerCase() ? ' active' : '');
            opt.style.backgroundColor = color;
            opt.onclick = () => {
                container.querySelectorAll('.color-option').forEach(el => el.classList.remove('active'));
                opt.classList.add('active');
                document.getElementById(hiddenInputId).value = color;
                if (hexInput) hexInput.value = color.toUpperCase();
            };
            container.appendChild(opt);
        });

        // Add custom color option element
        const customOpt = document.createElement('div');
        customOpt.className = 'color-option custom-picker-btn' + (customColor && activeColor.toLowerCase() === customColor.toLowerCase() ? ' active' : '');
        customOpt.style.position = 'relative';
        if (customColor) {
            customOpt.style.background = customColor;
        } else {
            customOpt.style.background = 'linear-gradient(45deg, red, orange, yellow, green, blue, indigo, violet)';
        }
        customOpt.style.display = 'flex';
        customOpt.style.alignItems = 'center';
        customOpt.style.justifyContent = 'center';
        customOpt.innerHTML = '<i class="fa-solid fa-plus" style="font-size: 12px; color: #fff; pointer-events: none;"></i>';
        
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.style.position = 'absolute';
        colorInput.style.opacity = '0';
        colorInput.style.width = '100%';
        colorInput.style.height = '100%';
        colorInput.style.cursor = 'pointer';
        colorInput.value = activeColor.startsWith('#') && activeColor.length === 7 ? activeColor : '#ffffff';
        
        colorInput.oninput = (e) => {
            const customVal = e.target.value;
            document.getElementById(hiddenInputId).value = customVal;
            if (hexInput) hexInput.value = customVal.toUpperCase();
            customOpt.style.background = customVal;
            container.querySelectorAll('.color-option').forEach(el => {
                if (el !== customOpt) el.classList.remove('active');
            });
            customOpt.classList.add('active');
        };

        colorInput.onchange = (e) => {
            const customVal = e.target.value;
            renderColorPicker(containerId, hiddenInputId, hexInputId, customVal, imageUrl, customVal);
        };

        customOpt.appendChild(colorInput);
        container.appendChild(customOpt);
    };

    if (imageUrl) {
        sampleColorsFromImage(imageUrl).then(sampled => {
            render([...sampled, ...defaultColors]);
        });
    } else {
        render(defaultColors);
    }
}

async function sampleColorsFromImage(url) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 50; canvas.height = 50;
            ctx.drawImage(img, 0, 0, 50, 50);
            const data = ctx.getImageData(0, 0, 50, 50).data;
            const colorCounts = {};
            for (let i = 0; i < data.length; i += 20) { 
                const r = data[i], g = data[i+1], b = data[i+2];
                const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
                colorCounts[hex] = (colorCounts[hex] || 0) + 1;
            }
            const sorted = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
            resolve(sorted.slice(0, 5).map(e => e[0]));
        };
        img.onerror = () => resolve([]);
    });
}

window.removePlaylistArt = function() {
    const artPreview = document.getElementById('editPlaylistArtPreview');
    const artPlaceholder = document.getElementById('editPlaylistArtPlaceholder');
    const removeBtn = document.getElementById('removeArtBtn');
    artPreview.src = '';
    artPreview.style.display = 'none';
    artPlaceholder.style.display = 'flex';
    removeBtn.classList.remove('show');
    renderColorPicker('editPlaylistColorPicker', 'editPlaylistColor', 'editPlaylistColorHex', document.getElementById('editPlaylistColor').value, null);
};
function showAddToPlaylistModal(track) {
    if (!track) track = currentTrack;
    if (!track) {
        showToast('Select a track first', 'info');
        return;
    }
    const modal = document.getElementById('addToPlaylistModal');
    const list = document.getElementById('playlistSelectionList');
    if (!modal || !list) return;
    list.innerHTML = '';
    if (playlists.length === 0) {
        list.innerHTML = '<div class="py-4 text-center text-gray-500">No playlists found. Create one first!</div>';
    } else {
        playlists.forEach(pl => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            item.style.marginBottom = '8px';
            item.innerHTML = `
                <div class="pl-img" style="${pl.color ? `background: linear-gradient(135deg, ${pl.color}, var(--bg-highlight));` : ''} width: 40px; height: 40px; border-radius: 4px; overflow: hidden; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    ${pl.cover_url ? `<img src="${getProxyUrl(pl.cover_url)}" style="width: 100%; height: 100%; object-fit: cover;">` : `<i class="fas fa-list" style="color: #666;"></i>`}
                </div>
                <div class="pl-info" style="flex: 1; min-w: 0;">
                    <div class="pl-name" style="font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(pl.name)}</div>
                </div>
            `;
            item.onclick = () => addTrackToPlaylist(track, pl.id);
            list.appendChild(item);
        });
    }
    modal.style.display = 'flex';
}
function hideAddToPlaylistModal() {
    document.getElementById('addToPlaylistModal').style.display = 'none';
}
async function addTrackToPlaylist(track, playlistId) {
    const plIndex = playlists.findIndex(p => p.id.toString() === playlistId.toString());
    if (plIndex > -1) {
        const trackUid = getTrackUid(track);
        if (playlists[plIndex].tracks.some(t => getTrackUid(t) === trackUid)) {
            showToast('Already in playlist', 'info');
            hideAddToPlaylistModal();
            return;
        }

        // Deep clone track and ensure critical IDs are preserved
        const trackToSave = JSON.parse(JSON.stringify(track));
        
        // Lock in the UID as a stable_id to prevent any future mismatch
        trackToSave.stable_id = trackUid;
        
        let durationSec = 0;
        if (trackToSave.duration) durationSec = trackToSave.duration > 10000 ? trackToSave.duration / 1000 : trackToSave.duration;
        else if (trackToSave.duration_seconds) durationSec = trackToSave.duration_seconds;
        trackToSave.duration = durationSec;

        playlists[plIndex].tracks.push(trackToSave);
        await saveLibraryData();
        renderSidebarPlaylists();
        renderLibrary();
        
        // Refresh view if currently viewing this playlist
        if (document.getElementById('dynamicView').classList.contains('active')) {
            const currentHeader = document.querySelector('.artist-header');
            if (currentHeader && currentHeader.textContent === playlists[plIndex].name) {
                loadPlaylistView(playlistId);
            }
        }
        showToast('Added to playlist', 'success');
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
                cropState = {
                    x: cropperCanvas.width / 2,
                    y: cropperCanvas.height / 2,
                    radius: Math.min(cropperCanvas.width, cropperCanvas.height) / 3
                };
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
        if (id) {
            // Direct update
            const pl = playlists.find(p => p.id.toString() === id.toString());
            if (pl) {
                updatePlaylist(pl.id, pl.name, pl.description, base64, pl.color);
            }
            document.getElementById('uploadPlaylistId').value = '';
        } else {
            // Edit modal update
            const artPreview = document.getElementById('editPlaylistArtPreview');
            const artPlaceholder = document.getElementById('editPlaylistArtPlaceholder');
            const removeBtn = document.getElementById('removeArtBtn');
            
            if (artPreview) {
                artPreview.src = base64;
                artPreview.style.display = 'block';
                if (artPlaceholder) artPlaceholder.style.display = 'none';
                if (removeBtn) removeBtn.classList.add('show');
                renderColorPicker('editPlaylistColorPicker', 'editPlaylistColor', 'editPlaylistColorHex', document.getElementById('editPlaylistColor').value, base64);
            }
        }

        document.getElementById('cropperModal').style.display = 'none';
        document.getElementById('playlistCoverInput').value = '';
    });
    }
function showPlaylistCoverUploadModal(id) {
    document.getElementById('uploadPlaylistId').value = id;
    document.getElementById('playlistCoverInput').click();
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
                updateLyricsSync(current);
            }
        } else if (activeSource === 'audio') {
            const audio = document.getElementById('nativeAudio');
            if (audio) updateLyricsSync(audio.currentTime);
        }
    }, 250);
}
function stopProgressUpdate() { clearInterval(progressInterval); }
function updateVolumeUI() { const bar = document.getElementById('volumeBarFill'); if (bar) bar.style.width = volume + '%'; const slider = document.getElementById('volumeSlider'); if (slider) slider.value = volume; }
let parsedLyrics = [];
function parseLyrics(lyricsText, duration) {
    const lines = lyricsText.split('\n');
    const parsed = [];
    const timeRegex = /\[(\d+):(\d+)(?:\.(\d+))?\]/;
    let hasTimestamps = false;
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        const match = timeRegex.exec(line);
        if (match) {
            hasTimestamps = true;
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const ms = match[3] ? parseFloat('0.' + match[3]) : 0;
            const time = minutes * 60 + seconds + ms;
            const text = line.replace(timeRegex, '').trim();
            parsed.push({ time, text });
        } else {
            parsed.push({ time: null, text: line });
        }
    }
    if (!hasTimestamps && duration && duration > 0) {
        const total = parsed.length;
        parsed.forEach((item, index) => {
            item.time = (index / total) * duration;
        });
    }
    
    // Insert dots for long breaks
    const finalParsed = [];
    
    // Handle start wait
    if (parsed.length > 0 && parsed[0].time > 3) {
        finalParsed.push({ 
            time: 0, 
            endTime: parsed[0].time - 0.5,
            type: 'dots', 
            text: '...' 
        });
    }

    for (let i = 0; i < parsed.length; i++) {
        finalParsed.push(parsed[i]);
        if (i < parsed.length - 1 && parsed[i+1].time - parsed[i].time > 5) {
            finalParsed.push({ 
                time: parsed[i].time + 1, 
                endTime: parsed[i+1].time - 0.5,
                type: 'dots', 
                text: '...' 
            });
        }
    }
    return finalParsed;
}
function updateLyricsSync(currentTime) {
    if (!parsedLyrics || parsedLyrics.length === 0) return;
    
    // Add a small lead-in offset so lyrics change slightly before they are said
    const adjustedTime = currentTime + 0.3;
    
    let activeIndex = -1;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (adjustedTime >= parsedLyrics[i].time) {
            activeIndex = i;
        } else {
            break;
        }
    }
    if (activeIndex === -1) return;

    const updateUI = (container, isVisible) => {
        if (!container) return;
        const lines = container.querySelectorAll('.lyric-line');
        lines.forEach((line, index) => {
            if (index === activeIndex) {
                if (!line.classList.contains('active')) {
                    line.classList.add('active');
                    if (isVisible) {
                        line.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
                
                // Handle dots animation
                const dots = line.querySelector('.lyric-dots');
                if (dots) {
                    dots.classList.add('active');
                    const dotEls = dots.querySelectorAll('.lyric-dot');
                    const startTime = parsedLyrics[index].time;
                    const endTime = parsedLyrics[index].endTime;
                    const duration = endTime - startTime;
                    const progress = (adjustedTime - startTime) / duration;
                    
                    dotEls.forEach((dot, i) => {
                        const threshold = (i + 1) / 4; // 3 dots, 4 segments
                        if (progress > threshold) dot.classList.add('highlight');
                        else dot.classList.remove('highlight');
                    });
                }
            } else {
                line.classList.remove('active');
                const dots = line.querySelector('.lyric-dots');
                if (dots) dots.classList.remove('active');
            }
        });
    };

    const panelContent = document.getElementById('panelContent');
    const isLyricsPanel = currentPanel === 'lyrics';
    updateUI(panelContent, isLyricsPanel);

    const fsPlayer = document.getElementById('fsPlayer');
    const isFsVisible = fsPlayer && fsPlayer.style.display === 'flex';
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    updateUI(fsLyrics, isFsVisible);
}
function seekToLyrics(time) {
    if (time === null || time === undefined) return;
    if (activeSource === 'audio') {
        const audio = document.getElementById('nativeAudio');
        if (audio) audio.currentTime = time;
    } else if (player && typeof player.seekTo === 'function') {
        player.seekTo(time);
    }
}
async function fetchLyrics() {
    const panelContent = document.getElementById('panelContent');
    const fsLyrics = document.querySelector('.fs-lyrics-container');
    if (!currentTrack) {
        if (panelContent) panelContent.innerHTML = '<div class="py-10 text-center">No track playing</div>';
        return;
    }

    const playingWhenStarted = getTrackUid(currentTrack);
    const loadingHtml = '<div class="py-10 text-center"><i class="fa-solid fa-circle-notch fa-spin"></i></div>';
    if (panelContent && currentPanel === 'lyrics') panelContent.innerHTML = loadingHtml;
    if (fsLyrics) fsLyrics.innerHTML = loadingHtml;

    try {
        let lyricsText = null;
        let id = currentTrack.youtube_id || currentTrack.videoId;
        if (!id) {
            const query = `${currentTrack.title} ${currentTrack.artist_name}`;
            try {
                const searchRes = await fetch(`${API_BASE_URL}/youtube-search?q=${encodeURIComponent(query)}`);
                const searchData = await searchRes.json();
                if (searchData.videoId) {
                    id = searchData.videoId;
                    currentTrack.youtube_id = id;
                    currentTrack.videoId = id;
                }
            } catch (err) {
                console.error(err);
            }
        }
        if (!id) id = getTrackUid(currentTrack);

        const trackName = currentTrack.title;
        const artistName = currentTrack.artist_name;
        let durationSec = 0;
        if (currentTrack.duration) {
            durationSec = currentTrack.duration > 1000 ? currentTrack.duration / 1000 : currentTrack.duration;
        }

        if (getTrackUid(currentTrack) !== playingWhenStarted) return;

        const response = await fetch(`${API_BASE_URL}/lyrics/${id}?title=${encodeURIComponent(trackName)}&artist=${encodeURIComponent(artistName)}&duration=${Math.round(durationSec)}`);
        if (getTrackUid(currentTrack) !== playingWhenStarted) return;

        if (response.ok) {
            const data = await response.json();
            lyricsText = data.lyrics;
        }
        const fsMain = document.querySelector('.fs-main');
        if (lyricsText) {
            if (fsMain) fsMain.classList.remove('no-lyrics');
            let duration = currentTrack.duration || 0;
            if (!duration) {
                if (activeSource === 'audio') {
                    const audio = document.getElementById('nativeAudio');
                    if (audio) duration = audio.duration;
                } else if (player && typeof player.getDuration === 'function') {
                    duration = player.getDuration();
                }
            }
            parsedLyrics = parseLyrics(lyricsText, duration);
            const html = parsedLyrics.map(line => {
                if (line.type === 'dots') {
                    return `<div class="lyric-line" style="display: flex; justify-content: center; pointer-events: none;">
                        <div class="lyric-dots">
                            <div class="lyric-dot"></div>
                            <div class="lyric-dot"></div>
                            <div class="lyric-dot"></div>
                        </div>
                    </div>`;
                }
                if (line.time !== null && line.time !== undefined) {
                    return `<div class="lyric-line" onclick="seekToLyrics(${line.time})">${escapeHtml(line.text)}</div>`;
                } else {
                    return `<div class="lyric-line">${escapeHtml(line.text)}</div>`;
                }
            }).join('');
            if (panelContent && currentPanel === 'lyrics') panelContent.innerHTML = html;
            if (fsLyrics) fsLyrics.innerHTML = html;
        } else {
            if (fsMain) fsMain.classList.add('no-lyrics');
            parsedLyrics = [];
            const html = '<div class="py-10 text-center" style="opacity: 0.5;">No lyrics found for this track.</div>';
            if (panelContent && currentPanel === 'lyrics') panelContent.innerHTML = html;
            if (fsLyrics) fsLyrics.innerHTML = html;
        }
    } catch (e) {
        const fsMain = document.querySelector('.fs-main');
        if (fsMain) fsMain.classList.add('no-lyrics');
        parsedLyrics = [];
        const errHtml = '<div class="py-10 text-center" style="color: #ef4444;">Lyrics unavailable.</div>';
        if (panelContent && currentPanel === 'lyrics') panelContent.innerHTML = errHtml;
        if (fsLyrics) fsLyrics.innerHTML = errHtml;
    }
}
function renderQueue() {
    const panelContent = document.getElementById('panelContent');
    if (!panelContent) return;
    if (!currentTrack) {
        panelContent.innerHTML = '<div class="py-10 text-center">No track playing</div>';
        return;
    }
    let html = `
        <div style="font-weight: 700; margin-bottom: 12px; color: var(--text-main); font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6;">Now Playing</div>
        <div class="queue-item" style="border: none; margin-bottom: 24px; background: var(--bg-highlight); padding: 12px; border-radius: 8px;">
            <img src="${currentTrack.local_artwork || getProxyUrl(currentTrack.artwork_url)}" class="q-art" style="width: 48px; height: 48px; border-radius: 4px; object-fit: cover;">
            <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; margin-left: 12px;">
                <span style="font-weight: 700; color: var(--text-main); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(currentTrack.title)}</span>
                <span style="font-size: 12px; color: var(--text-subdued); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(currentTrack.artist_name)}</span>
            </div>
        </div>
        <div style="font-weight: 700; margin-bottom: 12px; color: var(--text-main); font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; opacity: 0.6;">Next In Queue</div>
    `;
    const upcoming = [];
    const maxItems = 15;
    let count = 0;
    if (isShuffle) {
        for (let i = shuffledCurrentIndex + 1; i < shuffledIndices.length && count < maxItems; i++) {
            upcoming.push(playlist[shuffledIndices[i]]);
            count++;
        }
    } else {
        for (let i = currentIndex + 1; i < playlist.length && count < maxItems; i++) {
            upcoming.push(playlist[i]);
            count++;
        }
    }
    if (upcoming.length === 0) {
        html += '<div class="py-4 text-center" style="font-size: 12px; opacity: 0.5;">Queue is empty.</div>';
    } else {
        upcoming.forEach((track) => {
            html += `
                <div class="queue-item" style="display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--divider);">
                    <img src="${track.local_artwork || getProxyUrl(track.artwork_url)}" class="q-art" style="width: 40px; height: 40px; border-radius: 4px; object-fit: cover;">
                    <div style="display: flex; flex-direction: column; min-width: 0; flex: 1; margin-left: 12px;">
                        <span style="font-weight: 700; color: var(--text-main); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(track.title)}</span>
                        <span style="font-size: 12px; color: var(--text-subdued); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(track.artist_name)}</span>
                    </div>
                </div>
            `;
        });
    }
    panelContent.innerHTML = html;
}
let currentPanel = null;
window.currentPanel = null;
function togglePanel(type) {
    const body = document.body;
    const panelTitle = document.getElementById('panelTitle');
    const btnLyrics = document.getElementById('btnLyrics');
    const btnQueue = document.getElementById('btnQueue');
    if (currentPanel === type) {
        closePanel();
        return;
    }
    
    currentPanel = type;
    window.currentPanel = type;

    if (btnLyrics) btnLyrics.classList.remove('active');
    if (btnQueue) btnQueue.classList.remove('active');
    
    if (type === 'lyrics') {
        if (panelTitle) panelTitle.innerText = "Lyrics";
        if (btnLyrics) btnLyrics.classList.add('active');
        fetchLyrics();
    } else if (type === 'queue') {
        if (panelTitle) panelTitle.innerText = "Next Up";
        if (btnQueue) btnQueue.classList.add('active');
        renderQueue();
    }
    body.classList.add('panel-active');
}
function closePanel() {
    const body = document.body;
    const btnLyrics = document.getElementById('btnLyrics');
    const btnQueue = document.getElementById('btnQueue');
    body.classList.remove('panel-active');
    currentPanel = null;
    window.currentPanel = null;
    if (btnLyrics) btnLyrics.classList.remove('active');
    if (btnQueue) btnQueue.classList.remove('active');
}
window.togglePanel = togglePanel;
window.closePanel = closePanel;
window.switchView = switchView;
window.showCreatePlaylistModal = showCreatePlaylistModal;
window.hideCreatePlaylistModal = hideCreatePlaylistModal;
window.showPlaylistCoverUploadModal = showPlaylistCoverUploadModal;
window.showEditPlaylistModal = showEditPlaylistModal;
window.confirmEditPlaylist = confirmEditPlaylist;
window.deletePlaylist = deletePlaylist;
window.playAllFromDynamic = playAllFromDynamic;
window.playAllFavorites = playAllFavorites;
window.toggleLike = toggleLike;
window.toggleShuffle = toggleShuffle;
window.playPrev = playPrev;
window.togglePlayPause = togglePlayPause;
window.playNext = playNext;
window.cycleRepeat = cycleRepeat;
window.seekToLyrics = seekToLyrics;

let openedTOSFromInfo = false;
function showInfoModal() {
    document.getElementById('infoModal').style.display = 'flex';
}
function hideInfoModal() {
    document.getElementById('infoModal').style.display = 'none';
}
function showTOSModal(fromInfo = false) {
    openedTOSFromInfo = fromInfo;
    document.getElementById('infoModal').style.display = 'none';
    document.getElementById('tosModal').style.display = 'flex';
}
function hideTOSModal() {
    document.getElementById('tosModal').style.display = 'none';
    if (openedTOSFromInfo) {
        document.getElementById('infoModal').style.display = 'flex';
        openedTOSFromInfo = false;
    }
}
window.showInfoModal = showInfoModal;
window.hideInfoModal = hideInfoModal;
window.showTOSModal = showTOSModal;
window.hideTOSModal = hideTOSModal;
