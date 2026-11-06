'use strict';
/**
 * chat.js — Billedkart Realtech Chat REST API Router
 * Implements OLX-style real-time property conversation management.
 */
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('./db');
const { getIoInstance, isUserOnline } = require('./chat-socket');

const router = express.Router();

function cleanAvatarName(name) {
  if (!name || typeof name !== 'string') return 'User';
  return name.replace(/\s*\([^)]*\)/g, '').trim() || name;
}

/* ---------------------------------------------------------------
   Authentication Middleware
--------------------------------------------------------------- */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in to use chat.'
    });
  }
  next();
}

/* ---------------------------------------------------------------
   Multer Storage for Chat Image Attachments
--------------------------------------------------------------- */
const UPLOAD_DIR = path.resolve(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `chat-${uuidv4()}${ext}`);
  }
});

const fileFilter = (_req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid image format. Allowed: JPG, PNG, WEBP, GIF.'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

/* ---------------------------------------------------------------
   Helper: Format Currency
--------------------------------------------------------------- */
function formatPrice(num) {
  const val = Number(num);
  if (!val || isNaN(val)) return 'Price on Request';
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)} Lac`;
  return `₹${val.toLocaleString('en-IN')}`;
}

/* ---------------------------------------------------------------
   1. GET /api/chat/conversations
   Fetches all conversations for the authenticated user
--------------------------------------------------------------- */
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const filter = (req.query.filter || 'all').toLowerCase();
    const searchQuery = (typeof req.query.q === 'string') ? req.query.q.trim().toLowerCase() : '';

    // Fetch conversations where user is buyer or seller
    const query = `
      SELECT 
        c.id, c.property_id, c.buyer_id, c.seller_id, c.last_message_id,
        c.buyer_archived, c.seller_archived, c.buyer_muted, c.seller_muted,
        c.buyer_last_read_at, c.seller_last_read_at, c.created_at, c.updated_at,
        p.title AS property_title, p.price AS property_price, p.locality AS property_locality,
        p.city AS property_city, p.primary_image_url AS property_image, p.status AS property_status,
        p.slug AS property_slug,
        u_other.id AS other_user_id, u_other.full_name AS other_user_name,
        u_other.username AS other_user_username, u_other.profile_image_url AS other_user_avatar,
        u_other.role AS other_user_role,
        m.id AS last_msg_id, m.sender_id AS last_msg_sender_id, m.message_type AS last_msg_type,
        m.message_text AS last_msg_text, m.attachment_url AS last_msg_attachment,
        m.delivery_status AS last_msg_status, m.created_at AS last_msg_time,
        (
          SELECT COUNT(*) 
          FROM messages m_unread 
          WHERE m_unread.conversation_id = c.id 
            AND m_unread.sender_id != ? 
            AND m_unread.delivery_status != 'read'
        ) AS unread_count
      FROM conversations c
      JOIN properties p ON c.property_id = p.id
      JOIN users u_other ON u_other.id = (CASE WHEN c.buyer_id = ? THEN c.seller_id ELSE c.buyer_id END)
      LEFT JOIN messages m ON c.last_message_id = m.id
      WHERE (c.buyer_id = ? OR c.seller_id = ?)
      ORDER BY c.updated_at DESC
    `;

    const [rows] = await pool.query(query, [currentUserId, currentUserId, currentUserId, currentUserId]);

    // Format & filter conversations
    const conversations = rows.map(r => {
      const isBuyer = (r.buyer_id === currentUserId);
      const isArchived = isBuyer ? Boolean(r.buyer_archived) : Boolean(r.seller_archived);
      const isMuted = isBuyer ? Boolean(r.buyer_muted) : Boolean(r.seller_muted);
      const otherOnline = isUserOnline(r.other_user_id);

      return {
        id: r.id,
        property: {
          id: r.property_id,
          title: r.property_title,
          formattedPrice: formatPrice(r.property_price),
          rawPrice: r.property_price,
          locality: r.property_locality,
          city: r.property_city,
          imageUrl: r.property_image || '/property_detail_page/img/placeholder.jpg',
          status: r.property_status || 'active',
          slug: r.property_slug
        },
        participant: {
          id: r.other_user_id,
          name: r.other_user_name,
          username: r.other_user_username,
          avatarUrl: r.other_user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanAvatarName(r.other_user_name))}&background=eaedff&color=00236f&size=80`,
          role: isBuyer ? 'Seller' : 'Buyer',
          isOnline: otherOnline
        },
        lastMessage: r.last_msg_id ? {
          id: r.last_msg_id,
          senderId: r.last_msg_sender_id,
          isMine: (r.last_msg_sender_id === currentUserId),
          type: r.last_msg_type,
          text: r.last_msg_text,
          attachmentUrl: r.last_msg_attachment,
          status: r.last_msg_status,
          createdAt: r.last_msg_time
        } : null,
        unreadCount: parseInt(r.unread_count || 0, 10),
        isBuyer,
        isArchived,
        isMuted,
        updatedAt: r.updated_at
      };
    }).filter(c => {
      // Filter by archive state unless searching
      if (!searchQuery && filter !== 'archived' && c.isArchived) return false;
      if (filter === 'archived' && !c.isArchived) return false;

      // Filter tabs
      if (filter === 'unread' && c.unreadCount === 0) return false;
      if (filter === 'buying' && !c.isBuyer) return false;
      if (filter === 'selling' && c.isBuyer) return false;

      // Search keyword filter
      if (searchQuery) {
        const matchesProp = c.property.title.toLowerCase().includes(searchQuery) ||
                            c.property.locality.toLowerCase().includes(searchQuery);
        const matchesName = c.participant.name.toLowerCase().includes(searchQuery);
        const matchesLast = c.lastMessage && c.lastMessage.text && c.lastMessage.text.toLowerCase().includes(searchQuery);
        return matchesProp || matchesName || matchesLast;
      }
      return true;
    });

    res.json({
      success: true,
      conversations,
      total: conversations.length
    });
  } catch (err) {
    console.error('[GET /api/chat/conversations]', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve conversations.' });
  }
});

