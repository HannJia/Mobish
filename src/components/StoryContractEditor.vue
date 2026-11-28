<template>
  <section class="story-contract" aria-label="作品契约">
    <header class="contract-heading">
      <div class="title-group">
        <span class="seal" aria-hidden="true">墨</span>
        <div>
          <h3>作品契约</h3>
          <p class="project-subtitle">《{{ form.title || '未命名作品' }}》 · {{ originSubtitle }}</p>
        </div>
      </div>
      <div class="top-tools">
        <button type="button" class="meta-pill" :aria-expanded="openDrawer === 'title'" aria-controls="contract-title-drawer"
          @click="toggleDrawer('title')">
          <span>书名</span><strong>《{{ form.title || '未命名' }}》</strong><span>· 候选</span>
        </button>
        <button type="button" class="meta-pill" :aria-expanded="openDrawer === 'origin'" aria-controls="contract-origin-drawer"
          @click="toggleDrawer('origin')">
          <span>起点</span><strong>{{ originPillLabel }}</strong><span>· 编辑</span>
        </button>
        <nav class="narrow-tabs" aria-label="切换工作区">
          <button type="button" :aria-pressed="mobilePanel === 'chat'" @click="mobilePanel = 'chat'">探索对话</button>
          <button type="button" data-guide="create.contract.toggle" :aria-pressed="mobilePanel === 'contract'" @click="mobilePanel = 'contract'">契约卡片</button>
        </nav>
      </div>
    </header>

    <section v-if="openDrawer === 'title'" id="contract-title-drawer" class="meta-drawer" aria-label="作品名称与书名候选">
      <div class="meta-drawer-head">
        <h4>作品名称与书名候选</h4>
        <button type="button" class="drawer-close" @click="openDrawer = ''">收起</button>
      </div>
      <div class="meta-row">
        <input class="text-input title-input" type="text" :value="form.title" :disabled="busy || exploring"
          aria-label="作品名称快捷编辑" placeholder="输入作品名称，或从下方候选点选"
          @input="setField('title', ($event.target as HTMLInputElement).value)" />
        <button type="button" class="drawer-action" :disabled="busy || exploring || titleBusy" @click="loadTitles">
          {{ titleBusy ? '正在想书名…' : titleOptions.length ? '换一批' : 'AI 推荐书名' }}
        </button>
      </div>
      <p v-if="titleError" class="drawer-error" role="alert">{{ titleError }}</p>
      <div v-if="titleOptions.length" class="title-grid" role="list" aria-label="书名候选">
        <button v-for="option in titleOptions" :key="option.title" type="button" role="listitem" class="title-card"
          :aria-pressed="form.title === option.title" :disabled="busy || exploring" @click="setField('title', option.title)">
          <strong>{{ option.title }}</strong>
          <small v-if="option.reason">{{ option.reason }}</small>
        </button>
      </div>
    </section>

    <section v-if="openDrawer === 'origin'" id="contract-origin-drawer" class="meta-drawer" aria-label="故事时间起点">
      <div class="meta-drawer-head">
        <h4>故事时间起点</h4>
        <button type="button" class="drawer-close" @click="openDrawer = ''">收起</button>
      </div>
      <div class="origin-grid">
        <label class="origin-field"><span>起始故事日（留空保持待定）</span>
          <input class="text-input" type="number" min="0" step="0.01" v-model="originDayDraft" :disabled="busy || exploring"
            aria-label="故事起始日" placeholder="不确定可留空" />
        </label>
        <label class="origin-field"><span>起点名称（可独立填写）</span>
          <input class="text-input" type="text" v-model="originLabelDraft" :disabled="busy || exploring"
            aria-label="故事起点名称" placeholder="例如：1992 年春 / 抵达河港当天" />
        </label>
        <button type="button" class="drawer-action primary" :disabled="busy || exploring" @click="applyOrigin">保存起点</button>
      </div>
      <p class="origin-note" role="status">
        {{ originDayDraft === '' ? '未填写起始日时，仅记录起点名称并保持故事日待定，不自动确认第 0 天。' : `保存后将以故事日 ${originDayDraft} 作为开篇基准。` }}
      </p>
    </section>

    <form class="contract-workspace" :data-mobile="mobilePanel" @submit.prevent="confirm">
      <div class="explore-column">
        <ContractExplorationPanel :contract="form" :exploration="exploration" :knowledge-ids="knowledgeIds" :disabled="busy" :flush="flush"
          @change="value => emit('change', clone(form), value)" @busy="setExploring" @adopt="adopt" />
      </div>

      <aside class="contract-column" aria-label="契约卡片">
        <header class="cards-head">
          <h4>契约卡片</h4>
          <div class="cards-progress" role="status">
            <span class="pending-status" :data-state="pendingCards.length ? 'pending' : 'confirmed'">{{ pendingText }}</span>
            <span class="confirmation-count">已确认 {{ confirmedCount }} / {{ contractCards.length }}</span>
          </div>
        </header>

        <div class="contract-grid" data-guide="create.contract" tabindex="0" aria-label="契约卡片列表">
          <fieldset v-for="card in contractCards" :key="card.id" :disabled="busy || exploring"
            :class="{ confirmed: contractCardConfirmed(form, card.id), highlighted: highlightedCard === card.id }">
            <div class="card-heading">
              <h4>{{ card.title }}</h4>
              <div class="card-heading-actions">
                <button v-if="versionsFor(card.id).length" type="button" class="history-toggle"
                  :aria-expanded="openHistoryCard === card.id"
                  :aria-label="`${card.title}历史版本，${versionsFor(card.id).length} 个`"
                  @click="toggleHistory(card.id)">历史版本 {{ versionsFor(card.id).length }}</button>
                <button type="button" class="confirm-toggle"
                  :aria-label="`${contractCardConfirmed(form, card.id) ? '撤销确认' : '确认'}${card.title}`"
                  :aria-pressed="contractCardConfirmed(form, card.id)"
                  @click="handleToggle(card.id)">{{ contractCardConfirmed(form, card.id) ? '已确认' : '确认' }}</button>
              </div>
            </div>

            <button v-if="editingCard !== card.id" type="button" class="card-summary" :aria-label="'编辑' + card.title"
              :title="cardSummary(card.id)" @click="openCardEditor(card.id)">
              <span class="summary-caret" aria-hidden="true">▸</span>
              <span class="summary-text">{{ cardSummary(card.id) }}</span>
            </button>

            <div v-else class="card-fields">
              <button type="button" class="collapse-summary" @click="editingCard = ''">
                <span class="summary-caret" aria-hidden="true">▾</span><span>收起编辑</span>
              </button>
              <template v-for="key in card.fields" :key="key">
                <label>{{ labels[key] }}
                  <select v-if="key === 'format'" class="m-input m-select" aria-label="作品形式" :value="form.format"
                    @change="setField(key, ($event.target as HTMLSelectElement).value)">
                    <option value="serial">连载</option>
                    <option value="complete">完结作品</option>
                    <option value="undecided">暂不确定</option>
                  </select>
                  <input v-else-if="key === 'targetWordCountMin' || key === 'targetWordCountMax'"
                    :aria-label="labels[key]" type="number" min="1" :value="form[key]"
                    @input="setField(key, ($event.target as HTMLInputElement).value)" />
                  <textarea v-else :aria-label="labels[key]"
                    :value="Array.isArray(form[key]) ? (form[key] as string[]).join('\n') : form[key]"
                    rows="2"
                    :placeholder="card.id === 'rules' ? '每行一条，也可填写暂无' : '填写方向或暂不确定'"
                    @input="setField(key, ($event.target as HTMLTextAreaElement).value)"></textarea>
                </label>
                <div v-if="key === 'title'" class="title-suggest" data-title-suggest>
                  <button type="button" class="title-suggest-btn" :disabled="busy || exploring || titleBusy"
                    @click="loadTitles">{{ titleBusy ? '正在想书名…' : titleOptions.length ? '换一批' : 'AI 推荐书名' }}</button>
                  <span v-if="titleError" class="title-suggest-error" role="alert">{{ titleError }}</span>
                  <div v-if="titleOptions.length" class="title-suggest-list" role="list" aria-label="书名候选">
                    <button v-for="option in titleOptions" :key="option.title" type="button" role="listitem" class="title-suggest-option"
                      :class="{ on: form.title === option.title }" :title="option.reason" @click="setField('title', option.title)">
                      <strong>{{ option.title }}</strong><small v-if="option.reason">{{ option.reason }}</small>
                    </button>
                  </div>
                </div>
              </template>
            </div>

            <div v-if="blankConfirmCard === card.id" class="blank-confirm" role="alert">
              <p>「{{ card.title }}」当前留空，是否暂不确定？</p>
              <div class="blank-confirm-actions">
                <button type="button" class="blank-edit" @click="editBlankCard(card.id)">编辑</button>
                <button type="button" class="primary blank-accept" @click="acceptBlankCard(card.id)">确认</button>
              </div>
            </div>

            <div v-if="openHistoryCard === card.id && versionsFor(card.id).length" class="card-history" role="region" :aria-label="`${card.title}历史版本`">
              <ol>
                <li v-for="version in versionsFor(card.id)" :key="version.signature">
                  <div class="version-head">
                    <time :datetime="version.savedAt">{{ formatVersionTime(version.savedAt) }}</time>
                    <button type="button" class="restore-version" @click="restoreVersion(card.id, version.signature)">恢复此版本</button>
                  </div>
                  <p>{{ summarizeVersion(card.id, version) }}</p>
                </li>
              </ol>
            </div>
          </fieldset>
        </div>

        <footer class="contract-footer">
          <div class="contract-actions">
            <button type="button" class="save-btn" :disabled="busy || exploring" @click="saveContract">保存</button>
            <button type="submit" class="primary confirm-btn" :disabled="busy || exploring || issues.length > 0 || confirmedCount < contractCards.length"
              :title="issues[0] || (confirmedCount < contractCards.length ? pendingText : '确认全部契约并继续故事骨架')">确认契约并继续</button>
          </div>
          <p v-if="adoptionError" role="alert" class="footer-feedback error">{{ adoptionError }}</p>
          <p v-else-if="feedbackText" role="status" class="footer-feedback">{{ feedbackText }}</p>
          <button v-if="cancelable" type="button" class="cancel" :disabled="busy || exploring" @click="emit('cancel')">取消契约修改</button>
        </footer>
      </aside>
    </form>
  </section>
