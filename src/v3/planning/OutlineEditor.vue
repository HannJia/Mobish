<template>
  <BookPage>
  <div class="outline-view" id="outline-view">
    <div class="outline-header">
      <h2 class="page-title">总大纲</h2>
      <div class="header-actions" v-if="novel?.outline">
        <button type="button" class="m-btn sm" :disabled="saving || modifying" @click="startEdit" v-if="!editing">
          编辑
        </button>
        <button type="button" class="m-btn sm" :disabled="saving" @click="editing = false" v-if="editing">
          预览
        </button>
        <button type="button" class="m-btn pri sm" :disabled="(saving || modifying || editing) || (regenerating)" @click="regenerate" :aria-busy="regenerating">
          重新生成
        </button>
      </div>
    </div>

    <!-- 无大纲 -->
    <div v-if="!novel?.outline" class="empty-outline paper-panel">
      <img class="m-art empty-art" :src="outlineArt" alt="">
      <h3>还没有大纲</h3>
      <p>前往大纲生成页面，让 AI 为你构思整本小说的大纲</p>
      <button type="button" class="m-btn pri" @click="$router.push(`/generate/${novelId}`)">
        生成大纲
      </button>
    </div>

    <!-- 编辑模式 -->
    <div v-else-if="editing" class="outline-editor paper-panel">
      <V3Input
        v-model:value="editContent"
        :disabled="saving"
        type="textarea"
        :rows="30"
        placeholder="在此编辑大纲内容（Markdown 格式）"
      />
      <div class="editor-actions">
        <button type="button" class="m-btn" :disabled="saving" @click="editing = false">取消</button>
        <button type="button" class="m-btn pri" :disabled="saving" @click="saveEdit" :aria-busy="saving">保存</button>
      </div>
    </div>

    <!-- 预览模式 + AI 修改 -->
    <div v-else class="outline-reading-container">
      <div class="outline-preview paper-panel">
        <div class="rendered-content" v-html="renderedContent"></div>
      </div>

      <!-- AI 局部修改面板 -->
      <aside v-if="novel?.outline" class="ai-modify-panel paper-panel">
        <div class="modify-header">
          <h3>AI 助手</h3><span class="outline-assistant-tab">局部修改</span>
        </div>
        <V3Input
          v-model:value="modifyInstruction"
          :disabled="saving || modifying"
          type="textarea"
          :rows="2"
          placeholder="描述你想修改的内容，例如：&#10;• 把主角身份改为修仙门派弃徒&#10;• 增加一条暗线：宝物争夺&#10;• 减少恋爱戏份，增加打斗描写"
        />
        <button type="button" class="m-btn pri sm" @click="aiModifyOutline" :disabled="saving || modifying || !modifyInstruction.trim()" :aria-busy="modifying">
          {{ modifying ? 'AI 修改中...' : '生成修改建议' }}
        </button>
        <div v-if="modifyPreview" class="modify-preview">
          <div class="modify-label">修改预览：</div>
          <div class="modify-content" v-html="renderMd(modifyPreview)"></div>
          <div class="modify-actions">
            <button type="button" class="m-btn xs" :disabled="saving || modifying" @click="modifyPreview = ''">放弃</button>
            <button type="button" class="m-btn pri xs" :disabled="saving || modifying || !modifyComplete" @click="acceptModify">采纳修改</button>
          </div>
        </div>
      </aside>
    </div>
  </div>
  </BookPage>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import BookPage from '@/v3/components/BookPage.vue'
import { ref, computed, onDeactivated, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from '@/v3/feedback'
import V3Input from '@/v3/components/form/V3Input.vue'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { callAI } from '@/services/ai'
import { renderMd } from '@/utils/markdown'
import { captureStoryContextBaseline } from '@/services/storyImpactTransactions'
import outlineArt from '@/assets/v3/empty/outline.webp'

const route = useRoute()
const router = useRouter()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const message = useMessage()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))

const editing = ref(false)
const editContent = ref('')
const regenerating = ref(false)
const modifyInstruction = ref('')
const modifying = ref(false)
const modifyPreview = ref('')
const saving = ref(false)
const editBaseline = ref('')
const modifyBaseline = ref('')
const modifyComplete = ref(false)
let modifyController: AbortController | undefined
const abortModification = () => modifyController?.abort(new DOMException('已离开大纲页面', 'AbortError'))
onDeactivated(abortModification)
onBeforeUnmount(abortModification)
watch(novelId, () => { abortModification(); editing.value = false; modifyPreview.value = ''; modifyComplete.value = false })

const renderedContent = computed(() => {
  if (!novel.value?.outline) return ''
  return renderMd(novel.value.outline)
})

function startEdit() {
  if (!novel.value || saving.value || modifying.value) return
  editBaseline.value = captureStoryContextBaseline(novel.value)
  editContent.value = novel.value?.outline || ''
  editing.value = true
}

async function saveEdit() {
  if (saving.value || !editBaseline.value) return
  saving.value = true
  try {
    await novelStore.updateOutlineWithImpact(novelId.value, editContent.value, editBaseline.value)
    editing.value = false
    message.success('大纲已保存')
  } catch (error) { message.error(errorText(error, '大纲保存失败')) }
  finally { saving.value = false }
}