/* ---------------------------------------------------------------
   2. GET /api/chat/conversations/:id/messages
   Fetches paginated messages for a conversation
--------------------------------------------------------------- */
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const conversationId = parseInt(req.params.id, 10);
    const limit = Math.min(Math.max(parseInt(req.query.limit || 30, 10), 1), 100);
    const beforeId = req.query.before ? parseInt(req.query.before, 10) : null;

    if (!conversationId) {
      return res.status(400).json({ success: false, error: 'Invalid conversation ID.' });
    }

    // Verify membership
    const [convRows] = await pool.query(
      `SELECT c.id, c.property_id, c.buyer_id, c.seller_id,
              p.title AS property_title, p.price AS property_price, p.locality AS property_locality,
              p.city AS property_city, p.primary_image_url AS property_image, p.status AS property_status,
              p.slug AS property_slug,
              u_other.id AS other_user_id, u_other.full_name AS other_user_name,
              u_other.username AS other_user_username, u_other.profile_image_url AS other_user_avatar
       FROM conversations c
       JOIN properties p ON c.property_id = p.id
       JOIN users u_other ON u_other.id = (CASE WHEN c.buyer_id = ? THEN c.seller_id ELSE c.buyer_id END)
       WHERE c.id = ? AND (c.buyer_id = ? OR c.seller_id = ?)
       LIMIT 1`,
      [currentUserId, conversationId, currentUserId, currentUserId]
    );

    if (convRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found or access denied.' });
    }

    const conv = convRows[0];
    const isBuyer = (conv.buyer_id === currentUserId);

    // Query messages
    let msgSql = `
      SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.message_text,
             m.attachment_url, m.delivery_status, m.created_at,
             u.full_name AS sender_name, u.username AS sender_username, u.profile_image_url AS sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = ?
    `;
    const params = [conversationId];

    if (beforeId) {
      msgSql += ` AND m.id < ?`;
      params.push(beforeId);
    }

    msgSql += ` ORDER BY m.id DESC LIMIT ?`;
    params.push(limit + 1);

    const [rows] = await pool.query(msgSql, params);

    const hasMore = rows.length > limit;
    const rawMessages = hasMore ? rows.slice(0, limit) : rows;

    // Reverse to chronological order (oldest to newest)
    const messages = rawMessages.reverse().map(m => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      senderName: m.sender_name,
      senderAvatar: m.sender_avatar,
      isMine: (m.sender_id === currentUserId),
      type: m.message_type,
      text: m.message_text,
      attachmentUrl: m.attachment_url,
      status: m.delivery_status,
      createdAt: m.created_at
    }));

    // Mark any unread incoming messages as read
    await pool.query(
      `UPDATE messages 
       SET delivery_status = 'read' 
       WHERE conversation_id = ? AND sender_id != ? AND delivery_status != 'read'`,
      [conversationId, currentUserId]
    );

    if (isBuyer) {
      await pool.query('UPDATE conversations SET buyer_last_read_at = NOW() WHERE id = ?', [conversationId]);
    } else {
      await pool.query('UPDATE conversations SET seller_last_read_at = NOW() WHERE id = ?', [conversationId]);
    }

    const io = getIoInstance();
    if (io) {
      io.to(`conversation:${conversationId}`).emit('message:read', {
        conversationId,
        readerId: currentUserId,
        readAt: new Date()
      });
      io.to(`user:${conv.other_user_id}`).emit('conversation:updated', { conversationId });
    }

    res.json({
      success: true,
      conversation: {
        id: conv.id,
        isBuyer,
        property: {
          id: conv.property_id,
          title: conv.property_title,
          formattedPrice: formatPrice(conv.property_price),
          rawPrice: conv.property_price,
          locality: conv.property_locality,
          city: conv.property_city,
          imageUrl: conv.property_image || '/property_detail_page/img/placeholder.jpg',
          status: conv.property_status || 'active',
          slug: conv.property_slug
        },
        participant: {
          id: conv.other_user_id,
          name: conv.other_user_name,
          username: conv.other_user_username,
          avatarUrl: conv.other_user_avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(cleanAvatarName(conv.other_user_name))}&background=eaedff&color=00236f&size=80`,
          role: isBuyer ? 'Seller' : 'Buyer',
          isOnline: isUserOnline(conv.other_user_id)
        }
      },
      messages,
      hasMore,
      oldestMessageId: messages.length > 0 ? messages[0].id : null
    });
  } catch (err) {
    console.error('[GET /api/chat/conversations/:id/messages]', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve messages.' });
  }
});

/* ---------------------------------------------------------------
   3. POST /api/chat/conversations
   Creates or retrieves an existing conversation for a property
--------------------------------------------------------------- */
router.post('/conversations', requireAuth, async (req, res) => {
  try {
    const buyerId = req.session.userId;
    const rawProp = req.body.property_id != null ? String(req.body.property_id).trim() : '';
    const initialMessage = (typeof req.body.initial_message === 'string') ? req.body.initial_message.trim() : '';

    if (!rawProp) {
      return res.status(400).json({ success: false, error: 'Property ID or reference is required.' });
    }

    // 1. Fetch property and owner - support integer ID, exact slug, or ref slug (e.g. prop-201)
    let propRows = [];
    const numId = parseInt(rawProp, 10);
    if (!isNaN(numId) && String(numId) === rawProp) {
      [propRows] = await pool.query(
        'SELECT id, owner_user_id, title, status, slug, price, locality, city, owner_name, owner_phone FROM properties WHERE id = ? LIMIT 1',
        [numId]
      );
    }

    if (propRows.length === 0) {
      [propRows] = await pool.query(
        'SELECT id, owner_user_id, title, status, slug, price, locality, city, owner_name, owner_phone FROM properties WHERE slug = ? OR slug LIKE ? LIMIT 1',
        [rawProp, `%${rawProp}%`]
      );
    }

    if (propRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Property not found.' });
    }

    const prop = propRows[0];
    const propertyId = prop.id;
    let sellerId = prop.owner_user_id;

    // Fallback: If property has no owner_user_id assigned, assign to demo seller user 65
    if (!sellerId) {
      const [demoSeller] = await pool.query("SELECT id FROM users WHERE email = 'seller_demo@billedkart.com' LIMIT 1");
      sellerId = demoSeller.length > 0 ? demoSeller[0].id : 1;
      await pool.query('UPDATE properties SET owner_user_id = ? WHERE id = ?', [sellerId, propertyId]);
    }

    // Prevent user chatting with themselves
    if (sellerId === buyerId) {
      return res.status(400).json({
        success: false,
        error: 'You cannot start a chat with yourself on your own listed property.',
        isSelf: true
      });
    }

    // 2. Check if conversation already exists
    const [existing] = await pool.query(
      'SELECT id, buyer_archived, seller_archived FROM conversations WHERE property_id = ? AND buyer_id = ? AND seller_id = ? LIMIT 1',
      [propertyId, buyerId, sellerId]
    );

    let conversationId;
    let isNew = false;

    if (existing.length > 0) {
      conversationId = existing[0].id;
      // Unarchive if buyer had archived it
      if (existing[0].buyer_archived) {
        await pool.query('UPDATE conversations SET buyer_archived = 0 WHERE id = ?', [conversationId]);
      }
    } else {
      // Create new conversation
      const [insertConv] = await pool.query(
        `INSERT INTO conversations (property_id, buyer_id, seller_id, created_at, updated_at)
         VALUES (?, ?, ?, NOW(), NOW())`,
        [propertyId, buyerId, sellerId]
      );
      conversationId = insertConv.insertId;
      isNew = true;
    }

    // 3. If initial message was provided, save it
    if (initialMessage) {
      const isOnline = isUserOnline(sellerId);
      const deliveryStatus = isOnline ? 'delivered' : 'sent';

      const [msgRes] = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, message_type, message_text, delivery_status, created_at)
         VALUES (?, ?, 'text', ?, ?, NOW())`,
        [conversationId, buyerId, initialMessage, deliveryStatus]
      );

      const messageId = msgRes.insertId;

      await pool.query(
        `UPDATE conversations 
         SET last_message_id = ?, updated_at = NOW(), buyer_last_read_at = NOW() 
         WHERE id = ?`,
        [messageId, conversationId]
      );

      const io = getIoInstance();
      if (io) {
        const [savedRows] = await pool.query(
          `SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.message_text, 
                  m.attachment_url, m.delivery_status, m.created_at,
                  u.full_name as sender_name, u.username as sender_username, u.profile_image_url as sender_avatar
           FROM messages m
           JOIN users u ON m.sender_id = u.id
           WHERE m.id = ?`,
          [messageId]
        );

        if (savedRows.length > 0) {
          const savedMsg = savedRows[0];
          io.to(`conversation:${conversationId}`).emit('message:new', {
            conversationId,
            message: savedMsg
          });
          io.to(`user:${sellerId}`).emit('notification:new', {
            conversationId,
            senderId: buyerId,
            senderName: req.session.user ? req.session.user.fullName : 'Buyer',
            messagePreview: initialMessage,
            message: savedMsg
          });
          io.to(`user:${sellerId}`).emit('conversation:updated', { conversationId, lastMessage: savedMsg });
        }
      }
    }

    res.json({
      success: true,
      conversationId,
      isNew,
      propertyId,
      propertySlug: prop.slug,
      propertyTitle: prop.title,
      sellerPhone: prop.owner_phone,
      sellerName: prop.owner_name,
      message: isNew ? 'Conversation created.' : 'Existing conversation retrieved.'
    });
  } catch (err) {
    console.error('[POST /api/chat/conversations]', err);
    res.status(500).json({ success: false, error: 'Failed to initiate conversation.' });
  }
});

