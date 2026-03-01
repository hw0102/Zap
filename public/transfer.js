/**
 * transfer.js — File chunking, reassembly, and progress tracking.
 * Sender: reads a File, slices into 64KB chunks, sends over the data channel.
 * Receiver: collects ArrayBuffer chunks, assembles into a Blob, triggers download.
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB
const BUFFER_THRESHOLD = 1 * 1024 * 1024; // 1 MB

class FileSender {
  constructor(peerConn, file) {
    this.peerConn = peerConn;
    this.file = file;
    this.totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    this.chunksSent = 0;
    this.cancelled = false;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.startTime = 0;
  }

  async start() {
    this.startTime = performance.now();
    const ch = this.peerConn.dataChannel;

    // Send metadata as JSON string
    ch.send(JSON.stringify({
      type: 'file-meta',
      name: this.file.name,
      size: this.file.size,
      mimeType: this.file.type,
      totalChunks: this.totalChunks,
    }));

    for (let i = 0; i < this.totalChunks; i++) {
      if (this.cancelled) return;

      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, this.file.size);
      const chunk = await this.readChunk(start, end);

      // Flow control: wait if buffer is full
      while (ch.bufferedAmount > BUFFER_THRESHOLD) {
        await this.waitForDrain(ch);
        if (this.cancelled) return;
      }

      ch.send(chunk);
      this.chunksSent++;

      if (this.onProgress) {
        const elapsed = (performance.now() - this.startTime) / 1000;
        const bytesSent = end;
        const speed = bytesSent / elapsed;
        const remaining = (this.file.size - bytesSent) / speed;
        this.onProgress({
          percent: bytesSent / this.file.size,
          bytesSent,
          totalBytes: this.file.size,
          speed,
          eta: remaining,
        });
      }
    }

    // Send completion signal
    ch.send(JSON.stringify({ type: 'file-complete' }));
    if (this.onComplete) this.onComplete();
  }

  readChunk(start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this.file.slice(start, end));
    });
  }

  waitForDrain(ch) {
    return new Promise((resolve) => {
      const check = () => {
        if (ch.bufferedAmount <= BUFFER_THRESHOLD) {
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      // Use bufferedamountlow event if available
      if (typeof ch.onbufferedamountlow !== 'undefined') {
        ch.bufferedAmountLowThreshold = BUFFER_THRESHOLD;
        ch.onbufferedamountlow = () => {
          ch.onbufferedamountlow = null;
          resolve();
        };
      } else {
        setTimeout(check, 10);
      }
    });
  }

  cancel() {
    this.cancelled = true;
  }
}


class FileReceiver {
  constructor() {
    this.meta = null;
    this.chunks = [];
    this.bytesReceived = 0;
    this.startTime = 0;
    this.onProgress = null;
    this.onComplete = null;
  }

  handleData(data) {
    // If it's a string, it's a JSON control message
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'file-meta') {
        this.meta = msg;
        this.chunks = [];
        this.bytesReceived = 0;
        this.startTime = performance.now();
        return;
      }

      if (msg.type === 'file-complete') {
        this.assemble();
        return;
      }
      return;
    }

    // Binary chunk
    if (!this.meta) return;
    this.chunks.push(data);
    this.bytesReceived += data.byteLength;

    if (this.onProgress) {
      const elapsed = (performance.now() - this.startTime) / 1000;
      const speed = this.bytesReceived / elapsed;
      const remaining = (this.meta.size - this.bytesReceived) / speed;
      this.onProgress({
        percent: this.bytesReceived / this.meta.size,
        bytesReceived: this.bytesReceived,
        totalBytes: this.meta.size,
        speed,
        eta: remaining,
      });
    }
  }

  assemble() {
    const blob = new Blob(this.chunks, { type: this.meta.mimeType || 'application/octet-stream' });
    this.triggerDownload(blob, this.meta.name);
    if (this.onComplete) this.onComplete({ name: this.meta.name, size: this.meta.size });
    this.meta = null;
    this.chunks = [];
  }

  triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

// Helpers

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatSpeed(bytesPerSec) {
  return formatBytes(bytesPerSec) + '/s';
}

function formatEta(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '--';
  if (seconds < 60) return Math.ceil(seconds) + 's';
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}
