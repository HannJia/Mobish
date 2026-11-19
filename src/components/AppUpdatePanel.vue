<template>
  <div class="app-update-panel">
    <div class="update-overview">
      <div class="update-col update-col-current">
        <span class="update-version-label">当前版本</span><strong class="update-version-number">{{ state.currentVersion }}</strong>
        <p v-if="state.checkedAt" class="update-date">上次检查：{{ formatDate(state.checkedAt) }}</p>
      </div>
      <div class="update-col update-col-status">
        <p class="update-status" role="status">{{ statusText }}</p>
        <div v-if="state.phase === 'downloading'" class="update-progress">
          <div class="update-progress" role="progressbar" aria-label="下载进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(state.percent)">
            <span :style="{ width: Math.round(state.percent) + '%' }" />
          </div>
          <span>{{ megabytes(state.transferred) }} / {{ megabytes(state.total) }} MB</span>
        </div>
        <p v-if="state.error" class="update-error" role="alert">{{ state.error }}</p>
        <p class="update-release-version" v-if="state.release">最新版本 {{ state.release.version }}</p>
      </div>
      <div class="update-col update-col-actions">
        <div class="update-preference">
          <label :for="switchId">自动更新</label>
          <V3Switch :id="switchId" :value="state.autoCheck" :disabled="!state.supported || state.phase === 'installing'"
            aria-label="自动更新" @update:value="store.setAutoCheck" />
        </div>
        <p class="update-description">开启后自动下载新版。关闭后仍检查新版并显示红点提醒，可手动下载。安装前由你确认。</p>
        <div class="update-actions">
          <button type="button" class="m-btn" :disabled="!state.supported || busy || state.phase === 'downloaded' || state.phase === 'checking'" @click="store.check" :aria-busy="state.phase === 'checking'">
            <V3Icon name="refresh" size="s" />
            {{ state.phase === 'error' ? '重新检查' : '检查更新' }}
          </button>
          <button type="button" class="m-btn pri" v-if="state.phase === 'available' && state.release?.canDownload" @click="store.download">
            <V3Icon name="import" size="s" />下载更新
          </button>
          <button type="button" class="m-btn" v-if="state.phase === 'downloading'" @click="store.cancel">
            <V3Icon name="stop" size="s" />取消下载
          </button>
          <button type="button" class="m-btn pri" v-if="state.phase === 'downloaded'" @click="confirmInstall">
            <V3Icon name="power" size="s" />安装并重启
          </button>
          <button type="button" class="m-btn ghost" v-if="state.supported" :disabled="state.phase === 'installing'" @click="store.openRelease">
            <V3Icon name="external" size="s" />发布页
          </button>
          <a v-else class="update-release-link" href="https://github.com/HannJia/mobish/releases"
            target="_blank" rel="noopener noreferrer">GitHub 发布页</a>
        </div>
      </div>
    </div>
    <details v-if="state.release" class="update-notes" open>
      <summary>更新内容<span v-if="state.release.publishedAt"> · {{ formatDate(state.release.publishedAt) }}</span></summary>
      <pre>{{ state.release.notes || '此版本未提供更新说明。' }}</pre>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, useId } from 'vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import V3Switch from '@/v3/components/form/V3Switch.vue'
import { useAppUpdateStore } from '@/stores/appUpdate'
import { useUpdateInstall } from '@/composables/useUpdateInstall'

const store = useAppUpdateStore()
const switchId = useId()
const state = computed(() => store.state)
const { confirmInstall } = useUpdateInstall()
const busy = computed(() => ['checking', 'downloading', 'installing'].includes(state.value.phase))
const statusText = computed(() => {
  switch (state.value.phase) {
    case 'unsupported': return '浏览器 / 开发环境不安装更新，请使用 Windows 安装版。'
    case 'checking': return '正在检查 GitHub 正式版本…'
    case 'current': return '当前已是最新版本。'
    case 'available': return state.value.release?.canDownload
      ? (state.value.autoCheck ? '发现新版本，准备后台下载。' : '发现新版本，可手动下载。')
      : '已发现新版本，下载信息尚未就绪，可重试检查或打开发布页。'
    case 'downloading': return '正在后台下载更新，可以继续使用软件。'
    case 'downloaded': return '更新已准备好，点击“安装并重启”应用新版。'
    case 'installing': return '正在保存并准备安装，请稍候…'
    case 'error': return '更新检查或下载未完成。'
    default: return state.value.autoCheck ? '自动更新已开启。' : '自动更新已关闭。'
  }
})
const formatDate = (value: string) => new Date(value).toLocaleString('zh-CN')
const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
onMounted(() => { void store.init() })
</script>

<style scoped>
.update-progress { height: 6px; border-radius: 6px; background: var(--panel-2); overflow: hidden; }
.update-progress > span { display: block; height: 100%; background: var(--zhu); transition: width var(--motion-fast); }
.app-update-panel { display: grid; gap: 14px; min-width: 0; font-size: 14px; }
.update-overview { display: grid; gap: 16px; grid-template-columns: 1fr; min-width: 0; }
.update-col { display: grid; gap: 8px; align-content: start; min-width: 0; }
.update-col-current strong { font-size: 18px; line-height: 1.35; overflow-wrap: anywhere; }
.update-description { margin:0; font-size:12px; color:var(--ink-2); line-height:1.6; }
.update-preference { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.update-release-version, .update-date, .update-progress > span { color: var(--ink-2); font-size: 12px; margin: 0; }
.update-status, .update-error { margin: 0; overflow-wrap: anywhere; line-height: 1.6; }
.update-error { color: var(--zhu); }
.update-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.update-notes { border-top: 1px solid var(--line); padding-top: 12px; min-width: 0; }
.update-notes summary { cursor: pointer; line-height: 1.6; overflow-wrap: anywhere; }
.update-notes summary span { color: var(--ink-2); font-size: 12px; }
.update-notes pre { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; line-height: 1.7; margin: 10px 0 0; }
.update-release-link { color: var(--dai); }
@media (min-width: 900px) {
  .update-overview { grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1.6fr); align-items: start; }
}
.update-overview { padding: 24px; border: 1px solid var(--line); border-radius: var(--r-l); gap: 24px; }
.update-version-label { font-size: 16px; font-weight: 600; }
.update-col-current .update-version-number { font: 600 48px/1.3 var(--f-serif); }
.update-col-status .update-status { font: 600 21px/1.6 var(--f-serif); }
.update-release-version { color: var(--zhu); font-size: 16px; }
.update-col-actions .update-preference label { font-weight: 600; font-size: 16px; }
.update-notes { padding: 24px; border: 1px solid var(--line); border-radius: var(--r-l); }
.update-notes summary { font: 600 24px var(--f-serif); }
@media (min-width: 900px) { .update-col + .update-col { border-left: 1px solid var(--line); padding-left: 24px; } }
@media (max-width: 650px) { .update-overview, .update-notes { padding: 16px; } }
</style>
