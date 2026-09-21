import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';
import { countCasesToday, getActionStats, getCase, getDailyStats, getLogHealth, getRecentCases, getTopUsers, logEvent } from './logger.js';
import { addException, getAntiSpamSettings, getSettingsHealth, removeException, setAntiSpamMode } from './antispamSettings.js';

const PRIVATE = 64;
const adminCommands = new Set(['antispamstats', 'antispamdiagnose', 'antispamausnahme', 'antispammodus']);
const allCommands = new Set([...adminCommands, 'antispam', 'antispamfaelle']);

function formatCase(entry) {
  const decision = entry.decisions?.at(-1);
  const outcome = decision ? `${decision.action}${decision.success ? '' : ' fehlgeschlagen'}` : 'offen';
  return `• ${entry.time?.slice(0, 16).replace('T', ' ') || '?'} · ${entry.userId || '?'} · ${(entry.reasons || []).join('+') || 'unbekannt'} · ${outcome}\n  ID: ${entry.id}`;
}

async function showDiagnosis(interaction, client) {
  await interaction.deferReply({ flags: PRIVATE });
  const checks = [];
  let modChannel = null;
  if (!config.modChannel) {
    checks.push('❌ MOD_CHANNEL_ID fehlt');
  } else {
    try {
      modChannel = await client.channels.fetch(config.modChannel);
      const sameGuild = modChannel.guildId === interaction.guild.id;
      checks.push(sameGuild ? '✅ Mod-Kanal gehört zu diesem Server' : '❌ Mod-Kanal gehört zu einem anderen Server');
      if (!sameGuild) modChannel = null;
      const botMember = await interaction.guild.members.fetch(client.user.id);
      const permissions = modChannel?.permissionsFor?.(botMember);
      for (const [label, flag] of [
        ['Kanal ansehen', PermissionFlagsBits.ViewChannel],
        ['Nachrichten senden', PermissionFlagsBits.SendMessages],
        ['Nachrichtenverlauf lesen', PermissionFlagsBits.ReadMessageHistory]
      ]) checks.push(`${permissions?.has(flag) ? '✅' : '❌'} ${label}`);
    } catch (error) {
      checks.push(`❌ Mod-Kanal nicht erreichbar (${error.code || error.message})`);
    }
  }
  checks.push(`${getLogHealth().writable ? '✅' : '❌'} Fallprotokoll beschreibbar`);
  checks.push(`${getSettingsHealth().writable ? '✅' : '❌'} Einstellungen beschreibbar`);
  if (interaction.options.getBoolean('testmeldung')) {
    if (modChannel?.send) {
      try {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('diagnose_disabled').setLabel('Test: keine Aktion').setStyle(ButtonStyle.Secondary).setDisabled(true)
        );
        await modChannel.send({ content: `Anti-Spam-Diagnose durch ${interaction.user.tag}: Testmeldung, keine Moderationsaktion.`, components: [row], allowedMentions: { parse: [] } });
        checks.push('✅ Testmeldung mit deaktiviertem Button gesendet');
      } catch (error) {
        checks.push(`❌ Testmeldung fehlgeschlagen (${error.code || error.message})`);
      }
    } else {
      checks.push('❌ Testmeldung nicht möglich: Mod-Kanal fehlt');
    }
  }
  await interaction.editReply({ content: `**Anti-Spam-Diagnose**\n${checks.join('\n')}` });
}

