# Velium

Velium is a premium, standalone music streaming platform featuring unblocked streaming capabilities. It is designed to work seamlessly anywhere, with an elegant obsidian dark-mode interface, customizable theme accents, offline library persistence, and advanced proxy integration.

## Features

- **High-Quality Audio Playback**: Implements search and playback via YouTube Music and native fallback audio streams.
- **Search Categories**: Search results split into tracks, albums, playlists, and artists.
- **Dynamic Recommendations**: Custom curated category grid running instant search queries on click.
- **Personalized Library**: Custom playlist creation, cover adjustment (built-in interactive cropper), and favoriting songs.
- **Interactive Audio Visualizer**: Elegant canvas wave visualizer driven by real-time Web Audio API frequency analysis (for native media) or dynamic procedural animation (for YouTube streams).
- **Theme Accents**: Choose custom interface themes (Obsidian, Midnight Violet, Sunset Amber, Emerald Green, Cyan) persisted across sessions.
- **Backup & Restore**: Easily export and import your playlist/favorites library data as JSON.
- **Unblocked Proxy Integration**: Integrates Ultraviolet and Bare Server proxy protocols to stream assets dynamically, bypassing network filters.

## Project Structure

- `index.html`: The main user interface, designed with a clean, grid-based layout and modern styling.
- `music.js`: Full player controller, settings panel management, backup handlers, and visualizer canvas drawing loop.
- `db.js`: IndexedDB wrapper for saving library data locally.
- `sw.js` / `uv.config.js`: Ultraviolet Service Worker routing configuration.
- `api/music-api.mjs`: Serverless Vercel function routing requests to YouTube Music, MusicAPI, and Argon APIs.
- `api/bare.mjs`: Bare-server Node.js proxy helper for assets.

## Deployment

Deploy directly on Vercel with one click. Ensure that serverless function limits and API rewrites in `vercel.json` are maintained.
