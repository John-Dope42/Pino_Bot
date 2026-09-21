import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, Events, InteractionType } from 'discord.js';
import { appendFileSync, mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { notifyMods } from '../notify.js';
import { mlCheck } from '../mlSpam.js';
import { checkSpam } from '../messageCache.js';

const logDir = mkdtempSync(path.join(tmpdir(), 'anti-spam-test-'));
process.env.SPAM_LOG_FILE = path.join(logDir, 'spam_logs.jsonl');
process.env.ANTISPAM_SETTINGS_FILE = path.join(logDir, 'settings.json');
test.after(() => {
  for (const name of readdirSync(logDir)) unlinkSync(path.join(logDir, name));
  rmdirSync(logDir);
});

let bot;
Client.prototype.login = function () {
  bot = this;
  return Promise.resolve();
};
await import('../index.js');
const { getDailyStats, getTopUsers, getRecentCases, getActionStats, logCase } = await import('../logger.js');
const { getAntiSpamSettings, findException } = await import('../antispamSettings.js');
const handleInteraction = bot.listeners(Events.InteractionCreate).at(-1);
const handleMessage = bot.listeners(Events.MessageCreate)[0];

test('/antispam antwortet Moderatoren privat mit Einstellungen und Fallzahl', async () => {
  let reply;
  await handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'antispam',
    guild: { id: 'test-guild' },
    memberPermissions: { has: () => true },
    reply: async (payload) => { reply = payload; }
  });
  assert.equal(reply.flags, 64);
  assert.match(reply.content, /Erkannte Fälle heute/);
  assert.match(reply.content, /Keyword-Erkennung/);
  assert.match(reply.content, /Captcha/);
});

test('/antispam verweigert Mitgliedern ohne Moderationsrecht die Statusdaten', async () => {
  let reply;
  await handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'antispam',
    guild: { id: 'test-guild' },
    memberPermissions: { has: () => false },
    reply: async (payload) => { reply = payload; }
  });
  assert.equal(reply.flags, 64);
  assert.match(reply.content, /nur für die Server-Moderation/);
});

test('Die Tagesstatistik zählt Fälle und unterschiedliche Konten pro Server', () => {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  for (const entry of [
    { guildId: 'stats-guild', userId: 'user-a', time: yesterday.toISOString() },
    { guildId: 'stats-guild', userId: 'user-a', time: yesterday.toISOString() },
    { guildId: 'stats-guild', userId: 'user-b', time: yesterday.toISOString() },
    { guildId: 'stats-guild', userId: 'user-c', time: today.toISOString() },
    { guildId: 'other-guild', userId: 'user-d', time: today.toISOString() }
  ]) appendFileSync(process.env.SPAM_LOG_FILE, JSON.stringify(entry) + '\n');
  const stats = getDailyStats('stats-guild', 2, now);
  assert.deepEqual(stats.map(({ cases, users }) => ({ cases, users })), [
    { cases: 3, users: 2 },
    { cases: 1, users: 1 }
  ]);
  assert.deepEqual(getTopUsers('stats-guild', 2, now).map(({ userId, cases }) => ({ userId, cases })), [
    { userId: 'user-a', cases: 2 },
    { userId: 'user-c', cases: 1 },
    { userId: 'user-b', cases: 1 }
  ]);
});

test('/antispamstats zeigt Admins den Balkenverlauf privat', async () => {
  let reply;
  await handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'antispamstats',
    guild: { id: 'stats-guild' },
    memberPermissions: { has: () => true },
    reply: async (payload) => { reply = payload; }
  });
  assert.equal(reply.flags, 64);
  assert.match(reply.content, /letzte 7 Tage/);
  assert.match(reply.content, /█/);
  assert.match(reply.content, /Konten/);
  assert.match(reply.content, /Auffällige Konten/);
  assert.match(reply.content, /user-a.*2 Fälle/);
  assert.deepEqual(reply.allowedMentions, { parse: [] });
});

