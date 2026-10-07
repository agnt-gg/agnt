import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CALL_START = /dispatch\(\s*['"](?:aiProvider\/)?(setProvider|setProviderWithModelFetch)['"]\s*,/g;

function sourceFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '__guards__') files.push(...sourceFiles(full));
    } else if (/\.(js|vue)$/.test(entry.name) && !/\.(spec|test)\.js$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function payloadText(code, from) {
  let depth = 0;
  for (let i = from; i < code.length; i++) {
    const ch = code[i];
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      if (depth === 0) return code.slice(from, i);
      depth--;
    }
  }
  return code.slice(from);
}

const isLabelled = (payload) => /\bsource\b/.test(payload) || /\bpersist\s*:\s*false\b/.test(payload);

export function findDefaultAiWrites(code) {
  const writes = [];
  for (const match of code.matchAll(CALL_START)) {
    const payload = payloadText(code, match.index + match[0].length).trim();
    const line = code.slice(0, match.index).split('\n').length;
    writes.push({ action: match[1], line, payload, labelled: isLabelled(payload) });
  }
  return writes;
}

describe('every default-AI write names its source', () => {
  const allWrites = sourceFiles(FRONTEND_SRC).flatMap((file) =>
    findDefaultAiWrites(fs.readFileSync(file, 'utf8')).map((write) => ({
      ...write,
      file: path.relative(FRONTEND_SRC, file).replace(/\\/g, '/'),
    })),
  );

  it('sees the real call sites', () => {
    expect(allWrites.length).toBeGreaterThanOrEqual(10);
    expect(allWrites.some((write) => write.file.endsWith('composables/useAiProviderConnect.js'))).toBe(true);
  });

  it('no call site saves the default without a source', () => {
    const unlabelled = allWrites.filter((write) => !write.labelled).map((write) => `${write.file}:${write.line} ${write.payload}`);
    expect(unlabelled).toEqual([]);
  });

  describe('the detector itself', () => {
    it('flags a bare string payload', () => {
      const [write] = findDefaultAiWrites("store.dispatch('aiProvider/setProvider', 'Local');");
      expect(write.labelled).toBe(false);
    });

    it('flags a payload variable it cannot read', () => {
      const [write] = findDefaultAiWrites("store.dispatch('aiProvider/setProvider', storeName);");
      expect(write.labelled).toBe(false);
    });

    it('accepts an object with a source, including shorthand and multi-line', () => {
      const code = `
        store.dispatch('aiProvider/setProvider', { provider: x, source: 'chat-picker' });
        dispatch('setProvider', { provider: newProvider, source });
        store.dispatch('aiProvider/setProviderWithModelFetch', {
          provider: p,
          source: 'focused-settings',
        });`;
      expect(findDefaultAiWrites(code).map((write) => write.labelled)).toEqual([true, true, true]);
    });

    it('accepts a UI-only mirror that never persists', () => {
      const [write] = findDefaultAiWrites("store.dispatch('aiProvider/setProvider', { provider: cfg.provider, persist: false });");
      expect(write.labelled).toBe(true);
    });

    it('does not take a later call\'s source for an earlier bare one', () => {
      const code = "dispatch('aiProvider/setProvider', 'Local'); dispatch('aiProvider/setModel', { model: m, source: 'x' });";
      const [write] = findDefaultAiWrites(code);
      expect(write.payload).toBe("'Local'");
      expect(write.labelled).toBe(false);
    });
  });
});
