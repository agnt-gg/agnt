#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

for (const envPath of ['.env', 'backend/.env', '.env.local', 'backend/.env.local']) {
  dotenv.config({ path: path.resolve(envPath), override: false });
}

function parseArgs(argv) {
  const options = {
    email: 'local-test@agnt.local',
    name: 'Local Test User',
    expiresIn: '8h',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return next;
    };

    if (arg === '--email') options.email = readValue();
    else if (arg === '--name') options.name = readValue();
    else if (arg === '--user-id') options.userId = readValue();
    else if (arg === '--expires-in') options.expiresIn = readValue();
    else if (arg === '--secret') options.secret = readValue();
    else if (arg === '--out') options.out = readValue();
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return `Usage:
  npm run auth:test-token -- --email perf@local.test --name "Perf Tester" --out ~/.agnt-test-token

Options:
  --email EMAIL          Email claim. Default: local-test@agnt.local.
  --name NAME            Name claim. Default: Local Test User.
  --user-id ID           User id claim. Default: generated local-test UUID.
  --expires-in VALUE     JWT expiry accepted by jsonwebtoken. Default: 8h.
  --secret VALUE         JWT secret override. Defaults to JWT_SECRET from .env/backend/.env.
  --out FILE             Write only the raw token to a file.
  --json                 Print JSON instead of the raw token.
`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const secret = options.secret || process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is required. Set it in .env/backend/.env or pass --secret.');
  }

  const userId = options.userId || `local-test-${randomUUID()}`;
  const token = jwt.sign(
    {
      id: userId,
      userId,
      sub: userId,
      email: options.email,
      name: options.name,
      auth_type: 'local-test',
      iss: 'agnt-local-test',
      aud: 'agnt-local',
    },
    secret,
    { expiresIn: options.expiresIn },
  );

  if (options.out) {
    const outPath = path.resolve(options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${token}\n`, { mode: 0o600 });
  }

  if (options.json) {
    console.log(JSON.stringify({ token, user: { id: userId, email: options.email, name: options.name }, expiresIn: options.expiresIn }, null, 2));
  } else {
    console.log(token);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
