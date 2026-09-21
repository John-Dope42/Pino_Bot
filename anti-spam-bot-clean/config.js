import dotenv from 'dotenv';
dotenv.config();

export const config = {
  token: process.env.DISCORD_TOKEN,
  modChannel: process.env.MOD_CHANNEL_ID,
  spamDelete: process.env.SPAM_DELETE === 'true',
  similarMessageThreshold: parseInt(process.env.SIMILAR_MESSAGE_THRESHOLD) || 4,
  mlSpamDetection: process.env.ML_SPAM === 'true',
  newAccountAge: parseInt(process.env.NEW_ACCOUNT_AGE) || 4,
  // Window (ms) used to group similar messages from the same user. Default: 15 minutes
  similarMessageWindow: parseInt(process.env.SIMILAR_MESSAGE_WINDOW) || 15 * 60 * 1000
  ,
  // Wenn true, wird die Moderations-Benachrichtigungsnachricht im Mod-Channel
  // auch dann gelöscht, wenn die Moderationsaktion (Kick/Ban/Timeout) fehlschlägt.
  // Setze DELETE_MOD_MESSAGE_ON_FAILURE=false in der .env, um dies zu deaktivieren.
  deleteModMessageOnFailure: process.env.DELETE_MOD_MESSAGE_ON_FAILURE !== 'false'
  ,
  // If set, users who have been on the guild longer than this (ms) will be
  // automatically put in timeout (10 minutes) when the anti-spam triggers.
  // Default: 30 days
  autoTimeoutMemberAgeMs: parseInt(process.env.AUTO_TIMEOUT_MEMBER_AGE_MS) || 30 * 24 * 60 * 60 * 1000
  ,
  // Window after a timeout where a repeat trigger leads to a harsher penalty (ms)
  repeatOffenderWindowMs: parseInt(process.env.REPEAT_OFFENDER_WINDOW_MS) || 15 * 60 * 1000,
  // Timeout duration for repeat offenders (ms). Default: 2 hours
  repeatOffenderTimeoutMs: parseInt(process.env.REPEAT_OFFENDER_TIMEOUT_MS) || 2 * 60 * 60 * 1000
  ,
  // When deleting similar messages, only remove messages from the last N ms.
  // Default: 30 minutes
  deleteSimilarWindowMs: parseInt(process.env.DELETE_SIMILAR_WINDOW_MS) || 30 * 60 * 1000
  ,
  // While the deletion worker runs, keep a live listener active for this many ms
  // to delete incoming matching messages in real time. Default: 2 minutes.
  deleteDuringActiveMs: parseInt(process.env.DELETE_DURING_ACTIVE_MS) || 2 * 60 * 1000
};

