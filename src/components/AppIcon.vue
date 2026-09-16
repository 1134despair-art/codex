<script setup lang="ts">
import { computed } from 'vue'
import { assetUrl } from '@/services/assets'

const props = withDefaults(defineProps<{ name: string; size?: number; variant?: 'line' | 'feature'; label?: string }>(), { size: 18, variant: 'line', label: '' })
const iconAliases: Record<string, string> = {
  check: 'circle-check-big',
  'file-text': 'scroll-text',
  'file-up': 'upload',
  'globe-2': 'compass',
  'image-plus': 'image-up',
  inbox: 'package-open',
  'rotate-ccw': 'refresh-cw',
}
const source = computed(() => assetUrl(`/assets/icons/${props.variant}/${iconAliases[props.name] || props.name}.png`))
const style = computed(() => props.variant === 'line'
  ? { width: `${props.size}px`, height: `${props.size}px`, maskImage: `url("${source.value}")`, WebkitMaskImage: `url("${source.value}")` }
  : { width: `${props.size}px`, height: `${props.size}px` })
</script>

<template>
  <img v-if="variant === 'feature'" class="app-icon feature" :src="source" :style="style" :alt="label">
  <span v-else class="app-icon line" :style="style" :aria-label="label || undefined" :aria-hidden="!label" />
</template>