</template>
<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import { computed, nextTick, ref, watch } from 'vue'
import type { StoryClock } from '@/types/novel'
import { createEmptyCreationDraft, validateCreationStage, type ContractCardVersion, type ContractExploration, type ContractSuggestion, type StoryContract } from '@/types/reconstruction'
import { adoptContractSuggestion, contractCards, contractCardConfirmed, contractCardHistory, contractCardVersionValues, materializeContractConfirmations, normalizeContractCardHistory, recordContractCardChanges, restoreContractCardVersion, toggleContractCard } from '@/services/storyContract'
import ContractExplorationPanel from './ContractExplorationPanel.vue'
import { useConfigStore } from '@/stores/config'
import { suggestTitles, type TitleSuggestion } from '@/services/titleSuggestions'

const props = defineProps<{
  contract: StoryContract
  exploration?: ContractExploration
  knowledgeIds?: string[]
  storyClock?: StoryClock
  busy?: boolean
  cancelable?: boolean
  flush?: () => Promise<void>
}>()
const emit = defineEmits<{
  save: [contract: StoryContract]
  confirm: [contract: StoryContract]
  cancel: []
  change: [contract: StoryContract, exploration?: ContractExploration]
  exploring: [busy: boolean]
  'update-origin': [origin: { day?: number; label: string }]
}>()
const clone = (value: StoryContract): StoryContract => JSON.parse(JSON.stringify(value))
function loadContract(value: StoryContract): StoryContract {
  const next = materializeContractConfirmations(clone(value))
  if (next.cardHistory) next.cardHistory = normalizeContractCardHistory(next.cardHistory)
  return next
}
const form = ref(loadContract(props.contract))
const exploring = ref(false)
const adoptionError = ref('')
const feedbackText = ref('')
const editingCard = ref('')
const blankConfirmCard = ref('')
const openHistoryCard = ref('')
const highlightedCard = ref('')
const mobilePanel = ref<'chat' | 'contract'>('chat')
const openDrawer = ref<'' | 'title' | 'origin'>('')

