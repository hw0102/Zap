# PRD: Zap — Peer-to-Peer LAN File Sharing

**Domain:** `zap.example.com`
**Author:** Zap Team
**Status:** Draft
**Last Updated:** 2026-03-01

---

## 1. Overview

Zap is a browser-based file sharing tool that enables instant peer-to-peer file transfers between devices on the same local network. Files travel directly between browsers via WebRTC data channels — no file relay, no intermediary storage, full LAN speed.

Think of it as a more reliable, cross-platform AirDrop that works between any two devices with a modern browser.

## 2. Problem Statement

AirDrop is unreliable (discovery failures, stuck transfers, Bluetooth dependency) and limited to Apple-to-Apple transfers. Existing alternatives either route data through the cloud (slow, privacy concerns) or require installing native apps on each device.

A browser-based solution eliminates installation friction, works on any device with a browser, and keeps all data on the local network.

## 3. Goals

- **Zero-install:** Open a URL on any device and start transferring immediately
- **Peer-to-peer:** File data never touches the server; transfers go directly between browsers
- **LAN-first:** Transfers are optimized for same-network peers and should not depend on TURN relays
- **Fast:** Transfers should approach the theoretical Wi-Fi speed limit
- **Simple:** The UI should be immediately obvious — no accounts, no configuration

## 4. Non-Goals (MVP)

- Guaranteed public internet transfers across different networks (no TURN relay in MVP)
- User accounts or authentication (may add optional PIN pairing later)
- File storage or history (files are streamed, never persisted)
- Native app wrappers
- Multi-network / VPN support

---

## 5. Architecture

### 5.1 High-Level Diagram

```
┌──────────────┐       signaling (WebSocket)       ┌──────────────┐
│  Device A    │◄─────── tiny JSON messages ───────►│  Signaling   │
│  (Browser)   │                                     │  Server      │
└──────┬───────┘                                     │  (Node.js)   │
       │                                             └──────┬───────┘
       │  WebRTC Data Channel                               │
       │  ◄══ FILE DATA (direct, P2P) ══►                   │
       │                                             WebSocket│
┌──────┴───────┐                                            │
│  Device B    │◄─────── tiny JSON messages ────────────────┘
│  (Browser)   │
└──────────────┘
```

### 5.2 Signaling Server

A minimal Node.js + WebSocket server responsible for:

1. **Device discovery** — maintains a list of currently connected devices; broadcasts presence updates
2. **SDP exchange** — relays WebRTC session descriptions (offer/answer) between peers
3. **ICE candidate relay** — forwards network path negotiation messages

The server handles only small JSON messages (typically < 1KB each). It never sees or stores file data.

**Runtime:** Node.js with `ws` (or Socket.IO) for persistent WebSocket signaling. The frontend is deployed separately on Vercel.

### 5.3 WebRTC Peer-to-Peer Layer

Once two devices have exchanged signaling data, a direct WebRTC `RTCPeerConnection` is established with an `RTCDataChannel` for binary transfer.

**LAN simplification:** On a local network, ICE negotiation resolves to direct host candidates (local IPs). STUN/TURN servers are unnecessary. A public STUN server (e.g., `stun:stun.l.google.com:19302`) can be included as a fallback but will rarely be used.

**Data channel configuration:**
- `ordered: true` (files must arrive in order)
- `maxRetransmits: undefined` (reliable delivery)
- Binary type: `arraybuffer`

### 5.4 File Transfer Protocol

Since WebRTC data channels have a per-message size limit (~256KB, varies by browser), files are chunked:

**Sender side:**
1. Read file using the `File` API
2. Slice into chunks (64KB recommended for broad compatibility)
3. Send a metadata message first: `{ type: "file-meta", name, size, mimeType, totalChunks }`
4. Send chunks sequentially as `ArrayBuffer` over the data channel
5. Send a completion message: `{ type: "file-complete" }`

**Receiver side:**
1. Receive metadata, prepare to accumulate chunks
2. Collect incoming `ArrayBuffer` chunks into an array
3. On completion, assemble into a `Blob` and trigger a download (or preview)

**Flow control:** Monitor `RTCDataChannel.bufferedAmount` before sending each chunk. If the buffer exceeds a threshold (e.g., 1MB), pause sending until `bufferedamountlow` event fires. This prevents overwhelming the channel and ensures smooth progress reporting.

