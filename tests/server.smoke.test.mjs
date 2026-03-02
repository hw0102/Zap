import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { WebSocket } from 'ws';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to determine free port')));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

function waitForServerReady(proc, expectedLine, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let output = '';

    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(expectedLine)) {
        cleanup();
        resolve();
      }
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Server exited early (code=${code}, signal=${signal}). Output:\n${output}`));
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for server startup. Output:\n${output}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onData);
      proc.off('exit', onExit);
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', onExit);
  });
}

function httpGet(host, port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host,
        port,
        path,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode || 0, body });
        });
      }
    );

    req.on('error', reject);
  });
}

async function startServer(t, envOverrides = {}) {
  const port = await getFreePort();
  const expectedLine = `Zap server listening on 127.0.0.1:${port}`;

  const proc = spawn(process.execPath, ['server.js', '--dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    if (!proc.killed) proc.kill('SIGTERM');
  });

  await waitForServerReady(proc, expectedLine);
  return { port, proc };
}

function expectWebSocketRejected(url, origin, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      headers: { Origin: origin },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      finish({ opened: false, reason: 'timeout' });
    }, timeoutMs);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { ws.terminate(); } catch {}
      resolve(result);
    };

    ws.on('open', () => finish({ opened: true }));
    ws.on('unexpected-response', (_req, res) => {
      finish({ opened: false, statusCode: res.statusCode || 0 });
    });
    ws.on('error', () => finish({ opened: false, reason: 'error' }));
  });
}

function connectWebSocket(url, origin, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { Origin: origin },
    });

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket open'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('open', onOpen);
      ws.off('error', onError);
      ws.off('unexpected-response', onUnexpectedResponse);
    };

    const onOpen = () => {
      cleanup();
      resolve(ws);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const onUnexpectedResponse = (_req, res) => {
      cleanup();
      reject(new Error(`Unexpected WebSocket response ${res.statusCode || 0}`));
    };

    ws.on('open', onOpen);
    ws.on('error', onError);
    ws.on('unexpected-response', onUnexpectedResponse);
  });
}

function waitForMessageType(ws, type, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for message type "${type}"`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('close', onClose);
      ws.off('error', onError);
    };

    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === type) {
        cleanup();
        resolve(msg);
      }
    };

    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket closed before receiving "${type}"`));
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);
  });
}

function expectNoMessageType(ws, type, waitMs = 400) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, waitMs);

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('close', onClose);
      ws.off('error', onError);
    };

    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === type) {
        cleanup();
        reject(new Error(`Unexpected message type "${type}"`));
      }
    };

    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket closed while waiting for no "${type}" message`));
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    ws.on('message', onMessage);
    ws.on('close', onClose);
    ws.on('error', onError);
  });
}

test('server boots and serves core local endpoints', async (t) => {
  const { port } = await startServer(t);

  const health = await httpGet('127.0.0.1', port, '/api/local-urls');
  assert.equal(health.statusCode, 200);
  const parsed = JSON.parse(health.body);
  assert.ok(Array.isArray(parsed.urls));

  const homepage = await httpGet('127.0.0.1', port, '/');
  assert.equal(homepage.statusCode, 200);
  assert.match(homepage.body, /<title>Zap<\/title>/i);
});

test('websocket rejects mismatched Origin', async (t) => {
  const { port } = await startServer(t);
  const result = await expectWebSocketRejected(
    `ws://127.0.0.1:${port}/`,
    'https://evil.example'
  );

  assert.equal(result.opened, false);
});

test('websocket allows same-origin registration', async (t) => {
  const { port } = await startServer(t);
  const origin = `http://127.0.0.1:${port}`;
  const ws = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);

  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.send(JSON.stringify({
    type: 'register',
    name: 'test-client',
    deviceType: 'desktop',
  }));

  const registered = await waitForMessageType(ws, 'registered');
  assert.equal(typeof registered.id, 'string');
});

