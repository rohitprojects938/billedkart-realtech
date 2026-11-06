/**
 * chat.js — Billedkart Realtech OLX-Style Chat Engine
 * Real-time buyer-seller messaging with Socket.IO, MySQL persistence,
 * delivery/read receipts, typing indicators, and property context.
 */

'use strict';

const API_BASE = (window.location.port === '4000') ? '' : 'http://127.0.0.1:4000';

const state = {
  currentUser: null,
  conversations: [],
  activeConversationId: null,
  activeConversation: null,
  messages: [],
  activeFilter: 'all',
  searchQuery: '',
  socket: null,
  typingTimer: null,
  isTypingSent: false,
  isSending: false,
  isLoadingOlder: false,
  hasMoreOlder: false,
  oldestMessageId: null
};

function cleanAvatarName(name) {
  if (!name || typeof name !== 'string') return 'User';
  return name.replace(/\s*\([^)]*\)/g, '').trim() || name;
}

// Notification Sound (Subtle Pop using Web Audio API to avoid external assets)
function playNotificationChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {
    // AudioContext blocked or not supported
  }
}

/* ---------------------------------------------------------------
   1. Initialization & Auth Verification
--------------------------------------------------------------- */
async function initChatApp() {
  try {
    // 1. Check user authentication
    const authRes = await fetch(`${API_BASE}/api/auth/me`, {
      credentials: 'include',
      headers: { 'Cache-Control': 'no-store' }
    });
    const authData = await authRes.json();

    if (!authData.authenticated || !authData.user) {
      // User not logged in: Prompt to login
      showLoginRequiredModal();
      return;
    }

    state.currentUser = authData.user;
    updateCurrentUserHeaderUI();

    // 2. Initialize Socket.IO connection
    initSocketConnection();

    // 3. Check URL parameters (e.g. ?conversationId=1 or ?propertyId=2)
    const urlParams = new URLSearchParams(window.location.search);
    const targetConvId = urlParams.get('conversationId') || urlParams.get('id');
    const targetPropId = urlParams.get('propertyId') || urlParams.get('property_id');

    // 4. Load conversations list
    await loadConversations(true);

    if (targetConvId) {
      await selectConversation(parseInt(targetConvId, 10));
    } else if (targetPropId) {
      await initiateChatForProperty(targetPropId);
    } else if (window.innerWidth >= 1024 && state.conversations.length > 0) {
      // Auto-open first conversation on desktop
      await selectConversation(state.conversations[0].id);
    }

    // 5. Setup attachment upload listener
    setupAttachmentUpload();

    // 6. Setup scroll listener for infinite scroll up
    const msgBox = document.getElementById('chatMessagesContainer');
    if (msgBox) {
      msgBox.addEventListener('scroll', handleMessagesScroll);
    }

  } catch (err) {
    console.error('[Chat Init Error]', err);
  }
}

function updateCurrentUserHeaderUI() {
  const pill = document.getElementById('currentUserPill');
  const avatar = document.getElementById('currentUserAvatar');
  const name = document.getElementById('currentUserName');

  if (state.currentUser && pill) {
    pill.classList.remove('hidden');
    if (name) name.textContent = state.currentUser.fullName || state.currentUser.username;
    if (avatar && state.currentUser.profileImageUrl) {
      avatar.src = state.currentUser.profileImageUrl;
    }
  }
}

function showLoginRequiredModal() {
  const container = document.getElementById('noConversationSelectedState');
  if (container) {
    container.innerHTML = `
      <div class="max-w-md mx-auto text-center p-8 bg-white rounded-2xl border border-surface-container shadow-sm space-y-4">
        <div class="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center text-primary mx-auto">
          <span class="material-symbols-outlined text-[32px] text-secondary">lock</span>
        </div>
        <h2 class="text-base font-extrabold text-primary">Sign In to Access Your Messages</h2>
        <p class="text-xs text-outline leading-relaxed">
          You need an active Billedkart Realtech account to communicate directly with verified property owners and buyers.
        </p>
        <div class="pt-2 flex flex-col sm:flex-row gap-2.5">
          <a href="/?login=true" class="flex-1 py-2.5 px-4 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-container transition-colors shadow-xs">
            Sign In with Password / OTP
          </a>
          <a href="/" class="py-2.5 px-4 rounded-xl border border-surface-container text-xs font-bold hover:bg-surface-container transition-colors">
            Back to Home
          </a>
        </div>
      </div>
    `;
  }
  const feed = document.getElementById('conversationsFeed');
  if (feed) {
    feed.innerHTML = `<div class="p-6 text-center text-xs text-outline">Please sign in to view your inbox.</div>`;
  }
}

