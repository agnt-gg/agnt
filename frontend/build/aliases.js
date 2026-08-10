import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..');

/**
 * Module aliases, defined ONCE and imported by both vite.config.js (the app
 * build) and vitest.config.js (the test run).
 *
 * They used to be written out separately in each file. That is the same defect
 * this whole change is about — one fact in two places that cannot see each
 * other — and it bit immediately: adding `@llm` to the build config alone left
 * every test that transitively imports the provider store unable to resolve it,
 * which surfaced as seventeen unrelated-looking suite failures rather than as
 * "you forgot the other config".
 *
 *   @      the app's own source
 *   @llm   the SHARED PROVIDER DESCRIPTOR, which lives under backend/src
 *          because electron-builder already ships that tree. Vite inlines it
 *          into dist/ at build time, so nothing new is packaged and no npm
 *          workspace is required. The aliased modules must stay isomorphic —
 *          enforced by backend descriptor.purity.test.js.
 */
export const aliases = {
  '@': path.resolve(frontendRoot, 'src'),
  '@llm': path.resolve(frontendRoot, '../backend/src/services/ai/descriptor'),
};

export default aliases;