test('websocket enforces join token when configured', async (t) => {
  const token = 'test-join-token';
  const { port } = await startServer(t, { ZAP_JOIN_TOKEN: token });
  const origin = `http://127.0.0.1:${port}`;

  const rejected = await expectWebSocketRejected(`ws://127.0.0.1:${port}/`, origin);
  assert.equal(rejected.opened, false);

  const ws = await connectWebSocket(`ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`, origin);
  t.after(() => {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.send(JSON.stringify({ type: 'register', name: 'token-client', deviceType: 'desktop' }));
  const registered = await waitForMessageType(ws, 'registered');
  assert.equal(typeof registered.id, 'string');
});

test('local URL API enforces join token when configured', async (t) => {
  const token = 'api-token';
  const { port } = await startServer(t, { ZAP_JOIN_TOKEN: token });

  const denied = await httpGet('127.0.0.1', port, '/api/local-urls');
  assert.equal(denied.statusCode, 401);

  const allowed = await httpGet('127.0.0.1', port, `/api/local-urls?token=${encodeURIComponent(token)}`);
  assert.equal(allowed.statusCode, 200);
  const parsed = JSON.parse(allowed.body);
  assert.ok(Array.isArray(parsed.urls));
  assert.ok(parsed.urls.every((url) => url.includes(`token=${encodeURIComponent(token)}`)));
});

test('chat messages broadcast to all registered peers', async (t) => {
  const { port } = await startServer(t);
  const origin = `http://127.0.0.1:${port}`;

  const wsA = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);
  const wsB = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);

  t.after(() => {
    if (wsA.readyState === WebSocket.OPEN) wsA.close();
    if (wsB.readyState === WebSocket.OPEN) wsB.close();
  });

  wsA.send(JSON.stringify({ type: 'register', name: 'alpha', deviceType: 'desktop' }));
  wsB.send(JSON.stringify({ type: 'register', name: 'bravo', deviceType: 'desktop' }));
  await waitForMessageType(wsA, 'registered');
  await waitForMessageType(wsB, 'registered');

  wsA.send(JSON.stringify({ type: 'chat-message', text: 'hello from alpha' }));

  const receivedByA = await waitForMessageType(wsA, 'chat-message');
  const receivedByB = await waitForMessageType(wsB, 'chat-message');

  assert.equal(receivedByA.text, 'hello from alpha');
  assert.equal(receivedByB.text, 'hello from alpha');
  assert.equal(receivedByA.name, 'alpha');
  assert.equal(receivedByB.name, 'alpha');
  assert.equal(typeof receivedByA.id, 'string');
  assert.equal(typeof receivedByB.id, 'string');
  assert.equal(typeof receivedByA.ts, 'number');
  assert.equal(typeof receivedByB.ts, 'number');
});

test('chat messages can only be deleted by the sender', async (t) => {
  const { port } = await startServer(t);
  const origin = `http://127.0.0.1:${port}`;

  const wsA = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);
  const wsB = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);

  t.after(() => {
    if (wsA.readyState === WebSocket.OPEN) wsA.close();
    if (wsB.readyState === WebSocket.OPEN) wsB.close();
  });

  wsA.send(JSON.stringify({ type: 'register', name: 'alpha', deviceType: 'desktop' }));
  wsB.send(JSON.stringify({ type: 'register', name: 'bravo', deviceType: 'desktop' }));
  await waitForMessageType(wsA, 'registered');
  await waitForMessageType(wsB, 'registered');

  wsA.send(JSON.stringify({ type: 'chat-message', text: 'sender only delete' }));
  const chatA = await waitForMessageType(wsA, 'chat-message');
  const chatB = await waitForMessageType(wsB, 'chat-message');
  assert.equal(chatA.id, chatB.id);
  const messageId = chatA.id;

  const noDeleteA = expectNoMessageType(wsA, 'chat-delete');
  const noDeleteB = expectNoMessageType(wsB, 'chat-delete');
  wsB.send(JSON.stringify({ type: 'chat-delete', id: messageId }));
  await noDeleteA;
  await noDeleteB;

  wsA.send(JSON.stringify({ type: 'chat-delete', id: messageId }));
  const deleteA = await waitForMessageType(wsA, 'chat-delete');
  const deleteB = await waitForMessageType(wsB, 'chat-delete');
  assert.equal(deleteA.id, messageId);
  assert.equal(deleteB.id, messageId);
});