const originDayDraft = ref<string>(props.storyClock?.origin?.day !== undefined ? String(props.storyClock.origin.day) : '')
const originLabelDraft = ref<string>(props.storyClock?.origin?.label || props.storyClock?.pendingOriginLabel || props.storyClock?.label || '')
watch(() => props.storyClock, clock => {
  originDayDraft.value = clock?.origin?.day !== undefined ? String(clock.origin.day) : ''
  originLabelDraft.value = clock?.origin?.label || clock?.pendingOriginLabel || clock?.label || ''
}, { deep: true })

const originPillLabel = computed(() => {
  const label = originLabelDraft.value.trim()
  const day = originDayDraft.value.trim()
  if (label) return label
  if (day !== '') return `第 ${day} 天`
  return '暂未设定'
})
const originSubtitle = computed(() => {
  const label = originLabelDraft.value.trim()
  const day = originDayDraft.value.trim()
  if (label && day !== '') return `起点：${label}（第 ${day} 天）`
  if (label) return `起点：${label}（故事日待定）`
  if (day !== '') return `起点：第 ${day} 天`
  return '起点待定'
})

function toggleDrawer(kind: 'title' | 'origin') {
  openDrawer.value = openDrawer.value === kind ? '' : kind
}

function applyOrigin() {
  const raw = originDayDraft.value.trim()
  const day = raw === '' ? undefined : Number(raw)
  if (day !== undefined && (!Number.isFinite(day) || day < 0 || day > 100_000_000)) {
    adoptionError.value = '起始故事日需为 0 至 100000000 之间的数字，或留空。'
    return
  }
  adoptionError.value = ''
  emit('update-origin', { day, label: originLabelDraft.value.trim() })
  feedbackText.value = '故事起点已保存'
  openDrawer.value = ''
}

