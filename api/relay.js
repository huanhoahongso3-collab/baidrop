const sessions = new Map();
const TIMEOUT_MS = 60000 * 5; // 5 minutes inactivity timeout for relay

export const config = {
    api: {
        bodyParser: false, // We'll handle raw buffers for chunks manually to prevent Vercel 4.5MB crashes on JSON limits
    },
};

async function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = [];
        req.on('data', (chunk) => {
            body.push(chunk);
        });
        req.on('end', () => {
            resolve(Buffer.concat(body));
        });
        req.on('error', reject);
    });
}

export default async function handler(req, res) {
    // CORS allows cross-origin for local testing
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        const { query } = req;
        const sessionId = query.session;
        const action = query.action;

        if (!sessionId) {
            return res.status(400).json({ error: 'Missing session ID' });
        }

        // Cleanup stale sessions to keep Vercel RAM usage low
        const now = Date.now();
        for (const [sid, session] of sessions.entries()) {
            if (now - session.lastActive > TIMEOUT_MS) {
                sessions.delete(sid);
            }
        }

        if (req.method === 'POST') {
            if (action === 'init') {
                const rawBody = await parseBody(req);
                const meta = JSON.parse(rawBody.toString('utf-8'));
                sessions.set(sessionId, {
                    meta,
                    state: 'waiting', // waiting, accepted, rejected, complete
                    chunks: new Map(),
                    ackChunk: -1,
                    lastActive: now
                });
                return res.status(200).json({ success: true });
            } 
            else if (action === 'chunk') {
                const session = sessions.get(sessionId);
                if (!session) return res.status(404).json({ error: 'Session not found' });
                
                session.lastActive = now;
                const chunkIndex = parseInt(query.index, 10);
                const rawBody = await parseBody(req);
                
                // Store chunk in memory (until receiver downloads and ACKs it)
                session.chunks.set(chunkIndex, rawBody);
                return res.status(200).json({ success: true });
            }
            else if (action === 'ack') {
                const session = sessions.get(sessionId);
                if (!session) return res.status(404).json({ error: 'Session not found' });
                
                session.lastActive = now;
                const chunkIndex = parseInt(query.index, 10);
                
                // Receiver acks chunk, delete it immediately from memory to prevent Vercel OOM!
                session.chunks.delete(chunkIndex);
                session.ackChunk = chunkIndex;
                
                if (query.status === 'complete') {
                    session.state = 'complete';
                    setTimeout(() => sessions.delete(sessionId), 10000); // give 10 seconds for final polls to finish smoothly
                }
                
                return res.status(200).json({ success: true });
            }
            else if (action === 'accept') {
                const session = sessions.get(sessionId);
                if (!session) return res.status(404).json({ error: 'Session not found' });
                
                session.lastActive = now;
                session.state = query.accept === 'true' ? 'accepted' : 'rejected';
                return res.status(200).json({ success: true });
            }
            else if (action === 'cancel') {
                sessions.delete(sessionId);
                return res.status(200).json({ success: true });
            }
        } 
        else if (req.method === 'GET') {
            const session = sessions.get(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found or expired' });
            }
            session.lastActive = now;

            if (action === 'meta') {
                return res.status(200).json({
                    meta: session.meta,
                    state: session.state,
                    ackChunk: session.ackChunk
                });
            }
            else if (action === 'chunk') {
                const chunkIndex = parseInt(query.index, 10);
                
                if (session.chunks.has(chunkIndex)) {
                    const chunk = session.chunks.get(chunkIndex);
                    res.setHeader('Content-Type', 'application/octet-stream');
                    return res.send(chunk);
                } else {
                    return res.status(202).json({ status: 'pending' }); // Chunk not uploaded yet, HTTP 202 let's receiver know they need to poll again
                }
            }
        }
        
        res.status(400).json({ error: 'Invalid request' });
    } catch (error) {
        console.error('Relay Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
