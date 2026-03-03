/**
 * transfer.js — File chunking, reassembly, and progress tracking.
 * Sender: reads a File, slices into 64KB chunks, sends over the data channel.
 * Receiver: collects ArrayBuffer chunks, assembles into a Blob, triggers download.
 */

const CHUNK_SIZE = 64 * 1024; // 64 KB
const BUFFER_THRESHOLD = 1 * 1024 * 1024; // 1 MB
const DEFAULT_MAX_RECEIVE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const DEFAULT_TRANSFER_TIMEOUT_MS = 120000;

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
    try {
      this.startTime = performance.now();
      const ch = this.peerConn.dataChannel;

      if (!ch || ch.readyState !== 'open') {
        throw new Error('Data channel not open');
      }

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

        if (ch.readyState !== 'open') {
          throw new Error('Data channel closed during transfer');
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

      // Send completion signal and wait for it to leave the send buffer
      ch.send(JSON.stringify({ type: 'file-complete' }));
      await this.waitForBufferDrain(ch);
      if (this.onComplete) this.onComplete();
    } catch (err) {
      console.error('FileSender error:', err);
      if (this.onError) this.onError(err);
    }
  }

  readChunk(start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this.file.slice(start, end));
    });
  }

  waitForBufferDrain(ch) {
    return new Promise((resolve) => {
      const check = () => {
        if (ch.bufferedAmount === 0) resolve();
        else setTimeout(check, 10);
      };
      check();
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
  constructor(options = {}) {
    this.meta = null;
    this.chunks = [];
    this.bytesReceived = 0;
    this.startTime = 0;
    this.timeoutId = null;
    this.maxReceiveBytes = Number.isInteger(options.maxReceiveBytes) && options.maxReceiveBytes > 0
      ? options.maxReceiveBytes
      : DEFAULT_MAX_RECEIVE_BYTES;
    this.transferTimeoutMs = Number.isInteger(options.transferTimeoutMs) && options.transferTimeoutMs > 0
      ? options.transferTimeoutMs
      : DEFAULT_TRANSFER_TIMEOUT_MS;
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
  }

  handleData(data) {
    // If it's a string, it's a JSON control message
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'file-meta') {
        const meta = this.validateMeta(msg);
        if (!meta) {
          this.fail(new Error('Invalid incoming file metadata'));
          return;
        }
        this.meta = meta;
        this.chunks = [];
        this.bytesReceived = 0;
        this.startTime = performance.now();
        this.touchTimeout();
        return;
      }

      if (msg.type === 'file-complete') {
        if (!this.meta) return;
        if (this.bytesReceived !== this.meta.size) {
          this.fail(new Error('Incoming file ended before all bytes were received'));
          return;
        }
        this.assemble();
        return;
      }
      return;
    }

    // Binary chunk
    if (!this.meta) return;
    const chunkLength = this.getChunkLength(data);
    if (chunkLength === null) {
      this.fail(new Error('Incoming transfer sent an unsupported chunk type'));
      return;
    }
    const nextBytes = this.bytesReceived + chunkLength;
    if (nextBytes > this.meta.size || nextBytes > this.maxReceiveBytes) {
      this.fail(new Error('Incoming transfer exceeded expected size'));
      return;
    }

    this.chunks.push(data);
    this.bytesReceived = nextBytes;
    this.touchTimeout();

    if (this.onProgress) {
      const elapsed = Math.max((performance.now() - this.startTime) / 1000, 0.001);
      const speed = this.bytesReceived / elapsed;
      const remaining = (this.meta.size - this.bytesReceived) / speed;
      this.onProgress({
        percent: this.meta.size === 0 ? 1 : this.bytesReceived / this.meta.size,
        bytesReceived: this.bytesReceived,
        totalBytes: this.meta.size,
        speed,
        eta: remaining,
      });
    }
  }

  validateMeta(msg) {
    if (!msg || typeof msg.name !== 'string') return null;

    const name = msg.name.trim().slice(0, 255);
    if (!name) return null;

    const size = Number(msg.size);
    if (!Number.isInteger(size) || size < 0 || size > this.maxReceiveBytes) return null;

    let mimeType = '';
    if (typeof msg.mimeType === 'string') {
      mimeType = msg.mimeType.slice(0, 128);
    }

    return {
      name,
      size,
      mimeType,
    };
  }

  getChunkLength(data) {
    if (data instanceof ArrayBuffer) return data.byteLength;
    if (ArrayBuffer.isView(data)) return data.byteLength;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.size;
    return null;
  }

  touchTimeout() {
    if (!this.transferTimeoutMs) return;
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.timeoutId = setTimeout(() => {
      this.fail(new Error('Incoming transfer timed out'));
    }, this.transferTimeoutMs);
  }

  clearTimeoutGuard() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  resetTransferState() {
    this.clearTimeoutGuard();
    this.meta = null;
    this.chunks = [];
    this.bytesReceived = 0;
    this.startTime = 0;
  }

  fail(err) {
    const error = err instanceof Error ? err : new Error(String(err));
    this.resetTransferState();
    if (this.onError) this.onError(error);
  }

  dispose() {
    this.resetTransferState();
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
  }

  assemble() {
    try {
      const info = { name: this.meta.name, size: this.meta.size };
      const blob = new Blob(this.chunks, { type: this.meta.mimeType || 'application/octet-stream' });
      this.triggerDownload(blob, this.meta.name);
      this.resetTransferState();
      if (this.onComplete) this.onComplete(info);
    } catch (err) {
      this.fail(err);
    }
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
