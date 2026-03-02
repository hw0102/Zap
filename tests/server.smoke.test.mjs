import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';

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

test('server boots and serves core local endpoints', async (t) => {
  const port = await getFreePort();
  const expectedLine = `Zap server listening on 127.0.0.1:${port}`;

  const proc = spawn(process.execPath, ['server.js', '--dev'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    if (!proc.killed) proc.kill('SIGTERM');
  });

  await waitForServerReady(proc, expectedLine);

  const health = await httpGet('127.0.0.1', port, '/api/local-urls');
  assert.equal(health.statusCode, 200);
  const parsed = JSON.parse(health.body);
  assert.ok(Array.isArray(parsed.urls));

  const homepage = await httpGet('127.0.0.1', port, '/');
  assert.equal(homepage.statusCode, 200);
  assert.match(homepage.body, /<title>Zap<\/title>/i);
});