const config = useConfigStore()
const titleOptions = ref<TitleSuggestion[]>([])
const titleBusy = ref(false)
const titleError = ref('')
const titleHistory: string[] = []
async function loadTitles() {
  const model = config.getModelForTask('chat') || config.getModelForTask('outline')
  if (!model) { titleError.value = '请先在设置中配置对话模型'; return }
  titleBusy.value = true; titleError.value = ''
  try {
    const titles = await suggestTitles(model, clone(form.value), titleHistory.slice(-20))
    titleHistory.push(...titles.map(item => item.title))
    titleOptions.value = titles
  } catch (error) { titleError.value = errorText(error, '推荐书名失败') }
  finally { titleBusy.value = false }
}
watch(() => props.contract, value => {
  const next = loadContract(value)
  if (JSON.stringify(form.value) !== JSON.stringify(next)) form.value = next
})
const labels = {
  title: '作品名称', genre: '作品类型', subGenre: '子类型', audience: '目标读者', format: '作品形式', targetWordCountMin: '最少字数', targetWordCountMax: '最多字数', pacingDirection: '篇章节奏',
  pointOfView: '叙事视角', tense: '叙述时态', styleDirection: '文风方向', coreTheme: '核心主题', readerPromise: '读者承诺',
  protagonistPremise: '主角初始状态', protagonistGoal: '主角核心欲望', protagonistFear: '主角核心恐惧', centralConflict: '主线冲突', endingDirection: '结局方向',
  romanceDirection: '感情线方向', worldRules: '世界规则', forbiddenTopics: '禁用内容', authorPreferences: '作者偏好',
}

function formatWanWords(words: number): string {
  const wan = Math.round((words / 10000) * 100) / 100
  return `${Number(wan.toFixed(2))}万字`
}

const historyTimeFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
function formatVersionTime(iso: string): string {
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? historyTimeFormatter.format(new Date(ts)) : iso
}

function versionsFor(cardId: string): ContractCardVersion[] {
  return [...contractCardHistory(form.value, cardId)].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
}

function summarizeValues(cardId: string, source: Partial<StoryContract>): string {
  const card = contractCards.find(item => item.id === cardId)!
  const parts: string[] = []
  let minWord: number | undefined
  let maxWord: number | undefined
  for (const key of card.fields) {
    const value = source[key]
    if (key === 'format') {
      if (value) parts.push({ serial: '连载', complete: '完结作品', undecided: '形式暂不确定' }[value as StoryContract['format']])
      continue
    }
    if (key === 'targetWordCountMin') { if (typeof value === 'number' && value > 0) minWord = value; continue }
    if (key === 'targetWordCountMax') { if (typeof value === 'number' && value > 0) maxWord = value; continue }
    const text = Array.isArray(value) ? value.filter(Boolean).join('、') : value
    if (text) parts.push(String(text))
  }
  if (minWord && maxWord) parts.splice(1, 0, `${formatWanWords(minWord)}至${formatWanWords(maxWord)}`)
  else if (minWord) parts.splice(1, 0, `最少 ${formatWanWords(minWord)}`)
  else if (maxWord) parts.splice(1, 0, `最多 ${formatWanWords(maxWord)}`)
  return parts.join(' · ')
}

