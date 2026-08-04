<script setup>
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { jsonPathForChild, jsonValueType } from '../utils/jsonPathBinding.js'
import { formatRuntimeValue } from '../utils/runtimeValueFormat.js'

const props = defineProps({
  value: { default: null },
  selectedPath: { type: String, default: '$' },
  maxChildren: { type: Number, default: 60 },
  maxVisible: { type: Number, default: 240 },
  maxDepth: { type: Number, default: 12 }
})

const emit = defineEmits({
  select: payload => Boolean(payload?.path)
})

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const expandedPaths = ref(new Set(['$']))

function boundedInteger(value, fallback, minimum, maximum) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

const childLimit = computed(() => boundedInteger(props.maxChildren, 60, 1, 200))
const visibleLimit = computed(() => boundedInteger(props.maxVisible, 240, 20, 1000))
const depthLimit = computed(() => boundedInteger(props.maxDepth, 12, 1, 32))

function container(value) {
  return value !== null && typeof value === 'object'
}

function safeArrayLength(value) {
  try {
    const length = Math.trunc(Number(value.length))
    return Number.isFinite(length) ? Math.min(0xffffffff, Math.max(0, length)) : 0
  } catch {
    return 0
  }
}

function safeRead(value, key) {
  try {
    return { ok: true, value: value[key] }
  } catch {
    return { ok: false, value: '[无法读取]' }
  }
}

// 只枚举当前展开层，并在到达预算后立即停止，不为大对象建立完整中间数组。
function childEntries(value) {
  const limit = childLimit.value
  if (Array.isArray(value)) {
    const length = safeArrayLength(value)
    const count = Math.min(length, limit)
    const entries = []
    for (let index = 0; index < count; index += 1) {
      const item = safeRead(value, index)
      entries.push({ key: index, value: item.value, readable: item.ok })
    }
    return { entries, truncated: length > count }
  }

  const entries = []
  let scanned = 0
  const scanLimit = limit * 2 + 16
  let truncated = false
  try {
    for (const key in value) {
      scanned += 1
      if (scanned > scanLimit || entries.length >= limit) {
        truncated = true
        break
      }
      if (UNSAFE_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(value, key)) continue
      const item = safeRead(value, key)
      entries.push({ key, value: item.value, readable: item.ok })
    }
  } catch {
    truncated = true
  }
  return { entries, truncated }
}

function hasChildren(value) {
  if (!container(value)) return false
  if (Array.isArray(value)) return safeArrayLength(value) > 0
  let scanned = 0
  try {
    for (const key in value) {
      scanned += 1
      if (scanned > 32) return true
      if (!UNSAFE_KEYS.has(key) && Object.prototype.hasOwnProperty.call(value, key)) return true
    }
  } catch {}
  return false
}

function previewText(value, type) {
  if (type === 'array') return `[${safeArrayLength(value)} 项]`
  if (type === 'object') return '{...}'
  if (type === 'null') return 'null'
  return formatRuntimeValue(value, {
    maxLength: 72,
    maxDepth: 1,
    maxArrayItems: 2,
    maxObjectKeys: 2,
    maxTotalEntries: 4
  })
}

const rows = computed(() => {
  const result = []
  let budgetExhausted = false

  function append(value, path, key, depth, readable = true) {
    if (result.length >= visibleLimit.value) {
      budgetExhausted = true
      return
    }
    const type = readable ? jsonValueType(value) : 'unknown'
    const expandable = readable && depth < depthLimit.value && hasChildren(value)
    const expanded = expandable && expandedPaths.value.has(path)
    result.push({
      kind: 'value',
      key,
      path,
      depth,
      type,
      value,
      expandable,
      expanded,
      preview: readable ? previewText(value, type) : '[无法读取]'
    })
    if (!expanded) return

    const children = childEntries(value)
    for (const child of children.entries) {
      if (result.length >= visibleLimit.value) {
        budgetExhausted = true
        break
      }
      let childPath
      try {
        childPath = jsonPathForChild(path, child.key)
      } catch {
        continue
      }
      append(child.value, childPath, child.key, depth + 1, child.readable)
    }
    if (children.truncated && result.length < visibleLimit.value) {
      result.push({ kind: 'more', path: `${path}#more`, depth: depth + 1 })
    }
  }

  append(props.value, '$', '$', 0)
  if (budgetExhausted && result.length < visibleLimit.value) {
    result.push({ kind: 'budget', path: '#budget', depth: 0 })
  }
  return result
})

