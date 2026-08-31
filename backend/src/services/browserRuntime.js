/**
 * Where can a browser actually show itself, and how must it be launched here?
 *
 * ---------------------------------------------------------------------------
 * THE QUESTION IS "IS THERE A DISPLAY", NOT "AM I IN DOCKER"
 * ---------------------------------------------------------------------------
 * browserFallbackSurface.js launches Chromium with no headless flag, and says
 * why in its header: "Visible, not headless. A browser doing things on
 * someone's behalf should be watchable; a hidden one is how automation
 * surprises people." That is exactly right on a desktop, and impossible on a
 * machine with no X server — the process exits immediately and the launcher
 * spends 30 seconds polling for a DevToolsActivePort that will never appear.
 *
 * The obvious framing is "detect Docker". That is the wrong question, and
 * measuring made it obvious: WSL Ubuntu on this machine reports
 *
 *     DISPLAY=[]  WAYLAND_DISPLAY=[]  /proc/1/cgroup = 0::/init.scope
 *
 * so it is NOT a container by any honest test, has no display whatsoever, and
 * would have been handed a headed launch that cannot work. A headless VPS, a
 * CI runner and an SSH session with no X forwarding are all the same shape.
 * Container-ness is a proxy for the thing that matters, and it is a leaky one.
 *
 * So the runtime asks the direct question — CAN A HUMAN SEE THIS? — and only
 * consults container-ness for the one decision that genuinely depends on it.
 *
 * ---------------------------------------------------------------------------
 * WHY --no-sandbox IS GATED ON THE CONTAINER AND NOT ON HEADLESS
 * ---------------------------------------------------------------------------
 * These are routinely pasted together as one incantation. They are not the
 * same decision and they do not have the same cost.
 *
 * Headless is a rendering mode; it gives up nothing. `--no-sandbox` disables
 * Chromium's setuid/namespace sandbox, which is the boundary that contains a
 * renderer compromise — and an agent-driven browser visits pages chosen by a
 * language model, which is precisely when you want that boundary intact.
 *
 * It is needed in a container because the app runs as uid 1000 with no
 * CAP_SYS_ADMIN and Docker's default seccomp profile blocks the namespace
 * calls the sandbox is built from. On a headless VPS running as a normal user
 * none of that applies, the sandbox works, and passing the flag anyway would be
 * a silent security downgrade bought for nothing.
 *
 * Hence: headless follows the display, --no-sandbox follows the container.
 *
 * ---------------------------------------------------------------------------
 * MEASURED, SO THE LAUNCHER DOES NOT NEED TO CHANGE
 * ---------------------------------------------------------------------------
 * `--headless=new` writes DevToolsActivePort into the profile directory in the
 * same format as a headed launch (verified against Chrome on this machine:
 * "56776\n/devtools/browser/<uuid>"). browserFallbackSurface polls for exactly
 * that file, so its wait loop, its stale-file handling and its adoption path
 * all work unmodified. Adding headless is a change to the ARGUMENTS and nothing
 * else, which is why this module exports flags rather than a launcher.
 */

import fs from 'fs';

/** Overrides, in the order they win. Env beats detection, always. */
const FORCE_HEADLESS = 'AGNT_BROWSER_HEADLESS';
const FORCE_CONTAINER = 'AGNT_CONTAINER';

/** Truthy in the shell sense: "1", "true", "yes" — not merely "set". */
function envFlag(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

/**
 * Is this process running inside a container?
 *
 * Ordered cheapest-and-most-certain first. `/.dockerenv` is written by Docker
 * itself; `/run/.containerenv` is Podman's equivalent. The cgroup scan is the
 * fallback for runtimes that write neither, and it is deliberately LAST because
 * cgroup v2 hosts report a bare `0::/` that says nothing either way.
 */
export function isContainerRuntime() {
  const forced = envFlag(FORCE_CONTAINER);
  if (forced !== null) return forced;

  if (process.platform !== 'linux') return false;

  if (fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv')) return true;

  try {
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
    return /\b(docker|containerd|kubepods|lxc|podman)\b/.test(cgroup);
  } catch {
    // No procfs, or no permission. Absence of evidence, so: no.
    return false;
  }
}

/**
 * Could a browser window be seen by a person on this machine?
 *
 * Windows and macOS always have a window server. Linux does not, and the two
 * environment variables below are the only portable evidence that one is
 * reachable — an X11 DISPLAY or a Wayland socket.
 */
export function hasDisplay() {
  if (process.platform !== 'linux') return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * Must a browser launched here be headless?
 *
 * The env override exists for the case detection cannot see: an X server that
 * is present but unusable (a stale DISPLAY pointing at a dead socket), and its
 * mirror image, a CI box that has Xvfb running and genuinely wants headed.
 */
export function shouldRunHeadless() {
  const forced = envFlag(FORCE_HEADLESS);
  if (forced !== null) return forced;
  return !hasDisplay();
}

/**
 * The launch flags this machine requires, on top of whatever the caller wants.
 *
 * Returns [] on a normal desktop, which is the point: the desktop path is
 * unchanged and cannot regress from this module existing.
 */
export function requiredChromeFlags() {
  const flags = [];

  if (shouldRunHeadless()) {
    // `=new` rather than bare `--headless`: the old headless is a separate
    // browser implementation with a different feature set, and it is the one
    // that historically diverged from headed behaviour in ways that make an
    // agent's screenshots lie.
    flags.push('--headless=new');
    // No GPU to talk to, and the probe for one costs seconds on some drivers.
    flags.push('--disable-gpu');
  }

  if (isContainerRuntime()) {
    // See the header: this is the container's price, not headless's.
    flags.push('--no-sandbox');
    // Docker's default /dev/shm is 64MB. Chromium maps its renderer heaps there
    // and dies partway through a page load when it runs out — as a renderer
    // crash, several layers from the cause.
    flags.push('--disable-dev-shm-usage');
  }

  return flags;
}

/**
 * A human-readable account of the launch decision, for logs.
 *
 * A browser that silently became invisible is a support ticket. One line
 * naming the reason turns it into a fact.
 */
export function describeRuntime() {
  const parts = [];
  parts.push(shouldRunHeadless() ? 'headless' : 'visible');
  if (isContainerRuntime()) parts.push('containerised');
  if (process.platform === 'linux' && !hasDisplay()) parts.push('no DISPLAY');
  return parts.join(', ');
}
