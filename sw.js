importScripts('v-proxy/uv.bundle.js');
importScripts('v-proxy/uv.config.js');
importScripts('baremux/index.js');
const workerPath = location.origin + "/baremux/worker.js";
const connection = new BareMux.WorkerConnection(workerPath);
const bareClient = new BareMux.BareClient(connection);
const ultraviolet = new self.Ultraviolet(__uv$config);
importScripts(__uv$config.sw || 'v-proxy/uv.sw.js');
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
function cloneEventWithRequest(event, requestProxy) {
    const cloned = Object.create(event);
    Object.defineProperty(cloned, 'request', {
        value: requestProxy,
        writable: true,
        enumerable: true,
        configurable: true
    });
    return cloned;
}
self.addEventListener('fetch', event => {
    const url = event.request.url;
    const prefix = "/v-proxy/service/";
    event.respondWith(
        (async () => {
            const isEncoded = url.includes('hvtrs8');
            const isMediaDomain = url.includes('saavncdn.com') || url.includes('soundcloud.com') || url.includes('sndcdn.com') || url.includes('fastly.net') || url.includes('googleusercontent.com') || url.includes('ggpht.com');
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
                    targetEvent = cloneEventWithRequest(event, requestProxy);
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
                    targetEvent = cloneEventWithRequest(event, requestProxy);
                    shouldRoute = true;
                }
            }
            if (shouldRoute) {
                const unroutedUrl = ultraviolet.sourceUrl(targetEvent.request.url);
                const isMedia = unroutedUrl && (
                    targetEvent.request.destination === 'image' ||
                    targetEvent.request.destination === 'audio' ||
                    unroutedUrl.includes('saavncdn.com') ||
                    unroutedUrl.includes('soundcloud.com') ||
                    unroutedUrl.includes('sndcdn.com') ||
                    unroutedUrl.includes('fastly.net') ||
                    unroutedUrl.includes('googleusercontent.com') ||
                    unroutedUrl.includes('ggpht.com') ||
                    unroutedUrl.match(/\.(mp3|wav|ogg|m4a|png|jpg|jpeg|webp|gif|svg)(\?|$)/i)
                );
                if (isMedia) {
                    try {
                        const STRIP_HEADERS = new Set([
                            "origin", "referer", "host", "x-forwarded-for",
                            "x-real-ip", "cf-connecting-ip", "cf-ray",
                            "x-forwarded-proto", "x-forwarded-host", "connection"
                        ]);
                        const headers = {};
                        for (const [k, v] of targetEvent.request.headers.entries()) {
                            if (!STRIP_HEADERS.has(k.toLowerCase())) {
                                headers[k] = v;
                            }
                        }
                        headers["user-agent"] = navigator.userAgent;
                        headers["accept"] = headers["accept"] || "*/*";
                        headers["accept-language"] = headers["accept-language"] || "en-US,en;q=0.9";
                        if (unroutedUrl.includes("argon.global.ssl.fastly.net") ||
                            unroutedUrl.includes("soundcloud.com") ||
                            unroutedUrl.includes("sndcdn.com")) {
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