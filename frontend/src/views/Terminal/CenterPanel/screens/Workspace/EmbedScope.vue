<!-- EmbedScope — gives one canvas window its own panel-geometry scope.

     `provide` is per component instance, and the workspace renders every
     window from a single `v-for` in one setup(), so it cannot provide a
     different scope per window from there. This wrapper exists only to hold
     that provide: one instance per window, one scope each.

     It renders nothing of its own (a Fragment around the slot), so it adds
     no box to the layout and cannot affect the embedded screen's sizing. -->
<script>
import { provide } from 'vue';

export default {
  name: 'WorkspaceEmbedScope',
  props: {
    /** { get(key), set(key, value) } — see useWorkspaces.panelScopeFor. */
    scope: { type: Object, required: true },
  },
  setup(props, { slots }) {
    // Provided once, by identity. panelScopeFor memoises per instanceId, so
    // this object is stable for the life of the window and BaseScreen's
    // inject never sees it change underneath it.
    provide('panelWidthScope', props.scope);
    return () => slots.default?.();
  },
};
</script>
