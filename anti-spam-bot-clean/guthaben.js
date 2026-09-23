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
// Optional: Rolle, die an zwei Wochentagen beim täglichen Update gepingt wird
// (z.B. @akademieschüler). Manuelle /guthaben setzen-Updates pingen nie.
const GUTHABEN_PING_ROLE_ID = process.env.GUTHABEN_PING_ROLE_ID;

// ISO-Wochentage: 1 = Montag, ... 7 = Sonntag. Montag und Donnerstag
// ergeben einen möglichst gleichmäßigen Abstand von drei bzw. vier Tagen.
export function parsePingTage(raw) {
  if (!raw) return [1, 4];
  const tage = [...new Set(String(raw)
    .split(',')
    .map((wert) => parseInt(wert.trim(), 10))
    .filter((wert) => Number.isInteger(wert) && wert >= 1 && wert <= 7))];
  return tage.length === 2 ? tage.sort((a, b) => a - b) : [1, 4];
}

const GUTHABEN_PING_TAGE = parsePingTage(process.env.GUTHABEN_PING_TAGE);

export function istGuthabenPingTag(datum, pingTage = GUTHABEN_PING_TAGE) {
  const jsTag = datum.getDay();
  const isoTag = jsTag === 0 ? 7 : jsTag;
  return pingTage.includes(isoTag);
}

export function guthabenTagesoptionen(datum, pingTage = GUTHABEN_PING_TAGE) {
  return { neueNachricht: true, ping: istGuthabenPingTag(datum, pingTage) };
}

// Tag des Monats, an dem das Monatsziel abgezogen wird. Standard: 8.
// Der Bereich bis 28 stellt sicher, dass der Tag in jedem Monat existiert.
function parseStichtag(raw) {
  const tag = parseInt(raw, 10);
  return Number.isInteger(tag) && tag >= 1 && tag <= 28 ? tag : 8;
}
const STICHTAG = parseStichtag(process.env.GUTHABEN_TAG);

