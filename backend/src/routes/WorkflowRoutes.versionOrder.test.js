import { it, expect } from 'vitest';
import WorkflowRoutes from './WorkflowRoutes.js';

// GET /workflows/:id/versions/stats answered 404 "Version not found": Express matches routes in
// registration order, and /:workflowId/versions/:versionId was registered first, so "stats" (and
// "compare") were taken as a version id. Documented as a known bug, still live on bravo in Nov 2026.
const order = (path) => WorkflowRoutes.stack.findIndex((layer) => layer.route?.path === path && layer.route.methods.get);

it.each(['/:workflowId/versions/stats', '/:workflowId/versions/compare'])('%s is matched before /:workflowId/versions/:versionId', (path) => {
  expect(order(path)).toBeGreaterThanOrEqual(0);
  expect(order(path)).toBeLessThan(order('/:workflowId/versions/:versionId'));
});
