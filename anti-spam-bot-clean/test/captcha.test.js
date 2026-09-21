import test from 'node:test';
import assert from 'node:assert/strict';
import { sendCaptcha, handleCaptchaReply, isCaptchaPending, hasPassedCaptcha } from '../captcha.js';

function fakeMessage(guildId, userId) {
  const dms = [];
  const author = { id: userId, send: async (text) => { dms.push(text); } };
  return { guild: { id: guildId }, author, dms };
}

test('Captcha wird nur einmal versendet und entsperrt nach richtiger DM', async () => {
  const message = fakeMessage('guild-1', 'user-1');
  assert.equal(await sendCaptcha(message), 'sent');
  assert.equal(await sendCaptcha(message), 'pending');
  assert.equal(message.dms.length, 1);
  assert.equal(isCaptchaPending('guild-1', 'user-1'), true);

  const code = message.dms[0].match(/\*\*(\d{6})\*\*/)?.[1];
  assert.ok(code);
  await handleCaptchaReply({ author: message.author, content: 'falsch' });
  assert.equal(hasPassedCaptcha('guild-1', 'user-1'), false);
  await handleCaptchaReply({ author: message.author, content: code });
  assert.equal(isCaptchaPending('guild-1', 'user-1'), false);
  assert.equal(hasPassedCaptcha('guild-1', 'user-1'), true);
  assert.equal(await sendCaptcha(message), 'verified');
});

test('Nach drei falschen Antworten bleibt die Schreibsperre vorerst bestehen', async () => {
  const message = fakeMessage('guild-2', 'user-2');
  assert.equal(await sendCaptcha(message), 'sent');
  for (let attempt = 0; attempt < 3; attempt++) {
    await handleCaptchaReply({ author: message.author, content: 'falsch' });
  }
  assert.equal(hasPassedCaptcha('guild-2', 'user-2'), false);
  assert.equal(isCaptchaPending('guild-2', 'user-2'), true);
});