function summarizeVersion(cardId: string, version: ContractCardVersion): string {
  try { return summarizeValues(cardId, contractCardVersionValues(version)) || '（空白）' }
  catch { return '历史内容' }
}

function cardSummary(cardId: string): string {
  const text = summarizeValues(cardId, form.value)
  if (text) return text
  if (cardId === 'romance' || cardId === 'ending') return '留空点击「确认」将填入「暂不确定」'
  return '点击填写，或明确标记暂不确定。'
}

function changed() { adoptionError.value = ''; emit('change', clone(form.value)) }
function setField(key: keyof typeof labels, text: string) {
  let value: string | string[] | number | undefined = text
  if (key === 'targetWordCountMin' || key === 'targetWordCountMax') value = text === '' ? undefined : Number(text)
  if (['worldRules', 'forbiddenTopics', 'authorPreferences'].includes(key)) value = text.split('\n')
  if (JSON.stringify(form.value[key]) === JSON.stringify(value)) return
  const card = contractCards.find(item => item.fields.includes(key))!
  if (blankConfirmCard.value === card.id) blankConfirmCard.value = ''
  Object.assign(form.value, { [key]: value })
  form.value.cardConfirmations = form.value.cardConfirmations?.filter(item => item.cardId !== card.id)
  feedbackText.value = ''
  changed()
}

function openCardEditor(cardId: string) {
  blankConfirmCard.value = ''
  editingCard.value = cardId
}

function isBlankConfirmable(cardId: string): boolean {
  if (cardId === 'romance') return !form.value.romanceDirection?.trim()
  if (cardId === 'ending') return !form.value.endingDirection?.trim()
  return false
}

function handleToggle(cardId: string) {
  const confirmed = contractCardConfirmed(form.value, cardId)
  if (!confirmed && isBlankConfirmable(cardId)) {
    blankConfirmCard.value = cardId
    return
  }
  blankConfirmCard.value = ''
  form.value = toggleContractCard(form.value, cardId, new Date().toISOString())
  editingCard.value = ''
  feedbackText.value = ''
  changed()
}

async function editBlankCard(cardId: string) {
  blankConfirmCard.value = ''
  editingCard.value = cardId
  await nextTick()
  const field = cardId === 'ending' ? '结局方向' : '感情线方向'
  const input = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${field}"]`)
  input?.focus()
}

function acceptBlankCard(cardId: string) {
  blankConfirmCard.value = ''
  form.value = toggleContractCard(form.value, cardId, new Date().toISOString())
  editingCard.value = ''
  const title = contractCards.find(item => item.id === cardId)?.title || ''
  feedbackText.value = `已将「${title}」设为「暂不确定」并确认`
  changed()
}

function toggleHistory(cardId: string) {
  openHistoryCard.value = openHistoryCard.value === cardId ? '' : cardId
}

function restoreVersion(cardId: string, signature: string) {
  try {
    form.value = restoreContractCardVersion(form.value, cardId, signature, new Date().toISOString())
    openHistoryCard.value = ''
    editingCard.value = cardId
    const title = contractCards.find(item => item.id === cardId)?.title || ''
    feedbackText.value = `已载入「${title}」的历史内容`
    changed()
  } catch (error) {
    adoptionError.value = errorText(error, '恢复历史版本失败')
  }
}

function adopt(suggestion: ContractSuggestion) {
  try {
    form.value = adoptContractSuggestion(form.value, suggestion, new Date().toISOString())
    highlightedCard.value = suggestion.cardId
    if (blankConfirmCard.value === suggestion.cardId) blankConfirmCard.value = ''
    const title = contractCards.find(item => item.id === suggestion.cardId)?.title || '卡片'
    feedbackText.value = `已填入「${title}」，等待确认`
    changed()
  } catch (error) { adoptionError.value = errorText(error, '建议采用失败') }
}

function saveContract() {
  form.value = recordContractCardChanges(props.contract, form.value, new Date().toISOString())
  emit('save', clone(form.value))
}