function toggle(row) {
  if (!row.expandable) return
  const next = new Set(expandedPaths.value)
  if (next.has(row.path)) next.delete(row.path)
  else next.add(row.path)
  expandedPaths.value = next
}

function select(row) {
  if (row.kind !== 'value') return
  emit('select', { path: row.path, value: row.value, valueType: row.type })
}

watch(() => props.value, () => {
  expandedPaths.value = new Set(['$'])
})
</script>

<template>
  <div class="json-path-tree" role="tree" aria-label="JSON 数据结构" data-testid="communication-json-tree">
    <div
      v-for="row in rows"
      :key="row.path"
      class="json-tree-row"
      :class="[{ selected: row.kind === 'value' && row.path === selectedPath }, `row-${row.kind}`]"
      :style="{ '--tree-depth': row.depth }"
      :role="row.kind === 'value' ? 'treeitem' : 'status'"
      :aria-selected="row.kind === 'value' ? row.path === selectedPath : undefined"
    >
      <template v-if="row.kind === 'value'">
        <button
          type="button"
          class="tree-toggle"
          :class="{ empty: !row.expandable }"
          :disabled="!row.expandable"
          :aria-label="row.expanded ? '收起字段' : '展开字段'"
          @click.stop="toggle(row)"
        >
          <ChevronDown v-if="row.expanded" />
          <ChevronRight v-else-if="row.expandable" />
        </button>
        <button type="button" class="tree-value" :title="row.path" @click="select(row)">
          <code>{{ row.key }}</code>
          <span>{{ row.preview }}</span>
          <em>{{ row.type }}</em>
        </button>
      </template>
      <span v-else-if="row.kind === 'more'" class="tree-message">该层数据较多，仅显示前 {{ childLimit }} 项</span>
      <span v-else class="tree-message">已达到可见节点上限，请收起其他分支后查看</span>
    </div>
  </div>
</template>

<style scoped>
.json-path-tree,
.json-path-tree * {
  box-sizing: border-box;
}

.json-path-tree {
  min-width: 0;
  max-height: 300px;
  overflow: auto;
  border: 1px solid #dfe5e7;
  background: #fff;
  color: #405761;
  font-size: 10px;
}

.json-tree-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: stretch;
  min-width: 0;
  min-height: 29px;
  padding-left: calc(var(--tree-depth) * 12px + 3px);
  border-bottom: 1px solid #f0f2f3;
}

.json-tree-row.selected {
  box-shadow: inset 3px 0 #16a88f;
  background: #edf9f6;
}

.tree-toggle,
.tree-value {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
}

.tree-toggle {
  display: grid;
  place-items: center;
  width: 20px;
}

.tree-toggle:disabled {
  opacity: 1;
}

.tree-toggle svg {
  width: 13px;
  height: 13px;
}

.tree-value {
  display: grid;
  grid-template-columns: minmax(40px, auto) minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 6px 5px 1px;
  text-align: left;
}

.tree-value:hover,
.tree-value:focus-visible {
  outline: 0;
  background: #f3faf8;
}

.tree-value code,
.tree-value span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-value code {
  color: #2f5965;
  font: 10px Consolas, monospace;
  font-weight: 600;
}

.tree-value span {
  color: #74858d;
}

.tree-value em {
  color: #91a0a6;
  font-size: 8px;
  font-style: normal;
}

.row-more,
.row-budget {
  display: block;
  padding: 6px 8px 6px calc(var(--tree-depth) * 12px + 24px);
  color: #8b979d;
}

.tree-message {
  line-height: 1.5;
}
</style>
