import { it, expect } from 'vitest';
import { runActorFor, runAuthorizationFor, isWorkspacePrincipal } from './runActor.js';
import { withScopeRequest } from './ScopeRequestContext.js';
import { withToolActor } from '../security/toolRunAuthority.js';

// The run of a teamspace item used to be judged as its storage principal, which resolves to the owner,
// so every teammate's run was treated as the owner's. These pin who a run acts as.
const WORKSPACE = 'scope:abc';

it('a person always acts as themselves', () => {
  expect(runActorFor('member-2')).toBe('member-2');
  withToolActor('someone-else', () => expect(runActorFor('member-2')).toBe('member-2'));
});

it('a teamspace run in a verified request acts as the person who made the request', () => {
  const req = {};
  withScopeRequest(req, { actorId: 'member-2', resourceOwnerId: WORKSPACE }, () => {
    expect(runActorFor(WORKSPACE)).toBe('member-2');
  });
});

it("a request for another workspace does not lend its person to this one", () => {
  withScopeRequest({}, { actorId: 'member-2', resourceOwnerId: 'scope:other' }, () => {
    expect(runActorFor(WORKSPACE)).toBe(WORKSPACE);
  });
});

it('a node or sub-workflow inside a run acts as that run (the enclosing tool actor)', () => {
  withToolActor('member-2', () => expect(runActorFor(WORKSPACE)).toBe('member-2'), 'Bearer agnt-tool.x');
  withToolActor('member-2', () => expect(runAuthorizationFor(null, 'member-2', WORKSPACE)).toBe('Bearer agnt-tool.x'), 'Bearer agnt-tool.x');
});

it('an explicit actor wins; nobody known leaves the workspace (the owner\'s own background work)', () => {
  expect(runActorFor(WORKSPACE, 'member-3')).toBe('member-3');
  expect(runActorFor(WORKSPACE)).toBe(WORKSPACE);
  expect(runAuthorizationFor('Bearer caller', 'member-2', WORKSPACE)).toBe('Bearer caller');
  expect([isWorkspacePrincipal(WORKSPACE), isWorkspacePrincipal('member-2'), isWorkspacePrincipal(null)]).toEqual([true, false, false]);
});
