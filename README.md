# Zap

Peer-to-peer local network file transfer in the browser using WebRTC.

Zap is a local-first web app for quickly sending files between devices on the same LAN/hotspot. The server is only for peer discovery and signaling; file data is transferred directly between browsers.

## Project Direction (Local Only)

- Zap is intended to run on a local machine and local network.
- It is not intended to be deployed as a public internet website.
- Keep contributions aligned with local/private usage and wireless transfer between nearby devices.

## Features

- Direct browser-to-browser transfers over WebRTC data channels
- Device discovery via WebSocket signaling
- Drag-and-drop or file picker upload flow
- Receiver accept/decline confirmation before transfer starts
- Real-time progress, transfer speed, and ETA
- PWA support via service worker + manifest
- Hotspot fallback mode with QR-based SDP exchange when signaling is unavailable

## Tech Stack

- Node.js + Express static server
- `ws` WebSocket signaling server
- Vanilla HTML/CSS/JS frontend
- WebRTC (`RTCPeerConnection` + `RTCDataChannel`)

## Requirements

- Node.js 18+
- npm
- Modern browsers with WebRTC support

## Setup

```bash
npm install
```

## Run Locally

For same-machine development:

```bash
npm run dev
```

For local-network sharing (other devices on your Wi-Fi/hotspot):

```bash
npm run dev:lan
```

Then open Zap from another device on the same network:

```text
http://<host-machine-lan-ip>:3000
```

Default mode:

```bash
npm start
```

By default Zap listens on port `3000`. To use a custom port:

```bash
PORT=8080 npm start
```

## HTTPS / TLS Behavior

`server.js` checks for:

- `certs/fullchain.pem`
- `certs/privkey.pem`

Behavior:

- If both files exist and you run `npm start`, Zap starts with HTTPS.
- If cert files are missing, `npm start` fails closed (won't start).
- `npm run dev` and `npm run dev:lan` are still HTTP for local development.
- If you intentionally want insecure HTTP in start mode, use `ALLOW_INSECURE_HTTP=1 npm start` (or `node server.js --insecure-http`).

Note: iOS Safari generally requires HTTPS for reliable WebRTC support.

### Create `certs/fullchain.pem` and `certs/privkey.pem`

#### Local LAN workflow with `mkcert` (macOS)

1. Install `mkcert`:

```bash
brew install mkcert
```

2. Install and trust the local CA (this prompts for your macOS admin password):

```bash
mkcert -install
```

3. Find your current LAN IP (use whichever interface is active):

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

4. Generate cert/key files for localhost and that LAN IP:

```bash
mkdir -p certs
mkcert -cert-file certs/fullchain.pem -key-file certs/privkey.pem localhost 127.0.0.1 ::1 <your-lan-ip>
```

5. Start Zap in HTTPS mode:

```bash
npm start
```

6. Verify TLS trust:

```bash
curl -fsS https://localhost:3000 >/dev/null && echo "HTTPS trust OK"
```

Note: browser/curl trust checks are the right signal on macOS; Node.js TLS clients may still report trust errors unless explicitly configured to use system roots.

If your machine's LAN IP changes, rerun step 4 with the new IP so the certificate SAN list stays valid.

For a public DNS hostname, use Let's Encrypt:

```bash
sudo certbot certonly --standalone -d your-hostname.example.com
mkdir -p certs
sudo cp /etc/letsencrypt/live/your-hostname.example.com/fullchain.pem certs/fullchain.pem
sudo cp /etc/letsencrypt/live/your-hostname.example.com/privkey.pem certs/privkey.pem
sudo chown "$(whoami)" certs/fullchain.pem certs/privkey.pem
chmod 600 certs/privkey.pem
```

## Signaling Hardening Options

- `ZAP_JOIN_TOKEN`: Optional shared token for signaling/auth-protected LAN use. Start with a token and open Zap using `https://<host>:3000/?token=<token>`.
- `ZAP_WS_MAX_PAYLOAD`: Max signaling message size in bytes (default `262144`).
- `ZAP_WS_RATE_WINDOW_MS`: Rate-limit window for signaling messages (default `5000`).
- `ZAP_WS_RATE_MAX_MESSAGES`: Allowed messages per connection per window (default `120`).
- `ZAP_MAX_TRANSFER_BYTES`: Max accepted transfer size for metadata validation (default `2147483648`).

## Usage

### Standard LAN Mode

1. Start Zap on a machine reachable by both devices.
2. Open Zap in both browsers on the same network.
3. Select a peer device.
4. Drop/select a file and send.
5. Receiver accepts and the transfer begins.

### Hotspot Fallback Mode

If signaling server connection fails, the app can switch to Hotspot Mode:

1. One device creates a session (shows offer QR).
2. Other device joins by scanning and generating answer QR.
3. Creator scans answer QR.
4. Data channel connects directly and transfer proceeds.

## Security and Privacy Notes

- File payloads are not stored by the server.
- Server relays signaling messages only.
- WebRTC data channels are encrypted (DTLS).
- Receiver must accept incoming transfer requests.

## Scripts

- `npm start`: Run secure server (requires TLS certs unless you explicitly set `ALLOW_INSECURE_HTTP=1`)
- `npm run dev`: Run local dev server bound to loopback (`127.0.0.1`)
- `npm run dev:lan`: Run dev server bound to all interfaces (`0.0.0.0`)
- `npm run check:syntax`: Syntax-check backend and frontend JS files
- `npm test`: Run smoke tests
- `npm run check`: Run all regression checks (`check:syntax` + `test`)

## CI for PR Merges

GitHub Actions runs `.github/workflows/ci.yml` on:

- Pull requests targeting `main`
- Direct pushes to `main`

The workflow installs dependencies and runs `npm run check` on Node 18 and Node 20.

For merge protection, set branch protection on `main` and require the CI status checks to pass before merging.
