import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ProviderLanes from './ProviderLanes.vue';

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ProviderLanes.vue'),
  'utf8',
);

// `name` carries the auth API's capitalisation, because that is what the label
// falls back to for any provider without an override.
const ai = (id, name, extra = {}) => ({ id, name, icon: id, categories: ['AI'], ...extra });

const PROVIDERS = [
  ai('openai-codex', 'OpenAI Codex', { connectionType: 'oauth' }),
  ai('claude-code', 'Claude-Code', { connectionType: 'oauth' }),
  ai('gemini-cli', 'Gemini-CLI', { connectionType: 'oauth' }),
  ai('cursor-cli', 'Cursor', { connectionType: 'oauth' }),
  ai('grok-build', 'Grok-Build', { connectionType: 'oauth' }),
  ai('openai', 'OpenAI', { connectionType: 'apikey' }),
  ai('anthropic', 'Anthropic', { connectionType: 'apikey' }),
  ai('gemini', 'Gemini', { connectionType: 'apikey' }),
  ai('cerebras', 'Cerebras', { connectionType: 'apikey' }),
  ai('groq', 'Groq', { connectionType: 'apikey' }),
  ai('local', 'Local', { connectionType: 'apikey' }),
];

const mountLanes = (props = {}, options = {}) =>
  mount(ProviderLanes, {
    ...options,
    props: { providers: PROVIDERS, connectedIds: [], codexStatus: {}, ...props },
    global: {
      stubs: {
        SvgIcon: { template: '<span class="svg-icon-stub" />', props: ['name'] },
      },
    },
  });

const tileText = (wrapper) =>
  wrapper.findAll('.provider-tile').map((t) => t.text().replace(/\s+/g, ' ').trim());

/** Click a provider's tile by the text on it. */
const openTile = async (wrapper, label) => {
  const tile = wrapper.findAll('.provider-tile').find((t) => t.find('.provider-name').text().trim() === label);
  if (!tile) throw new Error(`No tile labelled "${label}" in: ${tileText(wrapper).join(', ')}`);
  await tile.trigger('click');
  return tile;
};

describe('ProviderLanes — the footer icon', () => {
  /**
   * Asserted against the SOURCE because jsdom computes no layout and resolves
   * no custom properties, so a mounted test cannot see either of the two things
   * that went wrong here.
   *
   * Both were regressions of the same kind: SvgIcon paints every path with
   * `--color-text` from a global rule, and an icon with no size falls back to
   * its intrinsic dimensions. The footer link is muted and small, so an icon
   * that answers neither question renders bigger and brighter than the sentence
   * it belongs to — which is exactly what shipped once already.
   */
  const footerBlock = SOURCE.slice(SOURCE.indexOf('.lane-foot :deep(.svg-icon)'));

  it('sizes the footer icon relative to its label, not in fixed pixels', () => {
    // px drifts the moment the surrounding font-size changes.
    expect(footerBlock).toMatch(/\.lane-foot :deep\(\.svg-icon\)\s*\{[^}]*width:\s*[\d.]+em/);
    expect(footerBlock).not.toMatch(/\.lane-foot :deep\(\.svg-icon\)\s*\{[^}]*width:\s*\d+px/);
  });

  it('sizes it BELOW cap-height, because a framed glyph reads heavier than text', () => {
    const [, size] = footerBlock.match(/\.lane-foot :deep\(\.svg-icon\)\s*\{[^}]*width:\s*([\d.]+)em/);
    expect(Number(size)).toBeLessThan(1);
  });

  it('paints it with currentColor so it cannot outshine its own label', () => {
    // SvgIcon's global `.svg-icon path[fill] { fill: var(--color-text) }` wins
    // otherwise, and the icon renders full-contrast beside muted text.
    expect(footerBlock).toMatch(/path\[fill\]\)\s*\{\s*fill:\s*currentColor/);
    expect(footerBlock).toMatch(/path\[stroke\]\)\s*\{\s*stroke:\s*currentColor/);
    expect(footerBlock).not.toMatch(/\.lane-foot[^}]*fill:\s*var\(--color-text\)/);
  });

  it('draws its divider only when a lane precedes it', () => {
    /**
     * Source-asserted: jsdom applies no CSS cascade, so a mounted test cannot
     * see which selector carries the border.
     *
     * Local is offered even when the catalog is empty, so the footer can be
     * the FIRST thing this component renders — and an unconditional
     * `border-top` then paints a rule above nothing, which reads as a stray
     * line left by content that failed to load.
     */
    expect(SOURCE).toMatch(/\.lane \+ \.lane-foot\s*\{[^}]*border-top:/);

    const bare = SOURCE.match(/(?<![+~]\s)\.lane-foot\s*\{[^}]*\}/);
    expect(bare, '.lane-foot rule not found').not.toBeNull();
    expect(bare[0], 'the bare .lane-foot rule must not carry the divider').not.toMatch(/border-top:/);
  });

  it('anti-vacuity: the footer rules are actually present to be checked', () => {
    expect(footerBlock.length).toBeGreaterThan(80);
    expect(SOURCE).toContain('.lane-foot :deep(.svg-icon)');
    expect(SOURCE).toContain('.lane-foot {');
  });
});