### 5.5 Hosting, DNS, and TLS (Vercel + Cloudflare)

**Frontend hosting (Vercel):**
The static frontend is deployed on Vercel and served at `https://zap.example.com`.

**DNS (Cloudflare):**
`example.com` remains managed in Cloudflare DNS.

1. Add `zap` as a custom domain in Vercel
2. In Cloudflare, create `CNAME zap -> cname.vercel-dns.com` (or the exact target shown in Vercel)
3. Use `DNS only` proxy mode during setup/verification
4. Keep TTL on Auto

**Signaling backend:**
WebRTC signaling needs long-lived WebSocket connections and in-memory presence state. Keep the existing Node.js + `ws` signaling service on a long-running host (e.g., Railway/Fly/Render or your own server), exposed as `wss://signal.zap.example.com`.

In Cloudflare DNS, create `CNAME signal -> <signaling-provider-hostname>`.

The frontend reads a `SIGNALING_URL` value (e.g., `wss://signal.zap.example.com`) and connects there for discovery/offer-answer/ICE relay.

**TLS (required):**
Safari on iOS requires HTTPS for WebRTC APIs.

- Vercel auto-provisions and renews TLS for `zap.example.com`
- The signaling host must also serve valid TLS for `signal.zap.example.com`
- No local certbot flow is required for production deployment

---

## 6. Frontend Design

### 6.1 UI Concept

A single-page application with three states:

**State 1 — Lobby (waiting for peers)**
- Shows "You are: [Device Name]" (auto-generated or browser-derived)
- Animated indicator showing the device is discoverable
- List updates in real time as devices join/leave

**State 2 — Peer connected**
- Shows connected peer device(s)
- Large drag-and-drop zone (desktop) / file picker button (mobile)
- "Send File" action

**State 3 — Transfer in progress**
- File name and size
- Progress bar with percentage and transfer speed (MB/s)
- ETA
- Cancel button
- On completion: success animation, option to send another

### 6.2 Device Naming

Auto-assign friendly names based on User-Agent parsing:
- "Sender's iPhone" (iOS Safari)
- "Sender's MacBook" (macOS Chrome/Safari)
- Allow manual rename via click-to-edit

### 6.3 Responsive Design

The UI must work well on:
- iPhone Safari (primary mobile target)
- macOS Safari / Chrome (primary desktop target)
- Minimum: any modern browser with HTTPS and WebRTC support

### 6.4 Interaction Flow

1. Open `https://zap.example.com` on both devices
2. Both devices appear in each other's peer list automatically
3. On Device A: drag a file onto the drop zone (or tap to select on mobile)
4. Device A initiates a WebRTC connection to Device B via signaling
5. Device B receives an incoming transfer notification with file name/size and an Accept/Decline prompt
6. On accept, the data channel opens and chunks flow directly between browsers
7. On completion, Device B auto-downloads the file (or shows a preview for images)

---

## 7. Security

### 7.1 Internet-Exposed Entry Point

- `zap.example.com` is publicly reachable through Vercel HTTPS
- The signaling endpoint (`signal.zap.example.com`) is internet-reachable but relays only signaling metadata (no file payload)
- Security can no longer rely on private-IP isolation; transfer consent and signaling controls become primary

### 7.2 Transport Security

- All WebSocket signaling traffic is encrypted via TLS (HTTPS/WSS)
- WebRTC data channels use DTLS encryption by default — even on LAN, the peer-to-peer stream is encrypted end-to-end

### 7.3 Transfer Consent

- The receiver is always prompted to accept or decline an incoming file before any data is sent
- File metadata (name, size, type) is shown before acceptance

### 7.4 No Persistent Storage

- The server stores nothing to disk — it only relays ephemeral signaling messages in memory
- File data exists only in browser memory during transfer, then is either saved by the user or garbage collected
- No database, no logs of file contents

### 7.5 Future: PIN Pairing (Post-MVP)

If the network has untrusted devices (guests on Wi-Fi):
- Device A displays a 4-digit PIN
- Device B enters the PIN to pair
- Only paired devices can initiate transfers

---

## 8. Tech Stack

