<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ name: string; size?: number; variant?: 'line' | 'feature'; label?: string }>(), { size: 18, variant: 'line', label: '' })
const source = computed(() => `./assets/icons/${props.variant}/${props.name}.png`)
const style = computed(() => props.variant === 'line'
  ? { width: `${props.size}px`, height: `${props.size}px`, maskImage: `url("${source.value}")`, WebkitMaskImage: `url("${source.value}")` }
  : { width: `${props.size}px`, height: `${props.size}px` })
</script>

<template>
  <img v-if="variant === 'feature'" class="app-icon feature" :src="source" :style="style" :alt="label">
  <span v-else class="app-icon line" :style="style" :aria-label="label || undefined" :aria-hidden="!label" />
</template>