describe('ProviderLanes — the list', () => {
  it('names the bill in each lane heading, not the auth mechanism', () => {
    const wrapper = mountLanes();
    const text = wrapper.text();
    expect(text).toContain('Sign in to a plan');
    expect(text).toContain('already paid');
    expect(text).toContain('Paste an API key');
    expect(text).toContain('pay per token');

    // Our vocabulary stays out of the copy. Scoped to the headings and notes,
    // because "Gemini CLI" is a product name a vendor chose and we render it.
    const copy = [...wrapper.findAll('.lane-title'), ...wrapper.findAll('.lane-note')]
      .map((el) => el.text())
      .join(' ');
    expect(copy).not.toMatch(/\bOAuth\b|\bCLI\b|\bapikey\b/i);
  });

  it('spells subscription products the way their vendor does', () => {
    // These render on a screen headed "a plan you already pay for", where an
    // identifier like "Claude-Code" reads as internal tooling.
    const labels = tileText(mountLanes());
    expect(labels).toContain('Claude Code');
    expect(labels).toContain('Gemini CLI');
    expect(labels).not.toContain('Claude-Code');
    expect(labels).not.toContain('Gemini-CLI');
  });

  // A "+N more" expander was one more click between a user and the plan they
  // pay for. Every provider is a tile, on screen, from the start.
  it('shows every provider in every lane, with no expander', () => {
    const wrapper = mountLanes();
    expect(wrapper.find('.provider-tile.more').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/\+\d+\s*more/);
    // 5 plans + 5 keys (Local is the footer, not a tile).
    expect(wrapper.findAll('.provider-tile')).toHaveLength(10);
    expect(tileText(wrapper)).toContain('Grok Build');
    expect(tileText(wrapper)).toContain('Groq');
  });

  it('shows ChatGPT by that name, in the subscription lane', async () => {
    const wrapper = mountLanes();
    const labels = tileText(wrapper);
    expect(labels).toContain('ChatGPT');
    expect(labels).not.toContain('OpenAI Codex');
    // The subscription lane renders first, so ChatGPT precedes the metered
    // OpenAI tile in document order.
    expect(labels.indexOf('ChatGPT')).toBeLessThan(labels.indexOf('OpenAI'));
  });

  it('marks connected providers', () => {
    const wrapper = mountLanes({ connectedIds: ['grok-build'] });
    const connected = wrapper.findAll('.provider-tile.connected');
    expect(connected).toHaveLength(1);
    expect(connected[0].text()).toContain('Grok Build');
    expect(connected[0].find('.provider-status-dot').exists()).toBe(true);
  });

  it('offers a local runtime as a footnote, not a billing lane', () => {
    const wrapper = mountLanes();
    expect(wrapper.find('.lane-foot').text()).toContain('Run a model on this machine');
    expect(tileText(wrapper)).not.toContain('Local');
  });

  it('offers it even though the real catalog contains no local record', () => {
    /**
     * The regression this replaces. `local` is a runtime, not an account, so
     * api.agnt.gg has no row for it — and the fixture above is the only reason
     * the test before this one passes. Given the catalog the app actually
     * receives, the footer rendered nothing at all.
     */
    const wrapper = mountLanes({
      providers: PROVIDERS.filter((p) => p.id !== 'local'),
    });
    expect(wrapper.find('.lane-foot').exists()).toBe(true);
    expect(wrapper.find('.lane-foot').text()).toContain('Run a model on this machine');
  });

  it('offers it when the catalog never arrived', () => {
    // No network, no providers, no accounts — the case where running a model
    // on this machine is the only thing left that can work.
    const wrapper = mountLanes({ providers: [] });
    expect(wrapper.find('.lane-foot').text()).toContain('Run a model on this machine');
  });

  it('still selects local when it was synthesized rather than fetched', async () => {
    const wrapper = mountLanes({
      providers: PROVIDERS.filter((p) => p.id !== 'local'),
    });
    await wrapper.find('.lane-foot button').trigger('click');
    expect(wrapper.emitted('connect')[0][0].id).toBe('local');
  });

  it('emits connect for the local runtime without a detail step', async () => {
    const wrapper = mountLanes();
    await wrapper.find('.lane-foot button').trigger('click');
    expect(wrapper.emitted('connect')[0][0].id).toBe('local');
  });

  it('drops a lane heading entirely rather than showing an empty one', () => {
    const wrapper = mountLanes({ providers: [ai('openai', 'OpenAI', { connectionType: 'apikey' })] });
    expect(wrapper.text()).not.toContain('Sign in to a plan');
    expect(wrapper.text()).toContain('Paste an API key');
  });
});

