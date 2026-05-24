importScripts('uv/uv.bundle.js');
importScripts('uv/uv.config.js');
importScripts('baremux/index.js');
const workerPath = location.origin + "/baremux/worker.js";
const connection = new BareMux.WorkerConnection(workerPath);
const bareClient = new BareMux.BareClient(connection);
const ultraviolet = new self.Ultraviolet(__uv$config);
importScripts(__uv$config.sw || 'uv/uv.sw.js');
const uv = new UVServiceWorker();
uv.bareClient = bareClient;
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
    const prefix = "/uv/service/";
    event.respondWith(
        (async () => {
            const isEncoded = url.includes('hvtrs8');
            const isMediaDomain = url.includes('saavncdn.com') || url.includes('soundcloud.com') || url.includes('sndcdn.com') || url.includes('fastly.net');
            let targetEvent = event;
            let shouldRoute = uv.route(event);
            if (!shouldRoute && (isEncoded || isMediaDomain)) {
                let encodedPart = "";
                if (isEncoded) {
                    encodedPart = url.split('hvtrs8')[1];
                    const fullProxyUrl = location.origin + prefix + 'hvtrs8' + encodedPart;
                    const requestProxy = new Proxy(event.request, {
                        get(target, prop) {
                            if (prop === 'url') return fullProxyUrl;
                            const val = target[prop];
                            return typeof val === 'function' ? val.bind(target) : val;
                        }
                    });
                    targetEvent = Object.assign(Object.create(event), { request: requestProxy });
                    shouldRoute = true;
                } else if (isMediaDomain) {
                    const encoded = "hvtrs8" + Ultraviolet.codec.xor.encode(url).split('hvtrs8')[1];
                    const fullProxyUrl = location.origin + prefix + encoded;
                    const requestProxy = new Proxy(event.request, {
                        get(target, prop) {
                            if (prop === 'url') return fullProxyUrl;
                            const val = target[prop];
                            return typeof val === 'function' ? val.bind(target) : val;
                        }
                    });
                    targetEvent = Object.assign(Object.create(event), { request: requestProxy });
                    shouldRoute = true;
                }
            }
            if (shouldRoute) {
                const decodedUrl = decodeURIComponent(targetEvent.request.url);
                if (decodedUrl !== targetEvent.request.url) {
                    const requestProxy = new Proxy(targetEvent.request, {
                        get(target, prop) {
                            if (prop === 'url') return decodedUrl;
                            const val = target[prop];
                            return typeof val === 'function' ? val.bind(target) : val;
                        }
                    });
                    targetEvent = Object.assign(Object.create(event), { request: requestProxy });
                }
                const unroutedUrl = ultraviolet.sourceUrl(targetEvent.request.url);
                const isMedia = unroutedUrl && (targetEvent.request.destination === 'image' ||
                                 targetEvent.request.destination === 'audio' ||
                                 (typeof unroutedUrl === 'string' && unroutedUrl.match(/\.(mp3|wav|ogg|m4a|png|jpg|jpeg|webp|gif|svg)$/i))) &&
                                !unroutedUrl.includes('?');
                if (isMedia) {
                    try {
                        const headers = {};
                        for (const [k, v] of targetEvent.request.headers.entries()) {
                            if (['host', 'connection'].includes(k.toLowerCase())) continue;
                            headers[k] = v;
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