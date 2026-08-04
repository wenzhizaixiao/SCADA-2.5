<script setup>
import { computed } from 'vue'

const props = defineProps({
  drawings: { type: Array, default: () => [] },
  entryFactory: { type: Function, required: true },
  generation: { type: Number, default: 0 }
})

const entries = computed(() => {
  void props.generation
  return props.drawings.map(props.entryFactory)
})
</script>

<template>
  <svg
    v-for="entry in entries"
    :key="entry.drawing.id"
    v-memo="[generation,entry.drawing,entry.frame.x,entry.frame.y,entry.frame.w,entry.frame.h,entry.path,entry.drawing.layer,entry.drawing.closed,entry.drawing.color,entry.drawing.width,entry.drawing.dash,entry.drawing.lineCap,entry.drawing.lineJoin,entry.drawing.opacity]"
    class="drawing-layer preview-drawing"
    :style="{ left: entry.frame.x + 'px', top: entry.frame.y + 'px', width: entry.frame.w + 'px', height: entry.frame.h + 'px', zIndex: Number(entry.drawing.layer) || 0 }"
    :viewBox="`${entry.frame.x} ${entry.frame.y} ${entry.frame.w} ${entry.frame.h}`"
    preserveAspectRatio="none"
  >
    <path
      :d="entry.path"
      :fill="entry.drawing.closed ? `${entry.drawing.color}22` : 'none'"
      :stroke="entry.drawing.color"
      :stroke-width="entry.drawing.width"
      :stroke-dasharray="entry.drawing.dash ? '8 6' : ''"
      :stroke-linecap="entry.drawing.lineCap || 'round'"
      :stroke-linejoin="entry.drawing.lineJoin || 'round'"
      :opacity="entry.drawing.opacity ?? 1"
    />
  </svg>
</template>
