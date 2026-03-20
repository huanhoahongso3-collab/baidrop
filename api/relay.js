const transfers = new Map();
const TIMEOUT_MS = 60 * 1000 * 5; // 5 minutes inactivity max

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e){}
        }

        const { action, roomId, sender, receiver, requestData, accept, chunkData, sdp } = body || {};

        if (!roomId) return res.status(400).json({ error: 'Missing roomId' });

        const now = Date.now();

        if (action === 'store_sdp') {
            // We just hijack the transfers map to hold temporary SDP strings
            transfers.set(roomId, { sdp, lastSeen: now });
            return res.status(200).json({ success: true });
        }
        if (action === 'get_sdp') {
            const entry = transfers.get(roomId);
            return res.status(200).json({ sdp: entry ? entry.sdp : null });
        }
        // Cleanup stale transfers
        for (const [id, t] of transfers.entries()) {
            if (now - t.lastSeen > TIMEOUT_MS) transfers.delete(id);
        }

        if (action === 'create') {
            transfers.set(roomId, {
                sender,
                receiver: null,
                status: 'waiting',
                pendingRequest: requestData || null,
                currentChunk: null,
                currentChunkIndex: -1,
                lastSeen: now
            });
            return res.status(200).json({ success: true });
        }

        const t = transfers.get(roomId);
        if (!t) return res.status(404).json({ error: 'Transfer not found or expired' });
        t.lastSeen = now;

        if (action === 'join') {
            if (t.status !== 'waiting') return res.status(400).json({ error: 'Cannot join or already joined' });
            t.receiver = receiver;
            return res.status(200).json({ success: true, sender: t.sender, requestData: t.pendingRequest });
        }

        if (action === 'poll_sender') {
            return res.status(200).json({ 
                receiver: t.receiver, 
                status: t.status, 
                chunkAck: t.currentChunk ? t.currentChunk.ack : false 
            });
        }

        if (action === 'poll_receiver') {
            return res.status(200).json({ 
                status: t.status, 
                request: t.pendingRequest,
                chunk: (t.currentChunk && !t.currentChunk.ack) ? t.currentChunk : null 
            });
        }

        if (action === 'respond') {
            t.status = accept ? 'accepted' : 'declined';
            return res.status(200).json({ success: true });
        }

        if (action === 'send_chunk') {
            if (t.status !== 'accepted' && t.status !== 'transferring') return res.status(400).json({ error: 'Invalid state' });
            // Allow re-sending same chunk or next chunk
            if (chunkData.index < t.currentChunkIndex) return res.status(200).json({ success: true, warning: 'Old chunk ignored' });
            
            t.status = 'transferring';
            t.currentChunk = { ...chunkData, ack: false };
            t.currentChunkIndex = chunkData.index;
            return res.status(200).json({ success: true });
        }

        if (action === 'ack_chunk') {
            if (t.currentChunk) t.currentChunk.ack = true;
            return res.status(200).json({ success: true });
        }

        if (action === 'complete') {
            t.status = 'completed';
            return res.status(200).json({ success: true });
        }

        if (action === 'cancel') {
            t.status = 'cancelled';
            return res.status(200).json({ success: true });
        }

        return res.status(400).json({ error: 'Unknown action' });
    } catch (err) {
        console.error('Relay Error:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