function setExploring(value: boolean) { exploring.value = value; emit('exploring', value) }
function confirm() {
  if (!props.busy && !exploring.value && !issues.value.length && confirmedCount.value === contractCards.length) emit('confirm', clone(form.value))
}
const confirmedCount = computed(() => contractCards.filter(card => contractCardConfirmed(form.value, card.id)).length)
const pendingCards = computed(() => contractCards.filter(card => !contractCardConfirmed(form.value, card.id)))
const pendingText = computed(() => {
  if (!pendingCards.value.length) return '已全部确认'
  if (pendingCards.value.length === 1) return `还需确认「${pendingCards.value[0].title}」`
  return `还需确认 ${pendingCards.value.length} 项`
})
const issues = computed(() => validateCreationStage({ ...createEmptyCreationDraft({ id: 'validation', now: '' }), contract: form.value }))
</script>
<style scoped>
.story-contract {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--ink);
}
.contract-heading {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title-group { display: flex; align-items: center; gap: 12px; min-width: 0; }
.seal {
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: var(--zhu);
  color: #fff8ee;
  font: 700 22px/1 var(--f-serif);
}
.contract-heading h3 { margin: 0; font: 700 22px/1.2 var(--f-serif); color: var(--ink); }
.project-subtitle { margin: 3px 0 0; color: var(--ink-3); font-size: 12px; }
.top-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.meta-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 4px 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.meta-pill span { color: var(--ink-3); }
.meta-pill strong { font-weight: 600; color: var(--ink); max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.meta-pill:hover, .meta-pill[aria-expanded="true"] { border-color: var(--zhu); background: var(--zhu-soft); }
.meta-pill[aria-expanded="true"] strong { color: var(--zhu); }

.meta-drawer {
  flex: none;
  padding: 12px 15px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  box-shadow: var(--shadow-1);
  display: grid;
  gap: 10px;
}
.meta-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.meta-drawer-head h4 { margin: 0; font: 700 14px/1.4 var(--f-serif); color: var(--ink); }
.drawer-close, .drawer-action {
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.drawer-close:hover, .drawer-action:hover:not(:disabled) { border-color: var(--zhu); background: var(--zhu-soft); color: var(--zhu); }
.drawer-action.primary { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.drawer-action.primary:hover:not(:disabled) { filter: brightness(1.06); color: #fff; }
.meta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.text-input {
  min-height: 33px;
  padding: 5px 10px;
  border: 1px solid var(--line-2);
  border-radius: 7px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}
.title-input { flex: 1; min-width: 200px; }
.title-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.title-card {
  display: grid;
  gap: 3px;
  align-content: start;
  text-align: left;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper);
  color: var(--ink);
  cursor: pointer;
}
.title-card strong { font-size: 13px; font-weight: 700; }
.title-card small { font-size: 11.5px; color: var(--ink-3); line-height: 1.45; }
.title-card:hover, .title-card[aria-pressed="true"] { border-color: var(--zhu); background: var(--zhu-soft); }
.title-card[aria-pressed="true"] strong { color: var(--zhu); }
.origin-grid { display: grid; grid-template-columns: minmax(150px, 210px) minmax(200px, 1fr) auto; gap: 10px; align-items: end; }
.origin-field { display: grid; gap: 4px; font-size: 12px; color: var(--ink-3); }
.origin-note { margin: 0; font-size: 12px; color: var(--ink-3); }
.drawer-error { margin: 0; font-size: 12px; color: var(--zhu); }

.narrow-tabs { display: none; gap: 6px; flex-shrink: 0; }
.narrow-tabs button { padding: 5px 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); color: var(--ink); font-size: 12px; white-space: nowrap; }
.narrow-tabs button[aria-pressed="true"] { border-color: var(--zhu); background: var(--zhu-soft); color: var(--zhu); }

.contract-workspace {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(310px, 29%, 380px);
  gap: 14px;
  align-items: stretch;
}
.explore-column { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.explore-column > :deep(.explore) { flex: 1; min-height: 0; }

.contract-column {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--paper);
  box-shadow: var(--shadow-1);
}
.cards-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 55px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--line);
}
.cards-head h4 { margin: 0; font: 700 17px/1.3 var(--f-serif); color: var(--ink); letter-spacing: 0; }
.cards-progress { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; text-align: right; }
.pending-status { font-size: 12px; font-weight: 600; white-space: nowrap; }
.pending-status[data-state="pending"] { color: var(--zhu); }
.pending-status[data-state="confirmed"] { color: var(--qing); }
.confirmation-count { color: var(--ink-3); font-size: 12px; white-space: nowrap; }

.contract-grid {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 10px;
}
fieldset {
  min-width: 0;
  margin: 0;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper);
}
fieldset.confirmed { border-color: color-mix(in srgb, var(--qing) 48%, var(--line)); }
fieldset.highlighted { border-color: var(--zhu); background: var(--zhu-soft); }
.card-heading { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.card-heading h4 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 700; }
.card-heading-actions { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }
.confirm-toggle, .history-toggle, .restore-version {
  height: auto;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink-3);
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
fieldset.confirmed .confirm-toggle { border-color: color-mix(in srgb, var(--qing) 45%, var(--line)); background: var(--qing-soft); color: var(--qing); }
.history-toggle { border-color: transparent; background: transparent; }
.history-toggle[aria-expanded="true"] { color: var(--zhu); border-color: var(--line); background: var(--zhu-soft); }

