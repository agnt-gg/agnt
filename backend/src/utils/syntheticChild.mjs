// PR145 Stage C (STAGED COPY — not applied; requires exact-file approval)
// backend/src/utils/syntheticChild.mjs — explicit shared synthetic-store child
// contract (R08/R09/S7, F7-A/FV-3).
//
// WHAT THIS DOES:
//   • Parent side: buildSharedStoreDescriptor() snapshots THIS process's
//     admitted storage context into a plain descriptor. No env authority, no
//     public token: the descriptor is bookkeeping validated against the
//     child's OWN frozen admitted parent (same host tmpdir) plus a ppid lease.
//   • Child side: adoptSyntheticChildStore() runs BEFORE any application
//     import (via `node --import <this file>` when the descriptor env is
//     present): initializeTestStorage({sharedStore}) validates the lease and
//     allocates the child's own root, then admitTestRoot(sharedRoot) makes the
//     SHARED root the child's ACTIVE storage. Resolution follows the adopted
//     context (D1); nothing here reads env for storage selection.
//   • Preload guard: importing this module in a process WITHOUT the descriptor
//     env is a no-op, so the bridge can import buildSharedStoreDescriptor()
//     from the parent side of the same module.
//
// WHAT THIS DOES NOT DO:
//   • It does not confine hostile code; it is a coordination contract, not an
//     authority (D3). Enforced confinement remains Stage D.
//   • The parent-exit lease policy is declared in the descriptor and enforced
//     by testStorageContext.v3LeaseCheck on every context validation: once the
//     descriptor's parent pid is gone, the child's context refuses (STALE_LEASE).
import { initializeTestStorage, admitTestRoot, getStorageContext } from './testStorageContext.js';

export const CHILD_STORE_ENV = 'AGNT_SYNTHETIC_CHILD_STORE';

/** Parent side: snapshot this process's admitted context as a share descriptor. */
export function buildSharedStoreDescriptor() {
  const ctx = getStorageContext(); // validates the parent's own admission first
  return {
    root: ctx.root,
    parentPid: process.pid,
    runId: ctx.runId,
    generation: ctx.generation,
    policy: 'parent-exit',
  };
}

/** Parent side: env additions for a test-mode fork child (explicit, additive). */
export function sharedStoreChildEnv() {
  return { [CHILD_STORE_ENV]: JSON.stringify(buildSharedStoreDescriptor()) };
}

/** Child side: adopt the descriptor as this child's storage (explicit APIs only). */
export function adoptSyntheticChildStore() {
  const raw = process.env[CHILD_STORE_ENV];
  if (!raw) return null;
  delete process.env[CHILD_STORE_ENV]; // single-use: never re-adopted
  let d;
  try { d = JSON.parse(raw); } catch { throw new Error('[syntheticChild] malformed shared-store descriptor'); }
  // initializeTestStorage validates the descriptor root against THIS child's
  // frozen admitted parent (RV-4) and the ppid lease BEFORE any allocation
  // (RV-3); it allocates the child's own root and records the descriptor.
  const ctx = initializeTestStorage({ sharedStore: d });
  // The child's ACTIVE storage is the SHARED root itself — the explicit
  // override API, never an env var. The child's freshly allocated root stays
  // recorded in admittedRoots as its private fallback bookkeeping.
  admitTestRoot(ctx.sharedStore.root);
  return getStorageContext();
}

// Preload entry: `node --import syntheticChild.mjs child.js` runs this before
// the child's main module, so no application import can race the adoption.
if (process.env[CHILD_STORE_ENV]) adoptSyntheticChildStore();
