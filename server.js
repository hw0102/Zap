const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const isDev = process.argv.includes('--dev');
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

let server;

const certPath = path.join(__dirname, 'certs', 'fullchain.pem');
const keyPath = path.join(__dirname, 'certs', 'privkey.pem');

if (!isDev && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const https = require('https');
  server = https.createServer(
    { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) },
    app
  );
  console.log('Starting HTTPS server (TLS enabled)');
} else {
  const http = require('http');
  server = http.createServer(app);
  if (!isDev) {
    console.log('Warning: No TLS certs found in certs/. Running plain HTTP.');
    console.log('WebRTC will NOT work on iOS Safari without HTTPS.');
  }
  console.log('Starting HTTP server (dev mode)');
}

// --- Signaling ---

const wss = new WebSocketServer({ server });
const peers = new Map(); // peerId -> { ws, name, deviceType }
let nextId = 1;

function broadcastPeerList() {
  const list = [];
  for (const [id, peer] of peers) {
    list.push({ id, name: peer.name, deviceType: peer.deviceType });
  }
  const msg = JSON.stringify({ type: 'peers', peers: list });
  for (const [, peer] of peers) {
    peer.ws.send(msg);
  }
}

function relay(fromId, toId, message) {
  const target = peers.get(toId);
  if (target) {
    target.ws.send(JSON.stringify({ ...message, from: fromId }));
  }
}

wss.on('connection', (ws) => {
  const peerId = String(nextId++);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'register': {
        peers.set(peerId, {
          ws,
          name: msg.name || `Device ${peerId}`,
          deviceType: msg.deviceType || 'unknown',
        });
        ws.send(JSON.stringify({ type: 'registered', id: peerId }));
        broadcastPeerList();
        break;
      }

      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'file-request':
      case 'file-accept':
      case 'file-decline':
      case 'transfer-cancel': {
        if (msg.to) relay(peerId, msg.to, msg);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    peers.delete(peerId);
    broadcastPeerList();
  });

  ws.on('error', () => {
    peers.delete(peerId);
    broadcastPeerList();
  });
});

server.listen(PORT, () => {
  const proto = server.address().family === 'IPv6' ? 'http' : 'http';
  console.log(`LanDrop server listening on port ${PORT}`);
  if (isDev) console.log(`  http://localhost:${PORT}`);
});