| Component         | Technology                                          |
|-------------------|-----------------------------------------------------|
| Frontend hosting  | Vercel                                              |
| DNS               | Cloudflare                                          |
| Signaling server  | Node.js + `ws` on a long-running host               |
| TLS               | Managed certs (Vercel for app + host cert for signal) |
| Frontend          | Vanilla HTML/CSS/JS (no framework)                  |
| Peer-to-peer      | WebRTC (RTCPeerConnection + RTCDataChannel)         |
| File handling     | File API, Blob, ArrayBuffer                         |

**Why vanilla JS:** The frontend is simple enough that a framework adds complexity without benefit. A single HTML file with embedded CSS/JS is easy to serve, debug, and maintain.

---

## 9. File Structure

```
zap/
├── server.js               # Express + WebSocket signaling server
├── package.json
├── certs/                   # Local TLS certs for non-Vercel dev (optional)
│   ├── fullchain.pem
│   └── privkey.pem
├── public/                  # Static frontend deployed to Vercel
│   ├── index.html           # Main (and only) HTML page
│   ├── style.css            # Responsive styles
│   ├── app.js               # Application logic, UI state management
│   ├── signaling.js         # WebSocket client for signaling
│   ├── webrtc.js            # RTCPeerConnection and data channel management
│   └── transfer.js          # File chunking, reassembly, progress tracking
├── vercel.json              # Vercel routing/build config (if needed)
├── .gitignore
└── README.md
```

---

## 10. Milestones

### MVP (V1)

| Milestone | Description | Estimate |
|-----------|-------------|----------|
| M1 | Signaling server with device discovery | 1 day |
| M2 | WebRTC connection establishment between two browsers | 1 day |
| M3 | File chunking and transfer over data channel | 1 day |
| M4 | Frontend UI with drag-and-drop, progress, and download | 1-2 days |
| M5 | Vercel deployment + custom domain + TLS + signaling URL wiring | 0.5 day |
| M6 | Testing across Mac Safari/Chrome ↔ iPhone Safari | 0.5 day |

**Total MVP estimate: ~5-6 days**

### Post-MVP Enhancements

| Feature | Description | Priority |
|---------|-------------|----------|
| PIN pairing | 4-digit PIN to restrict transfers to trusted devices | Medium |
| Multi-file transfer | Select and send multiple files or folders in one go | Medium |
| Image/video preview | Show thumbnails or previews before download on receiver | Low |
| Transfer history | In-memory log of recent transfers (clears on refresh) | Low |
| QR code join | Display a QR code on desktop for quick mobile access | Low |

---

## 11. V2: Hotspot Mode (No Wi-Fi Network Required)

### 11.1 Motivation

The MVP requires both devices to be on the same Wi-Fi network with the signaling server accessible. But sometimes there's no shared network available — you're outdoors, at a venue with no Wi-Fi, or on a network where devices can't see each other.

V2 adds a **hotspot mode** that lets two devices transfer files using only a mobile hotspot, with zero cellular data consumed for the actual file transfer.

### 11.2 Why Not Wi-Fi Direct?