/* ---------------------------------------------------------------
   2. Socket.IO Real-time Connection
--------------------------------------------------------------- */
function initSocketConnection() {
  if (typeof io === 'undefined') {
    console.error('Socket.IO client library not loaded');
    return;
  }

  state.socket = io(API_BASE, {
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 20,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  const banner = document.getElementById('socketConnectionBanner');

  state.socket.on('connect', () => {
    console.log('[Socket] Connected to Billedkart Messenger:', state.socket.id);
    if (banner) banner.classList.add('hidden');

    // If a conversation is already active, rejoin the room
    if (state.activeConversationId) {
      state.socket.emit('chat:join', { conversationId: state.activeConversationId });
    }
  });

  state.socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', reason);
    if (banner) banner.classList.remove('hidden');
  });

  state.socket.on('connect_error', (err) => {
    console.warn('[Socket Connect Error]', err.message);
    if (banner) banner.classList.remove('hidden');
  });

  // Event: message:new
  state.socket.on('message:new', (payload) => {
    handleIncomingMessage(payload);
  });

  // Event: message:delivered
  state.socket.on('message:delivered', (payload) => {
    handleMessageDelivered(payload);
  });

  // Event: message:read
  state.socket.on('message:read', (payload) => {
    handleMessageReadReceipt(payload);
  });

  // Event: typing:update
  state.socket.on('typing:update', (payload) => {
    handleTypingUpdate(payload);
  });

  // Event: notification:new
  state.socket.on('notification:new', (payload) => {
    handleNewNotification(payload);
  });

  // Event: user:online / user:offline
  state.socket.on('user:online', (payload) => {
    updateUserPresenceUI(payload.userId, true);
  });

  state.socket.on('user:offline', (payload) => {
    updateUserPresenceUI(payload.userId, false);
  });

  // Event: conversation:updated
  state.socket.on('conversation:updated', (payload) => {
    loadConversations(false);
  });
}

function reconnectSocket() {
  if (state.socket) {
    state.socket.connect();
  }
}

/* ---------------------------------------------------------------
   3. Conversation Loading & Filtering
--------------------------------------------------------------- */
async function loadConversations(isRefresh = false) {
  try {
    let url = `${API_BASE}/api/chat/conversations?filter=${encodeURIComponent(state.activeFilter)}`;
    if (state.searchQuery) {
      url += `&q=${encodeURIComponent(state.searchQuery)}`;
    }

    const res = await fetch(url, { credentials: 'include' });
    const data = await res.json();

    if (!data.success) return;

    state.conversations = data.conversations || [];
    renderConversationsList();
    updateUnreadNavbarBadge();

    const countBadge = document.getElementById('inboxCountBadge');
    if (countBadge) {
      countBadge.textContent = `(${state.conversations.length})`;
    }
  } catch (err) {
    console.error('[loadConversations]', err);
  }
}

function setFilter(filter) {
  state.activeFilter = filter;
  document.querySelectorAll('.chat-filter-tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-filter') === filter);
  });
  loadConversations();
}

// Search Handler
let searchDebounce = null;
const searchInput = document.getElementById('chatSearchInput');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const val = e.target.value.trim();
    const clearBtn = document.getElementById('clearSearchBtn');
    if (clearBtn) clearBtn.classList.toggle('hidden', val.length === 0);

    searchDebounce = setTimeout(() => {
      state.searchQuery = val;
      loadConversations();
    }, 300);
  });
}

