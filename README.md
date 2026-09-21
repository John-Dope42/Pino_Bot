# Pino_Bot

Ein Discord-Bot mit zwei Funktionsbereichen:

- 🛡️ **Anti-Spam** – erkennt und meldet verdächtige Nachrichten, mit Risiko-Score, Captcha-Aufforderung und Mod-Benachrichtigung inkl. Timeout/Kick/Ban-Buttons.
- 💰 **Guthaben-Anzeige** – zeigt automatisch im Spendenchannel das aktuelle Serverguthaben, das Monatsziel und die verbleibenden Tage bis zum Stichtag an, inklusive täglichem Rollen-Ping.

Beide Teile laufen im selben Bot-Prozess und sind unabhängig voneinander.

---

## Features

### Anti-Spam
- Erkennung ähnlicher/wiederholter Nachrichten innerhalb eines Zeitfensters
- Einfache Keyword-basierte Spam-Erkennung (ML_SPAM_DETECTION)
- Risiko-Bewertung anhand des Account-Alters
- Automatisches Captcha bei hohem Risiko
- Mod-Benachrichtigung im konfigurierten Channel mit Buttons für Timeout, Kick und Ban
- Protokollierung aller Fälle in `spam_logs.json`

### Guthaben-Anzeige
- Embed mit aktuellem Guthaben, Zielbetrag und Fortschrittsbalken
- Zeigt korrekt an, wenn das Ziel überschritten wird (goldener Bonus-Balken + Extra-Betrag)
- Automatische Berechnung der Tage bis zum nächsten Stichtag (z. B. jeweils der 8. des Monats)
- `/guthaben setzen` – Betrag manuell eintragen (nur für Rollen mit „Server verwalten")
- `/guthaben anzeigen` – aktuellen Stand privat einsehen
- Tägliches automatisches Update zu einer festgelegten Uhrzeit, optional mit Rollen-Ping
- Bearbeitet bestehende Nachrichten bei manuellen Updates (kein Spam), postet beim täglichen Ping bewusst eine neue Nachricht (damit die Benachrichtigung zuverlässig auslöst)

---

## Voraussetzungen

- [Node.js](https://nodejs.org/) 18 oder neuer
- Ein Discord-Bot-Account ([Developer Portal](https://discord.com/developers/applications))
- Der Bot muss mit den Scopes `bot` **und** `applications.commands` auf den Server eingeladen werden

---

## Installation

```bash
git clone <dieses-repo>
cd anti-spam-bot
npm install
cp .env.example .env
```

Anschließend `.env` mit den eigenen Werten ausfüllen (siehe unten).

### Slash-Commands registrieren

Einmalig ausführen, danach nur wieder nötig, wenn sich Commands ändern:

```bash
node deploy-commands.js
```

### Bot starten

```bash
npm start
```

Für den Dauerbetrieb empfiehlt sich ein Prozess-Manager wie [pm2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
pm2 start index.js --name discord-bot
pm2 save
pm2 startup
```

---

## Konfiguration (`.env`)

```dotenv
# ---- Bot-Zugang ----
DISCORD_TOKEN=              # Bot-Token (Developer Portal -> Bot -> Reset Token)
CLIENT_ID=                  # Application ID (Developer Portal -> General Information)
GUILD_ID=                   # Server-ID (Rechtsklick auf Server -> ID kopieren)

# ---- Admin / Moderation ----
OWNER_ID=                   # Discord-User-ID des Bot-Owners
MOD_CHANNEL_ID=              # Channel für Mod-Benachrichtigungen bei Spam-Verdacht

# ---- Anti-Spam Einstellungen ----
SPAM_DELETE=true             # Spam-Nachrichten automatisch löschen
CAPTCHA_HIGH_RISK=true       # Bei hohem Risiko Captcha anfordern
ML_SPAM_DETECTION=true       # Keyword-/ML-basierte Spam-Erkennung aktivieren
NEW_ACCOUNT_AGE=4            # Accounts jünger als X Tage gelten als verdächtig
SIMILAR_MESSAGE_THRESHOLD=3  # Gleiche Nachricht X-mal = Spam

# ---- Guthaben-Anzeige ----
GUTHABEN_CHANNEL_ID=         # Channel-ID des Spendenchannels
GUTHABEN_ZIEL=54.70          # Zielbetrag in Euro
GUTHABEN_TAG=8               # Tag im Monat, an dem das Ziel fällig ist
GUTHABEN_UHRZEIT=9:00        # Uhrzeit der täglichen Aktualisierung (HH:MM)
GUTHABEN_PING_ROLE_ID=       # Optional: Rolle, die beim täglichen Update gepingt wird
```

### IDs finden

- **Server-, Channel- und Rollen-IDs:** In Discord unter Einstellungen → Erweitert → **Entwicklermodus** aktivieren, dann per Rechtsklick auf Server/Channel/Rolle → „ID kopieren".
- **CLIENT_ID (Application ID):** [Developer Portal](https://discord.com/developers/applications) → Anwendung auswählen → General Information.

### Rollen-Ping aktivieren

Damit `GUTHABEN_PING_ROLE_ID` tatsächlich benachrichtigt, muss eine der beiden Bedingungen erfüllt sein:
- Die Rolle ist auf „Jeder kann diese Rolle erwähnen" gestellt, **oder**
- Der Bot hat die Berechtigung „@everyone, @here und alle Rollen erwähnen".

---

## Slash-Commands

| Befehl | Beschreibung | Berechtigung |
|---|---|---|
| `/guthaben setzen betrag:<Zahl>` | Aktuelles Guthaben eintragen und Anzeige aktualisieren | Server verwalten |
| `/guthaben anzeigen` | Aktuellen Stand privat einsehen | Server verwalten |
| `/antispam` | Status der Anti-Spam-Funktion anzeigen | – |

---

## Projektstruktur

```
├── index.js              # Einstiegspunkt, Discord-Client, Event-Handling
├── config.js              # Zentrale Konfiguration (liest .env)
├── messageCache.js        # Erkennung wiederholter/ähnlicher Nachrichten
├── riskScore.js            # Risiko-Bewertung anhand Account-Alter
├── mlSpam.js               # Keyword-basierte Spam-Erkennung
├── captcha.js               # Captcha-Aufforderung bei hohem Risiko
├── notify.js                # Mod-Benachrichtigung mit Timeout/Kick/Ban-Buttons
├── logger.js                 # Protokollierung erkannter Spam-Fälle
├── slashCommands.js          # Definition bestehender Slash-Commands
├── guthaben.js                # Guthaben-Anzeige im Spendenchannel
├── deploy-commands.js         # Registriert alle Slash-Commands bei Discord
├── guthaben-data.json         # Persistente Speicherung des aktuellen Guthabens (wird automatisch angelegt)
└── .env                        # Eigene Konfiguration (nicht einchecken!)
```

---

## Hinweise

- `guthaben-data.json` und `.env` gehören in die `.gitignore` – sie enthalten Laufzeitdaten bzw. Zugangsdaten und sollten nicht ins Repository.
- Nach Codeänderungen muss der Bot-Prozess neu gestartet werden (`npm start` bzw. `pm2 restart discord-bot`).
- `deploy-commands.js` muss nur erneut ausgeführt werden, wenn sich die Slash-Command-Struktur ändert (neue Optionen, neue Commands) – nicht bei jedem normalen Codeupdate.
