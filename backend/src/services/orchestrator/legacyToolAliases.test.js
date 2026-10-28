import { describe, it, expect } from 'vitest';
import { resolveAssignedToolNames, displayToolName, missingToolsNotice, LEGACY_TOOL_ALIASES } from './legacyToolAliases.js';

const names = (...xs) => new Set(xs);

describe('resolveAssignedToolNames', () => {
  it('maps website slugs to the runtime tools that are registered', () => {
    expect(resolveAssignedToolNames(['gmail', 'slack'], names('gmail_api', 'slack_api', 'web_search')))
      .toEqual({ resolved: ['gmail_api', 'slack_api'], missing: [] });
  });

  it('never aliases over a tool that really has the stored name', () => {
    expect(resolveAssignedToolNames(['gmail'], names('gmail', 'gmail_api')))
      .toEqual({ resolved: ['gmail'], missing: [] });
  });

  it('reports a slug whose plugin is not installed as missing, not as a phantom tool', () => {
    expect(resolveAssignedToolNames(['hubspot', 'gmail'], names('gmail_api')))
      .toEqual({ resolved: ['gmail_api'], missing: ['hubspot'] });
  });

  it('leaves runtime names untouched', () => {
    expect(resolveAssignedToolNames(['gmail_api'], names('gmail_api')))
      .toEqual({ resolved: ['gmail_api'], missing: [] });
  });

  it('de-duplicates a slug and its runtime name held together', () => {
    expect(resolveAssignedToolNames(['x', 'twitter_api'], names('twitter_api')).resolved).toEqual(['twitter_api']);
  });

  it('ignores prototype keys and junk without throwing', () => {
    expect(resolveAssignedToolNames(['constructor', '__proto__', null, 7, ''], names('gmail_api')))
      .toEqual({ resolved: [], missing: ['constructor', '__proto__'] });
    expect(resolveAssignedToolNames(undefined, names('gmail_api'))).toEqual({ resolved: [], missing: [] });
  });

  it('covers every slug that shipped on a published first-party agent', () => {
    // From the live listings' asset_data before the fix (agnt-server 052798b).
    for (const slug of ['gmail', 'slack', 'notion', 'github', 'firecrawl', 'googlesheets', 'googledrive', 'googlecalendar', 'x', 'stripe', 'hubspot', 'quickbooks', 'linear']) {
      expect(LEGACY_TOOL_ALIASES[slug], slug).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('displayToolName / missingToolsNotice', () => {
  it('shows the runtime name for a legacy slug and passes anything else through', () => {
    expect(displayToolName('googlesheets')).toBe('google_sheets_api');
    expect(displayToolName('my_custom_tool')).toBe('my_custom_tool');
    expect(displayToolName('toString')).toBe('toString');
  });

  it('says nothing when nothing is missing', () => {
    expect(missingToolsNotice([])).toBe('');
    expect(missingToolsNotice(['hubspot'])).toMatch(/^Assigned but not available here: hubspot\./);
  });
});
