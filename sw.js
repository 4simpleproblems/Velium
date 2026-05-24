importScripts('v-proxy/uv.bundle.js');
importScripts('v-proxy/uv.config.js');
importScripts('baremux/index.js');

// Consistent SharedWorker worker path
const workerPath = location.origin + "/baremux/worker.js";
const connection = new BareMux.WorkerConnection(workerPath);
const bareClient = new BareMux.BareClient(connection);

importScripts(__uv$config.sw || 'v-proxy/uv.sw.js');

const uv = new UVServiceWorker();
uv.bareClient = bareClient;

// Sync port from main thread
self.addEventListener('message', (event) => {
    if (event.data && (event.data.type === 'baremuxinit' || event.data.type === 'baremuxready')) {
        const port = event.data.port || (event.ports && event.ports[0]);
        if (port) {
            connection.port = port;
            console.log("VELIUM SW: BareMux Port Synced (" + event.data.type + ")");
        }
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
            const isEncoded = url.includes('hvtrs8');
            const isMediaDomain = url.includes('saavncdn.com') || url.includes('soundcloud.com') || url.includes('sndcdn.com') || url.includes('fastly.net') || url.includes('googleusercontent.com') || url.includes('ggpht.com');
            
            let targetEvent = event;
            let shouldRoute = uv.route(event);

            if (!shouldRoute && (isEncoded || isMediaDomain)) {
                let encodedPart = "";
                if (isEncoded) {
                    encodedPart = url.split('hvtrs8')[1];
                    // Reconstruct with proper prefix
                    const fullProxyUrl = location.origin + prefix + 'hvtrs8' + encodedPart;
                    targetEvent = Object.assign(Object.create(event), { request: new Request(fullProxyUrl, event.request) });
                    shouldRoute = true;
                } else if (isMediaDomain) {
                    const encoded = "hvtrs8" + Ultraviolet.codec.xor.encode(url).split('hvtrs8')[1];
                    const fullProxyUrl = location.origin + prefix + encoded;
                    targetEvent = Object.assign(Object.create(event), { request: new Request(fullProxyUrl, event.request) });
                    shouldRoute = true;
                }
            }

            if (shouldRoute) {
                // Optimization: If it's an image or audio request, bypass UV's heavy processing
                // and fetch it directly through the Bare client for maximum speed.
                const unroutedUrl = uv.unroute(targetEvent);
                const isMedia = targetEvent.request.destination === 'image' || 
                                targetEvent.request.destination === 'audio' ||
                                (unroutedUrl && (unroutedUrl.includes('googleusercontent.com') || unroutedUrl.includes('ggpht.com') || unroutedUrl.match(/\.(mp3|wav|ogg|m4a|png|jpg|jpeg|webp|gif|svg)(\?|$)/i)));

                if (isMedia) {
                    try {
                        const headers = {};
                        for (const [k, v] of targetEvent.request.headers.entries()) {
                            headers[k] = v;
                        }
                        
                        // Add some basic headers if missing for specific domains
                        if (unroutedUrl.includes("soundcloud.com") || unroutedUrl.includes("sndcdn.com")) {
                            headers["origin"] = "https://soundcloud.com";
                            headers["referer"] = "https://soundcloud.com/";
                        }

                        const response = await bareClient.fetch(unroutedUrl, {
                            headers,
                            method: targetEvent.request.method,
                            body: targetEvent.request.method === 'GET' || targetEvent.request.method === 'HEAD' ? null : await targetEvent.request.clone().arrayBuffer(),
                            redirect: 'follow'
                        });
                        return response;
                    } catch (e) {
                        console.warn("Media direct fetch failed, falling back to UV:", e);
                    }
                }

                return await uv.fetch(targetEvent);
            }
            return await fetch(event.request);
        })()
    );
});
