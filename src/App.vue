<script setup lang="ts">
import { onMounted } from 'vue'
import { screenManifest } from '@/config/screen-manifest'

let currentAction = ''

onMounted(() => {
  window.__screenManifest = screenManifest
  window.__openAction = (action: string) => {
    currentAction = action
    window.dispatchEvent(new CustomEvent('prototype-open', { detail: { action } }))
  }
  window.__setModalTab = (tab: string) => window.dispatchEvent(new CustomEvent('prototype-open', { detail: { action: currentAction, tab } }))
  window.__prototypeReady = true
})
</script>

<template><RouterView /></template>
