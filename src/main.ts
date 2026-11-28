import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { blockNavigationWhileProjectBusy } from './router/busyGuard'
import { useNovelStore } from './stores/novel'
import { useConfigStore } from './stores/config'
import { useKnowledgeStore } from './stores/knowledge'
import { initializeAiTaskHistory } from './services/aiTaskQueue'
import { showRecoveryScreen } from './services/recoveryScreen'
import { flushEditorDrafts } from './services/appLifecycle'
import { useReconstructionWorkspaceStore } from './stores/reconstructionWorkspace'
import { prepareUpdateInstall } from './services/updateSafety'
import { CLOUD_SYNC_AVAILABLE } from '@/services/features'
import { useCloudSyncStore } from './stores/cloudSync'
import { useCloudPreferencesStore } from './stores/cloudPreferences'
import { useInspirationSessionsStore } from './stores/inspirationSessions'
import { useOnboardingStore } from './stores/onboarding'
import { hadProjectSnapshotBeforeInit, initializeProjectKernel } from './services/projectKernelClient'
import { windowCloseContext } from './services/windowClose'

// 全局样式
import './v3/styles/base.css'
import '@fontsource-variable/noto-serif-sc/wght.css'
import '@fontsource-variable/noto-sans-sc/wght.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import 'lxgw-wenkai-webfont/lxgwwenkai-regular.css'
import './v3/styles/v3.css'
import { startWritingLog } from './v3/writingLog'

async function bootstrap() {
  const app = createApp(App)

  app.config.errorHandler = (err, _vm, info) => {
    console.error('Vue error:', err, info)
  }

  const pinia = createPinia()
  router.beforeEach(blockNavigationWhileProjectBusy)
  app.use(pinia)
  app.use(router)

  try {
    const configStore = useConfigStore()
    const configLoaded = await configStore.loadConfig()

    await initializeProjectKernel()

    const novelStore = useNovelStore()
    await novelStore.initStore()

    const knowledgeStore = useKnowledgeStore()
    await knowledgeStore.initStore()
    await useInspirationSessionsStore().initialize()
    await useOnboardingStore().initialize({ hadPreExistingSnapshot: hadProjectSnapshotBeforeInit(), configLoadFailed: !configLoaded })
    void initializeAiTaskHistory().catch(error => console.warn('AI task recovery update failed', error))

    window.electronAPI?.onBeforeClose?.(async () => {
      await flushEditorDrafts()
      await knowledgeStore.flushPendingSaves()
      await novelStore.flushPendingSaves()
      await Promise.all([
        useInspirationSessionsStore().flushPendingSaves(),
        useReconstructionWorkspaceStore().flushPendingSaves(novelStore.novels.map(novel => novel.id)),
        configStore.flushPendingSaves(),
      ])
      if (CLOUD_SYNC_AVAILABLE) await useCloudSyncStore().flushBeforeClose()
      return windowCloseContext(router.currentRoute.value.path)
    })
    window.electronAPI?.onBeforeUpdate?.(prepareUpdateInstall)
  } catch (err) {
    console.error('数据初始化失败:', err)
    showRecoveryScreen(err)
    // No project was mounted or edited, so closing this recovery screen needs
    // no save and must not time out waiting for the normal application handler.
    window.electronAPI?.onBeforeClose?.(() => undefined)
    return
  }

  app.mount('#app')
  startWritingLog()
  if (CLOUD_SYNC_AVAILABLE) {
    void useCloudSyncStore().initialize().then(() => useCloudPreferencesStore().initialize())
    router.afterEach(() => useCloudSyncStore().schedule())
  }
}

bootstrap()
