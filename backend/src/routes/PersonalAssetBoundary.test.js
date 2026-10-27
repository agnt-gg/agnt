import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPersonalAssetBoundary } from './PersonalAssetBoundary.js';

// Reported 2026-10-27 on bravo: the workflow chat answered "Chat service stream
// chat 404: Resource not found". A team instance's workflows are team-owned;
// the chat request (personal by design) names the open workflow in its body,
// carries no team header, and was refused as an unscoped team-row operation.
const ROWS = {
  'workflows:wf-team': { id: 'wf-team', scope_id: 'scope-ws' },
  'workflows:wf-mine': { id: 'wf-mine', user_id: 'amber' },
  'workflows:wf-other': { id: 'wf-other', user_id: 'john' },
  'ownership_scopes:scope-ws': { id: 'scope-ws', kind: 'workspace', team_id: 'team-genii' },
};
const repository = { get: vi.fn(async (sql, [id]) => ROWS[`${/FROM "?(\w+)"?/.exec(sql)[1]}:${id}`] || null) };
const asAmber = (req, _res, next) => { req.user = { id: 'amber' }; next(); };
const run = (boundary, req) => new Promise((resolve) => {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ next: false, status: this.statusCode, body }); } };
  boundary(req, res, () => resolve({ next: true }));
});
const request = (method, path, body = {}) => ({ method, path, body, headers: { authorization: 'Bearer amber-token' } });

describe('personal asset boundary on a hosted instance', () => {
  beforeEach(() => { vi.stubEnv('AGNT_TENANT_SLUG', 'genii'); repository.get.mockClear(); });
  afterEach(() => vi.unstubAllEnvs());

  it('a chat opened from a team workflow is allowed for a member of that team, as a view of its workspace', async () => {
    const teamPolicy = vi.fn(async () => {});
    const boundary = createPersonalAssetBoundary(asAmber, { repository, teamPolicy });
    expect(await run(boundary, request('POST', '/orchestrator/chat', { workflowId: 'wf-team' }))).toEqual({ next: true });
    expect(teamPolicy).toHaveBeenCalledWith({ actorId: 'amber', authorization: 'Bearer amber-token', scopeId: 'scope-ws' }, 'view', ROWS['ownership_scopes:scope-ws']);
  });

  it('someone the control plane does not admit to that team still gets 404', async () => {
    const teamPolicy = vi.fn(async () => { throw Object.assign(new Error('not a member'), { status: 403 }); });
    const boundary = createPersonalAssetBoundary(asAmber, { repository, teamPolicy });
    expect(await run(boundary, request('POST', '/orchestrator/chat', { workflowId: 'wf-team' }))).toMatchObject({ next: false, status: 404 });
  });

  it('an operation on a team row through an asset API without the team header is still refused', async () => {
    const teamPolicy = vi.fn(async () => {});
    const boundary = createPersonalAssetBoundary(asAmber, { repository, teamPolicy });
    expect(await run(boundary, request('PUT', '/workflows/wf-team', {}))).toMatchObject({ next: false, status: 404 });
    expect(teamPolicy).not.toHaveBeenCalled();
  });

  it('page context naming someone else\'s personal workflow is refused; your own passes', async () => {
    const boundary = createPersonalAssetBoundary(asAmber, { repository, teamPolicy: vi.fn() });
    expect(await run(boundary, request('POST', '/orchestrator/chat', { workflowId: 'wf-other' }))).toMatchObject({ next: false, status: 404 });
    expect(await run(boundary, request('POST', '/orchestrator/chat', { workflowId: 'wf-mine' }))).toEqual({ next: true });
  });

  it('a desktop install, or a request already scoped to its team, is not inspected', async () => {
    const boundary = createPersonalAssetBoundary(asAmber, { repository, teamPolicy: vi.fn() });
    expect(await run(boundary, { ...request('POST', '/orchestrator/chat', { workflowId: 'wf-team' }), headers: { 'x-agnt-team-id': 'team-genii' } })).toEqual({ next: true });
    vi.stubEnv('AGNT_TENANT_SLUG', '');
    expect(await run(boundary, request('PUT', '/workflows/wf-team'))).toEqual({ next: true });
    expect(repository.get).not.toHaveBeenCalled();
  });
});
