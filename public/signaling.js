/**
 * signaling.js — WebSocket client for the Zap signaling server.
 * Handles device registration, peer discovery, and relaying WebRTC signaling.
 */

class SignalingClient {
  constructor() {
    this.ws = null;
    this.myId = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 8000;
    this.handlers = {};
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }

  emit(event, data) {
    for (const fn of this.handlers[event] || []) fn(data);
  }

  connect(deviceName, deviceType) {
    this.deviceName = deviceName;
    this.deviceType = deviceType;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.ws.send(JSON.stringify({
        type: 'register',
        name: deviceName,
        deviceType: deviceType,
      }));
    };

    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.emit('disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after onerror
    };
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'registered':
        this.myId = msg.id;
        this.emit('registered', { id: msg.id });
        break;
      case 'peers':
        // Exclude self from peer list
        this.emit('peers', msg.peers.filter(p => p.id !== this.myId));
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
      case 'file-request':
      case 'file-accept':
      case 'file-decline':
      case 'transfer-cancel':
        this.emit(msg.type, msg);
        break;
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  scheduleReconnect() {
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this.connect(this.deviceName, this.deviceType);
    }, this.reconnectDelay);
  }
}
