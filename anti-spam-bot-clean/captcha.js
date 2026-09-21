export async function sendCaptcha(message){
  // Optional: sende User einen Captcha-Link oder Nachricht
  await message.author.send("Hoher Spam-Risikowert! Bitte CAPTCHA lösen.");
}
