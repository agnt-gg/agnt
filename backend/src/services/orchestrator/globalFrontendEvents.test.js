import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GLOBAL_FRONTEND_EVENT_TYPES, isGlobalFrontendEvent } from './globalFrontendEvents.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const ORCHESTRATOR = path.join(REPO_ROOT, 'backend/src/services/OrchestratorService.js');
const FRONTEND_REGISTRY = path.join(REPO_ROOT, 'frontend/src/services/globalFrontendEvents.js');

describe('globalFrontendEvents', () => {
  it('classifies the window-scoped types', () => {
    expect(isGlobalFrontendEvent('tutorial:start')).toBe(true);
    expect(isGlobalFrontendEvent('tutorial:end')).toBe(true);
    expect(isGlobalFrontendEvent('appearance:background')).toBe(true);
  });

  it('classifies channel-scoped and junk types as not global', () => {
    expect(isGlobalFrontendEvent('widget:saved')).toBe(false);
    expect(isGlobalFrontendEvent('file_written')).toBe(false);
    expect(isGlobalFrontendEvent(undefined)).toBe(false);
    expect(isGlobalFrontendEvent(null)).toBe(false);
    expect(isGlobalFrontendEvent(123)).toBe(false);
  });

  // Cross-boundary contract. The backend decides WHICH events are broadcast to
  // every tab; the frontend decides WHAT WINDOW EVENT each becomes. A type
  // present on one side only is a silent no-op at runtime — the broadcast fires
  // and nothing listens, or a listener waits for a broadcast that never comes.
  it('is in step with the frontend registry', () => {
    const source = fs.readFileSync(FRONTEND_REGISTRY, 'utf8');
    const body = source.slice(source.indexOf('GLOBAL_FRONTEND_EVENTS'));
    const frontendTypes = [...body.matchAll(/^\s*'([^']+)':\s*'([^']+)',/gm)].map((m) => m[1]);

    expect(frontendTypes.length).toBeGreaterThan(0);
    expect([...GLOBAL_FRONTEND_EVENT_TYPES].sort()).toEqual([...frontendTypes].sort());
  });

  // Pins the call site, not just the module: the predicate has to actually be
  // the thing gating the socket.io mirror, or this module is decoration.
  it('gates the OrchestratorService socket mirror', () => {
    const source = fs.readFileSync(ORCHESTRATOR, 'utf8');
    expect(source).toMatch(/import \{ isGlobalFrontendEvent \} from '\.\/orchestrator\/globalFrontendEvents\.js'/);
    expect(source).toMatch(/if \(userId && isGlobalFrontendEvent\(event\.type\)\) \{/);
    // The hand-maintained list that this replaced must not come back.
    expect(source).not.toMatch(/event\.type === 'tutorial:start'/);
  });
});