describe('ProviderLanes — one provider', () => {
  // Reported: connecting a plan took a tile, a drawer, then "Sign in with X".
  // The tile IS the sign-in button now; the parent starts the flow.
  it('starts a plan sign-in on the tile click itself, with no drawer', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'ChatGPT');
    expect(wrapper.emitted('connect')).toHaveLength(1);
    expect(wrapper.emitted('connect')[0][0].id).toBe('openai-codex');
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  it('connects every provider that needs no typing in one click', async () => {
    const wrapper = mountLanes();
    for (const label of ['ChatGPT', 'Claude Code', 'Gemini CLI', 'Cursor', 'Grok Build']) {
      await openTile(wrapper, label);
    }
    expect(wrapper.emitted('connect').map(([p]) => p.id)).toEqual([
      'openai-codex',
      'claude-code',
      'gemini-cli',
      'cursor-cli',
      'grok-build',
    ]);
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  it('states who charges you when a plan is redeemed with a pasted token', async () => {
    const wrapper = mountLanes({
      providers: [ai('kimi-code', 'Kimi-Code', { connectionType: 'apikey' })],
    });
    await openTile(wrapper, 'Kimi Code');
    expect(wrapper.find('.panel-billing').text()).toContain('Included in your plan');
    expect(wrapper.find('.panel-billing').classes()).toContain('subscription');
  });

  it('states who charges you on the metered panel', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.find('.panel-billing').text()).toContain('per token');
    expect(wrapper.find('.panel-billing').classes()).toContain('api');
  });

  it('warns that the developer API is not the subscription of the same name', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.find('.panel-warn').text()).toContain('not your ChatGPT subscription');
  });

  it('does not warn in the other direction — a plan is not mistakable for an API', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'ChatGPT');
    expect(wrapper.find('.panel-warn').exists()).toBe(false);
  });

  it('offers the subscription of the same name, one click away, from its API key', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.find('.panel-swap').text()).toContain('Use ChatGPT instead');

    await wrapper.find('.panel-swap button').trigger('click');
    expect(wrapper.emitted('connect')[0][0].id).toBe('openai-codex');
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  it('omits the sibling link when that provider is not on this screen', async () => {
    const wrapper = mountLanes({
      providers: [
        ai('openai', 'OpenAI', { connectionType: 'apikey' }),
        ai('groq', 'Groq', { connectionType: 'apikey' }),
      ],
    });
    await openTile(wrapper, 'OpenAI');
    // A link to a provider we are not showing is a worse dead end than none.
    expect(wrapper.find('.panel-swap').exists()).toBe(false);
  });

  it('shows a credential field only for providers that take one', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.find('.panel-input').exists()).toBe(true);

    await openTile(wrapper, 'ChatGPT');
    expect(wrapper.find('.panel-input').exists()).toBe(false);
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  // Click, paste, Enter: the field is ready the moment it opens.
  it('focuses the key field when it opens', async () => {
    const wrapper = mountLanes({}, { attachTo: document.body });
    await openTile(wrapper, 'OpenAI');
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(wrapper.find('.panel-input').element);
    wrapper.unmount();
  });

  it('saves on Enter in the key field', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    await wrapper.find('.panel-input').setValue('typed-value');
    await wrapper.find('.panel-input').trigger('keyup.enter');
    expect(wrapper.emitted('submit-credential')[0][1]).toBe('typed-value');
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  it('branches the field on connection type, not on lane', async () => {
    // A subscription seat redeemed by pasting a token still needs the field.
    const wrapper = mountLanes({
      providers: [ai('kimi-code', 'Kimi-Code', { connectionType: 'apikey' })],
    });
    await openTile(wrapper, 'Kimi Code');
    expect(wrapper.find('.panel-billing').classes()).toContain('subscription');
    expect(wrapper.find('.panel-input').exists()).toBe(true);
  });

  it('says where a pasted key is kept', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.text()).toContain('follows you to other machines');
    expect(wrapper.text()).not.toContain('never sees a password');
  });

  it('submits what was typed, with the provider it belongs to', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    await wrapper.find('.panel-input').setValue('typed-value');
    await wrapper.find('.panel-action').trigger('click');

    const [provider, value] = wrapper.emitted('submit-credential')[0];
    expect(provider.id).toBe('openai');
    expect(value).toBe('typed-value');
  });

  it('refuses to submit an empty field', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.find('.panel-action').attributes('disabled')).toBeDefined();
    await wrapper.find('.panel-action').trigger('click');
    expect(wrapper.emitted('submit-credential')).toBeUndefined();
  });

  it('clears the field when moving between providers', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    await wrapper.find('.panel-input').setValue('typed-value');
    await openTile(wrapper, 'Anthropic');
    expect(wrapper.find('.panel-input').element.value).toBe('');
  });

  // Reported: a fresh install with ChatGPT already signed in had to open a
  // drawer that said "already connected", then press "Use", then dismiss a
  // popup. The tap on a connected tile is the whole choice.
  it('uses an already-connected provider in one tap, with no drawer', async () => {
    const wrapper = mountLanes({ connectedIds: ['openai-codex'] });
    await openTile(wrapper, 'ChatGPT');
    expect(wrapper.emitted('connect')).toHaveLength(1);
    expect(wrapper.emitted('connect')[0][0].id).toBe('openai-codex');
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  it('starts the sign-in for a plan that is not connected yet, also in one tap', async () => {
    const wrapper = mountLanes({ connectedIds: ['openai-codex'] });
    await openTile(wrapper, 'Claude Code');
    expect(wrapper.emitted('connect')[0][0].id).toBe('claude-code');
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  it('marks the provider in use, whatever its casing', () => {
    const wrapper = mountLanes({ connectedIds: ['openai-codex', 'claude-code'], activeId: 'OpenAI-Codex' });
    const inUse = wrapper.findAll('.provider-tile.active');
    expect(inUse.map((t) => t.find('.provider-name').text())).toEqual(['ChatGPT']);
    expect(inUse[0].find('.provider-in-use').text()).toBe('In use');
    expect(inUse[0].attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('.provider-in-use')).toHaveLength(1);
  });

  it('never navigates away from the list to show one provider', async () => {
    /**
     * The regression this replaces. Opening a provider used to REPLACE the
     * grid, so the tiles you might have meant instead were gone, and the
     * button you came for was fifth in reading order behind a back link, a
     * heading, a billing line and two paragraphs.
     */
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.findAll('.lane-title')).toHaveLength(2);
    expect(wrapper.findAll('.provider-tile').length).toBeGreaterThan(1);
    expect(wrapper.find('.panel-back').exists()).toBe(false);
  });

  it('opens the drawer inside the lane the provider came from', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    const lane = wrapper.find('.lane-api');
    expect(lane.find('.provider-drawer').exists()).toBe(true);
    expect(wrapper.findAll('.provider-drawer')).toHaveLength(1);
    expect(wrapper.find('.lane-subscription .provider-drawer').exists()).toBe(false);
  });

  it('keeps the chosen tile lit while its drawer is open', async () => {
    const wrapper = mountLanes();
    const tile = await openTile(wrapper, 'OpenAI');
    expect(tile.classes()).toContain('selected');
    expect(wrapper.findAll('.provider-tile.selected')).toHaveLength(1);
  });

  it('closes the drawer from the tile that opened it', async () => {
    const wrapper = mountLanes();
    const tile = await openTile(wrapper, 'OpenAI');
    await tile.trigger('click');
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
    expect(wrapper.find('.provider-tile.selected').exists()).toBe(false);
  });

  it('closes the drawer from its own close control', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    await wrapper.find('.panel-close').trigger('click');
    expect(wrapper.find('.provider-drawer').exists()).toBe(false);
  });

  it('puts the action before the fine print, not after it', async () => {
    // The whole complaint about the screen this replaces: the button was the
    // fifth thing you read. Asserted on DOM order so prose cannot creep back
    // above it.
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    const order = [...wrapper.find('.provider-drawer').element.querySelectorAll('.panel-action, .panel-fine')];
    expect(order[0].classList.contains('panel-action')).toBe(true);
  });
});

