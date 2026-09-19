// Source integrity maintenance only. Does not build, sign, launch or change policy.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== '--write')) throw new Error('Use no argument to check, or --write to update the source pin.');
const directory = path.resolve(__dirname, '../src/main/input-devices');
const source = fs.readFileSync(path.join(directory, 'usb-native.cs'));
if (source.length < 1 || source.length > 65536 || !Buffer.from(source.toString('utf8'), 'utf8').equals(source)) throw new Error('Native input source must be bounded UTF-8.');
const sha256 = crypto.createHash('sha256').update(source).digest('hex');
const serviceFile = path.join(directory, 'index.cjs'), service = fs.readFileSync(serviceFile, 'utf8');
const pattern = /const NATIVE_INPUT_SOURCE_SHA256 = '([a-f0-9]{64})';/g;
const matches = [...service.matchAll(pattern)];
if (matches.length !== 1) throw new Error('Expected exactly one native input source pin.');
if (matches[0][1] !== sha256) {
  if (!args.length) throw new Error('Native input source pin differs. Review the source change, then run with --write.');
  fs.writeFileSync(serviceFile, service.replace(pattern, `const NATIVE_INPUT_SOURCE_SHA256 = '${sha256}';`));
}
console.log(JSON.stringify({ status: 'PASS', sha256, bytes: source.length, updated: matches[0][1] !== sha256 }));
