export function mlCheck(message){
  const content = (message.content || '').toLowerCase();
  return /\b(?:free|click)\b|\b(?:discord\.gg|bit\.ly)\b/i.test(content);
}
