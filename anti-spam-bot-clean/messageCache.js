import { config } from './config.js';

const messageCache = new Map();

// Returns whether this message should be deleted and whether moderators need
// a new alert. Each user/content pair has a sliding window and alert cooldown.
export function checkSpam(message, { keywordSpam = false } = {}){
  const content = (message.content || '').toLowerCase().trim();
  if(!content) return { isSpam: false, messages: [], shouldAlert: false };
  const key = `${message.guild.id}:${message.author.id}:${content}`;
  const windowMs = config.similarMessageWindow || 15 * 60 * 1000;
  const now = Date.now();

  const entry = messageCache.get(key) || { messages: [], lastAlertAt: 0 };
  entry.messages = entry.messages.filter(item => now - item.timestamp < windowMs);
  const threshold = config.similarMessageThreshold || 4;
  const wasSimilar = entry.messages.length >= threshold;
  entry.messages.push({ id: message.id, channelId: message.channel.id, timestamp: now });
  entry.lastSeenAt = now;
  const isSpam = entry.messages.length >= threshold;
  const detected = isSpam || keywordSpam;
  const shouldAlert = detected && ((isSpam && !wasSimilar) || !entry.lastAlertAt || now - entry.lastAlertAt >= config.alertCooldownMs);
  if(shouldAlert) entry.lastAlertAt = now;
  messageCache.set(key, entry);

  if(!entry._timeout){
    const cleanup = () => {
      if(messageCache.get(key) !== entry) return;
      const idleMs = Date.now() - entry.lastSeenAt;
      if(idleMs >= windowMs){
        messageCache.delete(key);
      } else {
        entry._timeout = setTimeout(cleanup, windowMs - idleMs);
        entry._timeout.unref?.();
      }
    };
    entry._timeout = setTimeout(cleanup, windowMs);
    entry._timeout.unref?.();
  }
  return { isSpam, messages: isSpam ? entry.messages.slice() : [], shouldAlert };
}
