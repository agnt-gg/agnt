import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory fake of WalletModel so we exercise WalletService logic without SQLite.
// Models a single-process wallet ledger that mirrors the real semantics:
//   - balance is updated via atomic consume(walletId, amount) that returns null on insufficient
//   - transfer is an atomic move between two wallets that returns null on insufficient
const wallets = new Map();
const ledger = [];
let nextId = 1;

const fakeModel = {
  async create({ userId, ownerType, ownerId, parentId = null, kind = 'tokens', balance = 0 }) {
    const id = `w${nextId++}`;
    wallets.set(id, {
      id, user_id: userId, owner_type: ownerType, owner_id: ownerId,
      parent_id: parentId, kind, balance, status: 'active',
    });
    return id;
  },
  async findOne(id) {
    const w = wallets.get(id);
    return w ? { ...w } : null;
  },
  async findActiveByOwner(ownerType, ownerId) {
    for (const w of wallets.values()) {
      if (w.owner_type === ownerType && w.owner_id === ownerId && w.status === 'active') {
        return { ...w };
      }
    }
    return null;
  },
  async setStatus(id, status) {
    const w = wallets.get(id);
    if (w) w.status = status;
  },
  async topUp(id, amount) {
    const w = wallets.get(id);
    if (!w) return null;
    w.balance += Number(amount) || 0;
    return { ...w };
  },
  // Atomic debit: returns updated row, OR null if insufficient / closed.
  async consume(id, amount) {
    const w = wallets.get(id);
    if (!w || w.status !== 'active') return null;
    const amt = Number(amount) || 0;
    if (w.balance < amt) return null;
    w.balance -= amt;
    return { ...w };
  },
  // Atomic transfer: src must have balance, both must be active.
  async transfer(srcId, dstId, amount) {
    const src = wallets.get(srcId);
    const dst = wallets.get(dstId);
    if (!src || !dst) return null;
    const amt = Number(amount) || 0;
    if (src.balance < amt) return null;
    src.balance -= amt;
    dst.balance += amt;
    return true;
  },
  async logLedger(entry) {
    ledger.push({ ...entry });
  },
};

vi.mock('../../models/WalletModel.js', () => ({ default: fakeModel }));

const WalletService = (await import('./WalletService.js')).default;

beforeEach(() => {
  wallets.clear();
  ledger.length = 0;
  nextId = 1;
});

describe('getOrCreateRoot', () => {
  it('creates root wallet on first call', async () => {
    const w = await WalletService.getOrCreateRoot('u1');
    expect(w).toBeTruthy();
    expect(w.owner_type).toBe('user');
    expect(w.parent_id).toBeNull();
    expect(w.balance).toBe(0);
  });

  it('returns existing root on second call (idempotent)', async () => {
    const w1 = await WalletService.getOrCreateRoot('u1');
    const w2 = await WalletService.getOrCreateRoot('u1');
    expect(w2.id).toBe(w1.id);
    expect(wallets.size).toBe(1);
  });

  it('seeds initial balance and logs a topup', async () => {
    const w = await WalletService.getOrCreateRoot('u1', { initialBalance: 1000 });
    expect(w.balance).toBe(1000);
    expect(ledger.find((l) => l.op === 'topup')).toBeTruthy();
  });
});

describe('allocate — sub-wallet derivation', () => {
  it('moves funds from parent to child atomically', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 500 });
    const child = await WalletService.allocate(root.id, {
      ownerType: 'agent', ownerId: 'a1', amount: 100,
    });
    expect(child.balance).toBe(100);
    expect((await fakeModel.findOne(root.id)).balance).toBe(400);
  });

  it('throws on insufficient parent balance + closes the empty child', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 50 });
    await expect(
      WalletService.allocate(root.id, { ownerType: 'agent', ownerId: 'a1', amount: 100 })
    ).rejects.toThrow(/Insufficient/);
    // Empty child should have been marked closed (no orphan active children)
    const closed = [...wallets.values()].find((w) => w.owner_id === 'a1');
    expect(closed?.status).toBe('closed');
  });

  it('rejects allocation from non-existent parent', async () => {
    await expect(
      WalletService.allocate('nope', { ownerType: 'agent', ownerId: 'a1', amount: 10 })
    ).rejects.toThrow(/not found/);
  });

  it('rejects allocation from closed parent', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 100 });
    await fakeModel.setStatus(root.id, 'closed');
    await expect(
      WalletService.allocate(root.id, { ownerType: 'agent', ownerId: 'a1', amount: 10 })
    ).rejects.toThrow(/not active/);
  });

  it('zero-amount allocation creates child without transfer', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 100 });
    const child = await WalletService.allocate(root.id, {
      ownerType: 'agent', ownerId: 'a1', amount: 0,
    });
    expect(child.balance).toBe(0);
    expect((await fakeModel.findOne(root.id)).balance).toBe(100); // untouched
  });
});

describe('consume — atomic debit with insufficient-balance guard', () => {
  it('debits when balance is sufficient', async () => {
    const w = await WalletService.getOrCreateRoot('u1', { initialBalance: 100 });
    const r = await WalletService.consume(w.id, 30);
    expect(r.balance).toBe(70);
  });

  it('returns null (NOT a partial debit) when insufficient', async () => {
    const w = await WalletService.getOrCreateRoot('u1', { initialBalance: 5 });
    const r = await WalletService.consume(w.id, 100);
    expect(r).toBeNull();
    expect((await fakeModel.findOne(w.id)).balance).toBe(5); // unchanged
  });

  it('logs ledger entry on success', async () => {
    const w = await WalletService.getOrCreateRoot('u1', { initialBalance: 100 });
    await WalletService.consume(w.id, 30, { sourceKind: 'tool', sourceId: 'web-search' });
    const entry = ledger.find((l) => l.op === 'consume');
    expect(entry).toBeTruthy();
    expect(entry.amount).toBe(-30);
    expect(entry.sourceKind).toBe('tool');
  });

  it('does NOT log ledger entry on failure', async () => {
    const w = await WalletService.getOrCreateRoot('u1', { initialBalance: 5 });
    const consumeEntriesBefore = ledger.filter((l) => l.op === 'consume').length;
    await WalletService.consume(w.id, 100);
    const consumeEntriesAfter = ledger.filter((l) => l.op === 'consume').length;
    expect(consumeEntriesAfter).toBe(consumeEntriesBefore);
  });
});

