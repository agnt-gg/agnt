import { describe, it, expect } from 'vitest';
import {
  CONNECTOR_CATALOG,
  isConnectorOnlyProvider,
  mergeConnectorCatalog,
} from './connectorCatalog.js';
// The backend copy, imported rather than read as text. Comparing objects
// catches drift that substring matching cannot: a changed array member, a
// renamed field, or an apostrophe that survived one file's encoding and not
// the other's.
import { CONNECTOR_CATALOG as BACKEND_CATALOG } from '../../../../backend/src/services/auth/connectorCatalog.js';

/**
 * Fields the backend row carries that the client has no use for: `key` is
 * AuthDispatcher's lookup id and `authScheme` selects the auth manager.
 * Anything else appearing on one side only is drift, not design.
 */
const BACKEND_ONLY = ['authScheme', 'key'];

describe('connector catalog', () => {
  it('lists TypeSafe as an API-key connector, not a chat model', () => {
    expect(CONNECTOR_CATALOG.map((p) => p.id)).toContain('typesafe');
    const row = CONNECTOR_CATALOG.find((p) => p.id === 'typesafe');
    expect(row.connectionType).toBe('apikey');
    expect(row.connectorOnly).toBe(true);
    expect(row.icon).toBe('api');
  });

  it('merges TypeSafe into an already-populated remote catalogue', () => {
    const merged = mergeConnectorCatalog([{ id: 'google', name: 'Google' }]);
    expect(merged.map((p) => p.id)).toEqual(['google', 'typesafe']);
  });

  it('does not duplicate TypeSafe when the remote list already has it', () => {
    const merged = mergeConnectorCatalog([{ id: 'typesafe', name: 'Remote TypeSafe' }]);
    expect(merged.filter((p) => p.id === 'typesafe')).toHaveLength(1);
    expect(merged[0].name).toBe('Remote TypeSafe');
  });

  it('recognises catalog ids as connector-only', () => {
    expect(isConnectorOnlyProvider('TYPESAFE')).toBe(true);
    expect(isConnectorOnlyProvider('openai')).toBe(false);
  });

});

// This list lives in two files. Until it is shared the way @llm shares the
// provider descriptor, these are the guard. The earlier version asserted only
// that `id` and `connectionType` appeared SOMEWHERE in the backend source,
// which left name, icon, categories, instructions and connectorOnly free to
// drift silently — and would have passed even if the backend had listed them
// against a different provider.
describe('the two copies of the catalogue cannot drift', () => {
  it('describes the same providers, in the same order', () => {
    expect(CONNECTOR_CATALOG.map((r) => r.id)).toEqual(BACKEND_CATALOG.map((r) => r.id));
  });

  it('agrees on every shared field, not just id and connectionType', () => {
    for (const fe of CONNECTOR_CATALOG) {
      const be = BACKEND_CATALOG.find((r) => r.id === fe.id);
      expect(be, `${fe.id} missing from the backend catalogue`).toBeTruthy();
      for (const field of Object.keys(fe)) {
        expect(be[field], `${fe.id}.${field} drifted between the two copies`).toEqual(fe[field]);
      }
    }
  });

  it('notices a field added to one copy only', () => {
    // Derived from the rows themselves rather than a hardcoded field list, so
    // a field added later is covered without anyone remembering this test.
    for (const fe of CONNECTOR_CATALOG) {
      const be = BACKEND_CATALOG.find((r) => r.id === fe.id);
      const backendExtras = Object.keys(be).filter((k) => !(k in fe)).sort();
      expect(backendExtras, `${fe.id}: backend-only fields changed`).toEqual(BACKEND_ONLY);
    }
  });

  it('keeps the backend-only fields the auth layer actually reads', () => {
    for (const be of BACKEND_CATALOG) {
      expect(be.key, 'AuthDispatcher looks the row up by key').toBe(be.id);
      expect(be.authScheme, 'an unknown scheme makes getAuthEntry return null').toBe('api-key');
    }
  });
});
