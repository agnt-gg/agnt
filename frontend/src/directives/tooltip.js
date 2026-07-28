/**
 * v-tooltip — the attribute form of the tooltip.
 *
 *   v-tooltip="'Delete'"                 static
 *   v-tooltip="item.reason"              dynamic (blank value shows nothing)
 *   v-tooltip.bottom="'Forward'"         placement via modifier
 *   v-tooltip="{ text, title, position, width }"   full options
 *
 * This is the drop-in for a native `title`: it attaches to the element itself,
 * so the DOM is unchanged and no layout, selector or sizing can shift.
 *
 * ACCESSIBLE NAME. `title` does double duty — it is both a tooltip and, on an
 * icon-only control, the element's accessible name. Dropping it would silently
 * leave ~50 icon buttons in this app unnamed for screen readers. So when the
 * element has no other name, the directive supplies one via aria-label. When
 * it already has visible text or an explicit label, the tooltip is only a
 * description and the existing name is left alone.
 */
import { showTooltip, hideTooltip, normalizeTooltipOptions } from './tooltipEngine.js';

const STATE = Symbol('tooltipState');

/** Does the element already convey a name without our help? */
function hasAccessibleName(el) {
  if (el.getAttribute('aria-label')?.trim()) return true;
  if (el.getAttribute('aria-labelledby')?.trim()) return true;
  if (el.textContent?.trim()) return true;
  // <input> is named by its value/placeholder, never by its own text.
  if (el.tagName === 'INPUT' && (el.value || el.getAttribute('placeholder'))) return true;
  return false;
}

function syncAccessibleName(el, state, text) {
  if (!text) {
    if (state.ownsLabel) {
      el.removeAttribute('aria-label');
      state.ownsLabel = false;
    }
    return;
  }

  if (state.ownsLabel) {
    el.setAttribute('aria-label', text);
    return;
  }

  if (!hasAccessibleName(el)) {
    el.setAttribute('aria-label', text);
    state.ownsLabel = true;
  }
}

function apply(el, binding) {
  const options = normalizeTooltipOptions(binding.value, binding.modifiers);
  const state = el[STATE];
  state.options = options;

  // A native title on the same element would render the OS tooltip on top of
  // ours. The directive wins; stash the value so nothing is lost.
  if (el.hasAttribute('title')) {
    state.nativeTitle = el.getAttribute('title');
    el.removeAttribute('title');
  }

  syncAccessibleName(el, state, options.text);

  if (!options.text) hideTooltip(el);
  else if (state.visible) showTooltip(el, options); // live-update while open
}

export const vTooltip = {
  mounted(el, binding) {
    const state = {
      options: null,
      visible: false,
      ownsLabel: false,
      nativeTitle: null,
      show: () => {
        if (!state.options?.text) return;
        state.visible = true;
        showTooltip(el, state.options);
      },
      hide: () => {
        state.visible = false;
        hideTooltip(el);
      },
    };
    el[STATE] = state;

    el.addEventListener('mouseenter', state.show);
    el.addEventListener('mouseleave', state.hide);
    // focusin/focusout, NOT focus/blur: the latter do not bubble, which is why
    // the wrapper component never showed a tooltip for keyboard users.
    el.addEventListener('focusin', state.show);
    el.addEventListener('focusout', state.hide);

    apply(el, binding);
  },

  updated(el, binding) {
    if (!el[STATE]) return;
    apply(el, binding);
  },

  beforeUnmount(el) {
    const state = el[STATE];
    if (!state) return;

    el.removeEventListener('mouseenter', state.show);
    el.removeEventListener('mouseleave', state.hide);
    el.removeEventListener('focusin', state.show);
    el.removeEventListener('focusout', state.hide);

    hideTooltip(el);
    delete el[STATE];
  },
};

export default vTooltip;
