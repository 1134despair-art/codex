<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
defineProps<{ forbidden?: boolean }>()
</script>

<template><section class="page"><div class="surface empty-state"><img :src="'./assets/illustrations/empty-no-results.png'" alt="空设备箱与检查清单"><h2>{{ forbidden ? '没有访问权限' : '没有找到这个页面' }}</h2><p>{{ forbidden ? '当前角色的数据范围或功能权限不包含该页面。' : '该地址不存在，请返回工作台继续操作。' }}</p><RouterLink class="el-button el-button--primary" to="/dashboard">返回工作台 <AppIcon name="arrow-right" /></RouterLink></div></section></template>
