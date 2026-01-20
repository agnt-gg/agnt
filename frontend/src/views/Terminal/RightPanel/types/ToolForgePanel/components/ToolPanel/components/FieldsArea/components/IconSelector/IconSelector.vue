<template>
  <div class="field-group">
    <p class="label" for="template-icon">Tool Template Icon</p>
    <div id="icon-selector" class="icon-selector">
      <div v-for="icon in availableIcons" :key="icon" class="icon-option" :class="{ selected: iconValue === icon }" @click="selectIcon(icon)">
        <SvgIcon :name="icon" :data-icon-name="icon" />
      </div>
    </div>
    <input type="hidden" id="template-icon" name="template-icon" :value="iconValue" />
  </div>
</template>

<script>
import SvgIcon from '@/views/_components/common/SvgIcon.vue';

export default {
  name: 'IconSelector',
  components: {
    SvgIcon,
  },
  props: {
    iconValue: {
      type: String,
      default: 'custom',
    },
  },
  emits: ['update:iconValue'],
  data() {
    return {
      availableIcons: [
        'custom',
        'agent',
        'clock',
        'code',
        'connect',
        'cross',
        'dice',
        'document',
        'flow-2',
        'hourglass',
        'import',
        'inbox',
        'loop',
        'magic',
        'outbox',
        'output',
        'params',
        'table',
        'text',
        'timer',
        'transform',
        'twitter',
        'video',
        'web',
      ],
    };
  },
  methods: {
    selectIcon(icon) {
      this.$emit('update:iconValue', icon);
    },
  },
};
</script>

<style scoped>
.icon-selector {
  display: flex;
  flex-wrap: wrap;
  max-height: 120px;
  overflow-y: scroll;
  gap: 5.64px;
}

.icon-option {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgb(255, 255, 255, 0.25);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  opacity: 0.25;
  filter: grayscale(1);
}

.icon-option:hover {
  background-color: var(--color-background-hover);
  opacity: 0.5;
}

.icon-option.selected {
  background-color: var(--color-pink);
  border: 1px solid rgb(255, 255, 255, 0);
  color: white;
  opacity: 1;
  filter: grayscale(0);
}

.icon-option svg {
  width: 24px;
  height: 24px;
}
</style>
