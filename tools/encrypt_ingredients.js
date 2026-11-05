#!/usr/bin/env node
// Encrypt an ingredient CSV for the built-in library (read by index.html and streamlit/app.py).
// Usage: node tools/encrypt_ingredients.js <ingredients.csv> [assets/data/ingredients.enc.json]
// The passphrase is read from YAOYI_KEY or asked for interactively; it is never written to disk.
const crypto = require('crypto'), fs = require('fs'), readline = require('readline');
const [src, out = 'assets/data/ingredients.enc.json'] = process.argv.slice(2);
if (!src) { console.error('usage: node tools/encrypt_ingredients.js <ingredients.csv> [out.json]'); process.exit(1); }
function ask(q) {
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.startsWith(q)) rl.output.write(s); };
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}
(async () => {
  let pass = process.env.YAOYI_KEY;
  if (!pass) {
    pass = await ask('Passphrase: ');
    if (pass !== await ask('Repeat: ')) { console.error('Passphrases differ.'); process.exit(1); }
  }
  pass = pass.trim().normalize('NFC');
  if (pass.length < 12) console.warn('Note: a short passphrase can be guessed offline; 16+ characters is safer.');
  const data = fs.readFileSync(src), salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 310000;
  const key = crypto.pbkdf2Sync(pass, salt, iter, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  fs.writeFileSync(out, JSON.stringify({ v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') }));
  console.log(`Encrypted ${data.length} bytes → ${out}`);
})();