export async function handleAntiSpamCommand(interaction, client) {
  if (!interaction.isChatInputCommand() || !allCommands.has(interaction.commandName)) return false;
  const adminOnly = adminCommands.has(interaction.commandName);
  const permission = adminOnly ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageGuild;
  if (!interaction.guild || !interaction.memberPermissions?.has(permission)) {
    await interaction.reply({ content: adminOnly ? 'Dieser Befehl ist nur für Server-Admins verfügbar.' : 'Dieser Befehl ist nur für die Server-Moderation verfügbar.', flags: PRIVATE });
    return true;
  }

  if (interaction.commandName === 'antispam') {
    const settings = getAntiSpamSettings();
    const status = [
      '**Anti-Spam-Status**',
      `Erkannte Fälle heute (Bot-Zeitzone): **${countCasesToday(interaction.guild.id)}**`,
      `Modus: **${settings.mode === 'active' ? 'Aktiv' : 'Beobachten'}**`,
      `Automatisches Löschen: **${config.spamDelete ? 'aktiv' : 'inaktiv'}**`,
      `Keyword-Erkennung: **${config.mlSpamDetection ? 'aktiv' : 'inaktiv'}**`,
      `Captcha: **${config.captchaHighRisk ? 'aktiv' : 'inaktiv'}**`,
      `Aktive Ausnahmen: **${settings.exceptions.length}**`,
      `Schwelle gleicher Nachrichten: **${config.similarMessageThreshold}**`,
      `Neues Konto: jünger als **${config.newAccountAge} Tage**`,
      `Auto-Timeout ab **${Math.round(config.autoTimeoutMemberAgeMs / 86400000)} Tagen** Serverzugehörigkeit`
    ];
    await interaction.reply({ content: status.join('\n'), flags: PRIVATE });
    return true;
  }

  if (interaction.commandName === 'antispamstats') {
    const stats = getDailyStats(interaction.guild.id);
    const maximum = Math.max(1, ...stats.map(day => day.cases));
    const rows = stats.map(day => {
      const length = day.cases ? Math.max(1, Math.round(day.cases / maximum * 14)) : 0;
      return `${day.label} ${(length ? '█'.repeat(length) : '·').padEnd(14, ' ')} ${day.cases} Fälle / ${day.users} Konten`;
    });
    const topUsers = getTopUsers(interaction.guild.id);
    const users = topUsers.map((user, index) => `${index + 1}. ${/^\d{17,20}$/.test(user.userId) ? `<@${user.userId}> (${user.userId})` : user.userId} – ${user.cases} ${user.cases === 1 ? 'Fall' : 'Fälle'}`);
    const actions = getActionStats(interaction.guild.id);
    await interaction.reply({
      content: `**Anti-Spam-Statistik · letzte 7 Tage (Bot-Zeitzone)**\n\`\`\`\n${rows.join('\n')}\n\`\`\`\n**Auffällige Konten**\n${users.length ? users.join('\n') : 'Keine Fälle im Zeitraum.'}\n**Maßnahmen:** Timeout ${actions.timeout}, Kick ${actions.kick}, Ban ${actions.ban}, Fehlalarm ${actions.falsePositive}\n**Auslöser:** Wiederholungen ${actions.similar}, Keywords ${actions.keyword}\nVerdachtsfälle sind keine bestätigten Scammer.`,
      flags: PRIVATE,
      allowedMentions: { parse: [] }
    });
    return true;
  }

  if (interaction.commandName === 'antispamdiagnose') {
    await showDiagnosis(interaction, client);
    return true;
  }

  if (interaction.commandName === 'antispamfaelle') {
    const id = interaction.options.getString('id');
    if (id) {
      const entry = getCase(interaction.guild.id, id);
      if (!entry) {
        await interaction.reply({ content: 'Fall-ID nicht gefunden.', flags: PRIVATE });
      } else {
        const decisions = entry.decisions.map(item => `${item.action}: ${item.success ? 'erfolgreich' : 'fehlgeschlagen'} durch ${item.actorId || '?'}`).join('\n') || 'Noch keine Mod-Entscheidung';
        const preview = (entry.contentPreview || 'Nicht gespeichert').replace(/[\r\n]/g, ' ').slice(0, 200);
        await interaction.reply({ content: `**Fall ${entry.id}**\nZeit: ${entry.time}\nKonto: ${entry.userId}\nKanal: ${entry.channelId}\nAuslöser: ${(entry.reasons || []).join(', ') || 'unbekannt'}\nNachricht: ${preview}\nEntscheidungen:\n${decisions}`, flags: PRIVATE, allowedMentions: { parse: [] } });
      }
    } else {
      const limit = interaction.options.getInteger('anzahl') || 5;
      const cases = getRecentCases(interaction.guild.id, Math.min(10, Math.max(1, limit)));
      await interaction.reply({ content: `**Letzte Anti-Spam-Fälle**\n${cases.length ? cases.map(formatCase).join('\n') : 'Noch keine Fälle protokolliert.'}`, flags: PRIVATE, allowedMentions: { parse: [] } });
    }
    return true;
  }

  if (interaction.commandName === 'antispammodus') {
    const mode = interaction.options.getString('modus', true);
    try {
      setAntiSpamMode(mode);
      logEvent({ type: 'configuration', guildId: interaction.guild.id, actorId: interaction.user.id, action: 'mode', value: mode });
      await interaction.reply({ content: `Anti-Spam-Modus: **${mode === 'active' ? 'Aktiv' : 'Beobachten (nur melden)'}**.`, flags: PRIVATE });
    } catch (error) {
      await interaction.reply({ content: `Modus konnte nicht gespeichert werden: ${error.message}`, flags: PRIVATE });
    }
    return true;
  }

  if (interaction.commandName === 'antispamausnahme') {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'liste') {
      const exceptions = getAntiSpamSettings().exceptions;
      const rows = exceptions.slice(0, 10).map(item => `${item.type} ${item.id} · bis ${new Date(item.expiresAt).toLocaleString('de-DE')} · ${(item.reason || 'ohne Grund').slice(0, 50)}`);
      await interaction.reply({ content: `**Aktive Anti-Spam-Ausnahmen**\n${rows.length ? rows.join('\n') : 'Keine.'}${exceptions.length > 10 ? `\n… und ${exceptions.length - 10} weitere` : ''}`, flags: PRIVATE, allowedMentions: { parse: [] } });
      return true;
    }
    const type = interaction.options.getString('typ', true);
    const id = interaction.options.getString('id', true).trim();
    try {
      if (subcommand === 'hinzufuegen') {
        const exception = addException({ type, id, hours: interaction.options.getInteger('stunden') || 24, reason: interaction.options.getString('grund') || '', addedBy: interaction.user.id });
        logEvent({ type: 'configuration', guildId: interaction.guild.id, actorId: interaction.user.id, action: 'exception_add', targetType: type, targetId: id });
        await interaction.reply({ content: `Ausnahme für ${type} ${id} bis ${new Date(exception.expiresAt).toLocaleString('de-DE')} gespeichert.`, flags: PRIVATE });
      } else {
        const removed = removeException(type, id);
        if (removed) logEvent({ type: 'configuration', guildId: interaction.guild.id, actorId: interaction.user.id, action: 'exception_remove', targetType: type, targetId: id });
        await interaction.reply({ content: removed ? `Ausnahme für ${type} ${id} entfernt.` : 'Keine passende Ausnahme gefunden.', flags: PRIVATE });
      }
    } catch (error) {
      await interaction.reply({ content: `Ausnahme konnte nicht geändert werden: ${error.message}`, flags: PRIVATE });
    }
    return true;
  }
  return false;
}