/**
 * The ONE "which AI" page. Onboarding used to put a summary screen in front of
 * this list ("More options") and a plan-vs-key question inside it; both were
 * extra clicks before the AI a user already pays for. Every answer is on
 * screen at once now, and each is a single click.
 */
describe('ProviderLanes — one page, every answer', () => {
  it('asks no question before showing the providers', () => {
    const wrapper = mountLanes();
    expect(wrapper.find('.lane-fork').exists()).toBe(false);
    expect(wrapper.find('.fork-card').exists()).toBe(false);
    expect(wrapper.findAll('.lane-title')).toHaveLength(2);
    expect(wrapper.find('.provider-tile').exists()).toBe(true);
  });

  it('has no way to ask it either', () => {
    expect(ProviderLanes.props.askBillingFirst).toBeUndefined();
  });

  it('offers AGNT Flash, included with the account, when asked to', async () => {
    const wrapper = mountLanes({ included: true });
    const lane = wrapper.find('.lane-included');
    expect(lane.text()).toContain('Included with your account');
    expect(lane.find('.provider-name').text()).toBe('AGNT Flash');

    await lane.find('.provider-tile').trigger('click');
    expect(wrapper.emitted('connect')[0][0].id).toBe('agnt');
  });

  it('marks AGNT Flash in use when it is the selected provider', () => {
    const wrapper = mountLanes({ included: true, activeId: 'AGNT' });
    expect(wrapper.find('.lane-included .provider-in-use').text()).toBe('In use');
    expect(wrapper.findAll('.provider-in-use')).toHaveLength(1);
  });

  it('leaves AGNT Flash out where a signed-out user is choosing', () => {
    expect(mountLanes().find('.lane-included').exists()).toBe(false);
  });

  it('switches from the AI in use to any other in one click', async () => {
    const wrapper = mountLanes({ included: true, activeId: 'AGNT', connectedIds: ['openai-codex'] });
    await openTile(wrapper, 'ChatGPT');
    expect(wrapper.emitted('connect')[0][0].id).toBe('openai-codex');
  });

  it('still offers the local runtime beside everything else', () => {
    const wrapper = mountLanes({ included: true });
    expect(wrapper.find('.lane-foot').text()).toContain('Run a model on this machine');
  });
});