function clearSearch() {
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('clearSearchBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  state.searchQuery = '';
  loadConversations();
}

function renderConversationsList() {
  const container = document.getElementById('conversationsFeed');
  const emptyState = document.getElementById('sidebarEmptyState');
  if (!container) return;

  if (state.conversations.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  container.innerHTML = state.conversations.map(c => {
    const isActive = (c.id === state.activeConversationId);
    const lastMsgText = c.lastMessage
      ? (c.lastMessage.type === 'image' ? '📷 Photo' : escapeHtml(c.lastMessage.text))
      : 'No messages yet';
    const lastTime = c.lastMessage ? formatMessageTime(c.lastMessage.createdAt) : '';
    const statusTicks = (c.lastMessage && c.lastMessage.isMine)
      ? renderStatusTickHtml(c.lastMessage.status)
      : '';

    return `
      <div class="conv-item ${isActive ? 'active' : ''}" onclick="selectConversation(${c.id})">
        <div class="conv-avatar-wrapper">
          <img src="${c.participant.avatarUrl}" alt="${escapeHtml(cleanAvatarName(c.participant.name))}" class="conv-avatar" />
          <span class="conv-online-dot ${c.participant.isOnline ? '' : 'offline'}" data-user-online="${c.participant.id}"></span>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-1 mb-0.5">
            <h4 class="font-bold text-xs text-primary truncate max-w-[170px]">${escapeHtml(cleanAvatarName(c.participant.name))}</h4>
            <span class="text-[10px] text-outline font-semibold shrink-0">${lastTime}</span>
          </div>

          <div class="text-[11px] font-semibold text-secondary truncate flex items-center gap-1 mb-1">
            <span class="truncate">${escapeHtml(c.property.title)}</span>
            <span class="shrink-0 text-[10px] text-outline">• ${c.property.formattedPrice}</span>
          </div>

          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-on-surface-variant truncate max-w-[210px] flex items-center gap-1">
              ${statusTicks}
              <span class="truncate">${lastMsgText}</span>
            </p>
            ${c.unreadCount > 0 ? `
              <span class="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-secondary text-white shrink-0">
                ${c.unreadCount}
              </span>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/* ---------------------------------------------------------------
   4. Selecting & Opening a Conversation
--------------------------------------------------------------- */
async function selectConversation(conversationId) {
  if (!conversationId) return;

  // Leave previous room if any
  if (state.activeConversationId && state.socket) {
    state.socket.emit('chat:leave', { conversationId: state.activeConversationId });
  }

  state.activeConversationId = conversationId;

  // Switch UI states
  const emptyState = document.getElementById('noConversationSelectedState');
  const chatWrapper = document.getElementById('activeChatWrapper');
  const appContainer = document.getElementById('chatAppContainer');

  if (emptyState) emptyState.classList.add('hidden');
  if (chatWrapper) chatWrapper.classList.remove('hidden');
  if (appContainer) appContainer.classList.add('conversation-open');

  // Highlight active conversation in sidebar
  renderConversationsList();

  // Join room via socket
  if (state.socket) {
    state.socket.emit('chat:join', { conversationId }, (ack) => {
      if (ack && ack.success && typeof ack.isOtherUserOnline === 'boolean') {
        updateActiveHeaderOnlineStatus(ack.isOtherUserOnline);
      }
    });
  }

  // Fetch conversation messages
  try {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${conversationId}/messages?limit=30`, {
      credentials: 'include'
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.error || 'Failed to load conversation.');
      return;
    }

    state.activeConversation = data.conversation;
    state.messages = data.messages || [];
    state.hasMoreOlder = Boolean(data.hasMore);
    state.oldestMessageId = data.oldestMessageId;

    // Render Center & Right Panels
    renderActiveChatHeader();
    renderPropertyContextBanner();
    renderRightPanelDetails();
    renderMessagesList();
    scrollToBottom(false);

    // Focus textarea on desktop
    if (window.innerWidth >= 1024) {
      const textarea = document.getElementById('chatInput');
      if (textarea) textarea.focus();
    }

    // Refresh unread counts in sidebar & navbar
    loadConversations(false);
  } catch (err) {
    console.error('[selectConversation error]', err);
  }
}

function closeMobileChat() {
  const appContainer = document.getElementById('chatAppContainer');
  if (appContainer) {
    appContainer.classList.remove('conversation-open');
  }
  const emptyState = document.getElementById('noConversationSelectedState');
  const chatWrapper = document.getElementById('activeChatWrapper');
  if (emptyState) emptyState.classList.remove('hidden');
  if (chatWrapper) chatWrapper.classList.add('hidden');
  state.activeConversationId = null;
  state.activeConversation = null;
  renderRightPanelDetails();
  renderConversationsList();
}

function toggleRightPanel() {
  const rightPanel = document.getElementById('chatRightPanel');
  if (rightPanel) {
    rightPanel.classList.toggle('hidden');
  }
}

/* ---------------------------------------------------------------
   5. Rendering Chat Header, Property Context & Messages
--------------------------------------------------------------- */
function renderActiveChatHeader() {
  const conv = state.activeConversation;
  if (!conv) return;

  const avatar = document.getElementById('chatHeaderAvatar');
  const name = document.getElementById('chatHeaderName');
  const roleBadge = document.getElementById('chatHeaderRoleBadge');
  const onlineDot = document.getElementById('chatHeaderOnlineDot');

  if (avatar) avatar.src = conv.participant.avatarUrl;
  if (name) name.textContent = cleanAvatarName(conv.participant.name);
  if (roleBadge) {
    roleBadge.textContent = conv.participant.role;
    roleBadge.className = conv.participant.role === 'Seller'
      ? 'text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded-full bg-secondary-fixed text-on-secondary-fixed'
      : 'text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded-full bg-surface-container text-primary';
  }

  updateActiveHeaderOnlineStatus(conv.participant.isOnline);
}

function updateActiveHeaderOnlineStatus(isOnline) {
  const statusText = document.getElementById('chatHeaderStatusText');
  const onlineDot = document.getElementById('chatHeaderOnlineDot');

  if (statusText) {
    statusText.textContent = isOnline ? 'Online' : 'Offline';
    statusText.className = isOnline ? 'text-emerald-600 font-bold' : 'text-outline font-medium';
  }
  if (onlineDot) {
    onlineDot.className = isOnline ? 'conv-online-dot' : 'conv-online-dot offline';
  }
}

function renderPropertyContextBanner() {
  const conv = state.activeConversation;
  if (!conv || !conv.property) return;

  const img = document.getElementById('propBannerImg');
  const title = document.getElementById('propBannerTitle');
  const price = document.getElementById('propBannerPrice');
  const viewBtn = document.getElementById('propBannerViewBtn');

  if (img) img.src = conv.property.imageUrl;
  if (title) title.textContent = conv.property.title;
  if (price) price.textContent = conv.property.formattedPrice;
  if (viewBtn) {
    const propUrl = `/property_detail_page/code.html?slug=${encodeURIComponent(conv.property.slug || conv.property.id)}`;
    viewBtn.href = propUrl;
  }
}

function renderRightPanelDetails() {
  const conv = state.activeConversation;
  const placeholder = document.getElementById('rightPanelPlaceholder');
  const details = document.getElementById('rightPanelDetails');

  if (!conv || !conv.property) {
    if (placeholder) placeholder.classList.remove('hidden');
    if (details) details.classList.add('hidden');
    return;
  }

  if (placeholder) placeholder.classList.add('hidden');
  if (details) details.classList.remove('hidden');

  const rightImg = document.getElementById('rightPropImg');
  const rightTitle = document.getElementById('rightPropTitle');
  const rightPrice = document.getElementById('rightPropPriceTag');
  const rightLoc = document.getElementById('rightPropLocText');
  const rightLink = document.getElementById('rightPropViewLink');

  if (rightImg) rightImg.src = conv.property.imageUrl || '/property_detail_page/img/placeholder.jpg';
  if (rightTitle) rightTitle.textContent = conv.property.title;
  if (rightPrice) rightPrice.textContent = conv.property.formattedPrice;
  if (rightLoc) rightLoc.textContent = `${conv.property.locality || ''}${conv.property.locality && conv.property.city ? ', ' : ''}${conv.property.city || ''}`;
  if (rightLink) {
    rightLink.href = `/property_detail_page/code.html?slug=${encodeURIComponent(conv.property.slug || conv.property.id)}`;
  }

  const pAvatar = document.getElementById('rightParticipantAvatar');
  const pName = document.getElementById('rightParticipantName');
  const pRole = document.getElementById('rightParticipantRole');

  if (pAvatar) pAvatar.src = conv.participant.avatarUrl;
  if (pName) pName.textContent = cleanAvatarName(conv.participant.name);
  if (pRole) pRole.textContent = `Verified ${conv.participant.role}`;
}

function renderMessagesList() {
  const container = document.getElementById('messagesList');
  if (!container) return;

  if (state.messages.length === 0) {
    container.innerHTML = `
      <div class="py-8 text-center text-xs text-outline space-y-1">
        <p class="font-bold text-primary">No messages yet.</p>
        <p>Send a message below to start this conversation.</p>
      </div>
    `;
    return;
  }

  let html = '';
  let lastDateStr = '';

  state.messages.forEach(msg => {
    const msgDate = new Date(msg.createdAt);
    const dateStr = formatDateDivider(msgDate);

    if (dateStr !== lastDateStr) {
      html += `
        <div class="chat-date-separator">
          <span class="chat-date-badge">${dateStr}</span>
        </div>
      `;
      lastDateStr = dateStr;
    }

    html += renderMessageBubbleHtml(msg);
  });

  container.innerHTML = html;
}

function renderMessageBubbleHtml(msg) {
  const isMine = msg.isMine;
  const timeStr = formatTimeClock(msg.createdAt);
  const statusTicks = isMine ? renderStatusTickHtml(msg.status) : '';

  let contentHtml = '';
  if (msg.attachmentUrl) {
    contentHtml += `
      <img src="${msg.attachmentUrl}" alt="Attachment" class="chat-attachment-img"
        onclick="openImageLightbox('${msg.attachmentUrl}')" />
    `;
  }
  if (msg.text) {
    contentHtml += `<p class="whitespace-pre-wrap">${escapeHtml(msg.text)}</p>`;
  }

  const clientIdAttr = msg.clientMessageId ? `data-client-id="${escapeHtml(msg.clientMessageId)}"` : '';

  return `
    <div class="chat-msg-row ${isMine ? 'outgoing' : 'incoming'}" data-msg-id="${msg.id}" ${clientIdAttr}>
      <div class="chat-bubble">
        ${contentHtml}
        <div class="chat-bubble-meta">
          <span>${timeStr}</span>
          ${statusTicks}
        </div>
      </div>
    </div>
  `;
}

function renderStatusTickHtml(status) {
  if (status === 'sending') {
    return `<span class="material-symbols-outlined status-tick animate-spin text-[12px] opacity-70" title="Sending...">schedule</span>`;
  } else if (status === 'sent') {
    return `<span class="material-symbols-outlined status-tick text-[13px] text-slate-400" title="Sent (1 tick)">done</span>`;
  } else if (status === 'delivered') {
    return `<span class="material-symbols-outlined status-tick text-[14px] text-slate-400" title="Delivered (2 ticks)">done_all</span>`;
  } else if (status === 'read') {
    return `<span class="material-symbols-outlined status-tick read text-[14px]" title="Read (2 blue ticks)">done_all</span>`;
  }
  return '';
}

/* ---------------------------------------------------------------
   6. Sending Messages & Composer Handling
--------------------------------------------------------------- */
function handleInputAutoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessageFromInput();
  }
}

function handleTyping() {
  if (!state.socket || !state.activeConversationId) return;

  if (!state.isTypingSent) {
    state.socket.emit('typing:start', { conversationId: state.activeConversationId });
    state.isTypingSent = true;
  }

  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    state.socket.emit('typing:stop', { conversationId: state.activeConversationId });
    state.isTypingSent = false;
  }, 2500);
}

function sendQuickMessage(text) {
  const textarea = document.getElementById('chatInput');
  if (textarea) {
    textarea.value = text;
    sendMessageFromInput();
  }
}

async function sendMessageFromInput() {
  if (state.isSending) return;
  const textarea = document.getElementById('chatInput');
  if (!textarea) return;

  const text = textarea.value.trim();
  if (!text || !state.activeConversationId) return;

  // Clear textarea immediately
  textarea.value = '';
  textarea.style.height = 'auto';

  // Stop typing indicator
  if (state.socket && state.isTypingSent) {
    state.socket.emit('typing:stop', { conversationId: state.activeConversationId });
    state.isTypingSent = false;
    clearTimeout(state.typingTimer);
  }

  await executeSendMessage(text, 'text', null);
}

async function executeSendMessage(text, type = 'text', attachmentUrl = null) {
  const conversationId = state.activeConversationId;
  if (!conversationId) return;

  if (state.isSending) return;
  state.isSending = true;

  const sendBtn = document.getElementById('chatSendBtn');
  if (sendBtn) sendBtn.disabled = true;

  // Optimistic client-generated message ID
  const clientMessageId = 'cmsg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
  const optimisticMsg = {
    id: clientMessageId,
    clientMessageId,
    conversationId,
    senderId: state.currentUser.id,
    senderName: state.currentUser.fullName || state.currentUser.username,
    isMine: true,
    type,
    text,
    attachmentUrl,
    status: 'sending',
    createdAt: new Date().toISOString()
  };

  state.messages.push(optimisticMsg);
  appendMessageToDOM(optimisticMsg);
  scrollToBottom(true);

  const onConfirm = (serverMsg) => {
    state.isSending = false;
    if (sendBtn) sendBtn.disabled = false;
    updateOptimisticMessage(clientMessageId, serverMsg);
    loadConversations(false);
  };

  const onFail = () => {
    state.isSending = false;
    if (sendBtn) sendBtn.disabled = false;
    markMessageFailed(clientMessageId);
  };

  if (state.socket && state.socket.connected) {
    // Send via real-time Socket.IO with clientMessageId
    state.socket.emit('message:send', {
      conversationId,
      messageText: text,
      messageType: type,
      attachmentUrl,
      clientMessageId
    }, (ack) => {
      if (ack && ack.success && ack.message) {
        onConfirm(ack.message);
      } else {
        onFail();
      }
    });
  } else {
    // HTTP Fallback with clientMessageId
    try {
      const res = await fetch(`${API_BASE}/api/chat/conversations/${conversationId}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText: text, messageType: type, attachmentUrl, clientMessageId })
      });
      const data = await res.json();
      if (data.success && data.message) {
        onConfirm(data.message);
      } else {
        onFail();
      }
    } catch (err) {
      onFail();
    }
  }
}

