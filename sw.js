const CACHE_NAME = 'baidrop-v2';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&family=Google+Sans:wght@400;500;700&display=swap',
    'https://fonts.googleapis.com/icon?family=Material+Icons+Round',
    'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
    'https://unpkg.com/html5-qrcode',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Use a map to handle successes and failures individually for pre-caching
            return Promise.allSettled(
                ASSETS_TO_CACHE.map(url => 
                    fetch(url, { mode: 'no-cors' }).then(response => cache.put(url, response))
                )
            );
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // Avoid caching common non-cacheable items
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            let cacheWon = false;

            const fetchPromise = fetch(event.request).then((networkResponse) => {
                const isSuccessful = networkResponse.status === 200;
                const isOpaque = networkResponse.status === 0;
                
                if (isSuccessful) {
                    const accept = event.request.headers.get('accept') || '';
                    if (accept.includes('text/html') || event.request.url.includes('index.html')) {
                        cache.match(event.request).then(cachedRes => {
                            if (cachedRes) {
                                Promise.all([cachedRes.clone().text(), networkResponse.clone().text()]).then(([oldText, newText]) => {
                                    if (oldText !== newText && cacheWon) {
                                        self.clients.matchAll({ type: 'window' }).then(clients => {
                                            clients.forEach(c => c.navigate(c.url));
                                        });
                                    }
                                });
                            }
                        });
                    }
                }

                if (isSuccessful || isOpaque) {
                    cache.put(event.request, networkResponse.clone());
                }
                return networkResponse;
            }).catch((err) => {
                throw err;
            });

            return cache.match(event.request).then((cachedResponse) => {
                if (!cachedResponse) {
                    return fetchPromise;
                }

                const timeoutPromise = new Promise((resolve) => {
                    setTimeout(() => {
                        cacheWon = true;
                        resolve(cachedResponse);
                    }, 5000);
                });

                return Promise.race([
                    fetchPromise.catch(() => cachedResponse),
                    timeoutPromise
                ]);
            });
        })
    );
});