/* ---------------------------------------------------------------
   4. POST /api/chat/conversations/:id/messages
   HTTP fallback for sending messages
--------------------------------------------------------------- */
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const conversationId = parseInt(req.params.id, 10);
    const rawText = (typeof req.body.messageText === 'string') ? req.body.messageText.trim() : '';
    const messageType = ['text', 'image', 'system'].includes(req.body.messageType) ? req.body.messageType : 'text';
    const attachmentUrl = req.body.attachmentUrl || null;
    const clientMessageId = (typeof req.body.clientMessageId === 'string' && req.body.clientMessageId.trim())
      ? req.body.clientMessageId.trim().slice(0, 64)
      : null;

    if (!conversationId) {
      return res.status(400).json({ success: false, error: 'Conversation ID required.' });
    }
    if (!rawText && !attachmentUrl) {
      return res.status(400).json({ success: false, error: 'Message cannot be empty.' });
    }

    // Verify membership
    const [convRows] = await pool.query(
      'SELECT id, buyer_id, seller_id FROM conversations WHERE id = ? LIMIT 1',
      [conversationId]
    );

    if (convRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }

    const conv = convRows[0];
    if (conv.buyer_id !== currentUserId && conv.seller_id !== currentUserId) {
      return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const recipientId = (conv.buyer_id === currentUserId) ? conv.seller_id : conv.buyer_id;

    // Idempotency check: if clientMessageId already exists, return existing
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
        return res.json({ success: true, message: existingRows[0] });
      }
    }

    const [insertRes] = await pool.query(
      `INSERT INTO messages 
       (conversation_id, sender_id, client_message_id, message_type, message_text, attachment_url, delivery_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', NOW())`,
      [conversationId, currentUserId, clientMessageId, messageType, rawText, attachmentUrl]
    );

    const messageId = insertRes.insertId;

    await pool.query(
      `UPDATE conversations 
       SET last_message_id = ?, updated_at = NOW(), buyer_archived = 0, seller_archived = 0 
       WHERE id = ?`,
      [messageId, conversationId]
    );

    const [savedRows] = await pool.query(
      `SELECT m.id, m.conversation_id, m.sender_id, m.message_type, m.message_text, 
              m.attachment_url, m.delivery_status, m.created_at,
              u.full_name as sender_name, u.username as sender_username, u.profile_image_url as sender_avatar
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.id = ?`,
      [messageId]
    );

    const savedMsg = savedRows[0];

    const io = getIoInstance();
    if (io) {
      io.to(`conversation:${conversationId}`).emit('message:new', {
        conversationId,
        message: savedMsg
      });
      io.to(`user:${recipientId}`).emit('notification:new', {
        conversationId,
        senderId: currentUserId,
        senderName: savedMsg.sender_name,
        messagePreview: rawText || 'Attachment',
        message: savedMsg
      });
      io.to(`user:${recipientId}`).emit('conversation:updated', { conversationId, lastMessage: savedMsg });
      io.to(`user:${currentUserId}`).emit('conversation:updated', { conversationId, lastMessage: savedMsg });
    }

    res.json({
      success: true,
      message: savedMsg
    });
  } catch (err) {
    console.error('[POST /api/chat/conversations/:id/messages]', err);
    res.status(500).json({ success: false, error: 'Failed to send message.' });
  }
});

