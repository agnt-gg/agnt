<!-- EmbedScope — gives one workspace window its own panel-geometry scope.

     `provide` is per component instance, and the workspace renders every
     window from a single `v-for` in one setup(), so it cannot provide a
     different scope per window from there. This wrapper exists only to hold
     that provide: one instance per window, one scope each.

     It renders nothing of its own (a Fragment around the slot), so it adds
     no box to the layout and cannot affect the embedded screen's sizing. -->
<script>
import { provide } from 'vue';
import { provideSurfaceIdentity } from '@/canvas/surfaceFederation.js';

export default {
  name: 'WorkspaceEmbedScope',
  props: {
    /** { get(key), set(key, value) } — see useWorkspaces.panelScopeFor. */
    scope: { type: Object, required: true },
    /** This window's identity, for chat federation. See surfaceFederation.js. */
    instanceId: { type: String, default: null },
    widgetId: { type: String, default: null },
  },
  setup(props, { slots }) {
    // Provided once, by identity. panelScopeFor memoises per instanceId, so
    // this object is stable for the life of the window and BaseScreen's
    // inject never sees it change underneath it.
    provide('panelWidthScope', props.scope);
    // The same per-instance reason this component exists at all: a screen must
    // be able to answer "which window am I?" so it can publish its chat
    // contribution and refuse events addressed to a sibling. Both ids are
    // immutable for the life of a window (navigateWidget swaps widgetId in
    // place, and WidgetFrame is :key'd on instanceId, so a widget change
    // remounts this scope).
    provideSurfaceIdentity(props.instanceId, props.widgetId);
    return () => slots.default?.();
  },
};
</script>