function appendMessageToDOM(msg) {
  const container = document.getElementById('messagesList');
  if (!container) return;

  // Deduplication guard
  const existingDom = container.querySelector(`[data-msg-id="${msg.id}"], [data-client-id="${msg.clientMessageId || msg.id}"]`);
  if (existingDom) return;

  const html = renderMessageBubbleHtml(msg);
  container.insertAdjacentHTML('beforeend', html);
}

function updateOptimisticMessage(clientMessageId, serverMsg) {
  const idx = state.messages.findIndex(m => m.id === clientMessageId || (m.clientMessageId && m.clientMessageId === clientMessageId));
  if (idx !== -1) {
    state.messages[idx].id = serverMsg.id;
    state.messages[idx].clientMessageId = clientMessageId;
    state.messages[idx].status = serverMsg.delivery_status || 'sent';
    state.messages[idx].createdAt = serverMsg.created_at;
  }

  const row = document.querySelector(`[data-client-id="${clientMessageId}"], [data-msg-id="${clientMessageId}"]`);
  if (row) {
    row.setAttribute('data-msg-id', serverMsg.id);
    row.setAttribute('data-client-id', clientMessageId);
    const meta = row.querySelector('.chat-bubble-meta');
    if (meta) {
      meta.innerHTML = `
        <span>${formatTimeClock(serverMsg.created_at)}</span>
        ${renderStatusTickHtml(serverMsg.delivery_status || 'sent')}
      `;
    }
  }
}