test('/antispamstats gibt Nicht-Admins keine Statistik', async () => {
  let reply;
  await handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'antispamstats',
    guild: { id: 'stats-guild' },
    memberPermissions: { has: () => false },
    reply: async (payload) => { reply = payload; }
  });
  assert.equal(reply.flags, 64);
  assert.match(reply.content, /nur für Server-Admins/);
});

test('Ein einzelner Keyword-Treffer wird gelöscht, aber nicht automatisch mit Timeout bestraft', async () => {
  const previous = {
    spamDelete: config.spamDelete,
    mlSpamDetection: config.mlSpamDetection,
    captchaHighRisk: config.captchaHighRisk,
    modChannel: config.modChannel,
    similarMessageWindow: config.similarMessageWindow
  };
  config.spamDelete = true;
  config.mlSpamDetection = true;
  config.captchaHighRisk = false;
  config.modChannel = 'test-mod-channel';
  config.similarMessageWindow = 1;
  let deleted = 0;
  let notified = 0;
  let memberFetches = 0;
  bot.channels.fetch = async () => ({ send: async () => { notified++; } });
  try {
    await handleMessage({
      id: 'test-keyword-message',
      content: 'free-test-123',
      author: {
        id: 'test-user',
        tag: 'test-user',
        bot: false,
        createdTimestamp: Date.now() - 30 * 86400000,
        send: async () => {}
      },
      guild: { id: 'test-guild', members: { fetch: async () => { memberFetches++; return null; } } },
      channel: { id: 'test-channel' },
      delete: async () => { deleted++; }
    });
    assert.equal(deleted, 1);
    assert.equal(notified, 1);
    assert.equal(memberFetches, 0);
  } finally {
    Object.assign(config, previous);
  }
});

test('Keywords treffen ganze Wörter und Wiederholungen lösen nicht unendlich Alerts aus', () => {
  assert.equal(mlCheck({ content: 'freedom und clickbait' }), false);
  assert.equal(mlCheck({ content: 'free-test-123' }), true);
  const previous = { similarMessageThreshold: config.similarMessageThreshold, alertCooldownMs: config.alertCooldownMs };
  config.similarMessageThreshold = 2;
  config.alertCooldownMs = 60000;
  try {
    const message = (id) => ({ id, content: 'identischer Text', guild: { id: 'cache-guild' }, author: { id: 'cache-user' }, channel: { id: 'cache-channel' } });
    assert.equal(checkSpam(message('cache-1')).isSpam, false);
    const second = checkSpam(message('cache-2'));
    assert.equal(second.isSpam, true);
    assert.equal(second.shouldAlert, true);
    const third = checkSpam(message('cache-3'));
    assert.equal(third.isSpam, true);
    assert.equal(third.shouldAlert, false);
    const keywordMessage = (id) => ({ id, content: 'free-test-keyword', guild: { id: 'cache-guild' }, author: { id: 'cache-user' }, channel: { id: 'cache-channel' } });
    assert.equal(checkSpam(keywordMessage('keyword-1'), { keywordSpam: true }).shouldAlert, true);
    assert.equal(checkSpam(keywordMessage('keyword-2'), { keywordSpam: true }).shouldAlert, true);
  } finally { Object.assign(config, previous); }
});

test('Ein Mitglied ohne Ban-Recht kann den Ban-Button nicht benutzen', async () => {
  const previousChannel = config.modChannel;
  config.modChannel = 'test-mod-channel';
  let memberFetches = 0;
  let reply;
  try {
    await handleInteraction({
      isChatInputCommand: () => false,
      type: InteractionType.MessageComponent,
      customId: 'ban_test-user',
      guild: { members: { fetch: async () => { memberFetches++; return null; } } },
      message: { channelId: 'test-mod-channel' },
      memberPermissions: { has: () => false },
      reply: async (payload) => { reply = payload; }
    });
    assert.equal(memberFetches, 0);
    assert.equal(reply.flags, 64);
    assert.match(reply.content, /keine Berechtigung/);
  } finally {
    config.modChannel = previousChannel;
  }
});

