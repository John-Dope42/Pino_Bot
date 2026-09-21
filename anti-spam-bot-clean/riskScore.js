export function evaluateRisk(user){
  const accountAgeDays = (Date.now() - user.createdTimestamp)/(1000*60*60*24);
  return {
    high: accountAgeDays < parseInt(process.env.NEW_ACCOUNT_AGE || 4),
    accountAgeDays
  };
}
