const peers = new Map();
const TIMEOUT_MS = 15000; // 15 seconds

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
        const { id, name, avatar, ipHash, hostHash } = req.body;

        if (!id || (!ipHash && !hostHash)) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const now = Date.now();

        // Register or update peer
        peers.set(id, {
            id,
            name: name || 'Unknown Device',
            avatar: avatar || 'default',
            ipHash,
            hostHash,
            lastSeen: now
        });

        // Cleanup expired peers
        for (const [peerId, peerData] of peers.entries()) {
            if (now - peerData.lastSeen > TIMEOUT_MS) {
                peers.delete(peerId);
            }
        }

        // Return peers on same ipHash OR same hostHash
        const nearbyPeers = [];
        for (const [peerId, peerData] of peers.entries()) {
            if (peerId !== id) {
                if ((ipHash && peerData.ipHash === ipHash) || (hostHash && peerData.hostHash === hostHash)) {
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
