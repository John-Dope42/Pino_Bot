import fs from 'fs';
import { v4 as uuid } from 'uuid';

export function logCase(data) {
  const entry = { id: uuid(), time: new Date().toISOString(), ...data };
  fs.appendFileSync('spam_logs.json', JSON.stringify(entry) + '\n');
}
