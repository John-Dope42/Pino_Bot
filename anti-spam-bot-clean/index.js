import { Client, GatewayIntentBits, Partials, Events, InteractionType } from 'discord.js';

// Ephemeral response flag (Interaction response flags): 64
const EPHEMERAL_FLAG = 64;

// Track timestamps of last automatic timeout per user to detect repeat offenders
const autoTimeoutHistory = new Map();
import { config } from './config.js';
import { checkSpam } from './messageCache.js';
import { evaluateRisk } from './riskScore.js';
import { mlCheck } from './mlSpam.js';
import { notifyMods } from './notify.js';
import { registerGuthaben } from './guthaben.js'; // NEU: Guthaben-Anzeige im Spendenchannel

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel]
});

registerGuthaben(client); // NEU: hängt eigenen InteractionCreate-Listener an, rührt Anti-Spam-Logik nicht an

// READY Event
client.once(Events.ClientReady, () => {
  console.log(`Anti-Spam Bot ist online!`);
});

// Nachrichtenüberwachung
client.on(Events.MessageCreate, async (message) => {
  if(message.author.bot) return;

  const risk = evaluateRisk(message.author);
  let isSpam = false;

  if(config.mlSpamDetection){
    isSpam = mlCheck(message);
  }

  const spamResult = checkSpam(message);
  const similar = spamResult.isSpam;
  const similarMessages = spamResult.messages || [];

  // Verhalten:
  // - Wenn mehrere gleiche Nachrichten erreicht sind (similar) oder hohes Risiko,
  //   dann ggf. löschen und Mods benachrichtigen.
  // - Wenn nur ML-Detection anschlägt, nur Mods benachrichtigen (kein automatisches Löschen).
  if(similar || risk.high){
    // Auto-timeout: if member has been on the guild longer than configured age,
    // automatically timeout them for 10 minutes (if bot has sufficient hierarchy).
    try{
      if(message.guild && config.autoTimeoutMemberAgeMs){
        const m = await message.guild.members.fetch(message.author.id).catch(() => null);
        if(m && m.joinedTimestamp){
          const age = Date.now() - m.joinedTimestamp;
          if(age >= config.autoTimeoutMemberAgeMs){
            const botMember = await message.guild.members.fetch(client.user.id).catch(() => null);
            const targetPos = m.roles?.highest?.position || 0;
            const botPos = botMember?.roles?.highest?.position || 0;
            if(!(m.id === message.guild.ownerId || targetPos >= botPos)){
              try{
                const now = Date.now();
                const last = autoTimeoutHistory.get(m.id) || 0;
                const repeatWindow = config.repeatOffenderWindowMs || 15 * 60 * 1000;
                const repeatTimeout = config.repeatOffenderTimeoutMs || 2 * 60 * 60 * 1000;
                const shortTimeout = 10 * 60 * 1000;
                const useRepeat = last && (now - last) <= repeatWindow;
                const timeoutDuration = useRepeat ? repeatTimeout : shortTimeout;

                await m.timeout(timeoutDuration, useRepeat ? 'Repeat-offender timeout durch Anti-Spam' : 'Auto-timeout durch Anti-Spam');
                console.log(`Auto-timeout applied to ${m.user.tag} (${timeoutDuration/60000} min) (joined ${new Date(m.joinedTimestamp).toISOString()})`);
                // record history timestamp for repeat-offender detection
                autoTimeoutHistory.set(m.id, now);
                // Cleanup history entry after window expires
                setTimeout(() => autoTimeoutHistory.delete(m.id), repeatWindow + 1000);
                // Notify mods if this was a repeat-offender timeout
                if(useRepeat){
                  try{
                    const modCh = await client.channels.fetch(config.modChannel).catch(() => null);
                    if(modCh && modCh.send){
                      await modCh.send(`Wiederholungstäter: ${m.user.tag} hat innerhalb von ${Math.round(repeatWindow/60000)} Minuten erneut den Anti-Spam ausgelöst — automatischer Timeout ${Math.round(timeoutDuration/60000)} Minuten angewendet. Ursprung: <#${message.channel.id}> Nachricht-ID: ${message.id}`);
                    }
                  }catch(e){ console.warn('Failed to notify mods about repeat-offender', e); }
                }
              }catch(e){ console.warn('Failed to apply auto-timeout', e); }
            } else {
              console.warn(`Auto-timeout skipped due to role hierarchy: botPos=${botPos} targetPos=${targetPos}`);
            }
          }
        }
      }
    }catch(e){
      console.warn('Error while attempting auto-timeout', e);
    }

    // continue with deletion/notification logic
    if(config.spamDelete){
      try{
        console.log(`Deleting message ${message.id} by ${message.author.tag} (similar=${similar}, ml=${isSpam}, riskHigh=${risk.high})`);
        // Delete current message (best-effort)
        await message.delete().catch((e) => { if(!(e && e.code === 10008)) throw e; });

        // Notify mods immediately to avoid delays
        try{ await notifyMods(client, message, risk); }catch(e){ /* ignore */ }

        // Deletion worker: group stored messages by channel and use bulkDelete where possible
        const deleteSimilarMessages = async (messages) => {
          if(!messages || !messages.length) return 0;
          const byChannel = new Map();
          for(const m of messages){
            if(!m || m.id === message.id) continue;
            const arr = byChannel.get(m.channelId) || [];
            arr.push(m.id);
            byChannel.set(m.channelId, arr);
          }

          let deleted = 0;
          const MAX_BULK_AGE = 14 * 24 * 60 * 60 * 1000; // 14 days

          for(const [channelId, ids] of byChannel.entries()){
            try{
              const ch = await client.channels.fetch(channelId).catch(() => null);
              if(!ch || !ch.isTextBased || !ch.messages) continue;

              // Fetch messages by id and split into bulk-eligible and individual deletes
                  // Fetch stored IDs and also scan recent messages in the channel to catch
                  // matching messages that may not be in the stored list (but within window).
                  const cutoff = Date.now() - (config.deleteSimilarWindowMs || 30 * 60 * 1000);
                  const seenIds = new Set();
                  const storedFetch = await Promise.all(ids.map(id => ch.messages.fetch(id).catch(() => null)));
                  for(const msg of storedFetch){
                    if(!msg) continue;
                    if(msg.createdTimestamp >= cutoff) seenIds.add(msg.id);
                  }
                  // quick scan recent messages in channel to include any additional matches
                  try{
                    const recent = await ch.messages.fetch({ limit: 200 }).catch(() => null);
                    if(recent){
                      for(const gm of recent.values()){
                        if(!gm) continue;
                        if(gm.createdTimestamp < cutoff) continue;
                        if(gm.author?.id === message.author.id && (gm.content || '').toLowerCase().trim() === (message.content || '').toLowerCase().trim()){
                          seenIds.add(gm.id);
                        }
                      }
                    }
                  }catch(e){ /* ignore recent scan errors */ }

                  const bulkIds = [];
                  const individual = [];
                  for(const id of seenIds){
                    try{
                      const msg = await ch.messages.fetch(id).catch(() => null);
                      if(!msg) continue;
                      const age = Date.now() - msg.createdTimestamp;
                      if(age <= MAX_BULK_AGE) bulkIds.push(msg.id);
                      else individual.push(msg);
                    }catch(e){ /* ignore per-message fetch errors */ }
                  }

              // Bulk delete eligible messages (in chunks of up to 100)
              while(bulkIds.length){
                const chunk = bulkIds.splice(0, 100);
                try{
                  const res = await ch.bulkDelete(chunk, true).catch(() => null);
                  if(res && res.size) deleted += res.size;
                  else deleted += chunk.length;
                }catch(e){ console.warn('bulkDelete failed', e); }
                // small delay
                await new Promise(r => setTimeout(r, 200));
              }

              // Delete older messages individually
              for(const msg of individual){
                try{ await msg.delete().catch(() => null); deleted++; }catch(e){ if(!(e && e.code === 10008)) console.warn('Failed deleting old message', e); }
                await new Promise(r => setTimeout(r, 150));
              }
            }catch(e){ /* ignore per-channel errors */ }
          }
          return deleted;
        };

        (async () => {
          try{
            // Live listener: delete incoming identical messages during active window
            const authorId = message.author.id;
            const contentKeyLive = (message.content || '').toLowerCase().trim();
            let liveDeleted = 0;
            const activeMs = config.deleteDuringActiveMs || 2 * 60 * 1000;
            const handler = async (m) => {
              try{
                if(m.author?.id === authorId && (m.content || '').toLowerCase().trim() === contentKeyLive){
                  const cutoff = Date.now() - (config.deleteSimilarWindowMs || 30 * 60 * 1000);
                  if(m.createdTimestamp >= cutoff){
                    await m.delete().catch(() => null);
                    liveDeleted++;
                  }
                }
              }catch(e){ /* ignore */ }
            };
            client.on('messageCreate', handler);
            // ensure handler is removed after active window
            setTimeout(() => {
              try{ client.off('messageCreate', handler); }catch(e){}
              if(liveDeleted) console.log(`Also deleted ${liveDeleted} incoming similar messages from ${message.author.tag} during active window`);
            }, activeMs + 1000);

            const deletedCount = await deleteSimilarMessages(similarMessages || []);
            if(deletedCount) console.log(`Also deleted ${deletedCount} similar messages from ${message.author.tag}`);
            // Lightweight fallback: scan recent messages in the same channel
            try{
              const fetched = await message.channel.messages.fetch({ limit: 200 }).catch(() => null);
                if(fetched){
                const contentKey = (message.content || '').toLowerCase().trim();
                const promises = [];
                const cutoff = Date.now() - (config.deleteSimilarWindowMs || 30 * 60 * 1000);
                for(const msg of fetched.values()){
                  if(msg.id === message.id) continue;
                  if(msg.createdTimestamp < cutoff) continue; // skip messages outside delete window
                  if(msg.author?.id === message.author.id && (msg.content || '').toLowerCase().trim() === contentKey){
                    promises.push(msg.delete().then(() => 1).catch(() => 0));
                  }
                }
                const res = await Promise.allSettled(promises);
                let extraDeleted = 0;
                for(const r of res){ if(r.status === 'fulfilled' && r.value) extraDeleted += r.value; }
                if(extraDeleted) console.log(`Also deleted ${extraDeleted} additional similar messages from ${message.author.tag}`);
              }
            }catch(e){ console.warn('Failed fallback fetching/deleting similar messages', e); }
            // Final rescan after a short wait to catch stragglers
            try{
              await new Promise(r => setTimeout(r, 5000));
              const cutoff = Date.now() - (config.deleteSimilarWindowMs || 30 * 60 * 1000);
              const channelIds = new Set((similarMessages || []).map(m => m.channelId).concat([message.channel.id]));
              let finalDeleted = 0;
              for(const chId of channelIds){
                try{
                  const ch = await client.channels.fetch(chId).catch(() => null);
                  if(!ch || !ch.isTextBased || !ch.messages) continue;
                  let fetchedAll = [];
                  let lastId = null;
                  const maxRounds = 5; // up to ~500 messages
                  for(let round = 0; round < maxRounds; round++){
                    const opts = { limit: 100 };
                    if(lastId) opts.before = lastId;
                    const batch = await ch.messages.fetch(opts).catch(() => null);
                    if(!batch || !batch.size) break;
                    fetchedAll = fetchedAll.concat(Array.from(batch.values()));
                    lastId = batch.last()?.id;
                    const oldest = batch.size ? batch.last().createdTimestamp : 0;
                    if(oldest < cutoff) break;
                    await new Promise(r => setTimeout(r, 200));
                  }
                  // Collect candidates and delete in parallel batches, skipping failures
                  const candidates = [];
                  for(const gm of fetchedAll){
                    if(!gm) continue;
                    if(gm.createdTimestamp < cutoff) continue;
                    if(gm.author?.id === message.author.id && (gm.content || '').toLowerCase().trim() === (message.content || '').toLowerCase().trim()){
                      candidates.push(gm);
                    }
                  }
                  const batchSize = 20;
                  for(let i = 0; i < candidates.length; i += batchSize){
                    const batch = candidates.slice(i, i + batchSize);
                    const promises = batch.map(gm => gm.delete().then(() => 1).catch(() => 0));
                    const results = await Promise.allSettled(promises);
                    for(const r of results){ if(r.status === 'fulfilled' && r.value) finalDeleted += r.value; }
                    // small pause to avoid hitting rate limits
                    await new Promise(r => setTimeout(r, 150));
                  }
                }catch(e){ /* ignore per-channel errors */ }
              }
              if(finalDeleted) console.log(`Final rescan deleted ${finalDeleted} remaining similar messages from ${message.author.tag}`);
            }catch(e){ console.warn('Final rescan failed', e); }
          }catch(e){ console.warn('Background deletion worker failed', e); }
        })();
      }catch(err){
        if(err && err.code === 10008){
          console.warn('Message already deleted (Unknown Message)');
        } else {
          console.error('Failed to delete message', err);
        }
      }
    }
  } else if(isSpam){
    await notifyMods(client, message, risk);
  }
});

