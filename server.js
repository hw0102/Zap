const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const isDev = process.argv.includes('--dev');
const allowInsecureHttp = process.argv.includes('--insecure-http') || process.env.ALLOW_INSECURE_HTTP === '1';
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || (isDev ? '127.0.0.1' : '0.0.0.0');
const wsJoinToken = (process.env.ZAP_JOIN_TOKEN || '').trim();

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_WS_PAYLOAD = parsePositiveInt(process.env.ZAP_WS_MAX_PAYLOAD, 256 * 1024);
const WS_RATE_LIMIT_WINDOW_MS = parsePositiveInt(process.env.ZAP_WS_RATE_WINDOW_MS, 5000);
const WS_RATE_LIMIT_MAX_MESSAGES = parsePositiveInt(process.env.ZAP_WS_RATE_MAX_MESSAGES, 120);
const MAX_DEVICE_NAME_LENGTH = parsePositiveInt(process.env.ZAP_MAX_DEVICE_NAME_LENGTH, 30);
const MAX_FILE_NAME_LENGTH = parsePositiveInt(process.env.ZAP_MAX_FILE_NAME_LENGTH, 255);
const MAX_TRANSFER_BYTES = parsePositiveInt(process.env.ZAP_MAX_TRANSFER_BYTES, 2 * 1024 * 1024 * 1024);
const MAX_SDP_LENGTH = parsePositiveInt(process.env.ZAP_MAX_SDP_LENGTH, 64 * 1024);
const MAX_ICE_CANDIDATE_LENGTH = parsePositiveInt(process.env.ZAP_MAX_ICE_CANDIDATE_LENGTH, 8192);
const MAX_CHAT_MESSAGE_LENGTH = parsePositiveInt(process.env.ZAP_MAX_CHAT_MESSAGE_LENGTH, 400);
const MAX_CLIPBOARD_SNIPPET_LENGTH = parsePositiveInt(process.env.ZAP_MAX_CLIPBOARD_SNIPPET_LENGTH, 800);
const MAX_CLIPBOARD_ITEMS = parsePositiveInt(process.env.ZAP_MAX_CLIPBOARD_ITEMS, 200);
const MAX_MIME_TYPE_LENGTH = 128;
const RELAY_TYPES = new Set([
  'offer',
  'answer',
  'ice-candidate',
  'file-request',
  'file-accept',
  'file-decline',
  'transfer-cancel',
]);
const ALLOWED_DEVICE_TYPES = new Set(['phone', 'tablet', 'desktop', 'unknown']);

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  res.set('Cross-Origin-Opener-Policy', 'same-origin');
  res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');

  if (req.socket.encrypted) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
});

function getLanIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = new Set();

  for (const entries of Object.values(interfaces)) {
    for (const info of entries || []) {
      const isIPv4 = info.family === 'IPv4' || info.family === 4;
      if (!isIPv4 || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      addresses.add(info.address);
    }
  }

  return [...addresses];
}

function normalizeHost(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function isSameOriginWebSocket(req) {
  const hostHeader = normalizeHost(req.headers.host);
  const originHeader = req.headers.origin;

  if (!hostHeader) return false;
  if (!originHeader) return isDev;

  try {
    const origin = new URL(originHeader);
    return normalizeHost(origin.host) === hostHeader;
  } catch {
    return false;
  }
}

function hasValidJoinToken(urlPath, hostHeader) {
  if (!wsJoinToken) return true;

  try {
    const parsed = new URL(urlPath || '/', `http://${hostHeader || 'localhost'}`);
    const token = parsed.searchParams.get('token');
    return token === wsJoinToken;
  } catch {
    return false;
  }
}

function requireJoinToken(req, res, next) {
  if (!wsJoinToken) {
    next();
    return;
  }

  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (token === wsJoinToken) {
    next();
    return;
  }

  res.status(401).json({ error: 'Missing or invalid token' });
}

function buildShareUrl(protocol, ip, portSegment) {
  const base = `${protocol}://${ip}${portSegment}/`;
  return wsJoinToken
    ? `${base}?token=${encodeURIComponent(wsJoinToken)}`
    : base;
}

app.get('/api/local-urls', requireJoinToken, (req, res) => {
  const protocol = req.socket.encrypted ? 'https' : 'http';
  const omitPort = (protocol === 'http' && PORT === 80) || (protocol === 'https' && PORT === 443);
  const portSegment = omitPort ? '' : `:${PORT}`;
  const urls = getLanIPv4Addresses().map((ip) => buildShareUrl(protocol, ip, portSegment));

  res.set('Cache-Control', 'no-store');
  res.json({ urls });
});

app.get('/app-config.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(
    `window.__ZAP_CONFIG__ = { isDev: ${JSON.stringify(isDev)}, tokenRequired: ${JSON.stringify(Boolean(wsJoinToken))} };`
  );
});

