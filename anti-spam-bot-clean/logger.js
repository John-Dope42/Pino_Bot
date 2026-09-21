import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const logFile = process.env.SPAM_LOG_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'spam_logs.jsonl');

export function logCase(data) {
  return logEvent({ ...data, type: 'detection' });
}

export function logEvent(data) {
  const entry = { id: randomUUID(), time: new Date().toISOString(), ...data };
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n');
  } catch (error) {
    console.warn('Anti-Spam-Fall konnte nicht protokolliert werden', error);
  }
  return entry;
}

function readLogEntries() {
  try {
    return fs.readFileSync(logFile, 'utf8').split('\n').flatMap(line => {
      if (!line) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('Anti-Spam-Protokoll konnte nicht gelesen werden', error);
    return [];
  }
}

const isDetection = entry => !entry.type || entry.type === 'detection';

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDailyStats(guildId, days = 7, now = new Date()) {
  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - index - 1));
    return { date: localDateKey(date), label: `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`, cases: 0, users: new Set() };
  });
  const byDate = new Map(daily.map(day => [day.date, day]));
  for (const entry of readLogEntries()) {
    if (entry.guildId !== guildId || !isDetection(entry) || !entry.time) continue;
    const date = new Date(entry.time);
    if (Number.isNaN(date.getTime())) continue;
    const day = byDate.get(localDateKey(date));
    if (!day) continue;
    day.cases++;
    if (entry.userId) day.users.add(entry.userId);
  }
  return daily.map(day => ({ date: day.date, label: day.label, cases: day.cases, users: day.users.size }));
}

export function countCasesToday(guildId, now = new Date()) {
  return getDailyStats(guildId, 1, now)[0].cases;
}

export function getTopUsers(guildId, days = 7, now = new Date(), limit = 10) {
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const users = new Map();
  for (const entry of readLogEntries()) {
    if (entry.guildId !== guildId || !isDetection(entry) || !entry.userId || !entry.time) continue;
    const date = new Date(entry.time);
    if (Number.isNaN(date.getTime()) || date < firstDay || date >= nextDay) continue;
    const user = users.get(entry.userId) || { userId: entry.userId, cases: 0, lastSeen: 0 };
    user.cases++;
    user.lastSeen = Math.max(user.lastSeen, date.getTime());
    users.set(entry.userId, user);
  }
  return [...users.values()]
    .sort((a, b) => b.cases - a.cases || b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

export function getRecentCases(guildId, limit = 5) {
  const entries = readLogEntries().filter(entry => entry.guildId === guildId);
  const decisions = new Map();
  for (const entry of entries) {
    if (entry.type !== 'moderation' || !entry.caseId) continue;
    const list = decisions.get(entry.caseId) || [];
    list.push(entry);
    decisions.set(entry.caseId, list);
  }
  return entries.filter(isDetection).slice(-limit).reverse().map(entry => ({
    ...entry,
    decisions: decisions.get(entry.id) || []
  }));
}

export function getCase(guildId, caseId) {
  const entries = readLogEntries().filter(entry => entry.guildId === guildId);
  const matches = entries.filter(entry => isDetection(entry) && entry.id === caseId);
  const entry = matches[0];
  if (!entry) return null;
  return { ...entry, decisions: entries.filter(item => item.type === 'moderation' && item.caseId === caseId) };
}

export function getActionStats(guildId, days = 7, now = new Date()) {
  const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const result = { similar: 0, keyword: 0, timeout: 0, kick: 0, ban: 0, falsePositive: 0 };
  for (const entry of readLogEntries()) {
    if (entry.guildId !== guildId || !entry.time) continue;
    const date = new Date(entry.time);
    if (Number.isNaN(date.getTime()) || date < firstDay || date >= nextDay) continue;
    if (isDetection(entry)) {
      if (entry.reasons?.includes('similar')) result.similar++;
      if (entry.reasons?.includes('keyword')) result.keyword++;
    } else if (entry.type === 'moderation' && entry.success) {
      if (entry.action === 'ignore') result.falsePositive++;
      else if (entry.action in result) result[entry.action]++;
    }
  }
  return result;
}

export function getLogHealth() {
  try {
    const target = fs.existsSync(logFile) ? logFile : path.dirname(logFile);
    fs.accessSync(target, fs.constants.W_OK);
    return { writable: true, path: logFile };
  } catch (error) {
    return { writable: false, path: logFile, error: error.message };
  }
}
