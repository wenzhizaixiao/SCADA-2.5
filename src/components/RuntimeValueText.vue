<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { formatRuntimeValue } from '../utils/runtimeValueFormat'

const props = defineProps({
  dataKey: { type: String, default: '' },
  runtimeStore: { type: Object, default: null },
  tag: { type: String, default: 'small' },
  className: { type: String, default: 'runtime-value' },
  fallback: { default: undefined }
})

const element = ref(null)

function displayValue(value) {
  const resolved = value === undefined ? props.fallback : value
  if (resolved === undefined || resolved === null) return { hidden: true, text: '' }
  return { hidden: false, text: formatRuntimeValue(resolved) }
}

const initial = displayValue(props.runtimeStore?.getValue(String(props.dataKey || '').trim()))
let unsubscribe = null
let mounted = false

function renderValue(value) {
  const target = element.value
  if (!target) return
  const display = displayValue(value)
  target.hidden = display.hidden
  target.textContent = display.text
}

onMounted(() => {
  mounted = true
  syncSubscription()
})

function syncSubscription() {
  if (!mounted) return
  unsubscribe?.()
  unsubscribe = null
  const key = String(props.dataKey || '').trim()
  renderValue(key ? props.runtimeStore?.getValue(key) : undefined)
  if (key) unsubscribe = props.runtimeStore?.subscribe(key, renderValue) || null
}

watch([() => props.runtimeStore, () => props.dataKey, () => props.fallback], syncSubscription)
onUnmounted(() => {
  mounted = false
  unsubscribe?.()
})
</script>

<template>
  <component :is="tag" ref="element" :class="className" :hidden="initial.hidden">{{ initial.text }}</component>
</template>
