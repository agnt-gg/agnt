/**
 * ONE DEFINITION OF "RUNNING".
 *
 * The header pill counted with one status list and the Runs page filtered with
 * another, so the pill could say "1 running" and lead to an empty Running tab.
 * Every running count and filter now uses isRunningExecution; this fails if an
 * inline status check creeps back into a filter.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');

const SITES = {
  'Traces.vue': read('Traces.vue'),
  'TracesPanel.vue': read('../../../LeftPanel/types/TracesPanel/TracesPanel.vue'),
};

describe('running is defined once', () => {
  it.each(Object.keys(SITES))('%s filters running rows only through isRunningExecution', (file) => {
    const source = SITES[file];
    expect(source).toMatch(/import \{ isRunningExecution \} from '@\/canvas\/railBadges\.js';/);
    expect(source).not.toMatch(/\.filter\(\(\w+\) => \w+\.status === 'running'/);
    expect(source).toMatch(/\.filter\(isRunningExecution\)/);
  });
});