function markMessageFailed(tempId) {
  const row = document.querySelector(`[data-msg-id="${tempId}"], [data-client-id="${tempId}"]`);
  if (row) {
    const meta = row.querySelector('.chat-bubble-meta');
    if (meta) {
      meta.innerHTML += `<span class="text-error font-bold ml-1" title="Failed to send">⚠️ Failed</span>`;
    }
  }
}

function scrollToBottom(smooth = true) {
  const container = document.getElementById('chatMessagesContainer');
  if (container) {
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }
}

/* ---------------------------------------------------------------
   7. Real-Time Socket Event Handlers
--------------------------------------------------------------- */
function handleIncomingMessage(payload) {
  if (!payload || !payload.message) return;
  const msg = payload.message;
  const conversationId = payload.conversationId || msg.conversation_id;

  if (conversationId === state.activeConversationId) {
    const isMine = (msg.sender_id === state.currentUser.id);

    // 1. SENDER RECONCILIATION:
    // If this is our own message, reconcile optimistic message in state & DOM — NEVER append duplicate!
    const existingIndex = state.messages.findIndex(m => 
      m.id === msg.id || 
      (m.clientMessageId && msg.client_message_id && m.clientMessageId === msg.client_message_id) ||
      (m.id && msg.client_message_id && m.id === msg.client_message_id)
    );

    if (existingIndex !== -1) {
      state.messages[existingIndex].id = msg.id;
      state.messages[existingIndex].status = msg.delivery_status || 'sent';
      state.messages[existingIndex].createdAt = msg.created_at;

      const row = document.querySelector(`[data-client-id="${msg.client_message_id}"], [data-msg-id="${state.messages[existingIndex].id}"], [data-msg-id="${msg.id}"]`);
      if (row) {
        row.setAttribute('data-msg-id', msg.id);
        const meta = row.querySelector('.chat-bubble-meta');
        if (meta) {
          meta.innerHTML = `
            <span>${formatTimeClock(msg.created_at)}</span>
            ${renderStatusTickHtml(msg.delivery_status || 'sent')}
          `;
        }
      }
      return; // STOP! Never append a duplicate! Never emit read for self!
    }

    // 2. INCOMING MESSAGE FROM OTHER PARTICIPANT:
    const formatted = {
      id: msg.id,
      clientMessageId: msg.client_message_id,
      conversationId: msg.conversation_id,
      senderId: msg.sender_id,
      senderName: msg.sender_name,
      isMine: false,
      type: msg.message_type,
      text: msg.message_text,
      attachmentUrl: msg.attachment_url,
      status: msg.delivery_status,
      createdAt: msg.created_at
    };

    state.messages.push(formatted);
    appendMessageToDOM(formatted);
    scrollToBottom(true);
    playNotificationChime();

    // Recipient acknowledges delivery and read
    if (state.socket) {
      state.socket.emit('message:delivered', { conversationId: state.activeConversationId, messageId: msg.id });
      state.socket.emit('message:read', { conversationId: state.activeConversationId });
    }
  } else {
    // Message for another conversation
    playNotificationChime();
    loadConversations(false);
  }
}

