import { describe, it, expect, beforeEach } from 'vitest';

function ensureLocalStorage() {
  if (typeof globalThis.localStorage?.getItem === 'function') return;
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
}
ensureLocalStorage();

const {
  parsePairingInput,
  rememberServerOrigin,
  getRememberedServerOrigin,
  clearRememberedServerOrigin,
  normalizeServerOrigin,
  setAutoOpenServer,
  getAutoOpenServer,
  applyPairingSession,
  listPairedServers,
  removePairedServer,
  hostLabel,
  SERVER_ORIGIN_KEY,
  SERVER_LIST_KEY,
} = await import('./mobileLitePairing.js');

const HERE = 'http://192.168.1.10:3333';

describe('parsePairingInput', () => {
  it('parses bare 32-hex code on current origin', () => {
    const code = 'a'.repeat(32);
    const r = parsePairingInput(code, HERE);
    expect(r).toMatchObject({
      kind: 'code',
      code,
      origin: HERE,
      navigateAway: false,
    });
    expect(r.litePairUrl).toBe(`${HERE}/m/pair?c=${code}`);
  });

  it('parses full web /pair URL and prefers /m/pair', () => {
    const code = 'b'.repeat(32);
    const r = parsePairingInput(`http://100.64.1.2:3333/pair?c=${code}`, HERE);
    expect(r).toMatchObject({
      kind: 'url',
      code,
      origin: 'http://100.64.1.2:3333',
      navigateAway: true,
      litePairUrl: `http://100.64.1.2:3333/m/pair?c=${code}`,
    });
  });

  it('parses lite /m/pair URL on same origin without navigateAway', () => {
    const code = 'c'.repeat(32);
    const r = parsePairingInput(`${HERE}/m/pair?c=${code}`, HERE);
    expect(r.navigateAway).toBe(false);
    expect(r.origin).toBe(HERE);
  });

  it('parses host without scheme as http', () => {
    const code = 'd'.repeat(32);
    const r = parsePairingInput(`my-mac.tailnet.ts.net:3333/pair?c=${code}`, HERE);
    expect(r.origin).toBe('http://my-mac.tailnet.ts.net:3333');
    expect(r.navigateAway).toBe(true);
  });

  it('parses bare origin /m for open-home', () => {
    const r = parsePairingInput('http://100.64.1.2:3333/m', HERE);
    expect(r).toMatchObject({
      kind: 'origin',
      origin: 'http://100.64.1.2:3333',
      liteHomeUrl: 'http://100.64.1.2:3333/m',
      navigateAway: true,
    });
  });

  it('treats host:port as server origin', () => {
    const r = parsePairingInput('100.64.1.2:3333', HERE);
    expect(r).toMatchObject({
      kind: 'origin',
      origin: 'http://100.64.1.2:3333',
      liteHomeUrl: 'http://100.64.1.2:3333/m',
    });
  });

  it('rejects garbage', () => {
    expect(parsePairingInput('nope', HERE)).toBeNull();
    expect(parsePairingInput('abcd', HERE)).toBeNull();
  });
});

describe('normalizeServerOrigin', () => {
  it('normalizes scheme-less host:port', () => {
    expect(normalizeServerOrigin('192.168.1.5:3333')).toBe('http://192.168.1.5:3333');
  });

  it('strips path to origin', () => {
    expect(normalizeServerOrigin('https://agnt.example:8443/m/chat')).toBe(
      'https://agnt.example:8443',
    );
  });

  it('rejects empty/garbage', () => {
    expect(normalizeServerOrigin('')).toBeNull();
    expect(normalizeServerOrigin('nope')).toBeNull();
  });
});

describe('rememberServerOrigin', () => {
  beforeEach(() => {
    ensureLocalStorage();
    clearRememberedServerOrigin();
    localStorage.removeItem(SERVER_LIST_KEY);
    setAutoOpenServer(false);
  });

  it('round-trips origin in localStorage', () => {
    rememberServerOrigin('http://100.1.2.3:3333');
    expect(getRememberedServerOrigin()).toBe('http://100.1.2.3:3333');
    expect(localStorage.getItem(SERVER_ORIGIN_KEY)).toBe('http://100.1.2.3:3333');
  });

  it('round-trips auto-open flag', () => {
    expect(getAutoOpenServer()).toBe(false);
    setAutoOpenServer(true);
    expect(getAutoOpenServer()).toBe(true);
    setAutoOpenServer(false);
    expect(getAutoOpenServer()).toBe(false);
  });
});

describe('listPairedServers', () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
  });

  it('upserts origins and sorts by lastUsed', () => {
    rememberServerOrigin('http://a.example:3333');
    rememberServerOrigin('http://b.example:3333');
    rememberServerOrigin('http://a.example:3333'); // bump a to top
    const list = listPairedServers();
    expect(list.map((s) => s.origin)).toEqual([
      'http://a.example:3333',
      'http://b.example:3333',
    ]);
    expect(list[0].label).toBe(hostLabel('http://a.example:3333'));
  });

  it('removePairedServer drops an entry and retargets last origin', () => {
    rememberServerOrigin('http://a.example:3333');
    rememberServerOrigin('http://b.example:3333');
    removePairedServer('http://b.example:3333');
    expect(listPairedServers().map((s) => s.origin)).toEqual(['http://a.example:3333']);
    expect(getRememberedServerOrigin()).toBe('http://a.example:3333');
    removePairedServer('http://a.example:3333');
    expect(listPairedServers()).toEqual([]);
    expect(getRememberedServerOrigin()).toBeNull();
  });
});

describe('applyPairingSession', () => {
  it('sets user from claim even when fetchUserData fails', async () => {
    const commits = [];
    const store = {
      state: { userAuth: { user: null } },
      commit: (type, payload) => {
        commits.push({ type, payload });
        if (type === 'userAuth/SET_USER') store.state.userAuth.user = payload;
        if (type === 'userAuth/SET_USER' && payload === null) store.state.userAuth.user = null;
      },
      dispatch: async () => {
        throw new Error('remote auth down');
      },
    };
    await applyPairingSession(store, {
      token: 'tok',
      user: { id: 'u1', email: 'a@b.c' },
    });
    expect(commits.some((c) => c.type === 'userAuth/SET_TOKEN' && c.payload === 'tok')).toBe(true);
    expect(store.state.userAuth.user?.email).toBe('a@b.c');
    expect(getAutoOpenServer()).toBe(true);
  });
});
