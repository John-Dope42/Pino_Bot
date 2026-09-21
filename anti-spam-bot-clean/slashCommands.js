import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

const admin = PermissionFlagsBits.Administrator;
const typeOption = option => option.setName('typ').setDescription('Nutzer, Rolle oder Kanal').setRequired(true)
  .addChoices(
    { name: 'Nutzer', value: 'user' },
    { name: 'Rolle', value: 'role' },
    { name: 'Kanal', value: 'channel' }
  );

export const commands = [
  new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Anti-Spam-Status')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('antispamstats')
    .setDescription('Anti-Spam-Statistik der letzten 7 Tage')
    .setDefaultMemberPermissions(admin),
  new SlashCommandBuilder()
    .setName('antispamdiagnose')
    .setDescription('Bot-Zugriff und Protokoll prüfen')
    .setDefaultMemberPermissions(admin)
    .addBooleanOption(option => option.setName('testmeldung').setDescription('Sichere Testmeldung im Mod-Kanal senden')),
  new SlashCommandBuilder()
    .setName('antispamfaelle')
    .setDescription('Letzte Anti-Spam-Fälle oder einen Fall anzeigen')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(option => option.setName('id').setDescription('Vollständige Fall-ID für Details'))
    .addIntegerOption(option => option.setName('anzahl').setDescription('Anzahl der letzten Fälle (1–10)').setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder()
    .setName('antispamausnahme')
    .setDescription('Zeitlich begrenzte Ausnahmen verwalten')
    .setDefaultMemberPermissions(admin)
    .addSubcommand(sub => sub.setName('hinzufuegen').setDescription('Ausnahme setzen')
      .addStringOption(typeOption)
      .addStringOption(option => option.setName('id').setDescription('Discord-ID des Nutzers, der Rolle oder des Kanals').setRequired(true))
      .addIntegerOption(option => option.setName('stunden').setDescription('Dauer (1–720 Stunden, Standard: 24)').setMinValue(1).setMaxValue(720))
      .addStringOption(option => option.setName('grund').setDescription('Grund für die Ausnahme')))
    .addSubcommand(sub => sub.setName('entfernen').setDescription('Ausnahme entfernen')
      .addStringOption(typeOption)
      .addStringOption(option => option.setName('id').setDescription('Discord-ID').setRequired(true)))
    .addSubcommand(sub => sub.setName('liste').setDescription('Aktive Ausnahmen anzeigen')),
  new SlashCommandBuilder()
    .setName('antispammodus')
    .setDescription('Automatische Maßnahmen ein- oder ausschalten')
    .setDefaultMemberPermissions(admin)
    .addStringOption(option => option.setName('modus').setDescription('Neuer Modus').setRequired(true)
      .addChoices({ name: 'Aktiv: löschen und ggf. Timeout', value: 'active' },
        { name: 'Beobachten: nur melden', value: 'observe' }))
].map(command => command.toJSON());
