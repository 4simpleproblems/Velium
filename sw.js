importScripts('v-proxy/uv.bundle.js');
importScripts('v-proxy/uv.config.js');
importScripts('baremux/index.js');

// Consistent SharedWorker worker path
const workerPath = "/baremux/worker.js";
let connection = new BareMux.WorkerConnection(workerPath);
let bareClient = new BareMux.BareClient(connection);

importScripts(__uv$config.sw || 'v-proxy/uv.sw.js');

const uv = new UVServiceWorker();
uv.bareClient = bareClient;

// Sync port from main thread or other clients
self.addEventListener('message', (event) => {
    if (event.data && (event.data.type === 'baremuxinit' || event.data.type === 'baremuxready')) {
        const path = event.data.path || workerPath;
        // Re-initialize to refresh connection
        connection = new BareMux.WorkerConnection(path);
        bareClient = new BareMux.BareClient(connection);
        uv.bareClient = bareClient;
        console.log("VELIUM SW: BareMux Connection Refreshed (" + event.data.type + ")");
    }
});

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    const url = event.request.url;
    const prefix = "/v-proxy/service/";

    event.respondWith(
        (async () => {
            // Auto-proxy certain domains or encoded URLs even if prefix is missing
            const isEncoded = url.includes('/hvtrs8');
            const isMediaDomain = url.includes('saavncdn.com') || url.includes('soundcloud.com') || url.includes('sndcdn.com') || url.includes('fastly.net') || url.includes('googleusercontent.com') || url.includes('ggpht.com') || url.includes('scdn.co') || url.includes('mzstatic.com') || url.includes('ytimg.com');
            
            let targetEvent = event;
            let shouldRoute = uv.route(event);

            if (!shouldRoute && (isEncoded || isMediaDomain)) {
                let encodedPart = "";
                if (isEncoded) {
                    encodedPart = url.split('hvtrs8')[1];
                    const fullProxyUrl = location.origin + prefix + 'hvtrs8' + encodedPart;
                    targetEvent = Object.create(event);
                    Object.defineProperty(targetEvent, 'request', { value: new Request(fullProxyUrl, event.request) });
                    shouldRoute = true;
                } else if (isMediaDomain) {
                    const encoded = "hvtrs8" + Ultraviolet.codec.xor.encode(url).split('hvtrs8')[1];
                    const fullProxyUrl = location.origin + prefix + encoded;
                    targetEvent = Object.create(event);
                    Object.defineProperty(targetEvent, 'request', { value: new Request(fullProxyUrl, event.request) });
                    shouldRoute = true;
                }
            }

            if (shouldRoute) {
                // Optimization: For music player needs (audio, images, text/json), 
                // we prioritize direct Bare fetching to bypass UV's DOM-heavy processing.
                
                let unroutedUrl = "";
                try {
                    if (targetEvent.request.url.includes('hvtrs8')) {
                        const encodedPart = targetEvent.request.url.split('hvtrs8')[1];
                        unroutedUrl = Ultraviolet.codec.xor.decode('hvtrs8' + encodedPart);
                    } else {
                        unroutedUrl = uv.unroute(targetEvent);
                    }
                } catch (e) {
                    try {
                        const ultraviolet = new self.Ultraviolet(__uv$config);
                        unroutedUrl = ultraviolet.sourceUrl(targetEvent.request.url);
                    } catch (e2) {}
                }

                // If we have a valid unrouted URL, and it's something we need (media or API data)
                if (unroutedUrl) {
                    const isMedia = targetEvent.request.destination === 'image' || 
                                    targetEvent.request.destination === 'audio' ||
                                    unroutedUrl.match(/\.(mp3|wav|ogg|m4a|png|jpg|jpeg|webp|gif|svg|json)(\?|$)/i) ||
                                    unroutedUrl.includes('googleusercontent.com') ||
                                    unroutedUrl.includes('saavncdn.com') ||
                                    unroutedUrl.includes('ytimg.com');

                    if (isMedia) {
                        try {
                            const headers = {};
                            for (const [k, v] of targetEvent.request.headers.entries()) {
                                headers[k] = v;
                            }
                            
                            // Domain-specific speed hacks/headers
                            if (unroutedUrl.includes("soundcloud.com") || unroutedUrl.includes("sndcdn.com")) {
                                headers["origin"] = "https://soundcloud.com";
                                headers["referer"] = "https://soundcloud.com/";
                            }
                            
                            if (unroutedUrl.includes("ytimg.com")) {
                                headers["referer"] = "https://www.youtube.com/";
                            }

                            // Use Bare client directly - much faster for media than full UV routing
                            let response = await bareClient.fetch(unroutedUrl, {
                                headers,
                                method: targetEvent.request.method,
                                body: targetEvent.request.method === 'GET' || targetEvent.request.method === 'HEAD' ? null : await targetEvent.request.clone().arrayBuffer(),
                                redirect: 'follow'
                            });
                            
                            if (response.ok || response.status === 304 || response.status === 206) {
                                return response;
                            }
                        } catch (mediaError) {
                            // Silently fallback to UV on error
                        }
                    }
                }

                // Fallback to standard UV fetch for everything else or if direct failed
                return await uv.fetch(targetEvent);
            }
            return await fetch(event.request);
        })()
    );
});
