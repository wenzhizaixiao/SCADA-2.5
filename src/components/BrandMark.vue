<script setup>
defineProps({
  label: { type: String, default: '苔岑2D绘图' }
})
</script>

<template>
  <svg
    class="brand-symbol"
    viewBox="0 0 48 48"
    role="img"
    :aria-label="label"
  >
    <!-- 两层菱形都在固定视区内直接绘制，修改路径时应保留四周安全边距。 -->
    <path class="brand-symbol__body" d="M24 2.5 45.5 24 24 45.5 2.5 24Z" />
    <path class="brand-symbol__diamond" d="M24 12 36 24 24 36 12 24Z" />
  </svg>
</template>

<style scoped>
.brand-symbol {
  width: 42px;
  height: 42px;
  display: block;
  flex: 0 0 42px;
  overflow: visible;
}

.brand-symbol__body {
  fill: #16bea0;
}

.brand-symbol__diamond {
  fill: none;
  stroke: #fff;
  stroke-width: 3;
  stroke-linejoin: round;
}
</style>