test('clipboard snippets broadcast and sync to new peers', async (t) => {
  const { port } = await startServer(t);
  const origin = `http://127.0.0.1:${port}`;

  const wsA = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);
  const wsB = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);

  t.after(() => {
    if (wsA.readyState === WebSocket.OPEN) wsA.close();
    if (wsB.readyState === WebSocket.OPEN) wsB.close();
  });

  const wsARegistered = waitForMessageType(wsA, 'registered');
  const wsAClipboardState = waitForMessageType(wsA, 'clipboard-state');
  const wsBRegistered = waitForMessageType(wsB, 'registered');
  const wsBClipboardState = waitForMessageType(wsB, 'clipboard-state');
  wsA.send(JSON.stringify({ type: 'register', name: 'alpha', deviceType: 'desktop' }));
  wsB.send(JSON.stringify({ type: 'register', name: 'bravo', deviceType: 'desktop' }));
  await wsARegistered;
  await wsAClipboardState;
  await wsBRegistered;
  await wsBClipboardState;

  wsA.send(JSON.stringify({ type: 'clipboard-add', text: 'const LAN = true;' }));

  const addA = await waitForMessageType(wsA, 'clipboard-add');
  const addB = await waitForMessageType(wsB, 'clipboard-add');

  assert.equal(addA.snippet.text, 'const LAN = true;');
  assert.equal(addB.snippet.text, 'const LAN = true;');
  assert.equal(addA.snippet.name, 'alpha');
  assert.equal(addB.snippet.name, 'alpha');
  assert.equal(typeof addA.snippet.id, 'string');
  assert.equal(typeof addB.snippet.id, 'string');

  const wsC = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);
  t.after(() => {
    if (wsC.readyState === WebSocket.OPEN) wsC.close();
  });
  const wsCRegistered = waitForMessageType(wsC, 'registered');
  const wsCClipboardState = waitForMessageType(wsC, 'clipboard-state');
  wsC.send(JSON.stringify({ type: 'register', name: 'charlie', deviceType: 'desktop' }));
  await wsCRegistered;
  const stateC = await wsCClipboardState;
  assert.ok(Array.isArray(stateC.snippets));
  assert.ok(stateC.snippets.some((snippet) => snippet.text === 'const LAN = true;'));
});

test('clipboard snippets can be deleted and are removed from sync state', async (t) => {
  const { port } = await startServer(t);
  const origin = `http://127.0.0.1:${port}`;

  const wsA = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);
  const wsB = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);

  t.after(() => {
    if (wsA.readyState === WebSocket.OPEN) wsA.close();
    if (wsB.readyState === WebSocket.OPEN) wsB.close();
  });

  const wsARegistered = waitForMessageType(wsA, 'registered');
  const wsAClipboardState = waitForMessageType(wsA, 'clipboard-state');
  const wsBRegistered = waitForMessageType(wsB, 'registered');
  const wsBClipboardState = waitForMessageType(wsB, 'clipboard-state');
  wsA.send(JSON.stringify({ type: 'register', name: 'alpha', deviceType: 'desktop' }));
  wsB.send(JSON.stringify({ type: 'register', name: 'bravo', deviceType: 'desktop' }));
  await wsARegistered;
  await wsAClipboardState;
  await wsBRegistered;
  await wsBClipboardState;

  wsA.send(JSON.stringify({ type: 'clipboard-add', text: 'delete me' }));
  const addA = await waitForMessageType(wsA, 'clipboard-add');
  const addB = await waitForMessageType(wsB, 'clipboard-add');
  assert.equal(addA.snippet.id, addB.snippet.id);
  const snippetId = addA.snippet.id;

  wsB.send(JSON.stringify({ type: 'clipboard-delete', id: snippetId }));
  const deleteA = await waitForMessageType(wsA, 'clipboard-delete');
  const deleteB = await waitForMessageType(wsB, 'clipboard-delete');
  assert.equal(deleteA.id, snippetId);
  assert.equal(deleteB.id, snippetId);

  const wsC = await connectWebSocket(`ws://127.0.0.1:${port}/`, origin);
  t.after(() => {
    if (wsC.readyState === WebSocket.OPEN) wsC.close();
  });
  const wsCRegistered = waitForMessageType(wsC, 'registered');
  const wsCClipboardState = waitForMessageType(wsC, 'clipboard-state');
  wsC.send(JSON.stringify({ type: 'register', name: 'charlie', deviceType: 'desktop' }));
  await wsCRegistered;
  const stateC = await wsCClipboardState;
  assert.ok(Array.isArray(stateC.snippets));
  assert.ok(stateC.snippets.every((snippet) => snippet.id !== snippetId));
});
