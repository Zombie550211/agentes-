const { getDb } = require('../config/db');
const { ObjectId } = require('mongodb');

const COLLECTION = 'chat_messages';

class Message {
  static col() { return getDb().collection(COLLECTION); }

  static async send({ from, fromName, fromAvatar, to, toName, subject = '', body, type = 'chat' }) {
    const doc = {
      from, fromName, fromAvatar: fromAvatar || '',
      to, toName,
      subject, body, type,
      isRead: false,
      isFollowup: false,
      readAt: null,
      timestamp: new Date()
    };
    const result = await this.col().insertOne(doc);
    return { ...doc, _id: result.insertedId };
  }

  static async getConversation(userA, userB, limit = 100) {
    return this.col().find({
      $or: [
        { from: userA, to: userB },
        { from: userB, to: userA }
      ]
    }).sort({ timestamp: 1 }).limit(limit).toArray();
  }

  // Lista de conversaciones únicas para un usuario
  static async getConversationList(username) {
    const msgs = await this.col().find({
      $or: [{ from: username }, { to: username }]
    }).sort({ timestamp: -1 }).toArray();

    const seen = new Map();
    for (const m of msgs) {
      const peer = m.from === username ? m.to : m.from;
      const peerName = m.from === username ? m.toName : m.fromName;
      const peerAvatar = m.from === username ? '' : m.fromAvatar;
      if (!seen.has(peer)) {
        seen.set(peer, {
          peer, peerName, peerAvatar,
          lastMessage: m.body,
          lastTime: m.timestamp,
          unread: (m.to === username && !m.isRead) ? 1 : 0
        });
      } else if (m.to === username && !m.isRead) {
        seen.get(peer).unread++;
      }
    }
    return Array.from(seen.values());
  }

  static async getInbox(username) {
    return this.col().find({ to: username }).sort({ timestamp: -1 }).toArray();
  }

  static async getSent(username) {
    return this.col().find({ from: username }).sort({ timestamp: -1 }).toArray();
  }

  static async getUnread(username) {
    return this.col().find({ to: username, isRead: false }).sort({ timestamp: -1 }).toArray();
  }

  static async getFollowup(username) {
    return this.col().find({
      $or: [{ from: username }, { to: username }],
      isFollowup: true
    }).sort({ timestamp: -1 }).toArray();
  }

  static async markRead(ids, username) {
    const objectIds = ids.map(id => new ObjectId(id));
    return this.col().updateMany(
      { _id: { $in: objectIds }, to: username },
      { $set: { isRead: true, readAt: new Date() } }
    );
  }

  static async toggleFollowup(id) {
    const msg = await this.col().findOne({ _id: new ObjectId(id) });
    if (!msg) return null;
    await this.col().updateOne({ _id: new ObjectId(id) }, { $set: { isFollowup: !msg.isFollowup } });
    return !msg.isFollowup;
  }

  static async unreadCount(username) {
    return this.col().countDocuments({ to: username, isRead: false });
  }
}

module.exports = Message;
