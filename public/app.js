/**
 * app.js — Application logic and UI state management for Zap.
 * Wires together signaling, WebRTC, and file transfer modules.
 */

(function () {
  'use strict';

  // ---- Device detection ----

  function detectDeviceType() {
    const ua = navigator.userAgent;
    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'tablet';
    if (/iPhone|iPod|Android.*Mobile/i.test(ua)) return 'phone';
    return 'desktop';
  }

  // ---- Creative name generator ----

  const NAME_ADJECTIVES = [
    'swift', 'brave', 'calm', 'bold', 'cool', 'warm', 'keen', 'wild',
    'wise', 'fair', 'kind', 'glad', 'happy', 'lucky', 'witty', 'noble',
    'gentle', 'bright', 'quiet', 'sharp', 'vivid', 'cosmic', 'amber',
    'coral', 'jade', 'merry', 'snowy', 'sunny', 'lunar', 'rapid',
  ];

  const NAME_NOUNS = [
    'fox', 'owl', 'bear', 'wolf', 'deer', 'hawk', 'swan', 'dove',
    'lynx', 'crow', 'panda', 'tiger', 'eagle', 'whale', 'otter',
    'robin', 'finch', 'raven', 'koala', 'gecko', 'bison', 'moose',
    'crane', 'heron', 'manta', 'falcon', 'badger', 'parrot', 'coyote',
    'dolphin',
  ];

  function generateCreativeName() {
    const adj = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
    const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
    return `${adj}-${noun}`;
  }

  function getDefaultDeviceName() {
    const stored = localStorage.getItem('zap-device-name');
    if (stored) return stored;

    const name = generateCreativeName();
    localStorage.setItem('zap-device-name', name);
    return name;
  }

  function deviceIcon(type) {
    const icons = {
      phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
      tablet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>',
      desktop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
      unknown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    };
    return icons[type] || icons.unknown;
  }

  // ---- DOM refs ----

  const $ = (sel) => document.querySelector(sel);
  const lobbyView = $('#lobbyView');
  const peersView = $('#peersView');
  const transferView = $('#transferView');
  const peersGrid = $('#peersGrid');
  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');
  const browseBtn = $('#browseBtn');
  const deviceNameEl = $('#deviceName');
  const renameBtn = $('#renameBtn');
  const renameModal = $('#renameModal');
  const renameInput = $('#renameInput');
  const renameCancelBtn = $('#renameCancelBtn');
  const renameSaveBtn = $('#renameSaveBtn');
  const transferCard = $('#transferCard');
  const transferComplete = $('#transferComplete');
  const transferFileName = $('#transferFileName');
  const transferFileSize = $('#transferFileSize');
  const transferDirection = $('#transferDirection');
  const progressFill = $('#progressFill');
  const progressPercent = $('#progressPercent');
  const progressSpeed = $('#progressSpeed');
  const progressEta = $('#progressEta');
  const cancelBtn = $('#cancelBtn');
  const sendAnotherBtn = $('#sendAnotherBtn');
  const incomingModal = $('#incomingModal');
  const modalFileName = $('#modalFileName');
  const modalFileSize = $('#modalFileSize');
  const modalFromDevice = $('#modalFromDevice');
  const acceptBtn = $('#acceptBtn');
  const declineBtn = $('#declineBtn');
  const completeMessage = $('#completeMessage');
  const shareUrlValue = $('#shareUrlValue');
  const shareUrlCopyBtn = $('#shareUrlCopyBtn');
  const shareUrlExtra = $('#shareUrlExtra');
  const chatMessagesEl = $('#chatMessages');
  const chatForm = $('#chatForm');
  const chatInput = $('#chatInput');
  const chatSendBtn = $('#chatSendBtn');
  const clipboardListEl = $('#clipboardList');
  const clipboardForm = $('#clipboardForm');
  const clipboardInput = $('#clipboardInput');
  const clipboardAddBtn = $('#clipboardAddBtn');

  // Hotspot mode DOM refs
  const hotspotView = $('#hotspotView');
  const hotspotActions = $('#hotspotActions');
  const createSessionBtn = $('#createSessionBtn');
  const joinSessionBtn = $('#joinSessionBtn');
  const qrDisplay = $('#qrDisplay');
  const qrCanvas = $('#qrCanvas');
  const qrTitle = $('#qrTitle');
  const qrSubtitle = $('#qrSubtitle');
  const qrBackBtn = $('#qrBackBtn');
  const qrScanner = $('#qrScanner');
  const scannerVideo = $('#scannerVideo');
  const scannerCanvas = $('#scannerCanvas');
  const scanTitle = $('#scanTitle');
  const scanSubtitle = $('#scanSubtitle');
  const scanBackBtn = $('#scanBackBtn');
  const hotspotConnected = $('#hotspotConnected');
  const hotspotDropZone = $('#hotspotDropZone');
  const hotspotBrowseBtn = $('#hotspotBrowseBtn');
  const hotspotFileInput = $('#hotspotFileInput');

  // ---- State ----

  let selectedPeerId = null;
  let peerList = [];
  let peerConnection = null; // active PeerConnection instance
  let fileSender = null;
  let fileReceiver = null;
  let pendingIncomingData = [];
  let pendingRequest = null; // incoming file request awaiting accept/decline
  let hotspot = null; // HotspotSignaling instance when in hotspot mode
  let isOffline = false;
  let shareUrls = [];
  const MAX_CHAT_ITEMS = 120;
  const MAX_CLIPBOARD_ITEMS = 120;

  // ---- Signaling ----

  const signaling = new SignalingClient();
  const myDeviceType = detectDeviceType();
  let myDeviceName = getDefaultDeviceName();
  const authToken = new URLSearchParams(location.search).get('token') || '';

  signaling.connect(myDeviceName, myDeviceType, authToken);

  signaling.on('registered', ({ id }) => {
    isOffline = false;
    deviceNameEl.textContent = myDeviceName;
    if (chatSendBtn) chatSendBtn.disabled = false;
    if (clipboardAddBtn) clipboardAddBtn.disabled = false;
  });

  signaling.on('peers', (peers) => {
    peerList = peers;
    renderPeers();
    showView(peers.length > 0 ? 'peers' : 'lobby');
  });

  signaling.on('disconnected', () => {
    deviceNameEl.textContent = 'Reconnecting...';
    if (chatSendBtn) chatSendBtn.disabled = true;
    if (clipboardAddBtn) clipboardAddBtn.disabled = true;
    // After a delay, if still not connected, offer hotspot mode
    setTimeout(() => {
      if (!signaling.myId || (signaling.ws && signaling.ws.readyState !== WebSocket.OPEN)) {
        isOffline = true;
        deviceNameEl.textContent = 'Offline';
        showView('hotspot');
      }
    }, 4000);
  });

  signaling.on('chat-message', (msg) => {
    appendChatMessage(msg);
  });

  signaling.on('chat-delete', (msg) => {
    removeChatMessage(msg.id);
  });

  signaling.on('clipboard-state', (msg) => {
    replaceClipboardSnippets(msg.snippets);
  });

  signaling.on('clipboard-add', (msg) => {
    appendClipboardSnippet(msg.snippet);
  });

  signaling.on('clipboard-delete', (msg) => {
    removeClipboardSnippet(msg.id);
  });

  // ---- Incoming signaling (callee side) ----

  signaling.on('offer', async (msg) => {
    // Received an offer — we are the callee
    try {
      if (peerConnection) peerConnection.close();
      peerConnection = new PeerConnection(signaling, msg.from, false);
      setupPeerConnectionHandlers(peerConnection, msg.from);
      await peerConnection.handleOffer(msg.sdp);
    } catch (err) {
      console.error('Error handling offer:', err);
    }
  });

  signaling.on('answer', async (msg) => {
    try {
      if (peerConnection) await peerConnection.handleAnswer(msg.sdp);
    } catch (err) {
      console.error('Error handling answer:', err);
    }
  });

  signaling.on('ice-candidate', async (msg) => {
    try {
      if (peerConnection) await peerConnection.addIceCandidate(msg.candidate);
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  });

  signaling.on('file-request', (msg) => {
    // Someone wants to send us a file
    const fromPeer = peerList.find(p => p.id === msg.from);
    pendingRequest = { from: msg.from, meta: msg.meta };
    modalFileName.textContent = msg.meta.name;
    modalFileSize.textContent = formatBytes(msg.meta.size);
    modalFromDevice.textContent = fromPeer ? fromPeer.name : 'Unknown';
    incomingModal.hidden = false;
  });

  signaling.on('file-accept', async (msg) => {
    // Receiver accepted — now establish WebRTC and send
    try {
      if (peerConnection) peerConnection.close();
      peerConnection = new PeerConnection(signaling, msg.from, true);
      setupPeerConnectionHandlers(peerConnection, msg.from);

      peerConnection.on('channel-open', () => {
        clearTimeout(connectionTimeout);
        startSending();
      });

      // Timeout if WebRTC connection isn't established in 15 seconds
      var connectionTimeout = setTimeout(() => {
        if (fileSender) return; // already sending
        console.error('WebRTC connection timed out');
        if (peerConnection) {
          peerConnection.close();
          peerConnection = null;
        }
        pendingFile = null;
        showView('peers');
        alert('Connection timed out. Make sure both devices are on the same network and try again.');
      }, 15000);

      await peerConnection.createOffer();
    } catch (err) {
      console.error('Error creating WebRTC offer:', err);
      pendingFile = null;
      showView('peers');
    }
  });

  signaling.on('file-decline', () => {
    showView('peers');
  });

  signaling.on('transfer-cancel', () => {
    if (fileSender) fileSender.cancel();
    fileSender = null;
    if (fileReceiver) fileReceiver.dispose();
    fileReceiver = null;
    pendingIncomingData = [];
    if (peerConnection) peerConnection.close();
    peerConnection = null;
    showView('peers');
  });

  function setupPeerConnectionHandlers(pc, remotePeerId) {
    pendingIncomingData = [];

    // Attach immediately so early messages (file-meta) are not dropped.
    pc.on('data', (data) => {
      if (!fileReceiver) {
        pendingIncomingData.push(data);
        return;
      }
      fileReceiver.handleData(data);
    });

    pc.on('disconnected', () => {
      if (fileSender) fileSender.cancel();
    });

    pc.on('ice-failed', () => {
      console.error('ICE connection failed — cleaning up');
      cleanupTransfer();
      showView('peers');
      alert('Could not connect to the other device. Make sure both devices are on the same network.');
    });
  }

  function flushPendingIncomingData() {
    if (!fileReceiver || pendingIncomingData.length === 0) return;
    for (const data of pendingIncomingData) fileReceiver.handleData(data);
    pendingIncomingData = [];
  }

  // ---- Views ----

  function showView(name) {
    lobbyView.classList.toggle('active', name === 'lobby');
    peersView.classList.toggle('active', name === 'peers');
    transferView.classList.toggle('active', name === 'transfer');
    hotspotView.classList.toggle('active', name === 'hotspot');

    if (name === 'transfer') {
      transferCard.hidden = false;
      transferComplete.hidden = true;
    }

    if (name === 'hotspot') {
      hotspotActions.hidden = false;
      qrDisplay.hidden = true;
      qrScanner.hidden = true;
      hotspotConnected.hidden = true;
    }
  }

  function renderShareUrls(urls) {
    if (!shareUrlValue) return;

    const unique = [...new Set((urls || []).filter(Boolean))];
    const host = location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const localShareUrl = authToken
      ? `${location.origin}/?token=${encodeURIComponent(authToken)}`
      : location.origin;
    const fallback = isLocalhost ? [] : [localShareUrl];
    shareUrls = unique.length > 0 ? unique : fallback;

    if (shareUrls.length === 0) {
      shareUrlValue.textContent = 'LAN URL unavailable';
      if (shareUrlExtra) {
        shareUrlExtra.hidden = false;
        shareUrlExtra.textContent = 'Start with npm run dev:lan and reload this page.';
      }
      if (shareUrlCopyBtn) shareUrlCopyBtn.disabled = true;
      return;
    }

    if (shareUrlCopyBtn) shareUrlCopyBtn.disabled = false;
    shareUrlValue.textContent = shareUrls[0];

    if (shareUrls.length > 1 && shareUrlExtra) {
      shareUrlExtra.hidden = false;
      shareUrlExtra.textContent = `Also available: ${shareUrls.slice(1).join('  |  ')}`;
      return;
    }

    if (shareUrlExtra) {
      shareUrlExtra.hidden = true;
      shareUrlExtra.textContent = '';
    }
  }

  async function loadShareUrls() {
    if (!shareUrlValue) return;

    try {
      const endpoint = authToken
        ? `/api/local-urls?token=${encodeURIComponent(authToken)}`
        : '/api/local-urls';
      const resp = await fetch(endpoint, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`Request failed (${resp.status})`);
      const body = await resp.json();
      renderShareUrls(Array.isArray(body.urls) ? body.urls : []);
    } catch {
      const localShareUrl = authToken
        ? `${location.origin}/?token=${encodeURIComponent(authToken)}`
        : location.origin;
      renderShareUrls([localShareUrl]);
    }
  }

  // ---- Session chat ----

  function renderChatEmptyState() {
    if (!chatMessagesEl || chatMessagesEl.children.length > 0) return;
    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.textContent = 'No messages yet. Start the conversation for this LAN session.';
    chatMessagesEl.appendChild(empty);
  }

  function formatChatTime(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function resolveAuthorName(msg) {
    if (typeof msg.name === 'string' && msg.name.trim()) return msg.name.trim();
    if (msg.from === signaling.myId) return myDeviceName;
    const peer = peerList.find((p) => p.id === msg.from);
    return peer ? peer.name : 'Unknown device';
  }

  function sanitizeListItemId(value) {
    if (typeof value !== 'string') return null;
    const id = value.trim();
    if (!id || id.length > 64) return null;
    return id;
  }

  function findChatMessageElementById(id) {
    if (!chatMessagesEl) return null;
    for (const child of chatMessagesEl.children) {
      if (child.classList && child.classList.contains('chat-message') && child.dataset.chatId === id) {
        return child;
      }
    }
    return null;
  }

  function appendChatMessage(msg) {
    if (!chatMessagesEl || !msg || typeof msg.text !== 'string') return;
    const text = msg.text.trim();
    if (!text) return;
    const messageId = sanitizeListItemId(msg.id);
    if (messageId && findChatMessageElementById(messageId)) return;

    const empty = chatMessagesEl.querySelector('.chat-empty');
    if (empty) empty.remove();

    const messageEl = document.createElement('article');
    messageEl.className = 'chat-message';
    if (messageId) {
      messageEl.dataset.chatId = messageId;
    }
    if (msg.from === signaling.myId) {
      messageEl.classList.add('self');
    }

    const metaEl = document.createElement('div');
    metaEl.className = 'chat-meta';

    const authorEl = document.createElement('span');
    authorEl.className = 'chat-author';
    authorEl.textContent = resolveAuthorName(msg);

    const timeEl = document.createElement('span');
    timeEl.className = 'chat-time';
    timeEl.textContent = formatChatTime(msg.ts || Date.now());

    const textEl = document.createElement('p');
    textEl.className = 'chat-text';
    textEl.textContent = text;

    metaEl.appendChild(authorEl);
    metaEl.appendChild(timeEl);
    messageEl.appendChild(metaEl);
    messageEl.appendChild(textEl);

    if (messageId && msg.from === signaling.myId) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'chat-actions';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'chat-delete-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.dataset.deleteChat = messageId;
      deleteBtn.setAttribute('aria-label', 'Delete this message');

      actionsEl.appendChild(deleteBtn);
      messageEl.appendChild(actionsEl);
    }

    chatMessagesEl.appendChild(messageEl);

    while (chatMessagesEl.children.length > MAX_CHAT_ITEMS) {
      chatMessagesEl.removeChild(chatMessagesEl.firstElementChild);
    }

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function removeChatMessage(rawId) {
    if (!chatMessagesEl) return;
    const id = sanitizeListItemId(rawId);
    if (!id) return;
    const messageEl = findChatMessageElementById(id);
    if (!messageEl) return;
    messageEl.remove();
    renderChatEmptyState();
  }

  function renderClipboardEmptyState() {
    if (!clipboardListEl || clipboardListEl.children.length > 0) return;
    const empty = document.createElement('p');
    empty.className = 'clipboard-empty';
    empty.textContent = 'No snippets yet. Add text for everyone to copy quickly.';
    clipboardListEl.appendChild(empty);
  }

  function sanitizeSnippetForView(snippet) {
    if (!snippet || typeof snippet !== 'object') return null;
    if (typeof snippet.id !== 'string' || snippet.id.length > 64) return null;
    if (typeof snippet.text !== 'string') return null;
    const text = snippet.text.trim();
    if (!text || text.length > 800) return null;

    const name = typeof snippet.name === 'string' && snippet.name.trim()
      ? snippet.name.trim().slice(0, 50)
      : 'Unknown device';
    const ts = Number.isFinite(Number(snippet.ts)) ? Number(snippet.ts) : Date.now();

    return {
      id: snippet.id,
      text,
      name,
      ts,
    };
  }

  function createClipboardItemElement(snippet) {
    const item = document.createElement('article');
    item.className = 'clipboard-item';
    item.dataset.snippetId = snippet.id;

    const header = document.createElement('div');
    header.className = 'clipboard-item-header';

    const author = document.createElement('span');
    author.className = 'clipboard-author';
    author.textContent = snippet.name;

    const time = document.createElement('span');
    time.className = 'clipboard-time';
    time.textContent = formatChatTime(snippet.ts);

    const text = document.createElement('p');
    text.className = 'clipboard-text';
    text.textContent = snippet.text;

    const actions = document.createElement('div');
    actions.className = 'clipboard-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'clipboard-copy-btn';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy';
    copyBtn.dataset.copySnippet = snippet.id;
    copyBtn.setAttribute('aria-label', 'Copy snippet text');

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'clipboard-delete-btn';
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.dataset.deleteSnippet = snippet.id;
    deleteBtn.setAttribute('aria-label', 'Delete snippet');

    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);
    header.appendChild(author);
    header.appendChild(time);
    item.appendChild(header);
    item.appendChild(text);
    item.appendChild(actions);
    return item;
  }

  function findSnippetElementById(id) {
    if (!clipboardListEl) return null;
    for (const child of clipboardListEl.children) {
      if (child.classList && child.classList.contains('clipboard-item') && child.dataset.snippetId === id) {
        return child;
      }
    }
    return null;
  }

  function appendClipboardSnippet(rawSnippet) {
    if (!clipboardListEl) return;
    const snippet = sanitizeSnippetForView(rawSnippet);
    if (!snippet) return;
    if (findSnippetElementById(snippet.id)) return;

    const empty = clipboardListEl.querySelector('.clipboard-empty');
    if (empty) empty.remove();

    clipboardListEl.appendChild(createClipboardItemElement(snippet));
    while (clipboardListEl.children.length > MAX_CLIPBOARD_ITEMS) {
      clipboardListEl.removeChild(clipboardListEl.firstElementChild);
    }
    clipboardListEl.scrollTop = clipboardListEl.scrollHeight;
  }

  function removeClipboardSnippet(rawId) {
    if (!clipboardListEl) return;
    const id = sanitizeListItemId(rawId);
    if (!id) return;
    const item = findSnippetElementById(id);
    if (!item) return;
    item.remove();
    renderClipboardEmptyState();
  }

  function replaceClipboardSnippets(rawSnippets) {
    if (!clipboardListEl) return;
    clipboardListEl.innerHTML = '';
    const snippets = Array.isArray(rawSnippets) ? rawSnippets : [];
    for (const raw of snippets) {
      const snippet = sanitizeSnippetForView(raw);
      if (!snippet) continue;
      clipboardListEl.appendChild(createClipboardItemElement(snippet));
    }
    renderClipboardEmptyState();
  }

  // ---- Render peers ----

  function renderPeers() {
    peersGrid.innerHTML = '';
    for (const peer of peerList) {
      const card = document.createElement('div');
      card.className = 'peer-card' + (peer.id === selectedPeerId ? ' selected' : '');
      card.innerHTML = `
        <div class="device-icon">${deviceIcon(peer.deviceType)}</div>
        <div class="peer-name">${escapeHtml(peer.name)}</div>
        <div class="peer-status">Online</div>
      `;
      card.addEventListener('click', () => {
        selectedPeerId = peer.id;
        renderPeers();
      });
      peersGrid.appendChild(card);
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  if (shareUrlCopyBtn) {
    shareUrlCopyBtn.addEventListener('click', async () => {
      const localShareUrl = authToken
        ? `${location.origin}/?token=${encodeURIComponent(authToken)}`
        : location.origin;
      const text = (shareUrls[0] || localShareUrl).trim();

      try {
        await navigator.clipboard.writeText(text);
        const original = shareUrlCopyBtn.textContent;
        shareUrlCopyBtn.textContent = 'Copied';
        setTimeout(() => {
          shareUrlCopyBtn.textContent = original;
        }, 1200);
      } catch {
        window.prompt('Copy this URL:', text);
      }
    });
  }

  if (chatForm && chatInput) {
    renderChatEmptyState();
    if (chatSendBtn) chatSendBtn.disabled = true;

    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if (!text) return;
      if (text.length > 400) {
        alert('Chat messages are limited to 400 characters.');
        return;
      }

      signaling.send({
        type: 'chat-message',
        text,
      });
      chatInput.value = '';
      chatInput.focus();
    });
  }

  if (chatMessagesEl) {
    chatMessagesEl.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('[data-delete-chat]');
      if (!deleteBtn) return;
      const id = sanitizeListItemId(deleteBtn.dataset.deleteChat);
      if (!id) return;
      signaling.send({
        type: 'chat-delete',
        id,
      });
    });
  }

  if (clipboardForm && clipboardInput && clipboardListEl) {
    renderClipboardEmptyState();
    if (clipboardAddBtn) clipboardAddBtn.disabled = true;

    clipboardForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = clipboardInput.value.trim();
      if (!text) return;
      if (text.length > 800) {
        alert('Clipboard snippets are limited to 800 characters.');
        return;
      }

      signaling.send({
        type: 'clipboard-add',
        text,
      });

      clipboardInput.value = '';
      clipboardInput.focus();
    });

    clipboardListEl.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-delete-snippet]');
      if (deleteBtn) {
        const id = sanitizeListItemId(deleteBtn.dataset.deleteSnippet);
        if (!id) return;
        signaling.send({
          type: 'clipboard-delete',
          id,
        });
        return;
      }

      const copyBtn = e.target.closest('[data-copy-snippet]');
      if (!copyBtn) return;
      const item = copyBtn.closest('.clipboard-item');
      const textEl = item ? item.querySelector('.clipboard-text') : null;
      const text = textEl ? textEl.textContent : '';
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = original;
        }, 1000);
      } catch {
        window.prompt('Copy this snippet:', text);
      }
    });
  }

  // ---- Rename ----

  renameBtn.addEventListener('click', () => {
    renameInput.value = deviceNameEl.textContent;
    renameModal.hidden = false;
    renameInput.focus();
    renameInput.select();
  });

  renameCancelBtn.addEventListener('click', () => {
    renameModal.hidden = true;
  });

  renameSaveBtn.addEventListener('click', () => {
    const name = renameInput.value.trim();
    if (name) {
      myDeviceName = name;
      localStorage.setItem('zap-device-name', name);
      deviceNameEl.textContent = name;
      // Re-register with new name
      signaling.send({ type: 'register', name, deviceType: myDeviceType });
    }
    renameModal.hidden = true;
  });

  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') renameSaveBtn.click();
    if (e.key === 'Escape') renameCancelBtn.click();
  });

  loadShareUrls();

  // ---- File selection ----

  let pendingFile = null;

  browseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
    fileInput.value = '';
  });

  // Drag and drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  function handleFileSelected(file) {
    if (!selectedPeerId) {
      // Auto-select if only one peer
      if (peerList.length === 1) {
        selectedPeerId = peerList[0].id;
        renderPeers();
      } else {
        alert('Select a device first');
        return;
      }
    }

    pendingFile = file;

    // Send file request to receiver via signaling
    signaling.send({
      type: 'file-request',
      to: selectedPeerId,
      meta: {
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
    });

    // Show transfer view (waiting for acceptance)
    showTransferUI(file.name, file.size, 'Sending');
  }

  // ---- Accept / decline incoming file ----

  acceptBtn.addEventListener('click', async () => {
    incomingModal.hidden = true;
    if (!pendingRequest) return;

    // Set up receiver
    fileReceiver = new FileReceiver();
    fileReceiver.onProgress = updateReceiveProgress;
    fileReceiver.onComplete = onReceiveComplete;
    fileReceiver.onError = onReceiveError;
    flushPendingIncomingData();

    showTransferUI(pendingRequest.meta.name, pendingRequest.meta.size, 'Receiving');

    signaling.send({ type: 'file-accept', to: pendingRequest.from });
    pendingRequest = null;
  });

  declineBtn.addEventListener('click', () => {
    incomingModal.hidden = true;
    if (pendingRequest) {
      signaling.send({ type: 'file-decline', to: pendingRequest.from });
      pendingRequest = null;
    }
  });

  // ---- Transfer UI ----

  function showTransferUI(name, size, direction) {
    showView('transfer');
    transferFileName.textContent = name;
    transferFileSize.textContent = formatBytes(size);
    transferDirection.textContent = direction;
    progressFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressSpeed.textContent = '-- MB/s';
    progressEta.textContent = '--';
  }

  function startSending() {
    if (!pendingFile || !peerConnection) return;

    fileSender = new FileSender(peerConnection, pendingFile);
    fileSender.onProgress = updateSendProgress;
    fileSender.onComplete = onSendComplete;
    fileSender.onError = onSendError;
    fileSender.start();
    pendingFile = null;
  }

  function updateSendProgress(p) {
    progressFill.style.width = (p.percent * 100).toFixed(1) + '%';
    progressPercent.textContent = (p.percent * 100).toFixed(0) + '%';
    progressSpeed.textContent = formatSpeed(p.speed);
    progressEta.textContent = formatEta(p.eta);
  }

  function updateReceiveProgress(p) {
    progressFill.style.width = (p.percent * 100).toFixed(1) + '%';
    progressPercent.textContent = (p.percent * 100).toFixed(0) + '%';
    progressSpeed.textContent = formatSpeed(p.speed);
    progressEta.textContent = formatEta(p.eta);
  }

  function onSendComplete() {
    transferCard.hidden = true;
    transferComplete.hidden = false;
    completeMessage.textContent = 'File sent successfully!';
    sendAnotherBtn.textContent = 'Send Another';
    cleanupTransfer();
  }

  function onReceiveComplete({ name, size }) {
    transferCard.hidden = true;
    transferComplete.hidden = false;
    completeMessage.textContent = `${name} (${formatBytes(size)}) saved.`;
    sendAnotherBtn.textContent = 'Done';
    cleanupTransfer();
  }

  function returnToReadyView() {
    const hotspotChannel = hotspot && hotspot.getDataChannel ? hotspot.getDataChannel() : null;
    if (hotspotChannel && hotspotChannel.readyState === 'open') {
      showView('hotspot');
      showHotspotSubview('connected');
      return;
    }
    showView('peers');
  }

  function onSendError(err) {
    console.error('Send error:', err);
    cleanupTransfer();
    returnToReadyView();
    alert('Transfer failed while sending. Please try again.');
  }

  function onReceiveError(err) {
    console.error('Receive error:', err);
    cleanupTransfer();
    returnToReadyView();
    alert('Transfer failed while receiving. Please ask the sender to retry.');
  }

  function cleanupTransfer() {
    fileSender = null;
    if (fileReceiver) fileReceiver.dispose();
    fileReceiver = null;
    pendingIncomingData = [];
    // Delay closing the peer connection so the final file-complete message
    // has time to reach the other side before the SCTP/ICE layers tear down.
    const pc = peerConnection;
    peerConnection = null;
    if (pc) {
      setTimeout(() => {
        try { pc.close(); } catch {}
      }, 2000);
    }
  }

  cancelBtn.addEventListener('click', () => {
    if (fileSender) fileSender.cancel();
    if (peerConnection) {
      signaling.send({ type: 'transfer-cancel', to: peerConnection.remotePeerId });
      peerConnection.close();
      peerConnection = null;
    }
    fileSender = null;
    if (fileReceiver) fileReceiver.dispose();
    fileReceiver = null;
    pendingIncomingData = [];
    pendingFile = null;
    showView('peers');
  });

  sendAnotherBtn.addEventListener('click', () => {
    showView('peers');
  });

  // ---- Prevent default drag on document ----
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => e.preventDefault());

  // ---- Hotspot Mode ----

  const QR_SIZE = 280;

  function showHotspotSubview(sub) {
    hotspotActions.hidden = sub !== 'actions';
    qrDisplay.hidden = sub !== 'qr-display';
    qrScanner.hidden = sub !== 'scanner';
    hotspotConnected.hidden = sub !== 'connected';
  }

  // Creator: generate offer QR, then scan answer QR
  createSessionBtn.addEventListener('click', async () => {
    try {
      if (hotspot) hotspot.close();
      hotspot = new HotspotSignaling();

      qrTitle.textContent = 'Scan this QR code';
      qrSubtitle.textContent = 'The other device should tap "Join Session" and scan this code';
      showHotspotSubview('qr-display');
      await hotspot.createSession(qrCanvas, QR_SIZE);

      // Now we need to scan the answer QR
      qrTitle.textContent = 'Now scan their QR code';
      qrSubtitle.textContent = 'The other device will show a QR code — scan it to connect';
      showHotspotSubview('scanner');
      await hotspot.startCamera(scannerVideo);
      await hotspot.scanAnswerAndConnect(scannerVideo, scannerCanvas);

      onHotspotConnected();
    } catch (err) {
      console.error('Create session error:', err);
      if (hotspot) { hotspot.close(); hotspot = null; }
      showHotspotSubview('actions');
    }
  });

  // Joiner: scan offer QR, then show answer QR
  joinSessionBtn.addEventListener('click', async () => {
    try {
      if (hotspot) hotspot.close();
      hotspot = new HotspotSignaling();

      scanTitle.textContent = 'Scan their QR code';
      scanSubtitle.textContent = 'Point your camera at the QR code on the other device';
      showHotspotSubview('scanner');
      await hotspot.startCamera(scannerVideo);
      await hotspot.scanOfferAndRespond(scannerVideo, scannerCanvas);

      // Show our answer QR for the creator to scan
      qrTitle.textContent = 'Show this to the other device';
      qrSubtitle.textContent = 'They need to scan this QR code to complete the connection';
      showHotspotSubview('qr-display');
      await hotspot.showAnswer(qrCanvas, QR_SIZE);

      // Wait for the data channel to open
      await hotspot.waitForConnection();
      onHotspotConnected();
    } catch (err) {
      console.error('Join session error:', err);
      if (hotspot) { hotspot.close(); hotspot = null; }
      showHotspotSubview('actions');
    }
  });

  function onHotspotConnected() {
    showHotspotSubview('connected');
    deviceNameEl.textContent = myDeviceName;

    const ch = hotspot.getDataChannel();
    // Listen for incoming files in hotspot mode (receiver side)
    ch.onmessage = (e) => {
      if (!fileReceiver) {
        // Auto-create receiver on first data
        fileReceiver = new FileReceiver();
        fileReceiver.onProgress = updateReceiveProgress;
        fileReceiver.onError = onReceiveError;
        fileReceiver.onComplete = (info) => {
          onReceiveComplete(info);
          // Return to hotspot connected view after completion
          sendAnotherBtn.onclick = () => {
            showView('hotspot');
            showHotspotSubview('connected');
          };
        };
        showTransferUI('Receiving...', 0, 'Receiving');
      }
      fileReceiver.handleData(e.data);
      // Update filename/size from metadata once available
      if (fileReceiver.meta) {
        transferFileName.textContent = fileReceiver.meta.name;
        transferFileSize.textContent = formatBytes(fileReceiver.meta.size);
      }
    };
  }

  // Hotspot file sending
  function hotspotSendFile(file) {
    if (!hotspot || !hotspot.getDataChannel()) return;

    const ch = hotspot.getDataChannel();
    // Create a minimal PeerConnection-like wrapper for FileSender
    const wrapper = { dataChannel: ch };
    fileSender = new FileSender(wrapper, file);
    fileSender.onProgress = updateSendProgress;
    fileSender.onComplete = () => {
      onSendComplete();
      sendAnotherBtn.onclick = () => {
        showView('hotspot');
        showHotspotSubview('connected');
      };
    };
    showTransferUI(file.name, file.size, 'Sending');
    fileSender.start();
  }

  hotspotBrowseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hotspotFileInput.click();
  });

  hotspotDropZone.addEventListener('click', () => {
    hotspotFileInput.click();
  });

  hotspotFileInput.addEventListener('change', () => {
    if (hotspotFileInput.files.length > 0) {
      hotspotSendFile(hotspotFileInput.files[0]);
    }
    hotspotFileInput.value = '';
  });

  hotspotDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    hotspotDropZone.classList.add('drag-over');
  });

  hotspotDropZone.addEventListener('dragleave', () => {
    hotspotDropZone.classList.remove('drag-over');
  });

  hotspotDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    hotspotDropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      hotspotSendFile(e.dataTransfer.files[0]);
    }
  });

  // Back buttons
  qrBackBtn.addEventListener('click', () => {
    if (hotspot) { hotspot.close(); hotspot = null; }
    showHotspotSubview('actions');
  });

  scanBackBtn.addEventListener('click', () => {
    if (hotspot) { hotspot.close(); hotspot = null; }
    showHotspotSubview('actions');
  });

})();
