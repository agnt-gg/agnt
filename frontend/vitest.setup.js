import { config } from '@vue/test-utils';
import { vTooltip } from './src/directives/tooltip.js';

/**
 * Global registrations that main.js performs on the real app.
 *
 * Tests mount components in isolation, so anything registered on the app
 * instance has to be mirrored here or it simply does not exist under test:
 * Vue logs "Failed to resolve directive" and the binding silently does
 * nothing, which is indistinguishable from the feature being broken.
 *
 * main.js remains the source of truth for production — uiContracts.spec.js
 * asserts the registration is actually there, so this file cannot paper over
 * its absence.
 */
config.global.directives = {
  ...config.global.directives,
  tooltip: vTooltip,
};
