import { parseArgs, planLifecycle } from './planning.mjs';
import { collect } from './observations.mjs';

const HELP = `Read-only worktree lifecycle planning (Node 20+, Git, GitHub CLI)
  npm run wt -- doctor --github OWNER/REPO --author USER [--repo PATH]
  npm run wt -- sync --dry-run --github OWNER/REPO --author USER [--repo PATH]
  npm run wt -- retire --dry-run --pr N --worktree PATH --github OWNER/REPO --author USER [--repo PATH]

These commands never fetch, prune, switch branches, update main or delete.
Only origin/main and base main are supported in this first planning phase.
Use npm --silent run wt -- ... for JSON without npm's banner.
Exit 0: report/plan produced; 1: arguments or collection failed; 2: blockers.
A partial doctor report exits 2. No output authorizes or executes retirement.
See docs/WORKTREE_LIFECYCLE.md for limits and the approval workflow.
`;

export async function runPlanner(args, { observe = collect, print = console.log } = {}) {
  if (args.length === 2 && ['doctor', 'sync', 'retire'].includes(args[0]) && ['--help', '-h'].includes(args[1])) {
    print(HELP);
    return 0;
  }
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    print(JSON.stringify({ readOnly: true, canExecute: false, error: error.message }));
    return 1;
  }
  try {
    const observations = await observe(options);
    const plan = planLifecycle(observations, options);
    print(JSON.stringify({ plan, observations }, null, 2));
    if (observations.errors.length) return 1;
    return plan.blockers.length ? 2 : 0;
  } catch {
    // Do not echo subprocess stderr, headers, raw argv or server bodies.
    print(JSON.stringify({ readOnly: true, canExecute: false, error: 'Observation failed; no state was changed' }));
    return 1;
  }
}