describe('release — sweep child balance back to parent + close', () => {
  it('sweeps remaining balance back to parent', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 1000 });
    const child = await WalletService.allocate(root.id, { ownerType: 'agent', ownerId: 'a1', amount: 500 });
    await WalletService.consume(child.id, 100);
    expect((await fakeModel.findOne(child.id)).balance).toBe(400);

    await WalletService.release(child.id);
    expect((await fakeModel.findOne(child.id)).balance).toBe(0);
    expect((await fakeModel.findOne(child.id)).status).toBe('closed');
    expect((await fakeModel.findOne(root.id)).balance).toBe(900); // 1000 - 500 + (500 - 100)
  });

  it('is idempotent — second release is a no-op', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 100 });
    const child = await WalletService.allocate(root.id, { ownerType: 'agent', ownerId: 'a1', amount: 50 });
    await WalletService.release(child.id);
    const balanceAfterFirst = (await fakeModel.findOne(root.id)).balance;
    await WalletService.release(child.id);
    const balanceAfterSecond = (await fakeModel.findOne(root.id)).balance;
    expect(balanceAfterSecond).toBe(balanceAfterFirst);
  });

  it('returns null for unknown wallet', async () => {
    expect(await WalletService.release('nope')).toBeNull();
  });
});

describe('topUp + balance', () => {
  it('topUp increases balance and logs', async () => {
    const w = await WalletService.getOrCreateRoot('u1', { initialBalance: 0 });
    await WalletService.topUp(w.id, 50);
    expect(await WalletService.balance(w.id)).toBe(50);
    expect(ledger.filter((l) => l.op === 'topup').length).toBeGreaterThan(0);
  });
  it('balance returns 0 for unknown wallet', async () => {
    expect(await WalletService.balance('nope')).toBe(0);
  });
});

describe('spendForOwner — high-level "can the agent spend this" check', () => {
  it('spends from the agent wallet when one exists', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 200 });
    const agent = await WalletService.allocate(root.id, { ownerType: 'agent', ownerId: 'a1', amount: 100 });
    const r = await WalletService.spendForOwner({
      userId: 'u1', ownerType: 'agent', ownerId: 'a1', amount: 30,
    });
    expect(r.ok).toBe(true);
    expect(r.walletId).toBe(agent.id);
    expect(r.balance).toBe(70);
  });

  it('falls back to root wallet when no per-owner wallet exists', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 200 });
    const r = await WalletService.spendForOwner({
      userId: 'u1', ownerType: 'agent', ownerId: 'a-no-wallet', amount: 30,
    });
    expect(r.ok).toBe(true);
    expect(r.walletId).toBe(root.id);
    expect((await fakeModel.findOne(root.id)).balance).toBe(170);
  });

  it('refuses spend when budget exhausted', async () => {
    await WalletService.getOrCreateRoot('u1', { initialBalance: 10 });
    const r = await WalletService.spendForOwner({
      userId: 'u1', ownerType: 'agent', ownerId: 'a1', amount: 50,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('budget_exhausted');
  });

  it('zero-amount spend is a no-op success', async () => {
    const r = await WalletService.spendForOwner({
      userId: 'u1', ownerType: 'agent', ownerId: 'a1', amount: 0,
    });
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(true);
  });
});

describe('invariants — funds cannot be duplicated', () => {
  it('total of (root + all children) is conserved across allocate + consume + release', async () => {
    const root = await WalletService.getOrCreateRoot('u1', { initialBalance: 1000 });

    // Allocate two sub-wallets, consume some from each.
    const a = await WalletService.allocate(root.id, { ownerType: 'agent', ownerId: 'a', amount: 300 });
    const b = await WalletService.allocate(root.id, { ownerType: 'agent', ownerId: 'b', amount: 200 });
    await WalletService.consume(a.id, 50);
    await WalletService.consume(b.id, 100);

    const total = () =>
      [...wallets.values()].reduce((acc, w) => acc + (w.status === 'active' ? w.balance : 0), 0);

    // Spent 50 + 100 = 150. Total active funds should be 850.
    expect(total()).toBe(850);

    // Release returns child balance to parent — no creation/destruction.
    await WalletService.release(a.id);
    await WalletService.release(b.id);
    // Root absorbs a's remaining 250 + b's remaining 100 = root back to 1000 - 150 = 850.
    expect(total()).toBe(850);
    expect((await fakeModel.findOne(root.id)).balance).toBe(850);
  });

  it('consume cannot drive balance negative under concurrent-style calls', async () => {
    // Simulate two concurrent consume calls against a wallet with 5 balance.
    // The fake model is synchronous, so the first call wins, second returns null.
    const w = await WalletService.getOrCreateRoot('u1', { initialBalance: 5 });
    const results = await Promise.all([
      WalletService.consume(w.id, 5),
      WalletService.consume(w.id, 5),
    ]);
    const successes = results.filter(Boolean);
    expect(successes.length).toBe(1);
    expect((await fakeModel.findOne(w.id)).balance).toBe(0);
  });
});
