# Zap

<p align="center">
  <img src="public/zap-icon-alt-3a.svg" alt="Zap icon" width="144" />
</p>

Peer-to-peer local network file transfer in the browser using WebRTC.

Zap is a local-first web app for quickly sending files between devices on the same LAN/hotspot. The server is only for peer discovery and signaling; file data is transferred directly between browsers.

## Useful Scenarios

1. **Unstable or no outside internet, but local network still works**
   Teams on the same Wi-Fi/LAN can still share files, post quick session chat updates, and use shared clipboard snippets for coordination even when cloud chat/apps are unreliable.
2. **Field operations / pop-up teams**
   On construction sites, incident response setups, film sets, or lab environments, people can exchange photos, logs, and docs directly over a local hotspot without relying on external services.
3. **Classrooms, workshops, and local events**
   Instructors and participants can quickly distribute materials and gather submissions device-to-device on venue Wi-Fi, reducing setup friction and avoiding account sign-ins.

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
- Otherwise it falls back to HTTP.
- `npm run dev` and `npm run dev:lan` use HTTP.

Note: iOS Safari generally requires HTTPS for reliable WebRTC support.

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

- `npm start`: Run server (uses HTTPS if certs are present)
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

Passing CI status checks are required before merging.
