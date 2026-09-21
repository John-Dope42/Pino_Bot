// guthaben.js
// -----------
// Zusatzmodul für den bestehenden Anti-Spam-Bot: zeigt im Spendenchannel
// automatisch das aktuelle Serverguthaben, das Monatsziel und die Tage bis
// zum nächsten 8. des Monats an. Greift NICHT in die Anti-Spam-Logik ein
// und benötigt keine zusätzlichen npm-Pakete.
//
// Einbindung in index.js (siehe README-GUTHABEN.md):
//   import { registerGuthaben } from './guthaben.js';
//   registerGuthaben(client);

import { EmbedBuilder, Events, SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'guthaben-data.json');

// Konfiguration über .env (mit sinnvollen Standardwerten)

// Ziel-Betrag: entfernt z.B. "€" oder Leerzeichen, wandelt Komma in Punkt um
function parseZiel(raw) {
  if (!raw) return 54.70;
  const bereinigt = String(raw).replace(',', '.').replace(/[^0-9.]/g, '');
  const wert = parseFloat(bereinigt);
  return Number.isFinite(wert) ? wert : 54.70;
}
const ZIEL = parseZiel(process.env.GUTHABEN_ZIEL);
const WAEHRUNG = '€';
const GUTHABEN_CHANNEL_ID = process.env.GUTHABEN_CHANNEL_ID;
// Optional: Rolle, die beim TÄGLICHEN Update gepingt werden soll (z.B. @akademieschüler).
// Bei manuellen /guthaben setzen-Updates wird NICHT gepingt, um Spam zu vermeiden.
const GUTHABEN_PING_ROLE_ID = process.env.GUTHABEN_PING_ROLE_ID;

// Tag des Monats, an dem das Ziel erreicht sein soll. Standard: 8.
const STICHTAG = parseInt(process.env.GUTHABEN_TAG) || 8;

// Uhrzeit der täglichen Aktualisierung. Unterstützt "9", "9:30" oder "09:30".
function parseUhrzeit(raw) {
  if (!raw) return { stunde: 9, minute: 0 };
  const teile = String(raw).split(':');
  const stunde = parseInt(teile[0], 10);
  const minute = parseInt(teile[1], 10);
  return {
    stunde: Number.isFinite(stunde) ? stunde : 9,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}
const { stunde: TAEGLICHE_STUNDE, minute: TAEGLICHE_MINUTE } = parseUhrzeit(process.env.GUTHABEN_UHRZEIT);

export const guthabenCommandData = new SlashCommandBuilder()
  .setName('guthaben')
  .setDescription('Serverguthaben verwalten')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('setzen')
      .setDescription('Aktuelles Guthaben eintragen')
      .addNumberOption((opt) =>
        opt.setName('betrag').setDescription('Betrag in Euro, z.B. 47.30').setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName('anzeigen').setDescription('Aktuellen Status anzeigen'))
  .toJSON();

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { guthaben: 0, letzteAktualisierung: null, statusMessageId: null };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.warn('[guthaben] Konnte guthaben-data.json nicht lesen, starte mit Standardwerten', e);
    return { guthaben: 0, letzteAktualisierung: null, statusMessageId: null };
  }
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('[guthaben] Konnte guthaben-data.json nicht schreiben', e);
  }
}

function naechsterStichtag() {
  const heute = new Date();
  let ziel = new Date(heute.getFullYear(), heute.getMonth(), STICHTAG);
  if (heute.getDate() > STICHTAG) {
    ziel = new Date(heute.getFullYear(), heute.getMonth() + 1, STICHTAG);
  }
  return ziel;
}

function tageBisZiel() {
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const ziel = naechsterStichtag();
  ziel.setHours(0, 0, 0, 0);
  return Math.round((ziel - heute) / (1000 * 60 * 60 * 24));
}

function baueBalken(prozent, laenge = 20, fullEmoji = '🟩', emptyEmoji = '⬜') {
  const gefuellt = Math.max(0, Math.min(laenge, Math.round((prozent / 100) * laenge)));
  return fullEmoji.repeat(gefuellt) + emptyEmoji.repeat(laenge - gefuellt);
}