function handleMessageDelivered(payload) {
  if (payload.conversationId === state.activeConversationId) {
    document.querySelectorAll('.chat-msg-row.outgoing .status-tick').forEach(tick => {
      if (!tick.classList.contains('read')) {
        tick.textContent = 'done_all';
        tick.title = 'Delivered (2 neutral ticks)';
      }
    });
  }
}

function handleMessageReadReceipt(payload) {
  if (payload.conversationId === state.activeConversationId) {
    document.querySelectorAll('.chat-msg-row.outgoing .status-tick').forEach(tick => {
      tick.textContent = 'done_all';
      tick.classList.add('read');
      tick.title = 'Read (2 blue ticks)';
    });
  }
}

function handleTypingUpdate(payload) {
  if (payload.conversationId !== state.activeConversationId) return;

  const typingRow = document.getElementById('typingIndicatorRow');
  const typingName = document.getElementById('typingIndicatorName');

  if (typingRow && typingName) {
    if (payload.isTyping) {
      typingName.textContent = `${payload.userName || 'Other participant'} is typing...`;
      typingRow.classList.remove('hidden');
      scrollToBottom(true);
    } else {
      typingRow.classList.add('hidden');
    }
  }
}

function handleNewNotification(payload) {
  if (payload.conversationId !== state.activeConversationId) {
    updateUnreadNavbarBadge();
    loadConversations(false);
  }
}

