import os from 'os';
import path from 'path';

/**
 * Where each AI agent harness keeps the things a user would want in AGNT.
 *
 * ONE PLACE THAT KNOWS THE FACTS. Every path below was read off a real install
 * rather than taken from documentation — the two disagree more often than not,
 * and a reader pointed at a path that does not exist fails silently by finding
 * nothing. Adding support for another tool is an entry here and nothing else.
 *
 * SKILLS ARE DELIBERATELY ABSENT FROM THIS FILE.
 * Every one of these tools stores skills as `<home>/skills/<name>/SKILL.md` —
 * the agentskills.io layout — and SkillDiscoveryService ALREADY scans that
 * directory for each of them. Restating the location here would create a second
 * answer to a question that is already answered, and the two would drift. This
 * file covers only what discovery cannot see: persona and memory.
 */

const home = () => os.homedir();

/**
 * Text that ships in a freshly-installed file and means "the user never filled
 * this in". Importing it would hand someone a persona describing a form they
 * never completed, which is worse than importing nothing.
 */
const TEMPLATE_MARKERS = [
  '_(pick something you like)_',
  '_Fill this in during your first conversation._',
  '_(AI? robot? familiar? ghost in the machine? something weirder?)_',
];

export const HARNESSES = [
  {
    id: 'hermes',
    label: 'Hermes',
    icon: 'agent',
    // HERMES_HOME wins when set; the installer honours it, so we must too.
    homeDir: (env = process.env) => env.HERMES_HOME || path.join(home(), '.hermes'),
    persona: {
      // 'You are Hermes Agent, an intelligent AI assistant created by...'
      files: ['SOUL.md'],
      // model.default + provider, used to label the agent rather than to
      // configure it — AGNT resolves its own provider from the user's account.
      config: 'config.yaml',
    },
    memory: {
      files: ['memories/USER.md', 'memories/MEMORY.md'],
      // Hermes separates blocks with a lone section sign.
      delimiter: '§',
    },
  },
  {
    id: 'openclaw',
    label: 'OpenClaw',
    icon: 'agent',
    homeDir: (env = process.env) => env.OPENCLAW_HOME || path.join(home(), '.openclaw'),
    /**
     * Everything readable lives under a workspace directory whose location is
     * itself configurable, resolved in the documented order.
     *
     * `persona.files` and `memory.files` below are relative to THIS, not to
     * the harness home. Spelling them as `workspace/SOUL.md` against the home
     * instead would silently assume the workspace is named `workspace` and
     * sits inside it — which is exactly what the two override mechanisms
     * above exist to change, so the users who need this resolution most are
     * the ones it would fail for.
     */
    readRoot: (harnessHome, env = process.env) => {
      if (env.OPENCLAW_WORKSPACE_DIR) return env.OPENCLAW_WORKSPACE_DIR;
      const profile = env.OPENCLAW_PROFILE;
      if (profile && profile !== 'default') {
        return path.join(harnessHome, `workspace-${profile}`);
      }
      return path.join(harnessHome, 'workspace');
    },
    persona: {
      // AGENTS.md is 8 KB of real behavioural rules and is the single most
      // valuable non-obvious thing in an OpenClaw install. SOUL.md alone
      // imports the voice and leaves the instructions behind.
      files: ['SOUL.md', 'AGENTS.md'],
    },
    memory: {
      files: ['MEMORY.md', 'USER.md'],
      delimiter: null, // whole-file; no block delimiter in this format
    },
  },
  {
    id: 'claude',
    label: 'Claude Code',
    icon: 'claude',
    homeDir: () => path.join(home(), '.claude'),
    persona: { files: ['CLAUDE.md'] },
    memory: null,
  },
  {
    id: 'codex',
    label: 'Codex',
    icon: 'openai',
    homeDir: (env = process.env) => env.CODEX_HOME || path.join(home(), '.codex'),
    persona: { files: ['AGENTS.md'] },
    memory: null,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    icon: 'cursor',
    homeDir: () => path.join(home(), '.cursor'),
    persona: null,
    memory: null,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    icon: 'google',
    homeDir: () => path.join(home(), '.gemini'),
    persona: { files: ['GEMINI.md'] },
    memory: null,
  },
];

export const HARNESS_BY_ID = new Map(HARNESSES.map((h) => [h.id, h]));

/**
 * Where a harness's readable files live.
 *
 * Defaults to the harness home. Only tools that put their content under a
 * separately-configurable subdirectory declare `readRoot`.
 */
export function resolveReadRoot(harness, harnessHome, env = process.env) {
  return harness.readRoot ? harness.readRoot(harnessHome, env) : harnessHome;
}

/**
 * Does this text look like an unedited bootstrap template?
 * Exported because both the scanner (to report it as empty) and the importer
 * (to refuse to write it) need the same answer.
 */
export function looksLikeTemplate(text) {
  if (!text || !text.trim()) return true;
  return TEMPLATE_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Split a memory file into individual memories.
 *
 * A delimiter-less format is one memory, not zero — returning [] for a file
 * with real content in it would silently drop everything OpenClaw knows.
 */
export function splitMemories(text, delimiter) {
  if (!text || !text.trim()) return [];
  const parts = delimiter ? text.split(delimiter) : [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}
