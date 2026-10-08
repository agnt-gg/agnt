import { describe, it, expect } from 'vitest';
import { isWorkflowOwner } from './workflowOwnership.js';

// Reported on a Business instance: every workflow said "This workflow is not
// shared." because records there belong to the workspace (`scope:…`), never to
// the person's account id that the token carries.
describe('isWorkflowOwner', () => {
  it('trusts the server verdict on a team instance', () => {
    expect(isWorkflowOwner({ user_id: 'scope:5a8e', is_owner: true }, 'add4b3d4')).toBe(true);
  });
  it('a server "not yours" stands even when the ids happen to match', () => {
    expect(isWorkflowOwner({ user_id: 'add4b3d4', is_owner: false }, 'add4b3d4')).toBe(false);
  });
  it('falls back to comparing ids for a backend without is_owner', () => {
    expect(isWorkflowOwner({ user_id: 'add4b3d4' }, 'add4b3d4')).toBe(true);
    expect(isWorkflowOwner({ user_id: 'someone-else' }, 'add4b3d4')).toBe(false);
    expect(isWorkflowOwner({ user_id: undefined }, undefined)).toBe(false);
  });
});
