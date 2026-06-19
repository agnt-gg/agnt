import WalletModel from '../../models/WalletModel.js';

/**
 * WalletService — high-level capability budget primitive (PRD-091 Layer 3).
 *
 * Wraps WalletModel with the linear-type-style API:
 *   - allocate(parent, amount)  — derives a child wallet
 *   - consume(wallet, amount)   — atomic debit; fails if insufficient
 *   - transferTo(child, amount) — move from parent to child
 *   - release(wallet)           — mark closed, sweep balance back to parent
 *
 * A wallet is identified by id only; balance lives in the DB. Two handles to
 * the same wallet cannot "clone" funds because every debit goes through an
 * atomic UPDATE with a `balance >= amount` guard.
 */

const DEFAULT_KIND = 'tokens';

class WalletService {
  /**
   * Get-or-create the user's root wallet (parent_id NULL).
   * Defaults to 0 balance — callers top up explicitly.
   */
  static async getOrCreateRoot(userId, { kind = DEFAULT_KIND, initialBalance = 0 } = {}) {
    const existing = await WalletModel.findActiveByOwner('user', userId);
    if (existing) return existing;
    const id = await WalletModel.create({
      userId,
      ownerType: 'user',
      ownerId: userId,
      kind,
      balance: initialBalance,
    });
    if (initialBalance > 0) {
      await WalletModel.logLedger({ walletId: id, amount: initialBalance, op: 'topup', note: 'root_init' });
    }
    return WalletModel.findOne(id);
  }

  /**
   * Allocate a child wallet from a parent. Amount is transferred atomically.
   * Returns the child wallet row or throws if insufficient parent balance.
   */
  static async allocate(parentWalletId, { ownerType, ownerId, amount, kind = DEFAULT_KIND }) {
    const parent = await WalletModel.findOne(parentWalletId);
    if (!parent) throw new Error(`Parent wallet not found: ${parentWalletId}`);
    if (parent.status !== 'active') throw new Error(`Parent wallet not active: ${parentWalletId}`);
    const amt = Number(amount) || 0;

    const childId = await WalletModel.create({
      userId: parent.user_id,
      ownerType,
      ownerId,
      parentId: parentWalletId,
      kind,
      balance: 0,
    });

    if (amt > 0) {
      const tx = await WalletModel.transfer(parentWalletId, childId, amt);
      if (!tx) {
        // Parent didn't have it — close the empty child and signal failure.
        await WalletModel.setStatus(childId, 'closed');
        throw new Error(`Insufficient balance in parent wallet ${parentWalletId} (wanted ${amt})`);
      }
      await WalletModel.logLedger({ walletId: parentWalletId, amount: -amt, op: 'allocate_out', sourceKind: 'wallet', sourceId: childId });
      await WalletModel.logLedger({ walletId: childId, amount: amt, op: 'allocate_in', sourceKind: 'wallet', sourceId: parentWalletId });
    }

    return WalletModel.findOne(childId);
  }

  /**
   * Atomic debit. Returns the updated wallet row on success, or null if
   * insufficient balance / wallet inactive.
   */
  static async consume(walletId, amount, { sourceKind, sourceId, note } = {}) {
    const row = await WalletModel.consume(walletId, amount);
    if (!row) return null;
    await WalletModel.logLedger({ walletId, amount: -Number(amount), op: 'consume', sourceKind, sourceId, note });
    return row;
  }

  /**
   * Sweep child balance back to its parent and close the child.
   * Safe to call multiple times; second call is a no-op once status='closed'.
   */
  static async release(walletId) {
    const wallet = await WalletModel.findOne(walletId);
    if (!wallet) return null;
    if (wallet.status !== 'active') return wallet;
    if (wallet.parent_id && wallet.balance > 0) {
      const tx = await WalletModel.transfer(wallet.id, wallet.parent_id, wallet.balance);
      if (tx) {
        await WalletModel.logLedger({ walletId, amount: -wallet.balance, op: 'release_sweep', sourceKind: 'wallet', sourceId: wallet.parent_id });
        await WalletModel.logLedger({ walletId: wallet.parent_id, amount: wallet.balance, op: 'release_recv', sourceKind: 'wallet', sourceId: walletId });
      }
    }
    await WalletModel.setStatus(walletId, 'closed');
    return WalletModel.findOne(walletId);
  }

  static async balance(walletId) {
    const row = await WalletModel.findOne(walletId);
    return row ? row.balance : 0;
  }

  static async topUp(walletId, amount, { sourceKind, sourceId, note } = {}) {
    await WalletModel.topUp(walletId, amount);
    await WalletModel.logLedger({ walletId, amount, op: 'topup', sourceKind, sourceId, note });
    return WalletModel.findOne(walletId);
  }

  /**
   * Spend against the active wallet for an owner. Convenience wrapper that
   * falls back to the user's root wallet when no per-owner wallet exists.
   * Returns { ok: true, walletId, balance } or { ok: false, reason }.
   */
  static async spendForOwner({ userId, ownerType, ownerId, amount, sourceKind, sourceId, note }) {
    const amt = Number(amount) || 0;
    if (amt <= 0) return { ok: true, walletId: null, balance: null, skipped: true };

    let wallet = (ownerType && ownerId)
      ? await WalletModel.findActiveByOwner(ownerType, ownerId)
      : null;
    if (!wallet) wallet = await this.getOrCreateRoot(userId);

    const updated = await this.consume(wallet.id, amt, { sourceKind, sourceId, note });
    if (!updated) {
      return { ok: false, walletId: wallet.id, reason: 'budget_exhausted', balance: wallet.balance };
    }
    return { ok: true, walletId: wallet.id, balance: updated.balance };
  }
}

export default WalletService;
