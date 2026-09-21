import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const settingsFile = process.env.ANTISPAM_SETTINGS_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'antispam-settings.json');
const defaults = () => ({ mode: 'active', exceptions: [] });

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (!['active', 'observe'].includes(parsed.mode) || !Array.isArray(parsed.exceptions)) throw new Error('Ungültige Einstellungen');
    return parsed;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('Anti-Spam-Einstellungen beschädigt; Schutz läuft vorerst nur im Beobachtungsmodus', error);
      return { mode: 'observe', exceptions: [] };
    }
    return defaults();
  }
}

let settings = loadSettings();

function saveSettings() {
  const temporaryFile = `${settingsFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(settings, null, 2));
    fs.renameSync(temporaryFile, settingsFile);
  } catch (error) {
    try { fs.unlinkSync(temporaryFile); } catch {}
    throw error;
  }
}

export function getAntiSpamSettings() {
  return { mode: settings.mode, exceptions: settings.exceptions.filter(item => item.expiresAt > Date.now()).map(item => ({ ...item })) };
}

export function setAntiSpamMode(mode) {
  if (!['active', 'observe'].includes(mode)) throw new Error('Ungültiger Modus.');
  const previous = settings;
  settings = { ...settings, mode };
  try { saveSettings(); } catch (error) { settings = previous; throw error; }
  return mode;
}

export function addException({ type, id, hours = 24, reason = '', addedBy }) {
  if (!['user', 'role', 'channel'].includes(type) || !/^\d{17,20}$/.test(id)) throw new Error('Typ oder Discord-ID ungültig.');
  if (!Number.isInteger(hours) || hours < 1 || hours > 720) throw new Error('Dauer muss zwischen 1 und 720 Stunden liegen.');
  const exception = {
    type, id, reason: reason.slice(0, 100), addedBy,
    addedAt: new Date().toISOString(), expiresAt: Date.now() + hours * 60 * 60 * 1000
  };
  const previous = settings;
  settings = { ...settings, exceptions: settings.exceptions.filter(item => item.type !== type || item.id !== id).concat(exception) };
  try { saveSettings(); } catch (error) { settings = previous; throw error; }
  return exception;
}

export function removeException(type, id) {
  const previous = settings;
  const exceptions = settings.exceptions.filter(item => item.type !== type || item.id !== id);
  if (exceptions.length === settings.exceptions.length) return false;
  settings = { ...settings, exceptions };
  try { saveSettings(); } catch (error) { settings = previous; throw error; }
  return true;
}

export async function findException(message) {
  const active = settings.exceptions.filter(item => item.expiresAt > Date.now());
  for (const item of active) {
    if (item.type === 'user' && item.id === message.author.id) return item;
    if (item.type === 'channel' && item.id === message.channel.id) return item;
  }
  const roleIds = active.filter(item => item.type === 'role').map(item => item.id);
  if (!roleIds.length) return null;
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  return active.find(item => item.type === 'role' && member?.roles?.cache?.has(item.id)) || null;
}

export function getSettingsHealth() {
  try {
    const target = fs.existsSync(settingsFile) ? settingsFile : path.dirname(settingsFile);
    fs.accessSync(target, fs.constants.W_OK);
    return { writable: true };
  } catch (error) {
    return { writable: false, error: error.message };
  }
}
