import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractEndpoints, getOverview } from './apiReference.js';

// bravo smoke test, Nov 2026: get_agnt_api's overview listed 0 endpoints for Team and Workspace File,
// though both sections exist. It only read "### Heading + **METHOD** `path`"; those sections use
// bare/bulleted lines and a table.
const DOCS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/_API-DOCUMENTATION.md'), 'utf8');
const section = (title) => {
  const start = DOCS.indexOf(`## ${title}\n`);
  const next = DOCS.indexOf('\n## ', start + 4);
  return DOCS.slice(start, next === -1 ? undefined : next);
};

describe('extractEndpoints reads every style the docs use', () => {
  it('a heading followed by the endpoint names it', () => {
    expect(extractEndpoints('### Get Thing\n\n**GET** `/thing`\n')).toEqual([{ method: 'GET', path: '/thing', label: 'Get Thing' }]);
  });
  it('a bare or bulleted endpoint uses its own description', () => {
    expect(extractEndpoints('**POST** `/a`\n- **Authentication**: Required\n\n- **DELETE** `/b/:id`: the author, or an admin.')).toEqual([
      { method: 'POST', path: '/a', label: '' },
      { method: 'DELETE', path: '/b/:id', label: 'the author, or an admin.' },
    ]);
  });
  it('a table row uses its last cell', () => {
    expect(extractEndpoints('| Method | Path | Behavior |\n|---|---|---|\n| PUT | `/x?path=<p>` | `files.write` | Write it |')).toEqual([
      { method: 'PUT', path: '/x?path=<p>', label: 'Write it' },
    ]);
  });
  it('a heading names only the endpoint directly beneath it', () => {
    expect(extractEndpoints('### Chat\n\nSome prose.\n\n- **GET** `/messages`: the latest 200')[0].label).toBe('the latest 200');
  });
  it('ignores code fences and lists each endpoint once', () => {
    expect(extractEndpoints('```\n**GET** `/in-fence`\n```\n**GET** `/x`\n**GET** `/x`').map((e) => e.path)).toEqual(['/x']);
  });
});

describe('the real docs', () => {
  it('Team and Workspace File list their endpoints, including the delete routes', () => {
    const team = extractEndpoints(section('Team Routes')).map((e) => `${e.method} ${e.path}`);
    const files = extractEndpoints(section('Workspace File Routes')).map((e) => `${e.method} ${e.path}`);
    expect(team).toEqual(expect.arrayContaining(['GET /:teamId/assets', 'DELETE /:teamId/assets/:id', 'POST /:teamId/workspaces/:workspaceId/messages']));
    expect(files).toEqual(expect.arrayContaining(['GET /:teamId/:workspaceId/files', 'DELETE /:teamId/:workspaceId/content?path=<relative-path>']));
  });
  // Second bravo retest: the helper still taught POST /api/agents with a flat { name } (no such route).
  it("the overview's examples use routes and bodies that exist", () => {
    const overview = getOverview();
    expect(overview).not.toMatch(/agnt\.fetch\('\/api\/agents', \{/);
    expect(overview).toContain("agnt.fetch('/api/agents/save'");
    expect(overview).toContain('{ agent: { name:');
    expect(overview).toContain('{ workflow: { name:');
  });
  it('no endpoint is still documented as shadowed by the fixed version routes', () => {
    expect(DOCS).not.toMatch(/may be shadowed by `\/:workflowId\/versions\/:versionId`/);
  });
  it('the overview shows them', () => {
    const overview = getOverview();
    expect(overview).toMatch(/── Team \(\/api\/teams\) ──\n {2}GET/);
    expect(overview).toMatch(/── Workspace File \(\/api\/workspace-files\) ──\n {2}GET/);
  });
});
