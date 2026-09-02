<template>
  <section class="insp-sec">
    <div class="insp-sec-hd">
      <span class="insp-sec-title">{{ title }}</span>
      <span class="insp-sec-ln"></span>
      <button v-if="action" type="button" class="insp-sec-act" @click="$emit('action')">{{ action }}</button>
    </div>
    <div class="insp-sec-body">
      <slot></slot>
    </div>
  </section>
</template>

<script>
/** A labelled block inside an InspectorShell body: caps title · rule · optional action. */
export default {
  name: 'InspSection',
  props: {
    title: { type: String, required: true },
    action: { type: String, default: '' },
  },
  emits: ['action'],
};
</script>

<style scoped>
.insp-sec {
  margin-bottom: 14px;
}
.insp-sec-hd {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
  font-size: 9.5px;
  letter-spacing: 0.17em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}
.insp-sec-ln {
  flex: 1;
  height: 1px;
  background: var(--terminal-border-color);
}
.insp-sec-act {
  border: 0;
  background: none;
  color: var(--color-green);
  font: inherit;
  font-size: 10.5px;
  letter-spacing: 0;
  text-transform: none;
  cursor: pointer;
  padding: 0;
}
.insp-sec-body {
  font-size: 12.5px;
}
</style>
