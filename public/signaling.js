/**
 * signaling.js — WebSocket client for the Zap signaling server.
 * Handles device registration, peer discovery, and relaying WebRTC signaling.
 */

class SignalingClient {
  constructor() {
    this.ws = null;
    this.myId = null;
    this.authToken = '';
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 8000;
    this.maxReconnectAttempts = 5;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.handlers = {};
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }

  emit(event, data) {
    for (const fn of this.handlers[event] || []) fn(data);
  }

  connect(deviceName, deviceType, authToken = '') {
    this.deviceName = deviceName;
    this.deviceType = deviceType;
    this.authToken = typeof authToken === 'string' ? authToken : '';
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = this.authToken ? `/?token=${encodeURIComponent(this.authToken)}` : '/';
    const url = `${proto}//${location.host}${wsPath}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.reconnectAttempts = 0;
      ws.send(JSON.stringify({
        type: 'register',
        name: deviceName,
        deviceType: deviceType,
      }));
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.emit('disconnected');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
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
      case 'chat-message':
      case 'chat-delete':
      case 'clipboard-state':
      case 'clipboard-add':
      case 'clipboard-delete':
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect-exhausted', {
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
      });
      return;
    }

    const attempt = this.reconnectAttempts + 1;
    const delayMs = this.reconnectDelay;
    this.emit('reconnecting', {
      attempt,
      maxAttempts: this.maxReconnectAttempts,
      delayMs,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts = attempt;
      this.reconnectDelay = Math.min(Math.round(this.reconnectDelay * 1.5), this.maxReconnectDelay);
      this.connect(this.deviceName, this.deviceType, this.authToken);
    }, delayMs);
  }

  manualReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.reconnectDelay = 1000;
    this.connect(this.deviceName, this.deviceType, this.authToken);
  }
}
