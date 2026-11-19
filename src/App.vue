<template>
  <div class="app-provider">
    <V3Shell :inert="projectTransferBusy || appUpdateInstalling || (cloudApplyBusy && !cloudConfigApplying)" />
    <div v-if="projectTransferBusy" class="project-transfer-overlay" role="status">正在备份或恢复项目，请勿关闭软件…</div>
    <div v-if="appUpdateInstalling" class="project-transfer-overlay" role="status">正在保存并准备安装更新，请勿关闭软件…</div>
    <div v-if="cloudApplyBusy && !cloudConfigApplying" class="project-transfer-overlay" role="status">正在安全合并云端内容，请勿关闭软件…</div>
    <ExitConfirmDialog />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import ExitConfirmDialog from '@/components/ExitConfirmDialog.vue'
import V3Shell from '@/v3/V3Shell.vue'
import { appUpdateInstalling, cloudApplyBusy, cloudConfigApplying } from '@/services/appLifecycle'
import { projectTransferBusy } from '@/services/projectTransfer'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
onMounted(() => { themeStore.initTheme() })
</script>

<style>
.project-transfer-overlay { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; background: var(--desk); color: var(--ink); padding: 24px; }
.app-provider { width: 100%; height: 100%; min-height: 0; display: flex; flex-direction: column; }
</style>
