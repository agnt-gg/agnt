import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEAM_ASSET_APIS, PRIVATE_IN_TEAM_APIS } from './ScopeApiPolicy.js';

// The browser decides which requests carry a team header; the server decides what a team header
// means. If the two lists drift, a shared API silently turns personal (or a private one pooled).
it('the browser tags exactly the APIs the server shares with the team', () => {
  const source = readFileSync(fileURLToPath(new URL('../../../../frontend/src/utils/teamScopeTransport.js', import.meta.url)), 'utf8');
  const browser = new Set(JSON.parse(source.match(/const assetApis=new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"')));
  expect([...browser].sort()).toEqual([...TEAM_ASSET_APIS].sort());
});

it('chats, chat folders and memory are never pooled under the team', () => {
  for (const api of ['content-outputs', 'conversations', 'memory', 'groups']) {
    expect(PRIVATE_IN_TEAM_APIS.has(api)).toBe(true);
    expect(TEAM_ASSET_APIS.has(api)).toBe(false);
  }
});