function updateUserPresenceUI(userId, isOnline) {
  // Update sidebar dots
  document.querySelectorAll(`[data-user-online="${userId}"]`).forEach(dot => {
    dot.className = isOnline ? 'conv-online-dot' : 'conv-online-dot offline';
  });

  // Update active header if relevant
  if (state.activeConversation && state.activeConversation.participant.id === Number(userId)) {
    updateActiveHeaderOnlineStatus(isOnline);
  }
}

async function updateUnreadNavbarBadge() {
  try {
    const res = await fetch(`${API_BASE}/api/chat/unread-count`, { credentials: 'include' });
    const data = await res.json();
    const count = (data && data.success) ? parseInt(data.unreadCount || 0, 10) : 0;

    const badges = document.querySelectorAll('#navUnreadBadge, #mobile-bottom-chat-badge, .nav-chat-unread-badge');
    badges.forEach(b => {
      if (count > 0) {
        b.textContent = count > 99 ? '99+' : count;
        b.classList.remove('hidden');
      } else {
        b.classList.add('hidden');
      }
    });
  } catch (e) {}
}

/* ---------------------------------------------------------------
   8. Attachment Upload
--------------------------------------------------------------- */
function setupAttachmentUpload() {
  const fileInput = document.getElementById('chatFileInput');
  if (!fileInput) return;

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('Photo is too large. Maximum size allowed is 5MB.');
      fileInput.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('image', file);

    try {
      const res = await fetch(`${API_BASE}/api/chat/upload`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const data = await res.json();

      if (data.success && data.url) {
        await executeSendMessage('', 'image', data.url);
      } else {
        alert(data.error || 'Failed to upload photo.');
      }
    } catch (err) {
      alert('Network error while uploading photo.');
    } finally {
      fileInput.value = '';
    }
  });
}

