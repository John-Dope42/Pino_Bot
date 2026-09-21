export function mlCheck(message){
  const spamKeywords = ['free', 'click', 'discord.gg', 'bit.ly'];
  const content = message.content.toLowerCase();
  return spamKeywords.some(word => content.includes(word));
}
