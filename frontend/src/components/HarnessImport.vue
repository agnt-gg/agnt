<template>
  <div class="harness-import">
    <!-- ─────────────── DONE ─────────────── -->
    <div v-if="result" class="hi-done">
      <p class="hi-done-line">
        <svg class="hi-tick" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" stroke-width="2.6"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        {{ doneSummary }}
      </p>
      <p v-if="result.failures.length" class="hi-note hi-warn hi-done-note">
        {{ result.failures.length }} item{{ result.failures.length === 1 ? '' : 's' }} couldn't be
        brought over: {{ result.failures.slice(0, 2).map((f) => f.name).join(', ')
        }}{{ result.failures.length > 2 ? '…' : '' }}
      </p>
    </div>

    <!-- ─────────────── OFFER ─────────────── -->
    <template v-else>
      <!-- The most useful thing on this screen is usually not an offer at all:
           AGNT reads these tools' skill folders directly, so most of what the
           user has already works. Saying so first stops the list below reading
           as "your skills are missing". -->
      <p v-if="alreadyWorkingCount > 0" class="hi-already">
        <svg class="hi-tick" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" stroke-width="2.6"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>
          <strong>{{ alreadyWorkingCount }} skills</strong> from {{ toolList }} already work here.
          Nothing to do.
        </span>
      </p>

      <!-- Without this the banner counts six tools and only two rows appear,
           which reads as four missing cards rather than as four tools with
           nothing left to offer. -->
      <p class="hi-lead">{{ leadLabel }}</p>

      <div class="hi-rows">
        <div v-for="source in offerable" :key="source.id" class="hi-row">
          <div class="hi-row-head">
            <span class="hi-icon"><SvgIcon :name="source.icon" /></span>
            <span class="hi-label">{{ source.label }}</span>
          </div>

          <div class="hi-offers">
            <button
              v-for="offer in offersFor(source)"
              :key="offer.kind"
              type="button"
              class="hi-offer"
              :class="{ on: isSelected(offer.kind, source.id) }"
              :aria-pressed="isSelected(offer.kind, source.id)"
              @click="toggle(offer.kind, source.id)"
            >
              <span class="hi-box">
                <svg v-if="isSelected(offer.kind, source.id)" class="hi-tick" viewBox="0 0 16 16"
                     fill="none" aria-hidden="true">
                  <path d="M3 8.5l3.2 3.2L13 5" stroke="currentColor" stroke-width="2.6"
                        stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              {{ offer.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Directly under the selection it acts on. Putting the fine print
           between the two separates the choice from the button that commits
           it, and orphans the button below a paragraph.

           Deliberately NOT .btn-primary: the wizard's own Continue button is
           always green and always on screen, and a second green pill beside it
           makes the user pick between two identical-looking ways forward.
           Outlined reads as "the action on this screen"; Continue keeps
           meaning "move on". -->
      <button
        type="button"
        class="hi-action"
        :disabled="selectedCount === 0 || running"
        @click="onImport"
      >
        {{ running ? 'Bringing it over…' : importLabel }}
      </button>

      <p class="hi-note">
        Copies into AGNT. Nothing in {{ toolList }} is changed or removed, and anything you already
        have here is left alone.
      </p>

      <p v-if="error" class="hi-note hi-warn">{{ error }}</p>
    </template>
  </div>
</template>

<script>
import { computed } from 'vue';
import SvgIcon from '@/views/_components/common/SvgIcon.vue';

export default {
  name: 'HarnessImport',
  components: { SvgIcon },
  props: {
    /** The live useHarnessImport() instance, owned by the parent. */
    importer: { type: Object, required: true },
  },
  emits: ['imported'],
  setup(props, { emit }) {
    const {
      sources, totals, offerable, selectedCount, running, result, error, toggle, isSelected, run,
    } = props.importer;

    /**
     * Skills AGNT can already read from the other tools' own directories.
     * Seen minus importable, because "importable" is exactly the remainder
     * that AGNT does not already have a copy of.
     */
    const alreadyWorkingCount = computed(() =>
      Math.max(0, (totals.value.skillsSeen || 0) - (totals.value.skillsImportable || 0)),
    );

    /**
     * Carries the count, so the label itself reconciles the banner. Without
     * the numbers a reader has to infer that the four missing tools had
     * nothing left to offer, and nothing on screen confirms the inference.
     */
    const leadLabel = computed(() => {
      const shown = offerable.value.length;
      const all = sources.value.length;
      if (all <= shown) return 'Not in AGNT yet';
      return `Not in AGNT yet — ${shown} of your ${all} tools`;
    });

    /** "Claude Code, Codex and 2 others" — never an unbounded list. */
    const toolList = computed(() => {
      const names = sources.value.map((s) => s.label);
      if (names.length === 0) return 'your other tools';
      if (names.length <= 2) return names.join(' and ');
      return `${names[0]}, ${names[1]} and ${names.length - 2} other${names.length - 2 === 1 ? '' : 's'}`;
    });

    const offersFor = (source) => {
      const offers = [];
      if (source.skills.importable > 0) {
        offers.push({
          kind: 'skills',
          label: `${source.skills.importable} skill${source.skills.importable === 1 ? '' : 's'}`,
        });
      }
      if (source.persona.available) offers.push({ kind: 'personas', label: 'Agent persona' });
      if (source.memories.count > 0) {
        offers.push({
          kind: 'memories',
          label: `${source.memories.count} memor${source.memories.count === 1 ? 'y' : 'ies'}`,
        });
      }
      return offers;
    };

    /** Names the total so the button says what pressing it does. */
    const importLabel = computed(() => {
      if (selectedCount.value === 0) return 'Select what to bring over';
      const parts = [];
      const skills = sum(props.importer, 'skills', (s) => s.skills.importable);
      const agents = sum(props.importer, 'personas', () => 1);
      const memories = sum(props.importer, 'memories', (s) => s.memories.count);
      if (skills) parts.push(`${skills} skill${skills === 1 ? '' : 's'}`);
      if (agents) parts.push(`${agents} agent${agents === 1 ? '' : 's'}`);
      if (memories) parts.push(`${memories} memor${memories === 1 ? 'y' : 'ies'}`);
      return `Bring over ${parts.join(' · ')}`;
    });

    const doneSummary = computed(() => {
      const { skills = 0, agents = 0, memories = 0 } = result.value?.imported || {};
      const parts = [];
      if (skills) parts.push(`${skills} skill${skills === 1 ? '' : 's'}`);
      if (agents) parts.push(`${agents} agent${agents === 1 ? '' : 's'}`);
      if (memories) parts.push(`${memories} memor${memories === 1 ? 'y' : 'ies'}`);
      if (parts.length === 0) return 'Everything was already here — nothing to copy.';
      return `Brought over ${parts.join(', ')}.`;
    });

    const onImport = async () => {
      const done = await run();
      if (done) emit('imported', done);
    };

    return {
      sources, offerable, selectedCount, running, result, error,
      alreadyWorkingCount, toolList, leadLabel, offersFor, importLabel, doneSummary,
      toggle, isSelected, onImport,
    };
  },
};

/** Total across the sources ticked for one kind. */
function sum(importer, kind, pick) {
  let total = 0;
  for (const source of importer.sources.value) {
    if (importer.isSelected(kind, source.id)) total += pick(source);
  }
  return total;
}
</script>

<style scoped>
.harness-import {
  max-width: 520px;
  margin: 24px auto 0;
  text-align: left;
}

/* ── the part that needs no action ── */
.hi-already {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 0 0 24px;
  padding: 12px 14px;
  border: 1px solid rgba(var(--green-rgb), 0.25);
  border-radius: 10px;
  background: rgba(var(--green-rgb), 0.06);
  font-size: 0.88em;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.hi-already strong {
  color: var(--color-text);
  font-weight: 600;
}

/**
 * The tick is drawn inline rather than pulled from the icon set.
 *
 * `check.svg` is not a checkmark — it is a whole CHECKBOX: a dashed 31×31
 * bounding rect at 25% opacity with a 50%-opacity tick inside it. Rendered
 * beside a status line it reads as a greyed-out, disabled control the user
 * might be able to toggle, which is the opposite of the sentence it sits next
 * to; rendered inside our own checkbox it draws a box within a box.
 *
 * Inline also sidesteps SvgIcon's global `path[fill] { fill: var(--color-text) }`,
 * which out-specifies an inherited colour and is why the same icon renders
 * full-contrast white however carefully a consumer sets `color`.
 */
.hi-tick {
  flex-shrink: 0;
  width: 1em;
  height: 1em;
  display: block;
}

.hi-already .hi-tick {
  margin-top: 0.2em;
  color: var(--color-green);
}

/* ── one row per tool ── */
.hi-lead {
  margin: 0 0 10px;
  font-size: 0.8em;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.hi-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hi-row {
  padding: 14px;
  border: 1px solid var(--terminal-border-color);
  border-radius: 10px;
  background: var(--color-darker-1);
}

.hi-row-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.hi-icon {
  display: inline-flex;
  width: 20px;
  height: 20px;
  color: var(--color-text);
}

.hi-label {
  font-size: 0.95em;
  font-weight: 600;
  color: var(--color-text);
}

.hi-offers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* A toggle, not a link: it carries its own state and must look pressable in
   both states. Selected borrows the connected-tile treatment from the provider
   step, so "on" means one thing across the whole wizard. */
/* 2px, matching the provider tiles. A 1px muted stroke on this background is
   about 2:1 against the card and reads as a static label rather than something
   you can press — which is fatal for the unselected ones, since those are the
   choices the user has not made yet. */
.hi-offer {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 2px solid var(--color-text-muted);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.85em;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hi-offer:hover {
  border-color: var(--color-primary);
}

.hi-offer:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Tint only. The checked box already carries the green, and the banner above
   and the button below are green too — giving the border a fourth green in the
   same 400px makes none of them mean anything. */
.hi-offer.on {
  background: rgba(var(--green-rgb), 0.08);
}

.hi-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid var(--color-text-muted);
  border-radius: 4px;
}

/* Tinted, not filled. A solid green swatch this small is the highest-contrast
   pixel on the screen and pulls the eye off the button that actually does
   something. The border and the tick carry the state; the fill only supports
   them. */
.hi-offer.on .hi-box {
  border-color: var(--color-green);
  background: rgba(var(--green-rgb), 0.2);
  color: var(--color-green);
}

.hi-box :deep(.svg-icon),
.hi-box :deep(svg) {
  width: 10px;
  height: 10px;
}

/* The tick sits on the green fill of a checked box, so it is coloured to read
   against green rather than against the card. */
.hi-box .hi-tick {
  width: 10px;
  height: 10px;
}

/* ── footer ── */
/* Close to the button it explains. At a section-sized gap it floats free and
   reads as unrelated fine print rather than as this button's terms. */
.hi-note {
  margin: 10px 0 0;
  font-size: 0.82em;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.hi-warn {
  color: var(--color-red);
}

/* Tinted rather than outlined or solid. This is the point of the step, so a
   bare outline under-weights it; a solid green pill would be indistinguishable
   from the wizard's own Continue button sitting a few centimetres below, and
   two identical primaries is a worse problem than a quiet one. */
.hi-action {
  margin-top: 18px;
  padding: 12px 24px;
  border: 1px solid var(--color-primary);
  border-radius: 999px;
  background: rgba(var(--primary-rgb), 0.14);
  color: var(--color-primary);
  font-family: var(--font-family-primary);
  font-size: 1em;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hi-action:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.24);
}

.hi-action:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.hi-action:disabled {
  border-color: var(--terminal-border-color);
  background: transparent;
  color: var(--color-text-muted);
  cursor: not-allowed;
}

/* ── after ── */
.hi-done-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 1em;
  color: var(--color-text);
}

.hi-done-line .hi-tick {
  width: 1.1em;
  height: 1.1em;
  color: var(--color-green);
}

/* Aligned to the text beside the tick, not to the container. Starting at the
   container edge hangs it left of the sentence it belongs to and breaks the
   text column. Matches .hi-done-line's icon width plus its gap. */
.hi-done-note {
  padding-left: calc(1.1em + 10px);
}
</style>
