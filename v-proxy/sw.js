importScripts('../baremux/index.js');
importScripts('uv.bundle.js');
importScripts('uv.config.js');
importScripts(__uv$config.sw || 'uv.sw.js');

const workerPath = location.origin + "/baremux/worker.js";
const connection = new BareMux.WorkerConnection(workerPath);
const uv = new UVServiceWorker();
uv.bareClient = new BareMux.BareClient(connection);

let transportReady = false;
let transportResolve;
const transportPromise = new Promise(resolve => {
    transportResolve = resolve;
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'baremuxinit' && event.data.port) {
        connection.port = event.data.port;
        if (!transportReady) {
            transportReady = true;
            if (transportResolve) transportResolve();
        }
        console.log("VELIUM SW: BareMux Port Synced via " + workerPath);
    }
});

let config = {
    blocklist: new Set(),
}

async function handleRequest(event) {
    if (uv.route(event)) {
        if (!transportReady) {
            await transportPromise;
        }
        if (config.blocklist.size !== 0) {
            let decodedUrl = new URL(__uv$config.decodeUrl(new URL(event.request.url).pathname.slice(__uv$config.prefix.length)));
            if (config.blocklist.has(decodedUrl.hostname)) {
                return new Response("", { status: 404 });
            }
        }
        return await uv.fetch(event);
    }
    
    return await fetch(event.request);
}

self.addEventListener('fetch', (event) => {
    event.respondWith(handleRequest(event));
});

self.addEventListener("message", (event) => {
    if (event.data && event.data.type !== 'baremuxinit') {
        config = event.data;
    }
});

self.addEventListener("activate", () => {
    const bc = new BroadcastChannel("UvServiceWorker");
    bc.postMessage("Active");
});