async function regenerate() {
  router.push({ path: `/generate/${novelId.value}`, query: { regenerate: '1' } })
}

// AI 局部修改大纲
async function aiModifyOutline() {
  if (!novel.value || !modifyInstruction.value.trim() || saving.value || modifying.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { message.error('未配置 AI 模型'); return }

  modifying.value = true
  modifyPreview.value = ''
  modifyComplete.value = false
  const owner = novelId.value
  modifyBaseline.value = captureStoryContextBaseline(novel.value)
  const controller = modifyController = new AbortController()

  try {
    const messages = [{
      role: 'system' as const,
      content: '你是一个小说大纲编辑助手。用户会给你一份大纲和修改要求，请根据要求对大纲进行局部修改，保持其他部分不变。直接输出修改后的完整大纲，使用 Markdown 格式。',
    }, {
      role: 'user' as const,
      content: `【当前大纲】\n${novel.value.outline}\n\n【修改要求】\n${modifyInstruction.value.trim()}\n\n请根据修改要求对大纲进行局部修改，保持整体结构不变，直接输出修改后的完整大纲。`,
    }]

    let result = ''
    const response = await callAI({
      model,
      skillTask: 'planning',
      messages,
      stream: true,
      signal: controller.signal,
      noAutomaticRetry: true,
      onChunk: (chunk) => { result += chunk; modifyPreview.value = result },
    })
    controller.signal.throwIfAborted()
    if (owner !== novelId.value || !novel.value || captureStoryContextBaseline(novel.value) !== modifyBaseline.value) throw new Error('作品总纲或设定已经变化，请重新生成修改建议。')
    if (response.finishReason && response.finishReason !== 'stop') throw new Error('修改建议未完整结束，不能采纳，请重新生成。')
    modifyPreview.value = result || response.content
    modifyComplete.value = !!modifyPreview.value.trim()
  } catch (err: any) {
    message.error(err.message || '修改失败')
  } finally {
    modifying.value = false
    modifyController = undefined
  }
}

async function acceptModify() {
  if (modifyPreview.value && modifyComplete.value && !saving.value && !modifying.value) {
    saving.value = true
    try {
      await novelStore.updateOutlineWithImpact(novelId.value, modifyPreview.value, modifyBaseline.value)
      modifyPreview.value = ''
      modifyInstruction.value = ''
      message.success('大纲已更新')
    } catch (error) { message.error(errorText(error, '大纲保存失败')) }
    finally { saving.value = false }
  }
}
</script>

<style scoped>
.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-lg);
}

.header-actions {
  display: flex;
  gap: 8px;
}

.empty-outline {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 40vh;
  gap: 12px;
  text-align: center;
}

.empty-outline h3 { font-size: 18px; color: var(--ink); }
.empty-outline p { font-size: 14px; color: var(--ink-3); margin-bottom: 8px; }

/* 预览 */
.outline-reading-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

.outline-preview {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  line-height: 1.85;
  font-size: 16px;
  font-family: var(--f-serif);
  color: var(--ink);
}

.rendered-content :deep(h2) { font-family: var(--f-serif); font-size: 22px; font-weight: 700; margin: 28px 0 14px; padding-bottom: 10px; border-bottom: 2px solid var(--line-2); color: var(--zhu); letter-spacing: 0.02em; }
.rendered-content :deep(h3) { font-family: var(--f-serif); font-size: 19px; font-weight: 700; margin: 20px 0 10px; color: var(--ink); }
.rendered-content :deep(h4) { font-family: var(--f-serif); font-size: 17px; font-weight: 600; margin: 16px 0 8px; color: var(--ink); }
.rendered-content :deep(strong) { color: var(--zhu); }
.rendered-content :deep(li) { margin-left: 20px; margin-bottom: 4px; }

/* 编辑 */
.outline-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* AI 局部修改面板 */
.ai-modify-panel {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-l);
  background: var(--panel);
}

.modify-header {
  font-size: 13px;
  font-weight: 600;
  color: var(--zhu);
}

.modify-preview {
  margin-top: 8px;
  max-height: 300px;
  overflow-y: auto;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}

.modify-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  margin-bottom: 4px;
}

.modify-content {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-2);
  max-height: 200px;
  overflow-y: auto;
}

.modify-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 8px;
}

.outline-reading-container { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }
.outline-preview { width: 100%; max-width: 820px; margin: 0; font-size: 17px; padding: 28px; }
.ai-modify-panel { position: sticky; top: 0; width: 100%; max-width: none; margin: 0; padding: 20px; }
.modify-header { display: flex; flex-direction: column; align-items: stretch; gap: 16px; }
.modify-header h3 { font-size: 22px; }
.outline-assistant-tab { padding-bottom: 12px; border-bottom: 2px solid var(--zhu); color: var(--zhu); text-align: center; }
.ai-modify-panel > .m-btn { align-self: stretch !important; margin-top: 12px !important; }
@media (max-width: 1100px) { .outline-reading-container { grid-template-columns: minmax(0, 1fr) 280px; } }
@media (max-width: 900px) { .outline-reading-container { grid-template-columns: 1fr; } .ai-modify-panel { position: static; } }
</style>
