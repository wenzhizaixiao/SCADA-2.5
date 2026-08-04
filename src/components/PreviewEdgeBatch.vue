<script setup>
import { computed } from 'vue'
import { edgeEndpointsForNodes } from '../utils/edgeGeometry'

const props = defineProps({
  edges: { type: Array, default: () => [] },
  nodeIndex: { type: Object, required: true },
  generation: { type: Number, default: 0 }
})

const entries = computed(() => {
  void props.generation
  return props.edges.map(edge => ({
    edge,
    ...(edgeEndpointsForNodes(edge, props.nodeIndex) || {
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 }
    })
  }))
})

function markerUrl(marker) {
  return marker && marker !== 'none' ? `url(#preview-${marker})` : undefined
}
</script>

<template>
  <line
    v-for="entry in entries"
    :key="entry.edge.id"
    v-memo="[generation,entry.edge,entry.start.x,entry.start.y,entry.end.x,entry.end.y,entry.edge.color,entry.edge.width,entry.edge.dash,entry.edge.startMarker,entry.edge.endMarker]"
    :x1="entry.start.x"
    :y1="entry.start.y"
    :x2="entry.end.x"
    :y2="entry.end.y"
    :stroke="entry.edge.color"
    :stroke-width="entry.edge.width"
    :stroke-dasharray="entry.edge.dash ? '8 6' : ''"
    stroke-linecap="round"
    :marker-start="markerUrl(entry.edge.startMarker)"
    :marker-end="markerUrl(entry.edge.endMarker)"
  />
</template>
