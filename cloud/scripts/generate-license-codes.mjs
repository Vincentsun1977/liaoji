import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const count = Math.max(1, Number(args.count || 10));
const days = Math.max(1, Number(args.days || 30));
const maxRedemptions = Math.max(1, Number(args.maxRedemptions || 1));
const label = String(args.label || `Pro ${days} days`).replace(/'/g, "''");
const salt = String(args.salt || process.env.LICENSE_CODE_SALT || 'liaoji-local-license-salt');

const rows = Array.from({ length: count }, () => {
  const code = generateCode();
  const hash = hashLicenseCode(code, salt);
  return { code, hash };
});

console.log('会员码（只显示这一次，请保存好）：');
rows.forEach((row) => console.log(row.code));
console.log('');
console.log('Supabase SQL：');
console.log('insert into public.license_codes (code_hash, label, plan, status, duration_days, max_redemptions)');
console.log('values');
console.log(rows.map((row) => `  ('${row.hash}', '${label}', 'pro', 'active', ${days}, ${maxRedemptions})`).join(',\n') + '\n' + 'on conflict (code_hash) do nothing;');

function generateCode() {
  return [
    'LJ',
    'PRO',
    randomBlock(),
    randomBlock(),
    randomBlock(),
  ].join('-');
}

function randomBlock() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 4; i += 1) {
    value += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return value;
}

function hashLicenseCode(code, codeSalt) {
  return crypto
    .createHash('sha256')
    .update(`${codeSalt}:${normalizeLicenseCode(code)}`)
    .digest('hex');
}

function normalizeLicenseCode(code) {
  return String(code || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function parseArgs(values) {
  const parsed = {};
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[i + 1];
    parsed[key] = next && !next.startsWith('--') ? next : true;
    if (next && !next.startsWith('--')) i += 1;
  }
  return parsed;
}
