<script setup>
import NodeVisual from './NodeVisual.vue'

const bindingArrayIds = new WeakMap()
let nextBindingArrayId = 1

function bindingRenderKey(node) {
  const bindings = node?.dataBindings
  if (!Array.isArray(bindings) || !bindings.length) return 'static'
  let id = bindingArrayIds.get(bindings)
  if (!id) {
    id = nextBindingArrayId++
    bindingArrayIds.set(bindings, id)
  }
  return `bindings-${id}`
}

defineProps({
  nodes: { type: Array, default: () => [] },
  runtimeStore: { type: Object, default: null },
  timeContext: { type: Object, default: null }
})

const emit = defineEmits(['form-change', 'table-cell-view'])
</script>

<template>
  <div
    v-for="node in nodes"
    :key="node.id"
    v-memo="[node,node.x,node.y,node.w,node.h,node.rotate,node.layer,node.visible,node.dataKey,node.dataBindings,node.animation,node.animationDuration,node.animationDirection,node.animationPaused,node.visualPrimaryColor,node.signalColorCount,node.signalColors,node.signalOpacity,runtimeStore,timeContext]"
    class="node-shell preview-node"
    :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.w}px`, height: `${node.h}px`, zIndex: Number(node.layer) || 0, transform: `rotate(${node.rotate || 0}deg)` }"
  >
    <NodeVisual
      :key="`${node.id}:${node.dataKey}:${bindingRenderKey(node)}`"
      :node="node"
      :runtime-store="runtimeStore"
      :time-context="timeContext"
      preview
      @form-change="emit('form-change', node, $event)"
      @table-cell-view="emit('table-cell-view', node, $event)"
    />
  </div>
</template>
