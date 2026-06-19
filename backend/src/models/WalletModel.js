import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

/**
 * WalletModel — linear capability budgets (PRD-091 Layer 3).
 *
 * A wallet has an immutable identity, a balance, and (optionally) a parent.
 * Atomic UPDATE guards in `consume` and `transfer` prevent over-spending or
 * duplication, regardless of how many handles a caller holds.
 */
class WalletModel {
  static create({ userId, ownerType, ownerId, parentId, kind, balance, periodStart, periodEnd }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO wallets (id, user_id, owner_type, owner_id, parent_id, kind, balance, allocated, consumed, period_start, period_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          id,
          userId,
          ownerType,
          ownerId || null,
          parentId || null,
          kind || 'tokens',
          Number(balance) || 0,
          Number(balance) || 0,
          periodStart ? new Date(periodStart).toISOString() : null,
          periodEnd ? new Date(periodEnd).toISOString() : null,
        ],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static findOne(id) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM wallets WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  static findActiveByOwner(ownerType, ownerId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM wallets WHERE owner_type = ? AND owner_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
        [ownerType, ownerId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  static findChildren(parentId) {
    return new Promise((resolve, reject) => {
      db.all('SELECT * FROM wallets WHERE parent_id = ?', [parentId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  static findByUserId(userId, { ownerType, status } = {}) {
    let q = 'SELECT * FROM wallets WHERE user_id = ?';
    const params = [userId];
    if (ownerType) { q += ' AND owner_type = ?'; params.push(ownerType); }
    if (status) { q += ' AND status = ?'; params.push(status); }
    q += ' ORDER BY created_at DESC LIMIT 500';
    return new Promise((resolve, reject) => {
      db.all(q, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Atomically debit `amount` from `walletId`. Returns the wallet row on
   * success, or null if there was insufficient balance / wallet missing /
   * status not active.
   */
  static consume(walletId, amount) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      return Promise.reject(new Error(`Invalid consume amount: ${amount}`));
    }
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE wallets
            SET balance = balance - ?,
                consumed = consumed + ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
            AND status = 'active'
            AND balance >= ?`,
        [amt, amt, walletId, amt],
        function (err) {
          if (err) return reject(err);
          if (this.changes === 0) return resolve(null);
          db.get('SELECT * FROM wallets WHERE id = ?', [walletId], (gerr, row) => {
            if (gerr) reject(gerr);
            else resolve(row);
          });
        }
      );
    });
  }

  /**
   * Atomically move `amount` from parent to child. Both must exist; parent
   * must have balance. Implemented as two UPDATEs inside a transaction.
   */
  static transfer(parentId, childId, amount) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return Promise.reject(new Error(`Invalid transfer amount: ${amount}`));
    }
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN IMMEDIATE');
        db.run(
          `UPDATE wallets
              SET balance = balance - ?,
                  updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'active' AND balance >= ?`,
          [amt, parentId, amt],
          function (err) {
            if (err) { db.run('ROLLBACK'); return reject(err); }
            if (this.changes === 0) { db.run('ROLLBACK'); return resolve(null); }
            db.run(
              `UPDATE wallets
                  SET balance = balance + ?,
                      allocated = allocated + ?,
                      updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND status = 'active'`,
              [amt, amt, childId],
              function (err2) {
                if (err2) { db.run('ROLLBACK'); return reject(err2); }
                if (this.changes === 0) { db.run('ROLLBACK'); return resolve(null); }
                db.run('COMMIT', (cErr) => {
                  if (cErr) return reject(cErr);
                  resolve({ ok: true, amount: amt });
                });
              }
            );
          }
        );
      });
    });
  }

  static topUp(walletId, amount) {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return Promise.reject(new Error(`Invalid top-up amount: ${amount}`));
    }
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE wallets
            SET balance = balance + ?,
                allocated = allocated + ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [amt, amt, walletId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static setStatus(walletId, status) {
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE wallets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, walletId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  static logLedger({ walletId, amount, op, sourceKind, sourceId, note }) {
    const id = generateUUID();
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO wallet_ledger (id, wallet_id, amount, op, source_kind, source_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, walletId, Number(amount) || 0, op, sourceKind || null, sourceId || null, note || null],
        function (err) {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  static ledgerFor(walletId, limit = 200) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM wallet_ledger WHERE wallet_id = ? ORDER BY created_at DESC LIMIT ?`,
        [walletId, limit],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  static delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run('DELETE FROM wallets WHERE id = ? AND user_id = ?', [id, userId], function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
    });
  }
}

export default WalletModel;
