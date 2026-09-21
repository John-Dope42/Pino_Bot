import { config } from './config.js';

const messageCache = new Map();

// Returns an object { isSpam: boolean, messages: Array<{id, channelId, timestamp}> }
export function checkSpam(message){
  const content = (message.content || '').toLowerCase().trim();
  const key = `${message.author.id}:${content}`;
  const windowMs = config.similarMessageWindow || 15 * 60 * 1000;
  const now = Date.now();

  const entry = messageCache.get(key) || { count: 0, notified: false, messages: [] };
  entry.count = (entry.count || 0) + 1;
  entry.messages = entry.messages || [];
  entry.messages.push({ id: message.id, channelId: message.channel.id, timestamp: now });
  messageCache.set(key, entry);

  if(!entry._timeout){
    entry._timeout = setTimeout(() => messageCache.delete(key), windowMs);
  }

  const threshold = config.similarMessageThreshold || 4;
  if(!entry.notified && entry.count >= threshold){
    entry.notified = true;
    messageCache.set(key, entry);
    // return a copy of the messages list to allow deletion attempts
    return { isSpam: true, messages: entry.messages.slice() };
  }
  return { isSpam: false, messages: [] };
}