// Uhrzeit der täglichen Aktualisierung. Unterstützt "9", "9:30" oder "09:30".
function parseUhrzeit(raw) {
  if (!raw) return { stunde: 12, minute: 0 };
  const teile = String(raw).split(':');
  const stunde = parseInt(teile[0], 10);
  const minute = parseInt(teile[1], 10);
  return {
    stunde: Number.isInteger(stunde) && stunde >= 0 && stunde <= 23 ? stunde : 12,
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
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

function monatsschluessel(jahr, monat) {
  return `${jahr}-${String(monat + 1).padStart(2, '0')}`;
}

function monatsindexAusSchluessel(schluessel) {
  const treffer = /^(\d{4})-(\d{2})$/.exec(String(schluessel ?? ''));
  if (!treffer) return null;
  const jahr = Number(treffer[1]);
  const monat = Number(treffer[2]);
  if (monat < 1 || monat > 12) return null;
  return jahr * 12 + monat - 1;
}

function faelligerMonat(datum, stichtag = STICHTAG) {
  const verschiebung = datum.getDate() < stichtag ? -1 : 0;
  const monat = new Date(datum.getFullYear(), datum.getMonth() + verschiebung, 1);
  return monatsschluessel(monat.getFullYear(), monat.getMonth());
}

/**
 * Zieht alle seit dem letzten Lauf fälligen Monatsbeträge ab.
 *
 * Fehlt der Marker bei einer bestehenden Installation, wird der aktuell
 * fällige Monat nur als Ausgangspunkt gespeichert. So verursacht das Update
 * keine überraschende rückwirkende Abbuchung. Danach wird jeder Monat genau
 * einmal verarbeitet, auch wenn der Bot am Stichtag offline war.
 */
export function verarbeiteFaelligeAbzuege(data, datum = new Date(), ziel = ZIEL, stichtag = STICHTAG) {
  const aktuellerSchluessel = faelligerMonat(datum, stichtag);
  const aktuellerIndex = monatsindexAusSchluessel(aktuellerSchluessel);
  const letzterIndex = monatsindexAusSchluessel(data.letzterMonatsabzug);

  if (letzterIndex === null) {
    data.letzterMonatsabzug = aktuellerSchluessel;
    return { anzahl: 0, initialisiert: true };
  }

  const anzahl = aktuellerIndex - letzterIndex;
  if (anzahl <= 0) return { anzahl: 0, initialisiert: false };

  const bisher = Number.isFinite(Number(data.guthaben)) ? Number(data.guthaben) : 0;
  data.guthaben = Math.round((bisher - ziel * anzahl) * 100) / 100;
  data.letzterMonatsabzug = aktuellerSchluessel;
  data.letzteAktualisierung = datum.toISOString();
  return { anzahl, initialisiert: false };
}

function protokolliereAbzug(ergebnis, data) {
  if (ergebnis.initialisiert) {
    console.log(`[guthaben] Monatsabzug ab ${data.letzterMonatsabzug} aktiviert; keine rückwirkende Abbuchung.`);
  } else if (ergebnis.anzahl > 0) {
    const gesamt = Math.round(ZIEL * ergebnis.anzahl * 100) / 100;
    console.log(`[guthaben] ${ergebnis.anzahl} Monatsabzug/-abzüge (${gesamt.toFixed(2)} ${WAEHRUNG}) verarbeitet. Neuer Stand: ${data.guthaben.toFixed(2)} ${WAEHRUNG}`);
  }
}

function loadDataMitAbzug(datum = new Date()) {
  const data = loadData();
  const ergebnis = verarbeiteFaelligeAbzuege(data, datum);
  if (ergebnis.initialisiert || ergebnis.anzahl > 0) saveData(data);
  protokolliereAbzug(ergebnis, data);
  return data;
}

export function naechsterStichtag(heute = new Date(), letzterMonatsabzug = null, stichtag = STICHTAG) {
  let ziel = new Date(heute.getFullYear(), heute.getMonth(), stichtag);
  const zielSchluessel = monatsschluessel(ziel.getFullYear(), ziel.getMonth());
  const zielIndex = monatsindexAusSchluessel(zielSchluessel);
  const letzterIndex = monatsindexAusSchluessel(letzterMonatsabzug);

  if (heute.getDate() > stichtag || (letzterIndex !== null && letzterIndex >= zielIndex)) {
    ziel = new Date(heute.getFullYear(), heute.getMonth() + 1, stichtag);
  }
  return ziel;
}

function tageBisZiel(letzterMonatsabzug, datum = new Date()) {
  const heute = new Date(datum);
  heute.setHours(0, 0, 0, 0);
  const ziel = naechsterStichtag(datum, letzterMonatsabzug);
  ziel.setHours(0, 0, 0, 0);
  return Math.round((ziel - heute) / (1000 * 60 * 60 * 24));
}

function baueBalken(prozent, laenge = 20, fullEmoji = '🟩', emptyEmoji = '⬜') {
  const gefuellt = Math.max(0, Math.min(laenge, Math.round((prozent / 100) * laenge)));
  return fullEmoji.repeat(gefuellt) + emptyEmoji.repeat(laenge - gefuellt);
}

function baueEmbed(data) {
  const { guthaben, letzteAktualisierung, letzterMonatsabzug } = data;
  const prozentReal = Math.round((guthaben / ZIEL) * 1000) / 10; // kann über 100% liegen
  const prozentHaupt = Math.min(100, prozentReal);
  const rest = Math.max(0, ZIEL - guthaben);
  const ueberschuss = Math.max(0, guthaben - ZIEL);
  const tage = tageBisZiel(letzterMonatsabzug);
  const zielDatum = naechsterStichtag(new Date(), letzterMonatsabzug).toLocaleDateString('de-DE');
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

async function postOrUpdate(client, data, { ping = false, neueNachricht = false } = {}) {
  if (!GUTHABEN_CHANNEL_ID) {
    console.warn('[guthaben] GUTHABEN_CHANNEL_ID ist nicht gesetzt, überspringe Anzeige.');
    return;
  }
  const channel = await client.channels.fetch(GUTHABEN_CHANNEL_ID).catch(() => null);
  if (!channel) {
    console.warn('[guthaben] Spendenchannel nicht gefunden. Prüfe GUTHABEN_CHANNEL_ID.');
    return;
  }

  const embed = baueEmbed(data);

  // Der tägliche Lauf sendet immer eine neue Nachricht. Nur an den beiden
  // konfigurierten Wochentagen enthält sie die Rollen-Erwähnung.
  if (neueNachricht) {
    const rollePingen = ping && Boolean(GUTHABEN_PING_ROLE_ID);
    const msg = await channel
      .send({
        content: rollePingen ? `<@&${GUTHABEN_PING_ROLE_ID}>` : undefined,
        embeds: [embed],
        allowedMentions: rollePingen
          ? { parse: [], roles: [GUTHABEN_PING_ROLE_ID] }
          : { parse: [] },
      })
      .catch((e) => {
        console.warn('[guthaben] Konnte tägliche Guthaben-Nachricht nicht senden', e);
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
  const planeNaechstenLauf = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), TAEGLICHE_STUNDE, TAEGLICHE_MINUTE, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const optionen = guthabenTagesoptionen(next);

    const timer = setTimeout(async () => {
      try {
        await postOrUpdate(client, loadDataMitAbzug(), optionen);
      } catch (e) {
        console.warn('[guthaben] Tägliches Update fehlgeschlagen', e);
      } finally {
        // Jeden Tag neu berechnen, damit 12:00 Uhr auch nach einer Zeitumstellung
        // 12:00 Uhr in der lokalen Zeitzone des Bot-Hosts bleibt.
        planeNaechstenLauf();
      }
    }, next - now);
    timer.unref?.();

    console.log(`[guthaben] Tägliches Update geplant für ${next.toLocaleString('de-DE')} (${optionen.ping ? 'mit Rollenping' : 'ohne Rollenping'})`);
  };

  planeNaechstenLauf();
}

/**
 * Registriert die Guthaben-Funktion am bestehenden Client.
 * Fügt einen ZUSÄTZLICHEN InteractionCreate-Listener hinzu und rührt
 * die bestehenden Anti-Spam-Listener und -Dateien nicht an.
 */
export function registerGuthaben(client) {
  client.once(Events.ClientReady, () => {
    // Fällige Abzüge direkt nach einem Neustart nachholen. Die Nachricht wird
    // weiterhin erst zur konfigurierten täglichen Uhrzeit veröffentlicht.
    loadDataMitAbzug();
    scheduleDailyUpdate(client);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'guthaben') return; // andere Slash-Commands ignorieren

    const sub = interaction.options.getSubcommand();
    const data = loadDataMitAbzug();

    if (sub === 'setzen') {
      const betrag = interaction.options.getNumber('betrag');
      data.guthaben = betrag;
      data.letzteAktualisierung = new Date().toISOString();
      saveData(data);
      await postOrUpdate(client, data);
      await interaction.reply({ content: `✅ Guthaben auf **${betrag.toFixed(2)} €** gesetzt und Anzeige aktualisiert.`, ephemeral: true });
    }

    if (sub === 'anzeigen') {
      const embed = baueEmbed(data);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  });

  console.log('[guthaben] Modul registriert.');
}
