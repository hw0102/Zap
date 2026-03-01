/**
 * hotspot.js — Offline signaling via QR codes for hotspot mode.
 *
 * When the signaling server is unreachable, two devices can establish
 * a WebRTC connection by exchanging SDP offers/answers as QR codes:
 *
 *   Creator: generate offer → show QR → scan answer QR → connected
 *   Joiner:  scan offer QR → generate answer → show QR → connected
 *
 * SDP payloads are compressed (strip unnecessary fields, deflate) to
 * fit within QR code capacity (~2953 bytes at version 40, ECC-L).
 */

class HotspotSignaling {
  constructor() {
    this.pc = null;
    this.dataChannel = null;
    this.handlers = {};
    this.cameraStream = null;
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }

  emit(event, data) {
    for (const fn of this.handlers[event] || []) fn(data);
  }

  // ---- SDP Compression ----
  // SDP offers/answers are typically 1-3KB. We strip redundant lines
  // and use base64 encoding to keep QR codes scannable.

  compressSDP(sdp) {
    // Remove blank lines and comments
    let lines = sdp.sdp.split('\r\n').filter(l => l.length > 0);

    // Strip candidates that aren't host (on LAN we only need host candidates)
    lines = lines.filter(l => {
      if (!l.startsWith('a=candidate:')) return true;
      return l.includes(' host ');
    });

    // Strip some verbose optional lines
    const skipPrefixes = ['a=ice-options:', 'a=msid-semantic:', 'a=extmap:'];
    lines = lines.filter(l => !skipPrefixes.some(p => l.startsWith(p)));

    const stripped = lines.join('\n');
    const json = JSON.stringify({ type: sdp.type, sdp: stripped });

    // Try to compress with CompressionStream if available
    return this.deflate(json);
  }

  async deflate(str) {
    if (typeof CompressionStream !== 'undefined') {
      const blob = new Blob([str]);
      const stream = blob.stream().pipeThrough(new CompressionStream('deflate'));
      const compressed = await new Response(stream).arrayBuffer();
      return this.arrayBufferToBase64(compressed);
    }
    // Fallback: just base64 the raw JSON
    return btoa(unescape(encodeURIComponent(str)));
  }

  async inflateSDP(encoded) {
    let json;
    if (typeof DecompressionStream !== 'undefined') {
      try {
        const binary = this.base64ToArrayBuffer(encoded);
        const blob = new Blob([binary]);
        const stream = blob.stream().pipeThrough(new DecompressionStream('deflate'));
        json = await new Response(stream).text();
      } catch {
        // Fallback: might be uncompressed base64
        json = decodeURIComponent(escape(atob(encoded)));
      }
    } else {
      json = decodeURIComponent(escape(atob(encoded)));
    }

    const parsed = JSON.parse(json);
    // Restore \r\n line endings for WebRTC
    parsed.sdp = parsed.sdp.replace(/\n/g, '\r\n') + '\r\n';
    return parsed;
  }

  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  base64ToArrayBuffer(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // ---- Creator flow ----

  async createSession(qrCanvas, canvasSize) {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.dataChannel = this.pc.createDataChannel('file-transfer', { ordered: true });
    this.dataChannel.binaryType = 'arraybuffer';

    // Wait for ICE gathering to complete before encoding offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    await this.waitForICE();

    const compressed = await this.compressSDP(this.pc.localDescription);
    QR.generate(compressed, qrCanvas, canvasSize);

    this.emit('offer-ready');
    return compressed.length;
  }

  async scanAnswerAndConnect(videoEl, canvasEl) {
    const encoded = await QR.scan(videoEl, canvasEl, 30000);
    this.stopCamera();

    const answer = await this.inflateSDP(encoded);
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));

    return new Promise((resolve, reject) => {
      this.dataChannel.onopen = () => {
        this.emit('connected');
        resolve(this.dataChannel);
      };
      this.dataChannel.onerror = (e) => reject(e);
      setTimeout(() => reject(new Error('Connection timeout')), 15000);
    });
  }

  // ---- Joiner flow ----

  async scanOfferAndRespond(videoEl, canvasEl) {
    const encoded = await QR.scan(videoEl, canvasEl, 30000);
    this.stopCamera();

    const offer = await this.inflateSDP(encoded);

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.pc.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this.dataChannel.binaryType = 'arraybuffer';
      this.dataChannel.onopen = () => this.emit('connected');
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    await this.waitForICE();

    return this.pc.localDescription;
  }

  async showAnswer(qrCanvas, canvasSize) {
    const compressed = await this.compressSDP(this.pc.localDescription);
    QR.generate(compressed, qrCanvas, canvasSize);
    this.emit('answer-ready');
    return compressed.length;
  }

  async waitForConnection() {
    if (this.dataChannel && this.dataChannel.readyState === 'open') return this.dataChannel;
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
          resolve(this.dataChannel);
        }
      };
      this.pc.ondatachannel = (e) => {
        this.dataChannel = e.channel;
        this.dataChannel.binaryType = 'arraybuffer';
        this.dataChannel.onopen = () => {
          this.emit('connected');
          resolve(this.dataChannel);
        };
      };
      // Also check if it's already assigned
      if (this.dataChannel) {
        this.dataChannel.onopen = () => {
          this.emit('connected');
          resolve(this.dataChannel);
        };
      }
      setTimeout(() => reject(new Error('Connection timeout')), 15000);
    });
  }

  // ---- Camera ----

  async startCamera(videoEl) {
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      videoEl.srcObject = this.cameraStream;
    } catch (err) {
      throw new Error('Camera access denied. Please allow camera access to scan QR codes.');
    }
  }

  stopCamera() {
    if (this.cameraStream) {
      for (const track of this.cameraStream.getTracks()) track.stop();
      this.cameraStream = null;
    }
  }

  // ---- Helpers ----

  waitForICE() {
    return new Promise((resolve) => {
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const onStateChange = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', onStateChange);
      // Safety timeout — don't wait forever for candidates
      setTimeout(resolve, 5000);
    });
  }

  getDataChannel() {
    return this.dataChannel;
  }

  getPeerConnection() {
    return this.pc;
  }

  close() {
    this.stopCamera();
    if (this.dataChannel) this.dataChannel.close();
    if (this.pc) this.pc.close();
    this.pc = null;
    this.dataChannel = null;
  }
}