function baueEmbed(guthaben, letzteAktualisierung) {
  const prozentReal = Math.round((guthaben / ZIEL) * 1000) / 10; // kann über 100% liegen
  const prozentHaupt = Math.min(100, prozentReal);
  const rest = Math.max(0, ZIEL - guthaben);
  const ueberschuss = Math.max(0, guthaben - ZIEL);
  const tage = tageBisZiel();
  const zielDatum = naechsterStichtag().toLocaleDateString('de-DE');
  const istUeberfuellt = guthaben > ZIEL;

  const fields = [
    { name: 'Aktuelles Guthaben', value: `**${guthaben.toFixed(2)} ${WAEHRUNG}** / ${ZIEL.toFixed(2)} ${WAEHRUNG}` },
    { name: 'Fortschritt', value: `${baueBalken(prozentHaupt)}  ${prozentReal}%` },
  ];

  if (istUeberfuellt) {
    // Bonus-Balken für alles, was über das Ziel hinausgeht (bezogen auf das Ziel, z.B. 130% Ziel = 30% Bonus)
    const bonusProzent = Math.round((ueberschuss / ZIEL) * 1000) / 10;
    const bonusBalkenProzent = Math.min(100, bonusProzent); // Balken selbst wird bei +100% Bonus voll
    fields.push({
      name: '🎉 Bonus – Ziel übertroffen!',
      value: `${baueBalken(bonusBalkenProzent, 20, '🟨', '⬛')}  +${bonusProzent}%\n(+${ueberschuss.toFixed(2)} ${WAEHRUNG} extra, danke euch! 🙌)`,
    });
  } else {
    fields.push({ name: 'Noch benötigt', value: rest > 0 ? `${rest.toFixed(2)} ${WAEHRUNG}` : '✅ Ziel erreicht!' });
  }

  fields.push({ name: 'Fällig am', value: `${zielDatum} (in ${tage} Tag${tage === 1 ? '' : 'en'})` });

  return new EmbedBuilder()
    .setTitle(istUeberfuellt ? '💰🎉 Serverguthaben – Ziel übertroffen!' : '💰 Serverguthaben – Spendenstatus')
    .setColor(istUeberfuellt ? 0xffd700 : guthaben >= ZIEL ? 0x2ecc71 : 0xf1c40f)
    .addFields(...fields)
    .setFooter({ text: letzteAktualisierung ? `Zuletzt aktualisiert: ${new Date(letzteAktualisierung).toLocaleString('de-DE')}` : 'Noch nicht aktualisiert' })
    .setTimestamp();
}

async function postOrUpdate(client, data, ping = false) {
  if (!GUTHABEN_CHANNEL_ID) {
    console.warn('[guthaben] GUTHABEN_CHANNEL_ID ist nicht gesetzt, überspringe Anzeige.');
    return;
  }
  const channel = await client.channels.fetch(GUTHABEN_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.warn('[guthaben] Spendenchannel nicht gefunden. Prüfe GUTHABEN_CHANNEL_ID.');
    return;
  }

  const embed = baueEmbed(data.guthaben, data.letzteAktualisierung);

  // Ping: neue Nachricht mit Rollen-Erwähnung senden, damit Discord tatsächlich
  // benachrichtigt (bearbeitete Nachrichten pingen zuverlässig nicht).
  if (ping && GUTHABEN_PING_ROLE_ID) {
    const msg = await channel
      .send({ content: `<@&${GUTHABEN_PING_ROLE_ID}>`, embeds: [embed] })
      .catch((e) => {
        console.warn('[guthaben] Konnte Ping-Nachricht nicht senden', e);
        return null;
      });
    if (msg) {
      data.statusMessageId = msg.id;
      saveData(data);
    }
    return;
  }

  // Stilles Update: bestehende Nachricht bearbeiten statt neue zu senden
  if (data.statusMessageId) {
    const msg = await channel.messages.fetch(data.statusMessageId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed] }).catch((e) => console.warn('[guthaben] Konnte Nachricht nicht bearbeiten', e));
      return;
    }
  }

  const msg = await channel.send({ embeds: [embed] }).catch((e) => {
    console.warn('[guthaben] Konnte Nachricht nicht senden', e);
    return null;
  });
  if (msg) {
    data.statusMessageId = msg.id;
    saveData(data);
  }
}

function scheduleDailyUpdate(client) {
  const now = new Date();
  let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), TAEGLICHE_STUNDE, TAEGLICHE_MINUTE, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const msUntilNext = next - now;

  setTimeout(function run() {
    postOrUpdate(client, loadData(), true).catch((e) => console.warn('[guthaben] Tägliches Update fehlgeschlagen', e));
    // danach alle 24h wiederholen
    setInterval(() => {
      postOrUpdate(client, loadData(), true).catch((e) => console.warn('[guthaben] Tägliches Update fehlgeschlagen', e));
    }, 24 * 60 * 60 * 1000);
  }, msUntilNext);

  console.log(`[guthaben] Tägliches Update geplant für ${next.toLocaleString('de-DE')}`);
}

/**
 * Registriert die Guthaben-Funktion am bestehenden Client.
 * Fügt einen ZUSÄTZLICHEN InteractionCreate-Listener hinzu und rührt
 * die bestehenden Anti-Spam-Listener und -Dateien nicht an.
 */
export function registerGuthaben(client) {
  client.once(Events.ClientReady, () => {
    scheduleDailyUpdate(client);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'guthaben') return; // andere Slash-Commands ignorieren

    const sub = interaction.options.getSubcommand();
    const data = loadData();

    if (sub === 'setzen') {
      const betrag = interaction.options.getNumber('betrag');
      data.guthaben = betrag;
      data.letzteAktualisierung = new Date().toISOString();
      saveData(data);
      await postOrUpdate(client, data);
      await interaction.reply({ content: `✅ Guthaben auf **${betrag.toFixed(2)} €** gesetzt und Anzeige aktualisiert.`, ephemeral: true });
    }

    if (sub === 'anzeigen') {
      const embed = baueEmbed(data.guthaben, data.letzteAktualisierung);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  });

  console.log('[guthaben] Modul registriert.');
}