app.use(express.static(path.join(__dirname, 'public')));

let server;

const certPath = path.join(__dirname, 'certs', 'fullchain.pem');
const keyPath = path.join(__dirname, 'certs', 'privkey.pem');
const hasTlsCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);

if (!isDev && !hasTlsCerts && !allowInsecureHttp) {
  console.error('TLS certificate files were not found in certs/.');
  console.error('Expected: certs/fullchain.pem and certs/privkey.pem');
  console.error('Refusing to start without HTTPS. For local-only testing, use npm run dev or pass --insecure-http.');
  process.exit(1);
}

if (!isDev && hasTlsCerts) {
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
    console.log('Warning: Running plain HTTP due to explicit insecure override.');
    console.log('WebRTC will NOT work on iOS Safari without HTTPS.');
    console.log('Starting HTTP server (insecure override)');
  } else {
    console.log('Starting HTTP server (dev mode)');
  }
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

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_WS_PAYLOAD,
});
wss.on('error', failStartup);
const peers = new Map(); // peerId -> { ws, name, deviceType }
const clipboardSnippets = [];
let nextClipboardId = 1;
let nextId = 1;

function safeSend(ws, payload) {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(payload);
    return true;
  } catch {
    return false;
  }
}

function broadcastPeerList() {
  const list = [];
  for (const [id, peer] of peers) {
    list.push({ id, name: peer.name, deviceType: peer.deviceType });
  }

  const msg = JSON.stringify({ type: 'peers', peers: list });
  const stale = [];
  for (const [id, peer] of peers) {
    if (!safeSend(peer.ws, msg)) stale.push(id);
  }
  for (const id of stale) {
    peers.delete(id);
  }
}

function relay(fromId, toId, message) {
  const target = peers.get(toId);
  if (target) {
    safeSend(target.ws, JSON.stringify({ ...message, from: fromId }));
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeDeviceType(value) {
  return ALLOWED_DEVICE_TYPES.has(value) ? value : 'unknown';
}

function sanitizeDeviceName(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  return trimmed || fallback;
}

function sanitizeSdp(value, expectedType) {
  if (!isPlainObject(value)) return null;
  if (value.type !== expectedType) return null;
  if (typeof value.sdp !== 'string') return null;
  if (value.sdp.length === 0 || value.sdp.length > MAX_SDP_LENGTH) return null;
  return { type: value.type, sdp: value.sdp };
}

function sanitizeIceCandidate(value) {
  if (!isPlainObject(value)) return null;
  if (typeof value.candidate !== 'string' || value.candidate.length > MAX_ICE_CANDIDATE_LENGTH) {
    return null;
  }

  const candidate = {
    candidate: value.candidate,
    sdpMid: typeof value.sdpMid === 'string' ? value.sdpMid : null,
    sdpMLineIndex: Number.isInteger(value.sdpMLineIndex) ? value.sdpMLineIndex : null,
  };

  if (typeof value.usernameFragment === 'string') {
    candidate.usernameFragment = value.usernameFragment;
  }

  return candidate;
}

function sanitizeFileMeta(value) {
  if (!isPlainObject(value)) return null;
  if (typeof value.name !== 'string') return null;

  const name = value.name.trim().slice(0, MAX_FILE_NAME_LENGTH);
  if (!name) return null;

  const size = Number(value.size);
  if (!Number.isFinite(size) || size < 0 || size > MAX_TRANSFER_BYTES || !Number.isInteger(size)) {
    return null;
  }

  let mimeType = '';
  if (typeof value.mimeType === 'string') {
    mimeType = value.mimeType.slice(0, MAX_MIME_TYPE_LENGTH);
  }

  return {
    name,
    size,
    mimeType,
  };
}

function sanitizeRelayMessage(type, msg) {
  switch (type) {
    case 'offer':
    case 'answer': {
      const sdp = sanitizeSdp(msg.sdp, type);
      return sdp ? { type, sdp } : null;
    }
    case 'ice-candidate': {
      const candidate = sanitizeIceCandidate(msg.candidate);
      return candidate ? { type, candidate } : null;
    }
    case 'file-request': {
      const meta = sanitizeFileMeta(msg.meta);
      return meta ? { type, meta } : null;
    }
    case 'file-accept':
    case 'file-decline':
    case 'transfer-cancel':
      return { type };
    default:
      return null;
  }
}

function sanitizeChatText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CHAT_MESSAGE_LENGTH) return null;
  return trimmed;
}