/* ---------------------------------------------------------------
   5. PATCH /api/chat/conversations/:id/read
   Marks conversation messages as read
--------------------------------------------------------------- */
router.patch('/conversations/:id/read', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const conversationId = parseInt(req.params.id, 10);

    const [convRows] = await pool.query(
      'SELECT id, buyer_id, seller_id FROM conversations WHERE id = ? LIMIT 1',
      [conversationId]
    );

    if (convRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }

    const conv = convRows[0];
    if (conv.buyer_id !== currentUserId && conv.seller_id !== currentUserId) {
      return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const [updateRes] = await pool.query(
      `UPDATE messages 
       SET delivery_status = 'read' 
       WHERE conversation_id = ? AND sender_id != ? AND delivery_status != 'read'`,
      [conversationId, currentUserId]
    );

    if (conv.buyer_id === currentUserId) {
      await pool.query('UPDATE conversations SET buyer_last_read_at = NOW() WHERE id = ?', [conversationId]);
    } else {
      await pool.query('UPDATE conversations SET seller_last_read_at = NOW() WHERE id = ?', [conversationId]);
    }

    const io = getIoInstance();
    if (io) {
      io.to(`conversation:${conversationId}`).emit('message:read', {
        conversationId,
        readerId: currentUserId,
        readAt: new Date()
      });
    }

    res.json({ success: true, count: updateRes.affectedRows });
  } catch (err) {
    console.error('[PATCH /api/chat/conversations/:id/read]', err);
    res.status(500).json({ success: false, error: 'Failed to mark as read.' });
  }
});

