<template>
  <LoadingOverlay v-if="isLoading" />
  <main-area :class="mainAreaClasses">
    <slot></slot>
  </main-area>
</template>

<script>
// import LeftSidebar from "@/views/_components/layout/LeftSidebar.vue";
import LoadingOverlay from "@/views/_components/utility/LoadingOverlay.vue";
import WindowControls from "@/views/_components/layout/WindowControls.vue";
import { mapGetters } from 'vuex';

export default {
  name: "MainLayout",
  components: {
    // LeftSidebar,
    LoadingOverlay,
    WindowControls,
  },
  props: {
    isLoading: {
      type: Boolean,
      default: false,
    },
    drawingMode: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    ...mapGetters({
      isAuthenticated: 'userAuth/isAuthenticated'
    }),
    mainAreaClasses() {
      return {
        'drawing-mode': this.drawingMode,
        'not-logged-in': !this.isAuthenticated
      };
    }
  },
};
</script>

<style scoped>
main-layout {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

main-area {
  position: relative;
  justify-content: center;
  background-color: transparent;
  z-index: 11;
  width: calc(100% - 48px);
  margin: 0;
  height: 100vh;
}

main-area.drawing-mode {
  width: fit-content;
}

main-area.not-logged-in {
  width: 100%;
  left: 0;
}

body.dark main-area {
  background: transparent;
}

</style>