function sanitizeClipboardText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLIPBOARD_SNIPPET_LENGTH) return null;
  return trimmed;
}

server.on('upgrade', (req, socket, head) => {
  const host = normalizeHost(req.headers.host);

  if (!isSameOriginWebSocket(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  if (!hasValidJoinToken(req.url, host)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  const peerId = String(nextId++);
  let registered = false;
  let cleanedUp = false;
  let windowStartedAt = Date.now();
  let messagesInWindow = 0;

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (peers.delete(peerId)) {
      broadcastPeerList();
    }
  }

  function closePolicy(reason) {
    try {
      ws.close(1008, reason);
    } catch {
      cleanup();
    }
  }

  ws.on('message', (raw, isBinary) => {
    if (isBinary) {
      closePolicy('Binary signaling is not supported');
      return;
    }

    const now = Date.now();
    if (now - windowStartedAt > WS_RATE_LIMIT_WINDOW_MS) {
      windowStartedAt = now;
      messagesInWindow = 0;
    }
    messagesInWindow += 1;
    if (messagesInWindow > WS_RATE_LIMIT_MAX_MESSAGES) {
      closePolicy('Too many signaling messages');
      return;
    }

    let msg;
    try {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (!isPlainObject(msg) || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'register': {
        peers.set(peerId, {
          ws,
          name: sanitizeDeviceName(msg.name, `Device ${peerId}`),
          deviceType: sanitizeDeviceType(msg.deviceType),
        });
        if (!registered) {
          registered = true;
          safeSend(ws, JSON.stringify({ type: 'registered', id: peerId }));
        }
        safeSend(ws, JSON.stringify({ type: 'clipboard-state', snippets: clipboardSnippets }));
        broadcastPeerList();
        break;
      }

      case 'chat-message': {
        if (!registered) break;
        const text = sanitizeChatText(msg.text);
        if (!text) break;

        const sender = peers.get(peerId);
        if (!sender) break;

        const payload = JSON.stringify({
          type: 'chat-message',
          from: peerId,
          name: sender.name,
          text,
          ts: Date.now(),
        });

        const stale = [];
        for (const [id, peer] of peers) {
          if (!safeSend(peer.ws, payload)) stale.push(id);
        }
        for (const id of stale) {
          peers.delete(id);
        }
        break;
      }

      case 'clipboard-add': {
        if (!registered) break;
        const text = sanitizeClipboardText(msg.text);
        if (!text) break;

        const sender = peers.get(peerId);
        if (!sender) break;

        const snippet = {
          id: String(nextClipboardId++),
          from: peerId,
          name: sender.name,
          text,
          ts: Date.now(),
        };

        clipboardSnippets.push(snippet);
        if (clipboardSnippets.length > MAX_CLIPBOARD_ITEMS) {
          clipboardSnippets.splice(0, clipboardSnippets.length - MAX_CLIPBOARD_ITEMS);
        }

        const payload = JSON.stringify({
          type: 'clipboard-add',
          snippet,
        });

        const stale = [];
        for (const [id, peer] of peers) {
          if (!safeSend(peer.ws, payload)) stale.push(id);
        }
        for (const id of stale) {
          peers.delete(id);
        }
        break;
      }

      default: {
        if (!registered || !RELAY_TYPES.has(msg.type)) break;
        if (typeof msg.to !== 'string' || msg.to.length === 0 || msg.to.length > 32) break;
        if (msg.to === peerId) break;
        if (!peers.has(msg.to)) break;

        const sanitized = sanitizeRelayMessage(msg.type, msg);
        if (!sanitized) break;

        relay(peerId, msg.to, sanitized);
        break;
      }
    }
  });

  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

server.on('error', failStartup);

server.listen(PORT, HOST, () => {
  console.log(`Zap server listening on ${HOST}:${PORT}`);
  if (wsJoinToken) {
    console.log('Join token auth enabled for WebSocket and local URL API.');
  }
  if (isDev) {
    const localHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`  http://${localHost}:${PORT}`);
  }
});
