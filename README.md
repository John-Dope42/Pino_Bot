# Discord Anti-Spam & Balance Bot

A Discord bot with two feature areas:

- 🛡️ **Anti-Spam** – detects and flags suspicious messages, with a risk score, captcha challenge, and mod notifications including Timeout/Kick/Ban buttons.
- 💰 **Balance Display** – automatically shows the current server credit, the monthly goal, and the days remaining until the deadline in a donation channel, including a daily role ping.

Both parts run in the same bot process and work independently of each other.

---

## Features

### Anti-Spam
- Detects repeated/similar messages within a time window
- Simple keyword-based spam detection (ML_SPAM_DETECTION)
- Risk assessment based on account age
- Automatic captcha challenge for high-risk users
- Mod notification in a configured channel with Timeout, Kick, and Ban buttons
- Logs all cases to `spam_logs.json`

### Balance Display
- Embed showing current balance, target amount, and a progress bar
- Correctly displays when the goal is exceeded (golden bonus bar + extra amount)
- Automatically calculates the days remaining until the next deadline (e.g. the 8th of each month)
- `/guthaben setzen` – manually set the balance (restricted to roles with "Manage Server")
- `/guthaben anzeigen` – privately check the current status
- Automatic daily update at a configured time, optionally with a role ping
- Edits the existing message for manual updates (no spam), posts a new message for the daily ping (so the notification reliably triggers)

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- A Discord bot account ([Developer Portal](https://discord.com/developers/applications))
- The bot must be invited with both the `bot` **and** `applications.commands` scopes

---

## Installation

```bash
git clone <this-repo>
cd anti-spam-bot
npm install
cp .env.example .env
```

Then fill in `.env` with your own values (see below).

### Register slash commands

Run once, and again only when commands change:

```bash
node deploy-commands.js
```

### Start the bot

```bash
npm start
```

For production use, a process manager like [pm2](https://pm2.keymetrics.io/) is recommended:

```bash
npm install -g pm2
pm2 start index.js --name discord-bot
pm2 save
pm2 startup
```

---

## Configuration (`.env`)

```dotenv
# ---- Bot access ----
DISCORD_TOKEN=              # Bot token (Developer Portal -> Bot -> Reset Token)
CLIENT_ID=                  # Application ID (Developer Portal -> General Information)
GUILD_ID=                   # Server ID (right-click server -> Copy ID)

# ---- Admin / Moderation ----
OWNER_ID=                   # Discord user ID of the bot owner
MOD_CHANNEL_ID=              # Channel for mod notifications on suspected spam

# ---- Anti-Spam settings ----
SPAM_DELETE=true             # Automatically delete spam messages
CAPTCHA_HIGH_RISK=true       # Require a captcha for high-risk users
ML_SPAM_DETECTION=true       # Enable keyword/ML-based spam detection
NEW_ACCOUNT_AGE=4            # Accounts younger than X days are considered suspicious
SIMILAR_MESSAGE_THRESHOLD=3  # Same message X times = spam

# ---- Balance display ----
GUTHABEN_CHANNEL_ID=         # Channel ID of the donation channel
GUTHABEN_ZIEL=54.70          # Target amount in euros
GUTHABEN_TAG=8               # Day of the month the goal is due
GUTHABEN_UHRZEIT=9:00        # Time of the daily update (HH:MM)
GUTHABEN_PING_ROLE_ID=       # Optional: role to ping on the daily update
```

### Finding IDs

- **Server, channel, and role IDs:** In Discord, go to Settings → Advanced → enable **Developer Mode**, then right-click a server/channel/role → "Copy ID".
- **CLIENT_ID (Application ID):** [Developer Portal](https://discord.com/developers/applications) → select your application → General Information.

### Enabling the role ping

For `GUTHABEN_PING_ROLE_ID` to actually notify members, one of these must be true:
- The role is set to "Allow anyone to @mention this role", **or**
- The bot has the "Mention @everyone, @here, and All Roles" permission.

---

## Slash Commands

| Command | Description | Permission |
|---|---|---|
| `/guthaben setzen betrag:<number>` | Set the current balance and update the display | Manage Server |
| `/guthaben anzeigen` | Privately view the current status | Manage Server |
| `/antispam` | Show anti-spam status | – |

---

## Project Structure

```
├── index.js              # Entry point, Discord client, event handling
├── config.js              # Central configuration (reads .env)
├── messageCache.js        # Detection of repeated/similar messages
├── riskScore.js            # Risk assessment based on account age
├── mlSpam.js               # Keyword-based spam detection
├── captcha.js               # Captcha challenge for high-risk users
├── notify.js                # Mod notification with Timeout/Kick/Ban buttons
├── logger.js                 # Logging of detected spam cases
├── slashCommands.js          # Definition of existing slash commands
├── guthaben.js                # Balance display in the donation channel
├── deploy-commands.js         # Registers all slash commands with Discord
├── guthaben-data.json         # Persistent storage of the current balance (created automatically)
└── .env                        # Your own configuration (do not commit!)
```

---

## Notes

- `guthaben-data.json` and `.env` belong in `.gitignore` – they contain runtime data and credentials respectively and should not be committed to the repository.
- After code changes, the bot process must be restarted (`npm start` or `pm2 restart discord-bot`).
- `deploy-commands.js` only needs to be re-run when the slash command structure changes (new options, new commands) – not on every regular code update.
