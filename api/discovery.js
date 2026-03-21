import crypto from 'crypto';

const peers = new Map();
const TIMEOUT_MS = 15000; // 15 seconds

function getIpHash(req) {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded ? forwarded.split(/\s*,\s*/)[0] : req.socket.remoteAddress;
    // Use md5 for a short, consistent hash of the public IP
    return crypto.createHash('md5').update(ip || 'unknown').digest('hex').substring(0, 8);
}

export default function handler(req, res) {
    // CORS Headers for allowing local testing
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e){}
        }

        const { id, name, avatar, hostHash, action } = body || {};
        const ipHash = getIpHash(req);

        if (!id) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (action === 'remove') {
            peers.delete(id);
            return res.status(200).json({ success: true });
        }

        const now = Date.now();

        // Register or update peer
        peers.set(id, {
            id,
            name: name || 'Unknown Device',
            avatar: avatar || 'default',
            ipHash,
            lastSeen: now
        });

        // Cleanup expired peers
        for (const [peerId, peerData] of peers.entries()) {
            if (now - peerData.lastSeen > TIMEOUT_MS) {
                peers.delete(peerId);
            }
        }

        // Return peers on same ipHash
        const nearbyPeers = [];
        for (const [peerId, peerData] of peers.entries()) {
            if (peerId !== id) {
                if (peerData.ipHash === ipHash) {
                    nearbyPeers.push({
                        id: peerData.id,
                        name: peerData.name,
                        avatar: peerData.avatar,
                        lastSeen: peerData.lastSeen
                    });
                }
            }
        }

        res.status(200).json({ peers: nearbyPeers });
    } catch (error) {
        console.error('Discovery Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
