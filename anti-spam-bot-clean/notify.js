import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { config } from './config.js';

export async function notifyMods(client, message, risk) {
  const modChannel = await client.channels.fetch(config.modChannel).catch(() => null);
  if(!modChannel) return;

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`timeout_${message.author.id}`)
        .setLabel('Timeout')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`kick_${message.author.id}`)
        .setLabel('Kick')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ban_${message.author.id}`)
        .setLabel('Ban')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`ignore_${message.author.id}`)
        .setLabel('Ignore')
        .setStyle(ButtonStyle.Secondary)
    );

  modChannel.send({
    content: `Verdächtige Nachricht von ${message.author.tag}\nRisiko: ${risk.high ? 'Hoch' : 'Normal'}\nNachricht: "${message.content}"`,
    components: [row]
  });

  // Optional: DM an dich
  try {
    await message.author.send(`Deine Nachricht wurde als verdächtig markiert: "${message.content}"`);
  } catch(err) {
    // User DM kann blockiert sein
  }
}