test('Auch mit Ban-Recht ist ein Selbst-Ban über den Button gesperrt', async () => {
  const previousChannel = config.modChannel;
  config.modChannel = 'test-mod-channel';
  let banned = 0;
  let reply;
  const member = {
    id: 'same-user',
    roles: { highest: { position: 1 } },
    ban: async () => { banned++; }
  };
  try {
    await handleInteraction({
      isChatInputCommand: () => false,
      type: InteractionType.MessageComponent,
      customId: 'ban_same-user',
      guild: { ownerId: 'owner', members: { fetch: async () => member } },
      message: { channelId: 'test-mod-channel' },
      user: { id: 'same-user' },
      memberPermissions: { has: () => true },
      reply: async (payload) => { reply = payload; }
    });
    assert.equal(banned, 0);
    assert.match(reply.content, /gegen dich selbst/);
  } finally {
    config.modChannel = previousChannel;
  }
});

test('Ein berechtigter Mod kann weiterhin den Ban-Button benutzen', async () => {
  const previousChannel = config.modChannel;
  const previousUser = bot.user;
  config.modChannel = 'test-mod-channel';
  bot.user = { id: 'bot-user' };
  let banned = 0;
  let notificationDeleted = 0;
  let reply;
  const target = {
    id: 'target-user',
    user: { tag: 'target-user' },
    roles: { highest: { position: 1 } },
    ban: async () => { banned++; }
  };
  const actor = { id: 'mod-user', roles: { highest: { position: 5 } } };
  const botMember = { id: 'bot-user', roles: { highest: { position: 10 } } };
  try {
    await handleInteraction({
      isChatInputCommand: () => false,
      type: InteractionType.MessageComponent,
      customId: 'ban_target-user',
      guild: {
        ownerId: 'owner',
        members: { fetch: async (id) => ({ 'target-user': target, 'mod-user': actor, 'bot-user': botMember })[id] }
      },
      message: { channelId: 'test-mod-channel', delete: async () => { notificationDeleted++; } },
      user: { id: 'mod-user', tag: 'mod-user' },
      memberPermissions: { has: () => true },
      reply: async (payload) => { reply = payload; }
    });
    assert.equal(banned, 1);
    assert.equal(notificationDeleted, 1);
    assert.match(reply.content, /wurde gebannt/);
  } finally {
    config.modChannel = previousChannel;
    bot.user = previousUser;
  }
});

test('Fehlender Zugriff auf den Mod-Kanal wird als Fehler gemeldet', async () => {
  await assert.rejects(
    notifyMods(
      { channels: { fetch: async () => { throw Object.assign(new Error('Missing Access'), { code: 50001 }); } } },
      { author: { id: 'test-user' } },
      { high: false }
    ),
    (error) => error.message.includes('Mod-Kanal nicht erreichbar') && error.cause?.code === 50001
  );
});

test('Beobachtungsmodus protokolliert und meldet, löscht aber nicht', async () => {
  const old = { spamDelete: config.spamDelete, mlSpamDetection: config.mlSpamDetection, modChannel: config.modChannel };
  config.spamDelete = true;
  config.mlSpamDetection = true;
  config.modChannel = 'test-mod-channel';
  const { setAntiSpamMode } = await import('../antispamSettings.js');
  setAntiSpamMode('observe');
  let deleted = 0;
  let notified = 0;
  bot.channels.fetch = async () => ({ send: async () => { notified++; } });
  try {
    await handleMessage({
      id: 'observe-message', content: 'free-test-observe',
      author: { id: 'observe-user', tag: 'observe-user', bot: false, createdTimestamp: Date.now() - 30 * 86400000, send: async () => {} },
      guild: { id: 'observe-guild' }, channel: { id: 'observe-channel' },
      delete: async () => { deleted++; }
    });
    assert.equal(deleted, 0);
    assert.equal(notified, 1);
    assert.equal(getRecentCases('observe-guild', 1).length, 1);
  } finally {
    setAntiSpamMode('active');
    Object.assign(config, old);
  }
});

