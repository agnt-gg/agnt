/** The ChatGPT/Codex subscription account that can generate images. */
export function isCodexImageProvider(provider) {
  return String(provider).toLowerCase() === 'openai-codex';
}