// Button-Handler
client.on(Events.InteractionCreate, async (interaction) => {
  if(interaction.type !== InteractionType.MessageComponent) return;

  const { customId } = interaction;
  const guild = interaction.guild;
  if(!guild) return;

  const userId = customId.split('_')[1];
  const member = await guild.members.fetch(userId).catch(() => null);
  if(!member) return interaction.reply({ content: 'User nicht gefunden.', flags: EPHEMERAL_FLAG });

  // Debug logging and permission checks
  console.log(`Interaction received: ${customId} clicked by ${interaction.user.tag} targeting ${userId}`);
  const botMember = await guild.members.fetch(client.user.id).catch(() => null);
  if(!botMember){
    console.warn('Could not fetch bot member for role checks');
  } else {
    const targetPos = member.roles?.highest?.position || 0;
    const botPos = botMember.roles?.highest?.position || 0;
    if(member.id === guild.ownerId || targetPos >= botPos){
      console.warn(`Insufficient role hierarchy: botPos=${botPos} targetPos=${targetPos} owner=${member.id===guild.ownerId}`);
      // Safe reply: try to reply or followUp, ignore errors (interaction may be expired/unknown)
      try{
        if(interaction.replied || interaction.deferred){
          await interaction.followUp({ content: 'Aktion fehlgeschlagen: Bot hat nicht die nötige Rollen-Hierarchie, um diesen User zu verwalten.', flags: EPHEMERAL_FLAG }).catch(() => null);
        } else {
          await interaction.reply({ content: 'Aktion fehlgeschlagen: Bot hat nicht die nötige Rollen-Hierarchie, um diesen User zu verwalten.', flags: EPHEMERAL_FLAG }).catch(() => null);
        }
      }catch(e){ /* ignore */ }
      // If configured, delete the mod-channel notification even if the action can't be performed
      if(config.deleteModMessageOnFailure){
        try{
          if(interaction.message && interaction.message.channelId === config.modChannel){
            const ch = await client.channels.fetch(interaction.message.channelId).catch(() => null);
            if(ch && ch.messages){
              await ch.messages.fetch(interaction.message.id).then(m => m.delete().catch(() => null)).catch(() => null);
            } else {
              await interaction.message.delete().catch(() => null);
            }
          }
        }catch(e){
          console.warn('Could not delete mod message during role-check', e);
        }
      }
      return;
    }
  }

  let actionSucceeded = false;
  try{
    if(customId.startsWith('timeout_')){
      await member.timeout(10 * 60 * 1000, 'Timeout durch Mod-Button'); // 10 Minuten
      actionSucceeded = true;
      try{ await interaction.reply({ content: `${member.user.tag} wurde 10 Minuten gemutet.`, flags: EPHEMERAL_FLAG }); }catch(e){ console.warn('Reply failed', e); }
      // record moderator-applied timeout in history so repeat detection counts
      try{
        const now = Date.now();
        autoTimeoutHistory.set(member.id, now);
        const repeatWindow = config.repeatOffenderWindowMs || 15 * 60 * 1000;
        setTimeout(() => autoTimeoutHistory.delete(member.id), repeatWindow + 1000);
      }catch(e){ /* ignore */ }
    }
    else if(customId.startsWith('kick_')){
      await member.kick('Kick durch Mod-Button');
      actionSucceeded = true;
      try{ await interaction.reply({ content: `${member.user.tag} wurde gekickt.`, flags: EPHEMERAL_FLAG }); }catch(e){ console.warn('Reply failed', e); }
    }
    else if(customId.startsWith('ban_')){
      await member.ban({ reason: 'Ban durch Mod-Button' });
      actionSucceeded = true;
      try{ await interaction.reply({ content: `${member.user.tag} wurde gebannt.`, flags: EPHEMERAL_FLAG }); }catch(e){ console.warn('Reply failed', e); }
    }
    else if(customId.startsWith('ignore_')){
      // 'Ignore' considered a successful moderator action (no moderation API call)
      actionSucceeded = true;
      try{ await interaction.reply({ content: `${member.user.tag} wird ignoriert.`, flags: EPHEMERAL_FLAG }); }catch(e){ console.warn('Reply failed', e); }
    }
  }catch(err){
    console.error('Interaction action failed', err);
    try{ await interaction.reply({ content: 'Aktion fehlgeschlagen: ' + (err.message || err), flags: EPHEMERAL_FLAG }); }catch(e){}
  }finally{
    // Lösche die Mod-Channel-Benachrichtigung, wenn die Aktion erfolgreich war
    // oder wenn der Admin/Moderator in der Konfiguration das Überschreiben erlaubt.
    if(actionSucceeded || config.deleteModMessageOnFailure){
      try{
        if(interaction.message && interaction.message.channelId === config.modChannel){
          await interaction.message.delete().catch(() => null);
        }
      }catch(err){
        console.error('Failed to delete mod message', err);
      }
    }
  }
});

// LOGIN
client.login(config.token);
