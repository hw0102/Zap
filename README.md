# Zap

Peer-to-peer LAN file sharing in the browser using WebRTC.

Zap is a self-hosted web app for quickly sending files between devices on the same local network. The server handles discovery and signaling only; file data goes directly between browsers.

## Features

- Direct browser-to-browser transfers over WebRTC data channels
- Device discovery via WebSocket signaling
- Drag-and-drop or file picker upload flow
- Receiver accept/decline confirmation before transfer starts
- Real-time progress, transfer speed, and ETA
- PWA support via service worker + manifest
- Hotspot fallback mode with QR-based SDP exchange when server signaling is unavailable

## Tech Stack

- Node.js + Express static server
- `ws` WebSocket signaling server
- Vanilla HTML/CSS/JS frontend
- WebRTC (`RTCPeerConnection` + `RTCDataChannel`)

## Project Structure

```text
.
├── server.js
├── package.json
├── certs/                 # Optional TLS certs (not committed)
└── public/
    ├── index.html
    ├── style.css
    ├── app.js
    ├── signaling.js
    ├── webrtc.js
    ├── transfer.js
    ├── hotspot.js
    ├── qr.js
    ├── sw.js
    └── manifest.json
```

## Requirements

- Node.js 18+ (recommended)
- npm
- Modern browsers with WebRTC support

## Setup

```bash
npm install
```

## Run

Development mode (HTTP):

```bash
npm run dev
```

Default mode:

```bash
npm start
```

By default Zap listens on port `3000`. Set a custom port with:

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
- `npm run dev` always uses HTTP.

Note: iOS Safari generally requires HTTPS for full WebRTC support.

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

## Current Limitations

- One active peer connection at a time
- UI currently sends one selected file per transfer action
- No transfer history or authentication
- LAN-focused design (not intended for public internet transfer)

## Security and Privacy Notes

- File payloads are not stored by the server.
- Server relays signaling messages only.
- WebRTC data channels are encrypted (DTLS).
- Receiver must accept incoming transfer requests.

## Scripts

- `npm start`: Run server (uses HTTPS if certs are present)
- `npm run dev`: Run server in development mode (HTTP)
