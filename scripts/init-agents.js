const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = path.join(__dirname, '..', '.env');
const names = ['TRIPP_HERMES_WRITER_TOKEN', 'TRIPP_HERMES_DIRECTOR_TOKEN', 'TRIPP_OPENCLAW_TOKEN'];
const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
for (const name of names) {
  const index = lines.findIndex(line => line.startsWith(`${name}=`));
  if (index === -1) lines.push(`${name}=${crypto.randomBytes(32).toString('base64url')}`);
  else if (!lines[index].slice(name.length + 1)) lines[index] = `${name}=${crypto.randomBytes(32).toString('base64url')}`;
}
fs.writeFileSync(file, `${lines.join('\n')}\n`);
console.log('Agent credentials initialized in .env. Restart Tripp.Scenes to load them.');