function openImageLightbox(url) {
  const modal = document.getElementById('imageLightboxModal');
  const img = document.getElementById('lightboxImg');
  if (modal && img) {
    img.src = url;
    modal.classList.remove('hidden');
  }
}

function closeImageLightbox() {
  const modal = document.getElementById('imageLightboxModal');
  if (modal) modal.classList.add('hidden');
}

/* ---------------------------------------------------------------
   9. Property Chat Initiation from Detail Page
--------------------------------------------------------------- */
async function initiateChatForProperty(propertyId) {
  try {
    const res = await fetch(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ property_id: propertyId })
    });
    const data = await res.json();

    if (data.success && data.conversationId) {
      await selectConversation(data.conversationId);
      // Clean query param
      window.history.replaceState({}, document.title, `/chat?conversationId=${data.conversationId}`);
    } else {
      alert(data.error || 'Unable to open conversation for this property.');
    }
  } catch (err) {
    console.error('[initiateChatForProperty error]', err);
  }
}

/* ---------------------------------------------------------------
   10. Conversation Actions: Mute & Archive
--------------------------------------------------------------- */
async function toggleArchiveActiveConversation() {
  if (!state.activeConversationId) return;
  try {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${state.activeConversationId}/archive`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      alert(data.message);
      loadConversations(true);
      if (data.isArchived) {
        closeMobileChat();
      }
    }
  } catch (err) {
    console.error(err);
  }
}

async function toggleMuteActiveConversation() {
  if (!state.activeConversationId) return;
  try {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${state.activeConversationId}/mute`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.success) {
      const muteIcon = document.getElementById('muteIcon');
      if (muteIcon) {
        muteIcon.textContent = data.isMuted ? 'notifications_off' : 'notifications';
      }
      alert(data.message);
    }
  } catch (err) {
    console.error(err);
  }
}

/* ---------------------------------------------------------------
   11. Infinite Scroll for Older Messages
--------------------------------------------------------------- */
async function handleMessagesScroll() {
  const container = document.getElementById('chatMessagesContainer');
  if (!container || state.isLoadingOlder || !state.hasMoreOlder || !state.oldestMessageId) return;

  if (container.scrollTop <= 40) {
    state.isLoadingOlder = true;
    const spinner = document.getElementById('messagesLoadingOlderSpinner');
    if (spinner) spinner.classList.remove('hidden');

    const prevScrollHeight = container.scrollHeight;

    try {
      const res = await fetch(
        `${API_BASE}/api/chat/conversations/${state.activeConversationId}/messages?limit=25&before=${state.oldestMessageId}`,
        { credentials: 'include' }
      );
      const data = await res.json();

      if (data.success && data.messages && data.messages.length > 0) {
        state.hasMoreOlder = Boolean(data.hasMore);
        state.oldestMessageId = data.oldestMessageId;

        // Prepend older messages
        state.messages = [...data.messages, ...state.messages];
        renderMessagesList();

        // Restore scroll position
        const newScrollHeight = container.scrollHeight;
        container.scrollTop = newScrollHeight - prevScrollHeight;
      } else {
        state.hasMoreOlder = false;
      }
    } catch (e) {
      console.error(e);
    } finally {
      state.isLoadingOlder = false;
      if (spinner) spinner.classList.add('hidden');
    }
  }
}

/* ---------------------------------------------------------------
   12. Formatting & Utility Helpers
--------------------------------------------------------------- */
function formatTimeClock(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatMessageTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return d.toLocaleDateString([], { weekday: 'short' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateDivider(dateObj) {
  const now = new Date();
  const isToday = dateObj.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = dateObj.toDateString() === yesterday.toDateString();

  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return dateObj.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', initChatApp);

