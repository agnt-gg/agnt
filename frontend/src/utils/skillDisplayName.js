/**
 * A skill's name as people read it (requested 2026-10-23):
 *   "annie-universal-api-orchestrator" -> "Annie Universal API Orchestrator"
 *
 * Display only. A skill is stored, activated and exported by its name, so the
 * stored name never changes; screens show this.
 *
 * - A slug (no spaces: dashes, underscores, dots) becomes Title Case words.
 * - A name its author already wrote with spaces keeps their casing; only the
 *   known acronyms and brand spellings below are corrected.
 * - "plugin/skill" names keep both parts: "AGNT Autoresearch / Experiment Contract".
 *
 * To add a word: put it in ACRONYMS (shown all caps) or SPELLINGS (exact
 * form). Lookup is case-insensitive, whole words only.
 */

export const ACRONYMS = new Set([
  // AGNT and AI
  'agnt', 'ai', 'agi', 'llm', 'llms', 'gpt', 'rag', 'mcp', 'nlp', 'ocr', 'tts', 'stt', 'asr', 'ml',
  // Web and software
  'api', 'apis', 'ui', 'ux', 'cli', 'sdk', 'ide', 'http', 'https', 'url', 'urls', 'html', 'css', 'json', 'xml',
  'yaml', 'csv', 'tsv', 'pdf', 'sql', 'db', 'dom', 'jwt', 'oauth', 'sso', 'ssh', 'ssl', 'tls', 'dns', 'cdn',
  'vpn', 'ip', 'tcp', 'udp', 'rest', 'grpc', 'cors', 'crud', 'cicd', 'ci', 'cd', 'qa', 'e2e', 'tdd', 'bdd',
  'wasm', 'gpu', 'cpu', 'ram', 'os', 'vm', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'mp3', 'mp4', 'rss', 'smtp',
  'imap', 'sms', 'id', 'ids', 'uuid', 'utc', 'iso', 'pr', 'prs', 'mvp', 'prd', 'tsl', 'glsl', 'wgsl', 'ar', 'vr', 'xr', '3d', '2d',
  // Business
  'seo', 'sem', 'crm', 'erp', 'kpi', 'kpis', 'roi', 'b2b', 'b2c', 'saas', 'faq', 'faqs', 'hr', 'ceo', 'cto',
  'cfo', 'okr', 'okrs', 'sla', 'gdpr', 'hipaa', 'usd', 'eur', 'gbp', 'nft', 'nfts', 'defi', 'eth', 'btc',
  // Places and misc
  'us', 'uk', 'eu', 'usa', 'pdfs', 'diy', 'tldr',
]);

/** Words with a set spelling that is not simply all caps. */
export const SPELLINGS = Object.freeze({
  github: 'GitHub', gitlab: 'GitLab', openai: 'OpenAI', chatgpt: 'ChatGPT', youtube: 'YouTube', linkedin: 'LinkedIn',
  tiktok: 'TikTok', wordpress: 'WordPress', javascript: 'JavaScript', typescript: 'TypeScript', nodejs: 'Node.js',
  threejs: 'Three.js', vuejs: 'Vue.js', nextjs: 'Next.js', webgpu: 'WebGPU', webgl: 'WebGL', iphone: 'iPhone',
  ios: 'iOS', macos: 'macOS', hyperframes: 'HyperFrames', powerpoint: 'PowerPoint', postgresql: 'PostgreSQL',
  mysql: 'MySQL', sqlite: 'SQLite', mongodb: 'MongoDB', graphql: 'GraphQL', devops: 'DevOps', ecommerce: 'eCommerce',
  xlsx: 'XLSX', docx: 'DOCX', pptx: 'PPTX', ffmpeg: 'FFmpeg', figma: 'Figma', hubspot: 'HubSpot', paypal: 'PayPal',
  elevenlabs: 'ElevenLabs', deepseek: 'DeepSeek', xai: 'xAI',
});

/** Short words kept lower case inside a title. */
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via', 'with']);

const fixWord = (word) => {
  const key = word.toLowerCase();
  if (SPELLINGS[key]) return SPELLINGS[key];
  if (ACRONYMS.has(key)) return word.toUpperCase();
  return null;
};

function titleSlug(part) {
  const words = part.split(/[-_.\s]+/).filter(Boolean);
  return words
    .map((word, index) => {
      const fixed = fixWord(word);
      if (fixed) return fixed;
      const lower = word.toLowerCase();
      if (index > 0 && MINOR.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** An author-written name: their casing, with acronyms and brands corrected. */
function fixWritten(part) {
  return part.replace(/[A-Za-z0-9]+/g, (word) => fixWord(word) || word);
}

export function skillDisplayName(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  return raw
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/\s/.test(part) ? fixWritten(part) : titleSlug(part)))
    .join(' / ');
}
