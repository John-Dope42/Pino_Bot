// deploy-commands.js
// -------------------
// Registriert alle Befehle aus slashCommands.js sowie /guthaben.
// Einmalig ausführen (und erneut nach jeder Änderung an den Commands):
//   node deploy-commands.js
//
// Benötigt in der .env zusätzlich: CLIENT_ID und GUILD_ID
// (DISCORD_TOKEN ist bereits vorhanden).

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands as bestehendeCommands } from './slashCommands.js';
import { guthabenCommandData } from './guthaben.js';

const commands = [...bestehendeCommands, guthabenCommandData];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registriere ${commands.length} Slash-Commands...`);
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('Slash-Commands erfolgreich registriert!');
  } catch (error) {
    console.error('Fehler beim Registrieren der Slash-Commands:', error);
    process.exitCode = 1;
  }
})();
