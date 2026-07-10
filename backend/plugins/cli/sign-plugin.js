#!/usr/bin/env node

/**
 * sign-plugin — trust system Layer 4 (W2): Ed25519 publisher signing.
 *
 * Key custody (the one-way-door decisions, locked):
 *   - Ed25519 via Node's built-in crypto (no dependencies)
 *   - private key lives ONLY at %USER_DATA%/AGNT/publisher-key.json
 *     (or --key <path>); it is NEVER uploaded anywhere
 *   - public key registers with the marketplace as base64 raw 32 bytes:
 *     POST https://api.agnt.gg/marketplace/keys { publicKey, name }
 *   - signature is a detached Ed25519 signature over the EXACT .agnt bytes,
 *     base64-encoded, carried in the publish payload
 *
 * Usage:
 *   node cli/sign-plugin.js --keygen [--key <path>]      generate a keypair
 *   node cli/sign-plugin.js <file.agnt> [--key <path>]   sign a package
 *   node cli/sign-plugin.js --verify <file.agnt> <sig-b64> <pubkey-b64>
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function defaultKeyPath() {
  const base =
    process.env.USER_DATA_PATH ||
    (process.platform === 'win32'
      ? path.join(process.env.APPDATA || os.homedir(), 'AGNT')
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Library', 'Application Support', 'AGNT')
        : path.join(os.homedir(), '.config', 'AGNT'));
  return path.join(base, 'publisher-key.json');
}

export function generateKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(ED25519_SPKI_PREFIX.length);
  const rawPriv = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(ED25519_PKCS8_PREFIX.length);
  return { publicKey: rawPub.toString('base64'), privateKey: rawPriv.toString('base64') };
}

export function signBuffer(buffer, privateKeyB64) {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(privateKeyB64, 'base64')]),
    format: 'der',
    type: 'pkcs8',
  });
  return crypto.sign(null, buffer, privateKey).toString('base64');
}

export function verifyBuffer(buffer, signatureB64, publicKeyB64) {
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyB64, 'base64')]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, buffer, publicKey, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export function loadOrExplainKey(keyPath) {
  if (!fs.existsSync(keyPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(keyPath, 'utf8'));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const args = process.argv.slice(2);
  const keyFlagIdx = args.indexOf('--key');
  const keyPath = keyFlagIdx >= 0 ? path.resolve(args[keyFlagIdx + 1]) : defaultKeyPath();

  if (args.includes('--keygen')) {
    if (fs.existsSync(keyPath)) {
      console.error(`❌ Key already exists at ${keyPath} — refusing to overwrite. Move it aside first.`);
      process.exit(1);
    }
    const pair = generateKeypair();
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, JSON.stringify({ ...pair, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    console.log(`✅ Keypair generated → ${keyPath}`);
    console.log(`\n📤 Register the PUBLIC key with the marketplace (private key never leaves this machine):`);
    console.log(`   POST https://api.agnt.gg/marketplace/keys`);
    console.log(`   { "publicKey": "${pair.publicKey}", "name": "default" }`);
    process.exit(0);
  }

  if (args[0] === '--verify') {
    const [, file, sig, pub] = args;
    const ok = verifyBuffer(fs.readFileSync(file), sig, pub);
    console.log(ok ? '✅ Signature VALID' : '❌ Signature INVALID');
    process.exit(ok ? 0 : 1);
  }

  const file = args.find((a) => !a.startsWith('--') && a !== args[keyFlagIdx + 1]);
  if (!file) {
    console.error('Usage: node cli/sign-plugin.js --keygen | <file.agnt> [--key <path>] | --verify <file> <sig> <pub>');
    process.exit(1);
  }
  const key = loadOrExplainKey(keyPath);
  if (!key) {
    console.error(`❌ No key at ${keyPath}. Run: node cli/sign-plugin.js --keygen`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(path.resolve(file));
  const signature = signBuffer(buffer, key.privateKey);
  console.log(`✅ Signed ${path.basename(file)} (${buffer.length} bytes)`);
  console.log(`\nsignature:      ${signature}`);
  console.log(`publicKey:      ${key.publicKey}`);
  console.log(`\nInclude in the publish payload's asset_data: { "signature": "<signature>", "publisherKeyId": "<your registered key id>" }`);
}