Wi-Fi Direct (which AirDrop uses under the hood via Apple's AWDL protocol) requires OS-level access to the Wi-Fi radio — discovering nearby devices, negotiating a direct Wi-Fi link, establishing an ad-hoc network. Browsers are sandboxed and expose no APIs for this. The Web Bluetooth API is too slow (~100KB/s) and Web NFC is limited to tiny payloads. This is fundamentally why AirDrop, Nearby Share, etc. are native apps.

A mobile hotspot, however, creates a real local network — and that's all Zap needs.

### 11.3 How It Works

1. Device A (e.g., iPhone) enables its **Personal Hotspot** (Settings → Personal Hotspot)
2. Device B (e.g., MacBook or Android phone) joins Device A's hotspot Wi-Fi network
3. Both devices are now on the same local network, created by the hotspot
4. Both open `https://zap.example.com` and transfer files normally via WebRTC
5. File data travels locally over the hotspot's Wi-Fi radio — **it never touches cellular**

The only cellular data used is the initial DNS resolution and page load (~200-500 KB). Once the page is loaded, cellular data can even be disabled entirely and transfers will continue.

### 11.4 Technical Considerations

**Signaling server accessibility:**
In the new deployment model, signaling is hosted on the internet (`signal.zap.example.com`). If the hotspot has internet access, signaling works normally. If internet is unavailable, use an offline fallback. Three approaches:

**Option A — Portable signaling server (recommended for no-internet case):**
Run the signaling server on the device that joins the hotspot (e.g., if iPhone is the hotspot, run the server on the Mac that joins it). The Mac's local IP on the hotspot network becomes the signaling endpoint. This requires the server to be installed on a device you bring with you, but provides the smoothest UX.

**Option B — Pre-cached PWA + manual signaling fallback (recommended as fallback):**
The frontend is a PWA with a service worker that caches all assets. When the signaling server is unreachable, the app falls back to a manual signaling exchange:
1. Device A generates a WebRTC offer and displays it as a QR code
2. Device B scans the QR code, generating an answer
3. Device B displays its answer as a QR code
4. Device A scans it, completing the WebRTC handshake
5. The data channel is established — file transfer proceeds as normal

This involves two QR scans (more friction) but requires zero infrastructure and works fully offline.

**Option C — Embedded signaling via shared URL hash:**
One device generates the SDP offer, encodes it as a compressed base64 string in a URL fragment (e.g., `zap.example.com/#offer=<encoded>`). The other device opens this URL (via QR code), decodes the offer, generates an answer, and encodes it back. Slightly simpler than Option B but limited by URL length constraints for large SDP blobs.

**Recommended strategy:** Option A for the common case (Mac + iPhone), with Option B as a graceful offline fallback.

### 11.5 PWA Requirements for Offline Support

To support hotspot mode, the frontend must work offline after the first visit:

- **Service worker** caches all static assets (HTML, CSS, JS) on first visit
- **App manifest** enables "Add to Home Screen" on iOS and Android for an app-like experience
- **Offline detection** in the app: when the signaling server WebSocket fails to connect, show a banner: "Server unreachable — switch to Hotspot Mode" and present the QR code pairing flow
- **Cache versioning** so updates propagate when the user is back on the main network

### 11.6 Hotspot Mode UX

**Happy path (server running on a device on the hotspot network):**
Identical to MVP — no user action needed beyond creating/joining the hotspot. Devices discover each other and transfer as usual.

**Fallback path (no server available):**
1. Both devices open Zap from PWA cache
2. App detects no signaling server and shows "Hotspot Mode" banner
3. Device A taps "Create Session" → generates WebRTC offer → displays QR code
4. Device B taps "Join Session" → scans QR code → generates answer → displays QR code
5. Device A scans answer QR code
6. WebRTC connection established — file transfer proceeds as normal
7. UI clearly indicates "Direct connection — no server needed"

### 11.7 Data Usage Summary

| Action | Data source | Cellular cost |
|--------|-------------|---------------|
| Initial page load (first time ever) | Internet | ~200-500 KB |
| Subsequent loads (PWA cached) | Local cache | 0 |
| DNS resolution | Internet | Negligible |
| Signaling (if server on hotspot) | Local (hotspot Wi-Fi) | 0 |
| Signaling (QR code fallback) | Camera / screen | 0 |
| File transfer (WebRTC data channel) | Local (hotspot Wi-Fi) | 0 |

**Bottom line:** After the first page load, hotspot mode costs zero cellular data.

### 11.8 Limitations

- Requires one device to create a hotspot (not all devices/plans support this)
- Hotspot Wi-Fi speeds are typically slower than a dedicated router (~20-50 MB/s vs ~100+ MB/s)
- QR code fallback involves two scans — more friction than automatic discovery
- SDP offers can be large (~2-3KB); QR codes at this size require high resolution but are still scannable
- The signaling server must either be on the hotspot network or the QR fallback is used

---

## 12. Open Questions

1. **Chunk size optimization:** 64KB is safe but conservative. Should we benchmark larger chunks (128KB, 256KB) on Safari iOS to find the sweet spot for throughput vs. compatibility?
2. **Multiple simultaneous transfers:** Should the MVP support sending to multiple peers at once, or is one-at-a-time sufficient?
3. **Large file handling:** For files > 1GB, should we implement `ReadableStream`-based chunking to avoid loading the entire file into memory?
4. **Notification API:** Should the receiver get a browser notification when a transfer request comes in (useful if the tab is in the background)?
5. **mDNS alternative:** Could `zap.local` via mDNS replace the real domain, avoiding TLS/DNS complexity entirely? (Tradeoff: mDNS is flaky on some platforms and Safari may still require HTTPS.)
6. **SDP compression for QR codes:** In hotspot mode, can we use SDP munging or compression (e.g., stripping unnecessary candidates, gzip + base64) to keep QR codes small enough for reliable scanning?
