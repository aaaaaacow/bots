const express = require('express');
const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 8080;

// Your proxies (same as before)
const proxies = `85.209.195.92:32349
72.56.50.17:59787
72.56.59.56:63127
94.176.3.43:7443
94.176.3.109:7443
101.47.73.135:3128
150.107.140.238:3128
91.107.254.36:2000
158.160.215.167:8125
89.208.85.78:18080
72.56.59.62:63133
104.238.30.91:63900
210.223.44.230:3128
103.156.215.16:8080
104.238.30.58:63744
89.208.85.78:443
94.176.3.42:7443
72.56.59.17:61931
72.56.59.23:61937
14.225.240.23:8562
104.238.30.37:59741
200.174.198.32:8888
45.12.151.226:2828
104.238.30.86:63900
5.9.218.168:3128
103.236.64.247:8888
120.92.212.16:7890
66.80.0.115:3128
62.113.119.14:8080
183.249.5.109:22222
103.3.246.71:3128
162.240.154.26:3128
188.130.160.209:80
121.204.158.249:3128
150.230.104.3:16728
94.177.131.33:3128
220.197.44.36:3128
45.190.78.20:999
41.65.103.5:1981
202.191.127.9:1121
90.84.188.97:8000
45.140.147.155:1081
195.158.8.123:3128
45.170.128.125:999
186.67.74.52:3128
213.230.110.191:3128
49.144.23.152:8082
120.240.35.173:22222
103.35.188.243:3128
223.113.134.98:22222
120.238.159.228:22222
85.208.108.43:2094
103.193.144.100:8080`.trim();

const proxyList = proxies.split('\n').filter(p => p.trim());
const failedProxies = new Set();

const sessions = new Map(); // id → { mainWs, bots: [ws1, ws2, ...], spawnPackets: [] }

app.use(express.json());

// Browser sends the spawn / bypass packets it generated
app.post('/relay/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const { packets } = req.body; // array of packets (strings or buffers)

    if (!sessions.has(sessionId)) {
        sessions.set(sessionId, { bots: [], spawnPackets: packets });
    } else {
        sessions.get(sessionId).spawnPackets = packets;
    }

    res.json({ received: packets.length });
});

// Browser asks to add N bots
app.get('/add/:sessionId/:count', (req, res) => {
    const { sessionId, count } = req.params;
    const num = parseInt(count) || 1;
    const sess = sessions.get(sessionId);

    if (!sess || !sess.spawnPackets?.length) {
        return res.status(400).json({ error: "No spawn packets received yet" });
    }

    for (let i = 0; i < num; i++) {
        const proxy = proxyList[i % proxyList.length];
        const useProxy = !failedProxies.has(proxy);
        const agent = useProxy ? new HttpsProxyAgent(`http://${proxy}`) : undefined;

        const ws = new WebSocket('wss://sca2.sploop.io/wsbot1', {
            agent,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        ws.on('open', () => {
            // Replay the spawn & bypass packets from browser
            sess.spawnPackets.forEach(pkt => {
                if (typeof pkt === 'string') {
                    ws.send(pkt);
                } else if (pkt instanceof ArrayBuffer || pkt instanceof Uint8Array) {
                    ws.send(pkt);
                }
            });
            console.log(`Relay bot #${i+1} opened and replayed packets`);
        });

        ws.on('close', () => {
            if (useProxy) failedProxies.add(proxy);
        });

        sess.bots.push(ws);
    }

    res.json({ added: num });
});

// Remove all bots for a session
app.get('/remove/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const sess = sessions.get(sessionId);
    if (sess) {
        sess.bots.forEach(ws => ws.readyState < 2 && ws.close());
        sess.bots = [];
    }
    res.json({ success: true });
});

app.get('/status', (req, res) => {
    const stats = Array.from(sessions.entries()).map(([id, s]) => ({
        id,
        bots: s.bots.length,
        active: s.bots.filter(b => b.readyState === WebSocket.OPEN).length
    }));
    res.json({ sessions: stats, failedProxies: [...failedProxies] });
});

app.listen(PORT, () => {
    console.log(`Relay server on port ${PORT}`);
});
