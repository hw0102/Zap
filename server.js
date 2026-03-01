const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');

const isDev = process.argv.includes('--dev');
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || (isDev ? '127.0.0.1' : '0.0.0.0');

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

let startupFailed = false;
function failStartup(err) {
  if (startupFailed) return;
  startupFailed = true;

  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORT to another value and retry.`);
  } else if (err.code === 'EPERM' || err.code === 'EACCES') {
    console.error(`Permission denied while binding ${HOST}:${PORT} (${err.code}).`);
    console.error(`Try a different port with: PORT=3001 npm run dev`);
  } else {
    console.error(`Failed to start server on ${HOST}:${PORT}.`, err);
  }

  process.exit(1);
}

// --- Signaling ---

const wss = new WebSocketServer({ server });
wss.on('error', failStartup);
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

server.on('error', failStartup);

server.listen(PORT, HOST, () => {
  console.log(`Zap server listening on ${HOST}:${PORT}`);
  if (isDev) {
    const localHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`  http://${localHost}:${PORT}`);
  }
});
