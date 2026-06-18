/**
 * ENV_KEY_MAP — provider key → process.env variable name.
 *
 * Single source of truth for which env var seeds which provider's credential.
 * Consumed by AuthManager.getValidAccessToken and AuthManager.getConnectedApps
 * so that setting e.g. OPENAI_API_KEY=sk-... or SLACK_BOT_TOKEN=xoxb-... in
 * .env / docker-compose results in a working, "connected" provider without
 * any UI action.
 *
 * Naming convention: follow each upstream provider's own env-var name where
 * one exists (XAI_API_KEY for Grok, TOGETHER_API_KEY for Together, GITHUB_TOKEN
 * for GitHub, SLACK_BOT_TOKEN for Slack, NOTION_API_KEY for Notion, etc.) so
 * users coming from upstream docs don't have to re-learn the variable name.
 * Where no upstream convention exists, `<PROVIDER>_API_KEY` is the default.
 *
 * Scope: every provider that supports a single-string credential (API key,
 * bot token, personal access token, app password). Pure-OAuth-only providers
 * with no PAT form (sign-in-with-apple, google-login flow, AWS multi-credential
 * pairs, MetaMask wallet) are intentionally omitted — their auth doesn't fit
 * a single env-var slot. CLI providers (openai-codex, claude-code, gemini-cli,
 * kimi-code, ollama, lm-studio) are also omitted; they read filesystem creds.
 */
const ENV_KEY_MAP = Object.freeze({
  // ── AI / LLM providers ─────────────────────────────────────────────
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  grokai: 'XAI_API_KEY',
  groq: 'GROQ_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  togetherai: 'TOGETHER_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  kimi: 'MOONSHOT_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  zai: 'ZAI_API_KEY',
  chutes: 'CHUTES_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  sambanova: 'SAMBANOVA_API_KEY',
  novita: 'NOVITA_API_KEY',
  nebius: 'NEBIUS_API_KEY',
  'nvidia-nim': 'NVIDIA_API_KEY',
  scaleway: 'SCALEWAY_API_KEY',
  hyperbolic: 'HYPERBOLIC_API_KEY',
  'meta-llama': 'LLAMA_API_KEY',
  cohere: 'COHERE_API_KEY',
  lambda: 'LAMBDA_API_KEY',
  lepton: 'LEPTON_API_KEY',
  vllm: 'VLLM_API_KEY',
  jan: 'JAN_API_KEY',

  // ── Voice / media ──────────────────────────────────────────────────
  elevenlabs: 'ELEVENLABS_API_KEY',
  unsplash: 'UNSPLASH_ACCESS_KEY',
  canva: 'CANVA_API_KEY',

  // ── Communication / chat ───────────────────────────────────────────
  slack: 'SLACK_BOT_TOKEN',
  discord: 'DISCORD_BOT_TOKEN',
  telegram: 'TELEGRAM_BOT_TOKEN',
  intercom: 'INTERCOM_ACCESS_TOKEN',
  zendesk: 'ZENDESK_API_TOKEN',
  zoom: 'ZOOM_ACCESS_TOKEN',

  // ── Productivity / docs / notes ────────────────────────────────────
  notion: 'NOTION_API_KEY',
  airtable: 'AIRTABLE_API_KEY',
  evernote: 'EVERNOTE_DEVELOPER_TOKEN',
  obsidian: 'OBSIDIAN_API_KEY',
  todoist: 'TODOIST_API_TOKEN',
  monday: 'MONDAY_API_KEY',
  clickup: 'CLICKUP_API_TOKEN',
  asana: 'ASANA_PERSONAL_ACCESS_TOKEN',
  trello: 'TRELLO_API_TOKEN',
  calendly: 'CALENDLY_API_KEY',

  // ── Engineering / dev ──────────────────────────────────────────────
  github: 'GITHUB_TOKEN',
  atlassian: 'ATLASSIAN_API_TOKEN',
  jira: 'JIRA_API_TOKEN',
  figma: 'FIGMA_ACCESS_TOKEN',
  firecrawl: 'FIRECRAWL_API_KEY',
  'atlas-cloud': 'MONGODB_ATLAS_API_KEY',

  // ── Marketing / CRM / sales ────────────────────────────────────────
  hubspot: 'HUBSPOT_ACCESS_TOKEN',
  salesforce: 'SALESFORCE_ACCESS_TOKEN',
  mailchimp: 'MAILCHIMP_API_KEY',
  zapier: 'ZAPIER_NLA_API_KEY',

  // ── Finance / commerce ─────────────────────────────────────────────
  stripe: 'STRIPE_SECRET_KEY',
  quickbooks: 'QUICKBOOKS_ACCESS_TOKEN',
  xero: 'XERO_ACCESS_TOKEN',
  ebay: 'EBAY_API_KEY',
  docusign: 'DOCUSIGN_API_KEY',
  bankr: 'BANKR_API_KEY',

  // ── Social ─────────────────────────────────────────────────────────
  linkedin: 'LINKEDIN_ACCESS_TOKEN',
  facebook: 'FACEBOOK_ACCESS_TOKEN',

  // ── Storage / Microsoft ecosystem ──────────────────────────────────
  dropbox: 'DROPBOX_ACCESS_TOKEN',
  microsoft: 'MICROSOFT_ACCESS_TOKEN',

  // ── Analytics / weather / misc ─────────────────────────────────────
  openweathermap: 'OPENWEATHERMAP_API_KEY',
  analytics: 'GOOGLE_ANALYTICS_API_KEY',
  tableau: 'TABLEAU_ACCESS_TOKEN',

  // ── Note: deliberately omitted ─────────────────────────────────────
  // - agnt          : internal AGNT auth, not a third-party provider
  // - google        : umbrella for the Google Workspace suite (Gmail, Drive,
  //                   YouTube, Sheets, Slides, Calendar, etc.) — OAuth-only,
  //                   no single-string PAT covers all those scopes. Use the
  //                   OAuth connect flow. `gemini` above handles the AI API.
  // - google-login  : OAuth login flow, no single-string equivalent
  // - apple         : sign-in-with-apple, no PAT form
  // - aws           : requires AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
  //                   (plus optional SESSION_TOKEN) — multi-credential, can't
  //                   collapse to one env var. Handle in AWS-specific tool.
  // - metamask      : wallet signing, not a server-side credential
  // - dickbutt      : test/placeholder entry on remote
  // - kimi-code     : CLI provider, uses filesystem creds
});

export default ENV_KEY_MAP;
export { ENV_KEY_MAP };
