const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Sploop.io Relay</title></head>
            <body>
                <h2>Sploop.io WebSocket Relay</h2>
                <p>Status: Running</p>
                <p>Active connections: <span id="count">0</span></p>
                <script>
                    fetch('/stats').then(r=>r.json()).then(d=>{
                        document.getElementById('count').innerText = d.connections;
                    });
                </script>
            </body>
            </html>
        `);
    } else if (req.url === '/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ connections: activeConnections }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocket.Server({ server });
let activeConnections = 0;

// Store client -> game socket mappings
const clients = new Map();

wss.on('connection', (clientSocket, req) => {
    activeConnections++;
    console.log(`Client connected (${activeConnections} active)`);
    
    let gameSocket = null;
    let isConnecting = false;
    
    clientSocket.on('message', (data) => {
        // If game socket doesn't exist or is closed, create it
        if (!gameSocket || gameSocket.readyState !== WebSocket.OPEN) {
            if (isConnecting) return; // Already trying to connect
            
            isConnecting = true;
            console.log('Creating game connection from IP:', req.socket.remoteAddress);
            
            try {
                // Connect to sploop.io from Render's IP
                gameSocket = new WebSocket('wss://sploop.io/', {
                    headers: {
                        'Origin': 'https://sploop.io',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                gameSocket.binaryType = 'arraybuffer';
                
                gameSocket.on('open', () => {
                    console.log('Game socket connected');
                    isConnecting = false;
                    clients.set(clientSocket, gameSocket);
                    
                    // Forward any queued messages? The first message is usually the handshake
                    if (data) {
                        gameSocket.send(data);
                    }
                });
                
                gameSocket.on('message', (gameData) => {
                    if (clientSocket.readyState === WebSocket.OPEN) {
                        clientSocket.send(gameData);
                    }
                });
                
                gameSocket.on('error', (err) => {
                    console.error('Game socket error:', err.message);
                });
                
                gameSocket.on('close', () => {
                    console.log('Game socket closed');
                    clients.delete(clientSocket);
                    gameSocket = null;
                });
                
            } catch (err) {
                console.error('Failed to create game socket:', err);
                isConnecting = false;
            }
        } else if (gameSocket && gameSocket.readyState === WebSocket.OPEN) {
            // Forward client message to game
            gameSocket.send(data);
        }
    });
    
    clientSocket.on('close', () => {
        console.log('Client disconnected');
        activeConnections--;
        
        if (gameSocket && gameSocket.readyState === WebSocket.OPEN) {
            gameSocket.close();
        }
        clients.delete(clientSocket);
    });
    
    clientSocket.on('error', (err) => {
        console.error('Client socket error:', err.message);
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Relay server running on port ${PORT}`);
});
