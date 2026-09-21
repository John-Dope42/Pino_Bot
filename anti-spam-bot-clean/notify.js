import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config.js';

export async function notifyMods(client, message, risk, { dmUser = true, caseId = null } = {}) {
  if (!config.modChannel) throw new Error('MOD_CHANNEL_ID ist nicht gesetzt.');
  let modChannel;
  try {
    modChannel = await client.channels.fetch(config.modChannel);
  } catch (error) {
    throw new Error('Mod-Kanal nicht erreichbar. Prüfe Kanal-ID und Bot-Zugriff auf den privaten Kanal.', { cause: error });
  }
  if (!modChannel?.send) throw new Error('Der konfigurierte Mod-Kanal kann keine Nachrichten empfangen.');

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`timeout_${message.author.id}${caseId ? `_${caseId}` : ''}`)
        .setLabel('Timeout')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`kick_${message.author.id}${caseId ? `_${caseId}` : ''}`)
        .setLabel('Kick')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ban_${message.author.id}${caseId ? `_${caseId}` : ''}`)
        .setLabel('Ban')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ignore_${message.author.id}${caseId ? `_${caseId}` : ''}`)
        .setLabel('Fehlalarm')
        .setStyle(ButtonStyle.Secondary)
    );

  await modChannel.send({
    content: `Verdächtige Nachricht von ${message.author.tag}\nRisiko: ${risk.high ? 'Hoch' : 'Normal'}${caseId ? `\nFall-ID: ${caseId}` : ''}\nNachricht: "${(message.content || '').slice(0, 1500)}"`,
    components: [row],
    allowedMentions: { parse: [] }
  });

  if (!dmUser) return;
  try {
    await message.author.send(`Deine Nachricht wurde als verdächtig markiert: "${(message.content || '').slice(0, 1500)}"`);
  } catch(err) {
    // User DM kann blockiert sein
  }
}