test('Admin kann eine Ausnahme per Slash-Command setzen und entfernen', async () => {
  const replies = [];
  const interaction = (subcommand) => ({
    isChatInputCommand: () => true, commandName: 'antispamausnahme', guild: { id: 'test-guild' },
    user: { id: 'admin-user' }, memberPermissions: { has: () => true },
    options: {
      getSubcommand: () => subcommand,
      getString: (name) => ({ typ: 'user', id: '123456789012345678', grund: 'Test' })[name],
      getInteger: () => 1
    },
    reply: async (payload) => { replies.push(payload); }
  });
  await handleInteraction(interaction('hinzufuegen'));
  assert.equal(getAntiSpamSettings().exceptions.length, 1);
  assert.ok(await findException({ author: { id: '123456789012345678' }, channel: { id: 'some-channel' } }));
  assert.equal(replies.at(-1).flags, 64);
  await handleInteraction(interaction('entfernen'));
  assert.equal(getAntiSpamSettings().exceptions.length, 0);
});

test('/antispamfaelle zeigt einen protokollierten Fall mit ID', async () => {
  const entry = logCase({ guildId: 'cases-guild', userId: 'case-user', channelId: 'case-channel', reasons: ['keyword'], contentPreview: 'free-test-123' });
  let reply;
  await handleInteraction({
    isChatInputCommand: () => true, commandName: 'antispamfaelle', guild: { id: 'cases-guild' },
    memberPermissions: { has: () => true },
    options: { getString: () => entry.id },
    reply: async (payload) => { reply = payload; }
  });
  assert.equal(reply.flags, 64);
  assert.match(reply.content, /free-test-123/);
  assert.match(reply.content, new RegExp(entry.id));
});

test('/antispamdiagnose sendet nur eine harmlose Testmeldung mit deaktiviertem Button', async () => {
  const previous = { modChannel: config.modChannel, user: bot.user };
  config.modChannel = 'diagnose-channel';
  bot.user = { id: 'bot-user' };
  let sent;
  let reply;
  bot.channels.fetch = async () => ({
    guildId: 'diagnose-guild',
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => { sent = payload; }
  });
  try {
    await handleInteraction({
      isChatInputCommand: () => true, commandName: 'antispamdiagnose',
      guild: { id: 'diagnose-guild', members: { fetch: async () => ({ id: 'bot-user' }) } },
      user: { tag: 'admin' }, memberPermissions: { has: () => true },
      options: { getBoolean: () => true },
      deferReply: async () => {}, editReply: async (payload) => { reply = payload; }
    });
    assert.match(reply.content, /Testmeldung mit deaktiviertem Button gesendet/);
    assert.equal(sent.components[0].components[0].data.disabled, true);
  } finally {
    config.modChannel = previous.modChannel;
    bot.user = previous.user;
  }
});

test('Mod-Button protokolliert die Entscheidung und die Statistik zählt sie', async () => {
  const previousChannel = config.modChannel;
  config.modChannel = 'test-mod-channel';
  let deleted = 0;
  try {
    await handleInteraction({
      isChatInputCommand: () => false,
      type: InteractionType.MessageComponent,
      customId: 'ignore_123456789012345678_case-test-1',
      guild: { id: 'decision-guild' },
      message: { channelId: 'test-mod-channel', delete: async () => { deleted++; } },
      user: { id: 'mod-user' }, memberPermissions: { has: () => true },
      reply: async () => {}
    });
    assert.equal(deleted, 1);
    assert.equal(getActionStats('decision-guild').falsePositive, 1);
  } finally { config.modChannel = previousChannel; }
});
