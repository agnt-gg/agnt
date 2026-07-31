import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/views/Terminal/CenterPanel/screens/Agents/components/AgentDetails/tabs/ConfigureTab.vue'), 'utf8');
const storeSource = readFileSync(resolve(process.cwd(), 'src/store/features/agents.js'), 'utf8');

describe('ConfigureTab provider fallback editor', () => {
  it('renders and saves a bounded per-agent fallback chain', () => {
    expect(source).toContain('Enable provider fallback for this agent');
    expect(source).toContain('const MAX_FALLBACKS = 3');
    expect(source).toContain('fallbackProviders: agentConfig.value.fallbackProviders');
    expect(source).toContain(".slice(0, MAX_FALLBACKS)");
  });

  it('carries fallback settings through create and update payloads', () => {
    expect(storeSource.match(/fallbackEnabled: agentData\.fallbackEnabled === true/g)).toHaveLength(2);
    expect(storeSource.match(/fallbackProviders: Array\.isArray\(agentData\.fallbackProviders\)/g)).toHaveLength(2);
  });
});
