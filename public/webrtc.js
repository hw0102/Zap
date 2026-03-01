/**
 * webrtc.js — WebRTC peer connection and data channel management.
 * Creates P2P connections between browsers, relying on the signaling client
 * for SDP/ICE exchange.
 */

class PeerConnection {
  constructor(signaling, remotePeerId, isCaller) {
    this.signaling = signaling;
    this.remotePeerId = remotePeerId;
    this.isCaller = isCaller;
    this.handlers = {};

    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.dataChannel = null;
    this.setupPeerConnection();
  }

  on(event, fn) {
    (this.handlers[event] ||= []).push(fn);
  }

  emit(event, data) {
    for (const fn of this.handlers[event] || []) fn(data);
  }

  setupPeerConnection() {
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.signaling.send({
          type: 'ice-candidate',
          to: this.remotePeerId,
          candidate: e.candidate,
        });
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') this.emit('connected');
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.emit('disconnected');
      }
    };

    if (this.isCaller) {
      this.dataChannel = this.pc.createDataChannel('file-transfer', {
        ordered: true,
      });
      this.dataChannel.binaryType = 'arraybuffer';
      this.setupDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (e) => {
        this.dataChannel = e.channel;
        this.dataChannel.binaryType = 'arraybuffer';
        this.setupDataChannel(this.dataChannel);
      };
    }
  }

  setupDataChannel(ch) {
    ch.onopen = () => this.emit('channel-open');
    ch.onclose = () => this.emit('channel-close');
    ch.onerror = (e) => this.emit('channel-error', e);
    ch.onmessage = (e) => this.emit('data', e.data);
  }

  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signaling.send({
      type: 'offer',
      to: this.remotePeerId,
      sdp: this.pc.localDescription,
    });
  }

  async handleOffer(sdp) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    this.signaling.send({
      type: 'answer',
      to: this.remotePeerId,
      sdp: this.pc.localDescription,
    });
  }

  async handleAnswer(sdp) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async addIceCandidate(candidate) {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // ignore late candidates
    }
  }

  send(data) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      this.dataChannel.send(data);
    }
  }

  close() {
    if (this.dataChannel) this.dataChannel.close();
    this.pc.close();
  }
}
