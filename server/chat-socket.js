'use strict';
/**
 * chat-socket.js
 * Socket.IO real-time handler for Billedkart Realtech OLX-style Chat System.
 * - Authenticated session handshake via express-session cookie
 * - Conversation-level rooms with strict membership verification
 * - Message persistence before broadcast
 * - Instant delivery & read receipts (Sent -> Delivered -> Read)
 * - Lightweight typing indicators and online presence tracking
 */
const { Server } = require('socket.io');
const cookie = require('cookie');
const signature = require('cookie-signature');

const SESSION_SECRET = process.env.SESSION_SECRET || 'vastu-secure-session-secret-key-2026';

let ioInstance = null;
const userSocketsMap = new Map(); // userId (number) -> Set of socketId (string)

function isUserOnline(userId) {
  const set = userSocketsMap.get(Number(userId));
  return Boolean(set && set.size > 0);
}

function getOnlineUsers() {
  const list = [];
  for (const [userId, set] of userSocketsMap.entries()) {
    if (set.size > 0) list.push(userId);
  }
  return list;
}

function initChatSocket(httpServer, sessionStore, pool) {
  const allowedOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const devOrigins = [
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'http://127.0.0.1:5501',
    'http://localhost:5501',
  ];

  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    pingTimeout: 20000,
    pingInterval: 10000,
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const allowed = [...allowedOrigins, ...devOrigins];
        if (allowed.includes(origin) || process.env.NODE_ENV === 'development') {
          return callback(null, true);
        }
        return callback(new Error('CORS not allowed for Socket.IO origin: ' + origin));
      },
      credentials: true,
      methods: ['GET', 'POST']
    }
  });

  ioInstance = io;

  // 1. Session Authentication Middleware for Socket.IO
  io.use(async (socket, next) => {
    try {
      let rawSessionId = null;

      // A. Check auth payload first if passed explicitly
      if (socket.handshake.auth && socket.handshake.auth.sessionId) {
        rawSessionId = socket.handshake.auth.sessionId;
      }

      // B. Parse cookie from headers
      if (!rawSessionId && socket.handshake.headers.cookie) {
        const parsedCookies = cookie.parse(socket.handshake.headers.cookie);
        const rawCookie = parsedCookies.vastu_sid;
        if (rawCookie) {
          if (rawCookie.startsWith('s:')) {
            const unsigned = signature.unsign(rawCookie.slice(2), SESSION_SECRET);
            if (unsigned !== false) {
              rawSessionId = unsigned;
            }
          } else {
            rawSessionId = rawCookie;
          }
        }
      }

      if (!rawSessionId) {
        return next(new Error('Authentication required: No session cookie found'));
      }

      // C. Look up session in MySQL sessionStore
      sessionStore.get(rawSessionId, async (err, sessionData) => {
        if (err || !sessionData || !sessionData.userId) {
          return next(new Error('Authentication required: Invalid or expired session'));
        }

        try {
          const [users] = await pool.query(
            'SELECT id, full_name, username, email, phone, profile_image_url, role, status FROM users WHERE id = ? LIMIT 1',
            [sessionData.userId]
          );

          if (users.length === 0 || users[0].status !== 'active') {
            return next(new Error('Authentication required: Account inactive or not found'));
          }

          socket.userId = Number(users[0].id);
          socket.user = users[0];
          socket.sessionId = rawSessionId;
          return next();
        } catch (dbErr) {
          console.error('[Socket.IO Auth DB Error]', dbErr);
          return next(new Error('Internal authentication error'));
        }
      });
    } catch (err) {
      console.error('[Socket.IO Auth Middleware Error]', err);
      return next(new Error('Authentication failure'));
    }
  });

  // 2. Connection Handler
  io.on('connection', (socket) => {
    const userId = socket.userId;
    const userName = socket.user.full_name;

    // Track user socket ID
    if (!userSocketsMap.has(userId)) {
      userSocketsMap.set(userId, new Set());
    }
    userSocketsMap.get(userId).add(socket.id);

    // Join personal notification room
    socket.join(`user:${userId}`);

    // Broadcast online status if this is the user's first active socket
    if (userSocketsMap.get(userId).size === 1) {
      io.emit('user:online', { userId, timestamp: new Date() });
    }

    // Acknowledge connection
    socket.emit('connection:ready', {
      userId,
      user: {
        id: socket.user.id,
        fullName: socket.user.full_name,
        username: socket.user.username,
        role: socket.user.role,
        profileImageUrl: socket.user.profile_image_url
      },
      onlineUsers: getOnlineUsers()
    });

    // -------------------------------------------------------------
    // Event: chat:join
    // Verifies conversation membership before joining room
    // -------------------------------------------------------------
    socket.on('chat:join', async (payload, callback = () => {}) => {
      try {
        const conversationId = parseInt(payload && payload.conversationId, 10);
        if (!conversationId) {
          return callback({ success: false, error: 'Invalid conversation ID' });
        }

        const [convRows] = await pool.query(
          'SELECT id, property_id, buyer_id, seller_id FROM conversations WHERE id = ? LIMIT 1',
          [conversationId]
        );

        if (convRows.length === 0) {
          return callback({ success: false, error: 'Conversation not found' });
        }

        const conv = convRows[0];
        if (conv.buyer_id !== userId && conv.seller_id !== userId) {
          return callback({ success: false, error: 'Unauthorized: You are not a participant in this conversation' });
        }

        const roomName = `conversation:${conversationId}`;
        socket.join(roomName);

        const otherUserId = (conv.buyer_id === userId) ? conv.seller_id : conv.buyer_id;

        // Auto-mark incoming 'sent' messages as 'delivered'
        await pool.query(
          `UPDATE messages 
           SET delivery_status = 'delivered' 
           WHERE conversation_id = ? AND sender_id != ? AND delivery_status = 'sent'`,
          [conversationId, userId]
        );

        // Notify room of message delivery
        socket.to(roomName).emit('message:delivered', {
          conversationId,
          recipientId: userId,
          timestamp: new Date()
        });

        callback({
          success: true,
          conversationId,
          isOtherUserOnline: isUserOnline(otherUserId)
        });
      } catch (err) {
        console.error('[Socket chat:join error]', err);
        callback({ success: false, error: 'Failed to join chat room' });
      }
    });

    // -------------------------------------------------------------
    // Event: chat:leave
    // -------------------------------------------------------------
    socket.on('chat:leave', (payload, callback = () => {}) => {
      const conversationId = parseInt(payload && payload.conversationId, 10);
      if (conversationId) {
        socket.leave(`conversation:${conversationId}`);
      }
      callback({ success: true });
    });

    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // Event: message:send
    // Persists message idempotently in MySQL BEFORE broadcasting
    // Always starts with 'sent' status (single neutral tick)
    // -------------------------------------------------------------
    socket.on('message:send', async (payload, callback = () => {}) => {
      try {
        const conversationId = parseInt(payload && payload.conversationId, 10);
        const rawText = (typeof payload.messageText === 'string') ? payload.messageText.trim() : '';
        const messageType = ['text', 'image', 'system'].includes(payload.messageType) ? payload.messageType : 'text';
        const attachmentUrl = (typeof payload.attachmentUrl === 'string' && payload.attachmentUrl.trim()) ? payload.attachmentUrl.trim() : null;
        const clientMessageId = (typeof payload.clientMessageId === 'string' && payload.clientMessageId.trim()) 
          ? payload.clientMessageId.trim().slice(0, 64) 
          : null;

        if (!conversationId) {
          return callback({ success: false, error: 'Conversation ID is required' });
        }

        if (!rawText && !attachmentUrl) {
          return callback({ success: false, error: 'Message cannot be empty' });
        }

        if (rawText.length > 2000) {
          return callback({ success: false, error: 'Message cannot exceed 2000 characters' });
        }

        // Verify conversation membership
        const [convRows] = await pool.query(
          'SELECT id, property_id, buyer_id, seller_id FROM conversations WHERE id = ? LIMIT 1',
          [conversationId]
        );

        if (convRows.length === 0) {
          return callback({ success: false, error: 'Conversation not found' });
        }

        const conv = convRows[0];
        if (conv.buyer_id !== userId && conv.seller_id !== userId) {
          return callback({ success: false, error: 'Unauthorized: You are not a participant in this conversation' });
        }

        const recipientId = (conv.buyer_id === userId) ? conv.seller_id : conv.buyer_id;
        const roomName = `conversation:${conversationId}`;

        // IDEMPOTENCY CHECK: if clientMessageId already exists, return existing message without re-inserting
        if (clientMessageId) {
          const [existingRows] = await pool.query(
            `SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.message_type, m.message_text, 
                    m.attachment_url, m.delivery_status, m.created_at,
                    u.full_name as sender_name, u.username as sender_username, u.profile_image_url as sender_avatar
             FROM messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.client_message_id = ? LIMIT 1`,
            [clientMessageId]
          );
          if (existingRows.length > 0) {
            return callback({ success: true, message: existingRows[0] });
          }
        }

        // 1. Persist to MySQL — Status ALWAYS starts as 'sent' (1 neutral tick)
        const [insertRes] = await pool.query(
          `INSERT INTO messages 
           (conversation_id, sender_id, client_message_id, message_type, message_text, attachment_url, delivery_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'sent', NOW())`,
          [conversationId, userId, clientMessageId, messageType, rawText, attachmentUrl]
        );

        const messageId = insertRes.insertId;

        // 2. Fetch formatted saved message with sender details
        const [savedRows] = await pool.query(
          `SELECT m.id, m.conversation_id, m.sender_id, m.client_message_id, m.message_type, m.message_text, 
                  m.attachment_url, m.delivery_status, m.created_at,
                  u.full_name as sender_name, u.username as sender_username, u.profile_image_url as sender_avatar
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id = ?`,
          [messageId]
        );

        const savedMsg = savedRows[0];

        // 3. Update conversation last_message_id, timestamps, and unarchive for both
        await pool.query(
          `UPDATE conversations 
           SET last_message_id = ?, 
               updated_at = NOW(),
               buyer_archived = 0, 
               seller_archived = 0
           WHERE id = ?`,
          [messageId, conversationId]
        );

        // 4. Broadcast to the conversation room
        io.to(roomName).emit('message:new', {
          conversationId,
          message: savedMsg
        });

        // 5. Notify recipient in their personal room
        io.to(`user:${recipientId}`).emit('notification:new', {
          conversationId,
          senderId: userId,
          senderName: userName,
          messagePreview: rawText || (attachmentUrl ? '📷 Photo' : 'New message'),
          message: savedMsg
        });

        // 6. Notify conversation updates to both participants (for sidebar last message previews)
        io.to(`user:${recipientId}`).emit('conversation:updated', {
          conversationId,
          lastMessage: savedMsg
        });
        io.to(`user:${userId}`).emit('conversation:updated', {
          conversationId,
          lastMessage: savedMsg
        });

        callback({ success: true, message: savedMsg });
      } catch (err) {
        console.error('[Socket message:send error]', err);
        callback({ success: false, error: 'Failed to send message' });
      }
    });

    // -------------------------------------------------------------
    // Event: message:delivered
    // Recipient acknowledges receiving messages (Sent -> Delivered: 2 neutral ticks)
    // -------------------------------------------------------------
    socket.on('message:delivered', async (payload, callback = () => {}) => {
      try {
        const conversationId = parseInt(payload && payload.conversationId, 10);
        if (!conversationId) return;

        const [convRows] = await pool.query(
          'SELECT id, buyer_id, seller_id FROM conversations WHERE id = ? LIMIT 1',
          [conversationId]
        );
        if (convRows.length === 0) return;
        const conv = convRows[0];
        if (conv.buyer_id !== userId && conv.seller_id !== userId) return;

        // Recipient acknowledges messages from the OTHER participant
        const [updateRes] = await pool.query(
          `UPDATE messages 
           SET delivery_status = 'delivered' 
           WHERE conversation_id = ? AND sender_id != ? AND delivery_status = 'sent'`,
          [conversationId, userId]
        );

        if (updateRes.affectedRows > 0) {
          const roomName = `conversation:${conversationId}`;
          io.to(roomName).emit('message:delivered', {
            conversationId,
            recipientId: userId,
            deliveredAt: new Date()
          });
        }
        callback({ success: true, count: updateRes.affectedRows });
      } catch (err) {
        console.error('[Socket message:delivered error]', err);
      }
    });

    // -------------------------------------------------------------
    // Event: message:read
    // Recipient actually views conversation (Delivered -> Read: 2 blue ticks)
    // Never marks own messages as read!
    // -------------------------------------------------------------
    socket.on('message:read', async (payload, callback = () => {}) => {
      try {
        const conversationId = parseInt(payload && payload.conversationId, 10);
        if (!conversationId) {
          return callback({ success: false, error: 'Invalid conversation ID' });
        }

        const [convRows] = await pool.query(
          'SELECT id, buyer_id, seller_id FROM conversations WHERE id = ? LIMIT 1',
          [conversationId]
        );

        if (convRows.length === 0) {
          return callback({ success: false, error: 'Conversation not found' });
        }

        const conv = convRows[0];
        if (conv.buyer_id !== userId && conv.seller_id !== userId) {
          return callback({ success: false, error: 'Unauthorized' });
        }

        // Only mark messages sent by OTHER participant as read
        const [updateRes] = await pool.query(
          `UPDATE messages 
           SET delivery_status = 'read' 
           WHERE conversation_id = ? AND sender_id != ? AND delivery_status != 'read'`,
          [conversationId, userId]
        );

        // Update conversation read timestamp for the reader
        if (conv.buyer_id === userId) {
          await pool.query('UPDATE conversations SET buyer_last_read_at = NOW() WHERE id = ?', [conversationId]);
        } else {
          await pool.query('UPDATE conversations SET seller_last_read_at = NOW() WHERE id = ?', [conversationId]);
        }

        const roomName = `conversation:${conversationId}`;
        const otherUserId = (conv.buyer_id === userId) ? conv.seller_id : conv.buyer_id;

        // Emit read event to conversation room so sender sees double blue ticks
        io.to(roomName).emit('message:read', {
          conversationId,
          readerId: userId,
          readAt: new Date()
        });

        // Also update other user's conversation list badge
        io.to(`user:${otherUserId}`).emit('conversation:updated', { conversationId });

        callback({ success: true, count: updateRes.affectedRows });
      } catch (err) {
        console.error('[Socket message:read error]', err);
        callback({ success: false, error: 'Failed to mark messages as read' });
      }
    });

    // -------------------------------------------------------------
    // Event: typing:start & typing:stop
    // -------------------------------------------------------------
    socket.on('typing:start', (payload) => {
      const conversationId = parseInt(payload && payload.conversationId, 10);
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing:update', {
          conversationId,
          userId,
          userName: socket.user.full_name,
          isTyping: true
        });
      }
    });

    socket.on('typing:stop', (payload) => {
      const conversationId = parseInt(payload && payload.conversationId, 10);
      if (conversationId) {
        socket.to(`conversation:${conversationId}`).emit('typing:update', {
          conversationId,
          userId,
          userName: socket.user.full_name,
          isTyping: false
        });
      }
    });

    // -------------------------------------------------------------
    // Disconnect Handler
    // -------------------------------------------------------------
    socket.on('disconnect', () => {
      if (userSocketsMap.has(userId)) {
        const set = userSocketsMap.get(userId);
        set.delete(socket.id);
        if (set.size === 0) {
          userSocketsMap.delete(userId);
          // Broadcast offline event with lastSeen timestamp
          io.emit('user:offline', {
            userId,
            lastSeen: new Date()
          });
        }
      }
    });
  });

  console.log('[chat-socket] Socket.IO real-time chat service initialized.');
  return io;
}

function getIoInstance() {
  return ioInstance;
}

module.exports = {
  initChatSocket,
  getIoInstance,
  isUserOnline
};