/* ---------------------------------------------------------------
   6. PATCH /api/chat/conversations/:id/archive
   Toggles archive status for the user
--------------------------------------------------------------- */
router.patch('/conversations/:id/archive', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const conversationId = parseInt(req.params.id, 10);
    const { archived } = req.body;

    const [convRows] = await pool.query(
      'SELECT id, buyer_id, seller_id, buyer_archived, seller_archived FROM conversations WHERE id = ? LIMIT 1',
      [conversationId]
    );

    if (convRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }

    const conv = convRows[0];
    if (conv.buyer_id !== currentUserId && conv.seller_id !== currentUserId) {
      return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const isBuyer = (conv.buyer_id === currentUserId);
    const nextArchived = (typeof archived === 'boolean')
      ? (archived ? 1 : 0)
      : (isBuyer ? (conv.buyer_archived ? 0 : 1) : (conv.seller_archived ? 0 : 1));

    if (isBuyer) {
      await pool.query('UPDATE conversations SET buyer_archived = ? WHERE id = ?', [nextArchived, conversationId]);
    } else {
      await pool.query('UPDATE conversations SET seller_archived = ? WHERE id = ?', [nextArchived, conversationId]);
    }

    res.json({
      success: true,
      conversationId,
      isArchived: Boolean(nextArchived),
      message: nextArchived ? 'Conversation archived.' : 'Conversation unarchived.'
    });
  } catch (err) {
    console.error('[PATCH /api/chat/conversations/:id/archive]', err);
    res.status(500).json({ success: false, error: 'Failed to update archive status.' });
  }
});

