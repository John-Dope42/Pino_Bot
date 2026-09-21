import { config } from './config.js';

export function evaluateRisk(user){
  const accountAgeDays = (Date.now() - user.createdTimestamp)/(1000*60*60*24);
  return {
    high: accountAgeDays < config.newAccountAge,
    accountAgeDays
  };
}