.card-summary {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  margin-top: 5px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}
.card-summary:hover { color: var(--ink); }
.summary-caret { flex: none; color: var(--ink-3); font-size: 12px; line-height: 1; }
.summary-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

.card-fields { display: grid; gap: 8px; margin-top: 6px; }
.collapse-summary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  justify-self: start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  font-size: 11.5px;
  cursor: pointer;
}
.collapse-summary:hover { color: var(--zhu); }
label { display: grid; gap: 4px; color: var(--ink-3); font-size: 11.5px; }
textarea, input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
}

.blank-confirm {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--zhu) 45%, var(--line));
  border-radius: 7px;
  background: var(--zhu-soft);
  display: grid;
  gap: 7px;
}
.blank-confirm p { margin: 0; font-size: 12px; color: var(--ink); line-height: 1.45; }
.blank-confirm-actions { display: flex; justify-content: flex-end; gap: 6px; }
.blank-confirm-actions button { padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); font-size: 11.5px; cursor: pointer; }
.blank-confirm-actions button.primary { border-color: var(--zhu); background: var(--zhu); color: #fff; }

.card-history { margin-top: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
.card-history ol { margin: 0; padding: 0; list-style: none; }
.card-history li { padding: 7px 8px; }
.card-history li + li { border-top: 1px solid var(--line); }
.version-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.version-head time { color: var(--ink-3); font-size: 11px; }
.card-history p { margin: 0; font-size: 12px; color: var(--ink-2); white-space: pre-wrap; overflow-wrap: anywhere; }

.title-suggest { display: grid; gap: 6px; padding: 8px; border: 1px dashed var(--line-2); border-radius: 7px; background: var(--panel); }
.title-suggest-btn { justify-self: start; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); font-size: 12px; cursor: pointer; }
.title-suggest-error { color: var(--zhu); font-size: 12px; }
.title-suggest-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.title-suggest-option { display: grid; gap: 2px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink); text-align: left; font-size: 12px; cursor: pointer; }
.title-suggest-option small { color: var(--ink-3); font-size: 11px; }
.title-suggest-option.on { border-color: var(--zhu); background: var(--zhu-soft); }

.contract-footer {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  min-height: 103px;
  padding: 14px 14px 16px;
  border-top: 1px solid var(--line);
  background: var(--panel);
}
.contract-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 10px;
}
.contract-actions button {
  width: 100%;
  min-height: 46px;
  padding: 8px 14px;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  background: var(--paper);
  color: var(--ink);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.contract-actions button:hover:not(:disabled) { border-color: var(--zhu); background: var(--zhu-soft); color: var(--zhu); }
.contract-actions button.primary { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.contract-actions button.primary:hover:not(:disabled) { filter: brightness(1.06); color: #fff; }
.contract-actions button:disabled { opacity: .48; cursor: not-allowed; }
.footer-feedback { margin: 0; font-size: 11.5px; color: var(--ink-3); }
.footer-feedback.error { color: var(--zhu); }
.cancel { align-self: center; padding: 3px 10px; border: 0; background: transparent; color: var(--ink-3); font-size: 12px; cursor: pointer; }
.cancel:hover:not(:disabled) { color: var(--zhu); }

@media (max-width: 960px) {
  .contract-workspace { grid-template-columns: minmax(0, 1fr); }
  .narrow-tabs { display: flex; }
  .contract-workspace[data-mobile="chat"] .contract-column { display: none; }
  .contract-workspace[data-mobile="contract"] .explore-column { display: none; }
}
@media (max-width: 760px) {
  .story-contract { min-height: 560px; }
  .title-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .origin-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 600px) {
  .title-suggest-list { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 480px) {
  .title-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