/* ---------------------------------------------------------------
   7. PATCH /api/chat/conversations/:id/mute
   Toggles mute status for the user
--------------------------------------------------------------- */
router.patch('/conversations/:id/mute', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;
    const conversationId = parseInt(req.params.id, 10);
    const { muted } = req.body;

    const [convRows] = await pool.query(
      'SELECT id, buyer_id, seller_id, buyer_muted, seller_muted FROM conversations WHERE id = ? LIMIT 1',
      [conversationId]
    );

    if (convRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Conversation not found.' });
    }

    const conv = convRows[0];
    if (conv.buyer_id !== currentUserId && conv.seller_id !== currentUserId) {
      return res.status(403).json({ success: false, error: 'Unauthorized.' });
    }

    const isBuyer = (conv.buyer_id === currentUserId);
    const nextMuted = (typeof muted === 'boolean')
      ? (muted ? 1 : 0)
      : (isBuyer ? (conv.buyer_muted ? 0 : 1) : (conv.seller_muted ? 0 : 1));

    if (isBuyer) {
      await pool.query('UPDATE conversations SET buyer_muted = ? WHERE id = ?', [nextMuted, conversationId]);
    } else {
      await pool.query('UPDATE conversations SET seller_muted = ? WHERE id = ?', [nextMuted, conversationId]);
    }

    res.json({
      success: true,
      conversationId,
      isMuted: Boolean(nextMuted),
      message: nextMuted ? 'Notifications muted.' : 'Notifications unmuted.'
    });
  } catch (err) {
    console.error('[PATCH /api/chat/conversations/:id/mute]', err);
    res.status(500).json({ success: false, error: 'Failed to update mute status.' });
  }
});

/* ---------------------------------------------------------------
   8. GET /api/chat/unread-count
   Total unread message count for navbar badges
--------------------------------------------------------------- */
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const currentUserId = req.session.userId;

    const [rows] = await pool.query(
      `SELECT COUNT(*) AS total_unread
       FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE (c.buyer_id = ? OR c.seller_id = ?)
         AND m.sender_id != ?
         AND m.delivery_status != 'read'
         AND (
           (c.buyer_id = ? AND c.buyer_archived = 0) OR
           (c.seller_id = ? AND c.seller_archived = 0)
         )`,
      [currentUserId, currentUserId, currentUserId, currentUserId, currentUserId]
    );

    res.json({
      success: true,
      unreadCount: parseInt(rows[0].total_unread || 0, 10)
    });
  } catch (err) {
    console.error('[GET /api/chat/unread-count]', err);
    res.status(500).json({ success: false, error: 'Failed to retrieve unread count.' });
  }
});

/* ---------------------------------------------------------------
   9. POST /api/chat/upload
   Uploads image attachment for chat
--------------------------------------------------------------- */
router.post('/upload', requireAuth, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No image file uploaded.' });
  }

  const relativeUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    url: relativeUrl,
    filename: req.file.filename,
    mimetype: req.file.mimetype,
    size: req.file.size
  });
});

module.exports = router;

