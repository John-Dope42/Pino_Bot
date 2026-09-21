import { randomInt } from 'node:crypto';

const challenges = new Map();
const verified = new Map();
const cooldowns = new Map();
const CHALLENGE_MS = 10 * 60 * 1000;
const VERIFIED_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

const keyFor = (guildId, userId) => `${guildId}:${userId}`;

export function isCaptchaPending(guildId, userId) {
  const key = keyFor(guildId, userId);
  const challenge = challenges.get(key);
  if (challenge) {
    if (challenge.expiresAt > Date.now()) return true;
    challenges.delete(key);
  }
  const cooldown = cooldowns.get(key) || 0;
  if (cooldown > Date.now()) return true;
  cooldowns.delete(key);
  return false;
}

export function hasPassedCaptcha(guildId, userId) {
  const key = keyFor(guildId, userId);
  const expiresAt = verified.get(key) || 0;
  if (expiresAt > Date.now()) return true;
  verified.delete(key);
  return false;
}

export async function sendCaptcha(message) {
  const key = keyFor(message.guild.id, message.author.id);
  if (hasPassedCaptcha(message.guild.id, message.author.id)) return 'verified';
  if (isCaptchaPending(message.guild.id, message.author.id)) return 'pending';
  if ((cooldowns.get(key) || 0) > Date.now()) return 'cooldown';

  const code = String(randomInt(100000, 1000000));
  challenges.set(key, { code, expiresAt: Date.now() + CHALLENGE_MS, attempts: 0 });
  try {
    await message.author.send(
      `Bitte bestätige innerhalb von 10 Minuten, dass du ein Mensch bist. ` +
      `Antworte hier per DM mit diesem Code: **${code}**. Du hast ${MAX_ATTEMPTS} Versuche. ` +
      `Bis dahin werden weitere Nachrichten auf dem Server gelöscht.`
    );
  } catch (error) {
    challenges.delete(key);
    console.warn('Captcha-DM konnte nicht gesendet werden', error);
    return 'unavailable';
  }
  return 'sent';
}

export async function handleCaptchaReply(message) {
  const entries = [...challenges.entries()].filter(([key]) => key.endsWith(`:${message.author.id}`));
  if (!entries.length) return false;
  const [key, challenge] = entries[0];
  if (challenge.expiresAt <= Date.now()) {
    challenges.delete(key);
    await message.author.send('Der Bestätigungscode ist abgelaufen. Bei einem neuen Verdachtsfall bekommst du einen neuen Code.').catch(() => null);
    return true;
  }
  if (message.content.trim() === challenge.code) {
    challenges.delete(key);
    verified.set(key, Date.now() + VERIFIED_MS);
    await message.author.send('Bestätigt. Du kannst wieder auf dem Server schreiben.').catch(() => null);
    return true;
  }
  challenge.attempts++;
  if (challenge.attempts >= MAX_ATTEMPTS) {
    challenges.delete(key);
    cooldowns.set(key, Date.now() + CHALLENGE_MS);
    await message.author.send('Zu viele falsche Versuche. Bitte warte 10 Minuten und kontaktiere bei Bedarf die Moderation.').catch(() => null);
  } else {
    await message.author.send(`Code falsch. Noch ${MAX_ATTEMPTS - challenge.attempts} Versuch(e).`).catch(() => null);
  }
  return true;
}
