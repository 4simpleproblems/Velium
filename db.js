const DB_NAME = 'VeliumMusicDB';
const DB_VERSION = 1;
const STORE_NAME = 'library';

const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
        }
    };

    request.onsuccess = (event) => {
        resolve(event.target.result);
    };

    request.onerror = (event) => {
        console.error(event.target.error);
        reject(event.target.error);
    };
});

const DB = {
    async getLibrary() {
        const db = await dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get('main_library');

            request.onsuccess = () => {
                resolve(request.result || { likedSongs: [], playlists: [] });
            };
            request.onerror = () => reject(request.error);
        });
    },

    async saveLibrary(libraryData) {
        const db = await dbPromise;
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(libraryData, 'main_library');

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};

window.VeliumDB = DB;
