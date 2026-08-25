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

const mountLanes = (props = {}) =>
  mount(ProviderLanes, {
    props: { providers: PROVIDERS, connectedIds: [], codexStatus: {}, ...props },
    global: {
      stubs: {
        SvgIcon: { template: '<span class="svg-icon-stub" />', props: ['name'] },
      },
    },
  });

const tileText = (wrapper) =>
  wrapper.findAll('.provider-tile').map((t) => t.text().replace(/\s+/g, ' ').trim());

/**
 * Open a provider's panel by the text on its tile, expanding lanes first so a
 * test never depends on where the preview cut happens to fall.
 */
const openTile = async (wrapper, label) => {
  for (const more of wrapper.findAll('.provider-tile.more')) await more.trigger('click');
  const tile = wrapper.findAll('.provider-tile').find((t) => t.text().trim() === label);
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

  it('previews four per lane and hides the rest behind a count', () => {
    const wrapper = mountLanes();
    // 4 + expander, twice.
    expect(wrapper.findAll('.provider-tile.more')).toHaveLength(2);
    expect(wrapper.findAll('.provider-tile')).toHaveLength(4 + 1 + 4 + 1);
    expect(wrapper.text()).toContain('+1more');
  });

  it('expands a lane in place without collapsing the other', async () => {
    const wrapper = mountLanes();
    await wrapper.findAll('.provider-tile.more')[0].trigger('click');
    expect(wrapper.findAll('.provider-tile.more')).toHaveLength(1);
    expect(tileText(wrapper)).toContain('Grok Build');
  });

  it('shows ChatGPT by that name, in the subscription lane', async () => {
    const wrapper = mountLanes();
    for (const more of wrapper.findAll('.provider-tile.more')) await more.trigger('click');
    const labels = tileText(wrapper);
    expect(labels).toContain('ChatGPT');
    expect(labels).not.toContain('OpenAI Codex');
    // The subscription lane renders first, so ChatGPT precedes the metered
    // OpenAI tile in document order.
    expect(labels.indexOf('ChatGPT')).toBeLessThan(labels.indexOf('OpenAI'));
  });

  it('marks connected providers and never hides one behind the expander', () => {
    // grok-build sorts last by label, so without the connected-first rule it
    // would be the one tile the expander swallowed.
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
  it('states who charges you on the subscription panel', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'ChatGPT');
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

  it('offers the sibling product in both directions', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'OpenAI');
    expect(wrapper.find('.panel-swap').text()).toContain('Connect ChatGPT instead');

    await wrapper.find('.panel-swap button').trigger('click');
    expect(wrapper.find('.drawer-who strong').text()).toBe('ChatGPT');
    expect(wrapper.find('.panel-swap').text()).toContain('Connect OpenAI instead');
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
    expect(wrapper.find('.panel-action').text()).toContain('Sign in with ChatGPT');
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

  it('promises local storage only where that is actually true', async () => {
    const wrapper = mountLanes();
    await openTile(wrapper, 'ChatGPT');
    expect(wrapper.text()).toContain('on this computer');

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

  it('says nothing to do when the provider is already connected', async () => {
    const wrapper = mountLanes({ connectedIds: ['claude-code'] });
    await openTile(wrapper, 'Claude Code');
    expect(wrapper.text()).toContain('Already connected');
    expect(wrapper.find('.panel-input').exists()).toBe(false);
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
    await openTile(wrapper, 'ChatGPT');
    const order = [...wrapper.find('.provider-drawer').element.querySelectorAll('.panel-action, .panel-fine')];
    expect(order[0].classList.contains('panel-action')).toBe(true);
  });
});

describe('ProviderLanes — which wallet, asked first', () => {
  it('asks nothing extra by default, so chat stays one click', () => {
    const wrapper = mountLanes();
    expect(wrapper.find('.lane-fork').exists()).toBe(false);
    expect(wrapper.findAll('.lane-title')).toHaveLength(2);
  });

  it('offers the two wallets, priced, before naming a single vendor', () => {
    const wrapper = mountLanes({ askBillingFirst: true });
    const cards = wrapper.findAll('.fork-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain('I have a subscription');
    expect(cards[0].text()).toContain('already paid');
    expect(cards[1].text()).toContain('I have an API key');
    expect(cards[1].text()).toContain('pay per token');
    expect(wrapper.find('.provider-tile').exists()).toBe(false);
  });

  it('shows only the lane that was chosen', async () => {
    const wrapper = mountLanes({ askBillingFirst: true });
    await wrapper.findAll('.fork-card')[0].trigger('click');
    expect(wrapper.findAll('.lane')).toHaveLength(1);
    expect(wrapper.find('.lane-subscription').exists()).toBe(true);
    expect(wrapper.find('.lane-api').exists()).toBe(false);
    expect(tileText(wrapper)).toContain('ChatGPT');
  });

  it('asks which vendor, not which wallet again, once the wallet is known', async () => {
    const wrapper = mountLanes({ askBillingFirst: true });
    await wrapper.findAll('.fork-card')[0].trigger('click');
    expect(wrapper.find('.lane-title').text()).toBe('Which plan do you have?');
    // Already read on the card that was just clicked.
    expect(wrapper.find('.lane-chip').exists()).toBe(false);
    expect(wrapper.find('.lane-note').exists()).toBe(false);
  });

  it('goes back to the two wallets', async () => {
    const wrapper = mountLanes({ askBillingFirst: true });
    await wrapper.findAll('.fork-card')[1].trigger('click');
    await wrapper.find('.lane-back').trigger('click');
    expect(wrapper.findAll('.fork-card')).toHaveLength(2);
  });

  it('carries the visible lane along when the swap link crosses the divide', async () => {
    /**
     * The swap link exists to clear a dead end. Behind the fork it can create
     * one instead: follow it from the metered lane and the provider it selects
     * lives in the lane the fork is hiding, so the drawer renders nowhere.
     */
    const wrapper = mountLanes({ askBillingFirst: true });
    await wrapper.findAll('.fork-card')[1].trigger('click');
    await openTile(wrapper, 'OpenAI');
    await wrapper.find('.panel-swap button').trigger('click');

    expect(wrapper.find('.lane-subscription').exists()).toBe(true);
    expect(wrapper.find('.provider-drawer').exists()).toBe(true);
    expect(wrapper.find('.drawer-who strong').text()).toBe('ChatGPT');
  });

  it('does not ask when only one wallet has anything in it', () => {
    const wrapper = mountLanes({
      askBillingFirst: true,
      providers: [ai('openai', 'OpenAI', { connectionType: 'apikey' })],
    });
    expect(wrapper.find('.lane-fork').exists()).toBe(false);
    expect(wrapper.find('.lane-api').exists()).toBe(true);
  });

  it('does not hide an already-connected provider behind the question', () => {
    // Nothing here is worth making someone guess their way back to a provider
    // that already works.
    const wrapper = mountLanes({ askBillingFirst: true, connectedIds: ['claude-code'] });
    expect(wrapper.find('.lane-fork').exists()).toBe(false);
    expect(wrapper.findAll('.provider-tile.connected')).toHaveLength(1);
  });

  it('still offers the local runtime while the question is on screen', () => {
    // Running a model here is a third answer to "how do you want to pay", so
    // it cannot be stranded behind either card.
    const wrapper = mountLanes({ askBillingFirst: true });
    expect(wrapper.find('.lane-foot').text()).toContain('Run a model on this machine');
  });
});
