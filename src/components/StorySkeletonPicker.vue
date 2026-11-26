<template>
  <section class="skeleton-picker" aria-label="选择和编辑故事骨架">
    <div v-if="skeletons.length" class="toolbar">
      <div class="seg" role="group" aria-label="视图切换">
        <button type="button" :aria-pressed="activeView === 'cards'" @click="activeView = 'cards'">方案对照</button>
        <button type="button" :aria-pressed="activeView === 'lanes'" @click="activeView = 'lanes'">情节结构</button>
        <button type="button" :aria-pressed="activeView === 'desk'" @click="openDesk()">方案台</button>
      </div>

      <div class="index" aria-label="方案快速切换">
        <button v-for="(item, idx) in skeletons" :key="item.id" type="button"
          :class="{ 'is-confirmed': item.id === confirmedId, 'is-editing': item.id === selectedId && item.id !== confirmedId }"
          :disabled="busy" @click="selectAndFocus(item.id)">
          <span class="mini-seal">{{ slotTag(idx) }}</span>
          <span>{{ item.title || '未命名方案' }}</span>
        </button>
      </div>

      <div class="toolbar-right">
        <button v-if="activeView === 'cards'" type="button" class="m-btn sm" @click="fullCards = !fullCards">
          {{ fullCards ? '收起摘要' : '展开全文' }}
        </button>
        <button type="button" class="m-btn sm" :disabled="busy" @click="emit('create')">手写新方案</button>
        <button type="button" class="m-btn sm" :disabled="busy" @click="emit('regenerate')">重新生成候选</button>
      </div>
    </div>

    <div v-else class="start-empty">
      <div class="start-inner">
        <h3>尚未生成故事骨架候选</h3>
        <p>可以让 AI 根据已确认的作品契约生成 3 个不同方向的故事骨架，或直接手写一个方案。</p>
        <div class="start-actions">
          <button type="button" class="m-btn pri" :disabled="busy" @click="emit('regenerate')">重新生成候选</button>
          <button type="button" class="m-btn" :disabled="busy" @click="emit('create')">手写新方案</button>
        </div>
      </div>
    </div>

    <!-- 视图 1：方案对照（三列 subgrid 卡片，主线在前 + SVG 情节起伏曲线） -->
    <div v-if="skeletons.length && activeView === 'cards'" class="stage">
      <div class="cards" :class="{ full: fullCards }" tabindex="0" aria-label="方案对照卡片">
        <article v-for="(item, idx) in skeletons" :key="item.id" class="card"
          :class="{ confirmed: item.id === confirmedId, editing: item.id === selectedId && item.id !== confirmedId }">
          <header class="c-head">
            <span class="seal">{{ slotTag(idx) }}</span>
            <div class="c-name">
              <h4 class="c-title">{{ item.title || '未命名方案' }}</h4>
              <div class="c-meta">
                <span v-if="item.id === confirmedId" class="tag official">✓ 正式方向</span>
                <span v-if="item.id === selectedId" class="tag zhu">方案台编辑中</span>
                <span v-if="item.complete === false" class="tag jin">未完整，需要补齐后保存</span>
                <span>{{ item.beats.length }} 个关键节点</span>
              </div>
            </div>
          </header>

          <p class="c-logline">{{ item.logline || '尚未填写一句话主线' }}</p>

          <div class="c-struct">
            <div class="c-label"><span>情节起伏</span><small>悬停查看对应节点</small></div>
            <svg class="shape" viewBox="0 0 260 66" aria-hidden="true">
              <line class="base" x1="12" y1="56" x2="248" y2="56" />
              <path v-if="curvePath(item.beats).area" class="area" :d="curvePath(item.beats).area" />
              <path v-if="curvePath(item.beats).line" class="curve" :d="curvePath(item.beats).line" />
              <g v-for="(pt, bIdx) in curvePath(item.beats).points" :key="pt.id" class="node"
                :class="{ hot: hoveredBeatKey === `${item.id}:${bIdx}` }"
                @mouseenter="hoveredBeatKey = `${item.id}:${bIdx}`" @mouseleave="hoveredBeatKey = ''">
                <circle :cx="pt.x" :cy="pt.y" :r="hoveredBeatKey === `${item.id}:${bIdx}` ? 9 : 7.5" :fill="pt.color" />
                <text :x="pt.x" :y="pt.y">{{ bIdx + 1 }}</text>
              </g>
            </svg>
            <ol class="c-beats">
              <li v-for="(beat, bIdx) in item.beats" :key="beat.id"
                :class="{ hot: hoveredBeatKey === `${item.id}:${bIdx}` }"
                @mouseenter="hoveredBeatKey = `${item.id}:${bIdx}`" @mouseleave="hoveredBeatKey = ''">
                <span class="num" :style="{ background: kindColor(beat.kind) }">{{ bIdx + 1 }}</span>
                <span>{{ beat.title || '未命名节点' }}</span>
              </li>
            </ol>
          </div>

          <div class="c-field"><b>故事前提</b><p>{{ item.premise || '未填写' }}</p></div>
          <div class="c-field"><b>读者承诺</b><p>{{ item.promise || '未填写' }}</p></div>
          <div class="c-field"><b>结局方向</b><p>{{ item.ending || '未填写' }}</p></div>

          <div class="c-actions">
            <button type="button" class="m-btn sm pri" :disabled="busy"
              @click="openDeskOn(item.id)">{{ item.id === selectedId ? '进入方案台精修' : '选用并精修' }}</button>
            <button v-if="item.id !== confirmedId" type="button" class="m-btn sm" :disabled="busy || !item.revisionId"
              :aria-label="'整列选用：' + (item.title || '未命名方案')" @click="pickForDesk(item)">带入方案台混编</button>
            <span v-else class="note">当前正式方向</span>
          </div>
        </article>
      </div>
    </div>

    <!-- 视图 2：情节结构（横向泳道对照） -->
    <div v-else-if="skeletons.length && activeView === 'lanes'" class="stage">
      <div class="lanes" tabindex="0" aria-label="情节结构泳道对照">
        <div class="legend">
          <span v-for="kind in kinds" :key="kind.value"><i :style="{ background: kind.color }"></i>{{ kind.label }}</span>
          <span class="sp"></span>
          <small>点击任意节点展开细节</small>
        </div>
        <article v-for="(item, idx) in skeletons" :key="item.id" class="lane"
          :class="{ confirmed: item.id === confirmedId, editing: item.id === selectedId && item.id !== confirmedId }">
          <div class="lane-head">
            <span class="seal">{{ slotTag(idx) }}</span>
            <div class="c-name">
              <h4 class="c-title">{{ item.title || '未命名方案' }}</h4>
              <div class="c-meta">
                <span v-if="item.id === confirmedId" class="tag official">✓ 正式方向</span>
                <span v-else-if="item.id === selectedId" class="tag zhu">方案台</span>
                <button type="button" class="lane-open" :disabled="busy" @click="openDeskOn(item.id)">进入方案台</button>
              </div>
            </div>
          </div>
          <div class="track">
            <div class="track-line"></div>
            <ol>
              <li v-for="(beat, bIdx) in item.beats" :key="beat.id">
                <button type="button" :aria-expanded="expandedLaneBeat === `${item.id}:${beat.id}`"
                  @click="expandedLaneBeat = expandedLaneBeat === `${item.id}:${beat.id}` ? '' : `${item.id}:${beat.id}`">
                  <span class="num" :style="{ background: kindColor(beat.kind) }">{{ bIdx + 1 }}</span>
                  <span class="t">{{ beat.title || '未命名' }}</span>
                  <span class="k">{{ kindLabel(beat.kind) }}</span>
                </button>
              </li>
            </ol>
          </div>
          <div v-if="selectedLaneBeat(item)" class="lane-detail">
            <b>{{ selectedLaneBeat(item)!.title }}</b>
            <span>{{ selectedLaneBeat(item)!.description || '暂无节点说明' }}</span>
          </div>
        </article>
      </div>
    </div>

    <!-- 视图 3：方案台（左字段红框换写法 + 右节点曲线与借节点） -->
    <div v-else-if="skeletons.length && activeView === 'desk' && selected" class="stage">
      <div class="desk skeleton-edit" :class="{ pulse: showSwapTip, 'is-confirmed': selected.id === confirmedId }" :key="selected.id">
        <div class="desk-col">
          <header class="desk-head">
            <span class="seal" :class="selected.id === confirmedId ? 'confirmed' : 'editing'">{{ selectedSlotTag }}</span>
            <h2>方案台 · {{ selected.title || '未命名方案' }}</h2>
            <span v-if="selected.id === confirmedId" class="tag official">✓ 正式方向</span>
            <span v-else class="tag zhu">正在精修</span>
            <span class="sp"></span>
            <button type="button" class="m-btn sm ghost" @click="activeView = 'cards'">返回对照</button>
          </header>

          <div class="desk-body">
            <div v-if="skeletons.length > 1 && showSwapTip" class="swap-tip" role="status">
              <span class="mark" aria-hidden="true">!</span>
              <p><b>换写法提示</b>每段右上角红框「{{ slotListLabel }}」可一键换成其他方案的写法，满意后点底部保存作者版本或组合为新候选。</p>
              <button type="button" class="m-btn sm" @click="dismissSwapTip">知道了</button>
            </div>

            <p v-if="dirty" class="dirty-note" role="status">输入已暂存；请先保存作者版本，再切换方案或确认正式方向。</p>

            <details v-if="selectedReview?.review.conflicts.length" class="mix-review-saved">
              <summary>查看组合来源与取舍理由</summary>
              <ul><li v-for="(excerpt, index) in selectedReview.excerpts" :key="index">{{ excerpt.label }} · {{ excerpt.text }}</li></ul>
              <ul><li v-for="(decision, index) in selectedReview.review.decisions" :key="index">
                {{ selectedReview.review.conflicts[index].conflict }} · 保留 {{ selectedReview.excerpts[decision.keep].label }} · {{ decision.reason }}
              </li></ul>
            </details>

            <div v-for="field in deskFields" :key="field.key" class="field" :class="{ missing: !selected[field.key]?.trim() }">
              <div class="field-top">
                <b>{{ field.label }}</b>
                <span class="src" :class="fieldSourceState(field.key).tone">
                  <i>{{ fieldSourceState(field.key).tag }}</i>{{ fieldSourceState(field.key).label }}
                </span>
                <span class="sp"></span>
                <div v-if="skeletons.length > 1" class="swap" role="group" :aria-label="`切换${field.label}方案写法`">
                  <span>换写法</span>
                  <button v-for="(cand, idx) in skeletons" :key="cand.id" type="button"
                    :aria-pressed="isFieldFrom(field.key, cand)"
                    :aria-label="`${field.label} · ${cand.title || '未命名方案'}`"
                    :disabled="busy || !cand[field.key]"
                    :title="`换成「${cand.title || '方案' + (idx + 1)}」的${field.label}`"
                    @click="swapFieldFrom(field.key, cand)">{{ slotTag(idx) }}</button>
                </div>
              </div>
              <textarea :value="deskFieldValue(field.key)" :aria-label="field.label" :disabled="busy"
                :rows="field.key === 'title' ? 1 : field.key === 'logline' ? 2 : 3"
                @input="manualEditField(field.key, ($event.target as HTMLTextAreaElement).value)"></textarea>
            </div>

            <!-- 当从多个方案借用了写法/节点时，支持冲突检查与保留来源的组合保存 -->
            <section v-if="isMixed" class="mix-bar" aria-label="跨方案组合来源">
              <div class="mix-bar-top">
                <strong>跨方案组合：{{ mixCounts }}</strong>
                <div class="mix-bar-acts">
                  <button type="button" class="m-btn sm" :disabled="busy || checkingMix || !canMix || dirty" @click="checkMix">
                    {{ checkingMix ? '正在核对冲突…' : '检查组合冲突' }}
                  </button>
                  <button type="button" class="m-btn sm pri" :disabled="busy || checkingMix || !canMix || dirty || !reviewComplete" @click="mix">
                    组合为新的可编辑候选
                  </button>
                </div>
              </div>
              <p v-if="dirty" class="mix-hint" role="status">请先保存当前作者版本，再组合新的候选。</p>
              <p v-if="mixError" class="mix-err" role="alert">{{ mixError }}</p>
              <div v-if="mixConflicts" class="conflicts" aria-label="组合冲突检查">
                <h3 v-if="!mixConflicts.length">AI 未在这次组合中发现明确冲突</h3>
                <template v-else>
                  <h3>发现 {{ mixConflicts.length }} 处潜在冲突，请选择保留哪一项</h3>
                  <fieldset v-for="(conflict, index) in mixConflicts" :key="index" class="conflict" :disabled="busy">
                    <p>{{ conflict.conflict }}</p>
                    <div class="choices">
                      <label v-for="(source, position) in [conflict.left, conflict.right]" :key="source">
                        <input v-model="mixDecisions[index].keep" type="radio" :name="'mix-conflict-' + index" :value="source">
                        <span><strong>保留 {{ reviewedExcerpts[source].label }}</strong>：{{ conflict.options[position] }}</span>
                      </label>
                    </div>
                    <input v-model="mixDecisions[index].reason" class="reason" maxlength="500"
                      :aria-label="'取舍理由 ' + (index + 1)" placeholder="写一句取舍理由…" />
                  </fieldset>
                </template>
              </div>
            </section>
          </div>
        </div>

        <div class="desk-col">
          <header class="desk-head">
            <h2>关键节点（{{ selected.beats.length }}）</h2>
            <span class="sp"></span>
            <div class="borrow-wrap">
              <button v-if="otherSkeletons.length" type="button" class="m-btn sm" :disabled="busy"
                :aria-expanded="borrowOpen" @click="borrowOpen = !borrowOpen">从其他方案借节点</button>
              <div v-if="borrowOpen && otherSkeletons.length" class="pop" role="dialog" aria-label="从其他方案借用节点">
                <template v-for="other in otherSkeletons" :key="other.id">
                  <h4><span class="mini-seal">{{ slotTagOf(other.id) }}</span>{{ other.title || '未命名方案' }}</h4>
                  <button v-for="(beat, bIdx) in other.beats" :key="beat.id" type="button" class="opt"
                    @click="borrowBeat(other, beat)">
                    <span class="num" :style="{ background: kindColor(beat.kind) }">{{ bIdx + 1 }}</span>
                    <strong>{{ beat.title || '未命名节点' }}</strong>
                    <small>{{ beat.description || kindLabel(beat.kind) }}</small>
                  </button>
                </template>
              </div>
            </div>
            <button type="button" class="m-btn sm" :disabled="busy" @click="addBeat">添加关键节点</button>
          </header>

          <div class="shape-box">
            <svg class="shape" viewBox="0 0 360 66" aria-hidden="true">
              <line class="base" x1="12" y1="56" x2="348" y2="56" />
              <path v-if="curvePath(selected.beats, 360).area" class="area" :d="curvePath(selected.beats, 360).area" />
              <path v-if="curvePath(selected.beats, 360).line" class="curve" :d="curvePath(selected.beats, 360).line" />
              <g v-for="(pt, bIdx) in curvePath(selected.beats, 360).points" :key="pt.id" class="node">
                <circle :cx="pt.x" :cy="pt.y" r="8" :fill="pt.color" />
                <text :x="pt.x" :y="pt.y">{{ bIdx + 1 }}</text>
              </g>
            </svg>
          </div>

          <div class="desk-body">
            <div class="beats">
              <div v-for="(beat, index) in selected.beats" :key="beat.id" class="beat"
                :class="{ missing: !beat.title?.trim() || !beat.description?.trim() }">
                <span class="num" :style="{ background: kindColor(beat.kind) }">{{ index + 1 }}</span>
                <div class="beat-main">
                  <div class="beat-top">
                    <input :aria-label="'节点' + (index + 1) + '名称'" :value="beat.title" :disabled="busy"
                      placeholder="节点名称" @input="updateBeat(index, 'title', ($event.target as HTMLInputElement).value)" />
                    <select class="m-select beat-kind" :value="beat.kind" :disabled="busy" :aria-label="'节点' + (index + 1) + '类型'"
                      @change="updateBeat(index, 'kind', ($event.target as HTMLSelectElement).value)">
                      <option v-for="kind in kinds" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
                    </select>
                    <div class="beat-tools">
                      <button type="button" :disabled="busy || index === 0" title="上移" @click="moveBeat(index, -1)">↑</button>
                      <button type="button" :disabled="busy || index === selected.beats.length - 1" title="下移" @click="moveBeat(index, 1)">↓</button>
                      <button type="button" :disabled="busy" title="移除节点" @click="removeBeat(index)">×</button>
                    </div>
                  </div>
                  <textarea :aria-label="'节点' + (index + 1) + '内容'" :value="beat.description" :disabled="busy"
                    rows="2" placeholder="这个节点发生了什么变化？" @input="updateBeat(index, 'description', ($event.target as HTMLTextAreaElement).value)"></textarea>
                </div>
              </div>
              <p v-if="!selected.beats.length" class="empty-beats">暂无关键节点，请点击上方「添加关键节点」或从其他方案借用。</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <footer class="footer">
      <div class="f-status" :data-tone="footerTone" role="status">
        <span class="lamp" aria-hidden="true"></span>
        <span class="txt">{{ footerStatusText }}</span>
        <div v-if="selected" class="checks" aria-label="必填项检查">
          <span v-for="field in deskFields" :key="field.key" :class="{ ok: !!selected[field.key]?.trim() }" :title="field.label"></span>
        </div>
      </div>
      <div class="f-actions">
        <template v-if="selected">
          <button type="button" class="m-btn" :disabled="busy" @click="emit('save')">
            {{ selected.complete === false ? '已核对补齐，保存作者版本' : '保存作者版本' }}
          </button>
          <button type="button" class="m-btn zhu" :disabled="busy || dirty || !canConfirm" @click="emit('confirm')">
            确认此方案为正式方向
          </button>
        </template>
        <p v-else class="f-empty-hint">选择一个方案，或手写新方案。</p>
      </div>
    </footer>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { PlotSkeleton, SkeletonField, SkeletonSourceSelection, StoryBeat } from '@/types/reconstruction'
import { skeletonCompletionIssues } from '@/services/creationDraft'
import { useConfigStore } from '@/stores/config'
import { errorText } from '@/services/userFacingError'
import { mixExcerpts, reviewStoryMix, type MixConflict, type MixExcerpt, type MixReview } from '@/services/storyCreationMix'

const props = defineProps<{ skeletons: PlotSkeleton[]; selectedId?: string; confirmedId?: string; busy?: boolean; dirty?: boolean; hasOutline?: boolean }>()
const emit = defineEmits<{ select: [id: string]; edit: [skeleton: PlotSkeleton]; confirm: []; save: []; create: []; regenerate: []; mix: [sources: SkeletonSourceSelection[], review?: MixReview] }>()

const activeView = ref<'cards' | 'lanes' | 'desk'>(props.skeletons.length <= 1 ? 'desk' : 'cards')
const fullCards = ref(false)
const hoveredBeatKey = ref('')
const expandedLaneBeat = ref('')
const borrowOpen = ref(false)

const deskId = ref<string | undefined>(props.selectedId)
const selected = computed(() => props.skeletons.find(item => item.id === (deskId.value || props.selectedId)) || props.skeletons[0])
const otherSkeletons = computed(() => props.skeletons.filter(item => item.id !== selected.value?.id))

const SWAP_TIP_KEY = 'mobish.skeleton.swapTipDismissed'
const showSwapTip = ref((() => { try { return localStorage.getItem(SWAP_TIP_KEY) !== '1' } catch { return true } })())
function dismissSwapTip() {
  showSwapTip.value = false
  try { localStorage.setItem(SWAP_TIP_KEY, '1') } catch { /* ignore */ }
}

const slotNames = ['甲', '乙', '丙', '丁', '戊', '己']
const slotTag = (idx: number) => slotNames[idx] || String(idx + 1)
const slotListLabel = computed(() => props.skeletons.map((_, i) => slotTag(i)).join(' / '))
const slotTagOf = (id?: string) => {
  const idx = props.skeletons.findIndex(item => item.id === id)
  return idx >= 0 ? slotTag(idx) : '稿'
}
const selectedSlotTag = computed(() => slotTagOf(selected.value?.id))

const deskFields = [
  { key: 'title', label: '方案名称' },
  { key: 'logline', label: '一句话主线' },
  { key: 'premise', label: '故事前提' },
  { key: 'promise', label: '读者承诺' },
  { key: 'ending', label: '结局方向' },
] as const

const kinds: { value: StoryBeat['kind']; label: string; color: string; y: number }[] = [
  { value: 'opening', label: '开端', color: 'var(--ink-3)', y: 0.30 },
  { value: 'inciting', label: '引发事件', color: 'var(--dai)', y: 0.52 },
  { value: 'turning_point', label: '转折', color: 'var(--jin)', y: 0.64 },
  { value: 'midpoint', label: '中点', color: 'var(--zi)', y: 0.76 },
  { value: 'low_point', label: '低谷', color: 'var(--ink)', y: 0.14 },
  { value: 'climax', label: '高潮', color: 'var(--zhu)', y: 0.96 },
  { value: 'resolution', label: '结局', color: 'var(--qing)', y: 0.44 },
  { value: 'custom', label: '其他', color: 'var(--ink-4)', y: 0.50 },
]
const kindMap = Object.fromEntries(kinds.map(k => [k.value, k]))
const kindColor = (kind: StoryBeat['kind']) => kindMap[kind]?.color || 'var(--ink-4)'
const kindLabel = (kind: StoryBeat['kind']) => kindMap[kind]?.label || '其他'

function curvePath(beats: StoryBeat[], width = 260) {
  if (!beats.length) return { line: '', area: '', points: [] as Array<{ id: string; x: number; y: number; color: string }> }
  const left = 18, right = width - 18, top = 12, bottom = 56
  const points = beats.map((beat, index) => {
    const ratio = beats.length === 1 ? 0.5 : index / (beats.length - 1)
    const level = kindMap[beat.kind]?.y ?? 0.5
    const x = Math.round((left + ratio * (right - left)) * 10) / 10
    const y = Math.round((bottom - level * (bottom - top)) * 10) / 10
    return { id: beat.id, x, y, color: kindColor(beat.kind) }
  })
  const line = points.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`).join(' ')
  const area = points.length > 1 ? `${line} L ${points[points.length - 1].x} ${bottom} L ${points[0].x} ${bottom} Z` : ''
  return { line, area, points }
}

function selectedLaneBeat(item: PlotSkeleton) {
  if (!expandedLaneBeat.value.startsWith(item.id + ':')) return undefined
  const beatId = expandedLaneBeat.value.slice(item.id.length + 1)
  return item.beats.find(b => b.id === beatId)
}

// 追踪方案台里的跨方案来源，以便「组合为新的可编辑候选」保留完整 provenance
const fieldSources = reactive<Record<SkeletonField, string>>({ title: '', premise: '', logline: '', promise: '', ending: '' })
const beatSources = ref<SkeletonSourceSelection[]>([])
const manuallyEditedFields = reactive<Record<SkeletonField, boolean>>({ title: false, premise: false, logline: false, promise: false, ending: false })

function initSourcesFrom(item?: PlotSkeleton) {
  borrowOpen.value = false
  for (const field of deskFields) {
    fieldSources[field.key] = item?.revisionId || ''
    manuallyEditedFields[field.key] = false
  }
  beatSources.value = item?.revisionId
    ? item.beats.map(beat => ({ revisionId: item.revisionId!, field: 'beat' as const, beatId: beat.id, targetBeatId: crypto.randomUUID() }))
    : []
}

watch(() => props.selectedId, (id, prev) => {
  deskId.value = id
  if (id !== prev) initSourcesFrom(props.skeletons.find(item => item.id === id) || props.skeletons[0])
}, { immediate: true })
watch(() => props.skeletons.length, (len, prev) => {
  if (len === 1 && prev === 0) activeView.value = 'desk'
  else if (len > 1 && prev === 0) activeView.value = 'cards'
})

function openDesk() {
  if (!selected.value && props.skeletons.length) emit('select', props.skeletons[0].id)
  activeView.value = 'desk'
}
function openDeskOn(id: string) {
  deskId.value = id
  if (id !== props.selectedId) emit('select', id)
  activeView.value = 'desk'
}
function selectAndFocus(id: string) {
  deskId.value = id
  if (id !== props.selectedId) emit('select', id)
}
function pickForDesk(item: PlotSkeleton) {
  deskId.value = item.id
  initSourcesFrom(item)
  activeView.value = 'desk'
}

const mixSources = computed<SkeletonSourceSelection[]>(() =>
  [...deskFields.map(field => ({ field: field.key, revisionId: fieldSources[field.key] })), ...beatSources.value])
const isMixed = computed(() => new Set(mixSources.value.map(source => source.revisionId).filter(Boolean)).size > 1)
const mixConflicts = ref<MixConflict[]>()
const mixDecisions = ref<Array<{ keep: number; reason: string }>>([])
const reviewedExcerpts = ref<MixExcerpt[]>([])
const mixError = ref('')
const checkingMix = ref(false)
const reviewComplete = computed(() => mixDecisions.value.every(decision => decision.keep >= 0 && decision.reason.trim()))
type SavedReview = { review: MixReview; excerpts: MixExcerpt[] }
const selectedReview = ref<SavedReview>()
let pendingReview: { saved: SavedReview; beatIds: string[] } | undefined
let mixCheck: AbortController | undefined

watch(mixSources, () => {
  mixCheck?.abort()
  mixConflicts.value = undefined
  mixDecisions.value = []
  mixError.value = ''
})
watch(() => props.selectedId, id => {
  selectedReview.value = undefined
  if (!id) return
  const key = 'mobish.skeleton-mix-review.' + id
  const candidate = selected.value
  if (pendingReview && candidate && candidate.beats.length === pendingReview.beatIds.length
    && candidate.beats.every((beat, index) => beat.id === pendingReview!.beatIds[index])) {
    selectedReview.value = pendingReview.saved
    try { localStorage.setItem(key, JSON.stringify(pendingReview.saved)) } catch {
      mixError.value = '取舍理由暂时只能在当前页面查看。'
    }
  } else {
    try {
      const saved = localStorage.getItem(key)
      if (saved) selectedReview.value = JSON.parse(saved) as SavedReview
    } catch { /* ignore */ }
  }
  pendingReview = undefined
}, { immediate: true })
onBeforeUnmount(() => mixCheck?.abort())

const missingFields = computed(() => deskFields.filter(field => !props.skeletons.some(item => item.revisionId === fieldSources[field.key])).length)
const canMix = computed(() => missingFields.value === 0 && beatSources.value.length > 0)
const canConfirm = computed(() => selected.value && !skeletonCompletionIssues(selected.value).length)

function sourceName(revisionId: string) { return revisionId ? props.skeletons.find(item => item.revisionId === revisionId)?.title || '历史方案' : '' }
const mixCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const source of mixSources.value) {
    const name = sourceName(source.revisionId)
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts].map(([name, count]) => `${name}×${count}`).join(' · ')
})

function isFieldFrom(key: SkeletonField, cand: PlotSkeleton) {
  if (manuallyEditedFields[key]) return false
  if (fieldSources[key]) return !!cand.revisionId && fieldSources[key] === cand.revisionId
  return cand.id === selected.value?.id
}
function fieldSourceState(key: SkeletonField) {
  if (manuallyEditedFields[key]) return { tone: 'edited', tag: '改', label: '已手改' }
  const rev = fieldSources[key]
  const owner = props.skeletons.find(item => item.revisionId === rev)
  if (!owner) return { tone: '', tag: selectedSlotTag.value, label: '当前方案' }
  const tag = slotTagOf(owner.id)
  if (owner.id === selected.value?.id) return { tone: '', tag, label: `来自 ${tag}` }
  return { tone: 'borrowed', tag, label: `借自 ${tag}` }
}

function deskFieldValue(key: SkeletonField) {
  if (!selected.value) return ''
  if (!manuallyEditedFields[key] && fieldSources[key]) {
    const owner = props.skeletons.find(item => item.revisionId === fieldSources[key])
    if (owner) return owner[key]
  }
  return selected.value[key]
}

function swapFieldFrom(key: SkeletonField, cand: PlotSkeleton) {
  if (!selected.value || !cand[key]) return
  if (cand.revisionId) {
    fieldSources[key] = cand.revisionId
    manuallyEditedFields[key] = false
    return
  }
  manuallyEditedFields[key] = true
  emit('edit', { ...selected.value, [key]: cand[key], approval: 'draft' })
}
function manualEditField(key: SkeletonField, value: string) {
  if (!selected.value) return
  const base = { ...selected.value }
  for (const field of deskFields) {
    if (field.key !== key && !manuallyEditedFields[field.key] && fieldSources[field.key]) {
      const owner = props.skeletons.find(item => item.revisionId === fieldSources[field.key])
      if (owner) base[field.key] = owner[field.key]
    }
  }
  manuallyEditedFields[key] = true
  emit('edit', { ...base, [key]: value, approval: 'draft' })
}
function updateBeat(index: number, key: 'title' | 'description' | 'kind', value: string) {
  if (selected.value) emit('edit', { ...selected.value, approval: 'draft', beats: selected.value.beats.map((beat, i) => i === index ? { ...beat, [key]: value } as StoryBeat : beat) })
}
function addBeat() {
  if (selected.value) emit('edit', { ...selected.value, approval: 'draft', beats: [...selected.value.beats, { id: crypto.randomUUID(), title: '', description: '', kind: 'custom', relatedPlotlineIds: [], relatedCharacterIds: [] }] })
}
function borrowBeat(other: PlotSkeleton, beat: StoryBeat) {
  if (!selected.value) return
  const targetBeatId = crypto.randomUUID()
  if (other.revisionId) {
    beatSources.value = [...beatSources.value, { revisionId: other.revisionId, field: 'beat', beatId: beat.id, targetBeatId }]
  }
  emit('edit', { ...selected.value, approval: 'draft', beats: [...selected.value.beats, { ...beat, id: targetBeatId }] })
  borrowOpen.value = false
}
function removeBeat(index: number) {
  if (!selected.value) return
  beatSources.value = beatSources.value.filter((_, idx) => idx !== index)
  emit('edit', { ...selected.value, approval: 'draft', beats: selected.value.beats.filter((_, i) => i !== index) })
}
function moveBeat(index: number, delta: number) {
  if (!selected.value) return
  const beats = [...selected.value.beats]
  const [beat] = beats.splice(index, 1)
  beats.splice(index + delta, 0, beat)
  if (beatSources.value.length === selected.value.beats.length) {
    const nextSources = [...beatSources.value]
    const [src] = nextSources.splice(index, 1)
    nextSources.splice(index + delta, 0, src)
    beatSources.value = nextSources
  }
  emit('edit', { ...selected.value, approval: 'draft', beats })
}

async function checkMix() {
  const config = useConfigStore()
  const model = config.getModelForTask('outline') || config.getModelForTask('chat')
  if (!model?.apiKey.trim()) { mixError.value = '请先在设置中配置大纲或对话模型。'; return }
  const request = new AbortController()
  mixCheck = request
  checkingMix.value = true
  mixError.value = ''
  try {
    const excerpts = mixExcerpts(props.skeletons, mixSources.value)
    const conflicts = await reviewStoryMix(model, excerpts, request.signal)
    if (request.signal.aborted) return
    reviewedExcerpts.value = excerpts
    mixConflicts.value = conflicts
    mixDecisions.value = conflicts.map(() => ({ keep: -1, reason: '' }))
  } catch (error) {
    if (!request.signal.aborted) mixError.value = errorText(error, '冲突检查失败')
  } finally {
    if (mixCheck === request) { mixCheck = undefined; checkingMix.value = false }
  }
}

function mix() {
  const sources = mixSources.value
  if (!mixConflicts.value?.length) { emit('mix', sources); return }
  const keep = new Set(mixDecisions.value.map(decision => decision.keep))
  const replace = new Map<number, number>()
  mixConflicts.value.forEach(({ left, right }, index) => {
    const winner = mixDecisions.value[index].keep
    replace.set(winner === left ? right : left, winner)
  })
  if ([...replace.keys()].some(index => keep.has(index))) {
    mixError.value = '同一来源同时被保留和替换，请核对各项取舍。'
    return
  }
  const revised = sources.flatMap((source, index) => {
    const replacement = replace.get(index)
    if (replacement === undefined) return [source]
    if (source.field === 'beat') return []
    return [{ ...source, revisionId: sources[replacement].revisionId }]
  })
  if (!revised.some(source => source.field === 'beat')) { mixError.value = '取舍后至少要保留一个关键节点。'; return }
  const review: MixReview = { original: sources.map(source => ({ ...source })), conflicts: mixConflicts.value,
    decisions: mixDecisions.value.map(decision => ({ ...decision, reason: decision.reason.trim() })) }
  pendingReview = { saved: { review, excerpts: reviewedExcerpts.value },
    beatIds: revised.filter(source => source.field === 'beat').map(source => source.targetBeatId!) }
  emit('mix', revised, review)
}

const footerTone = computed(() => {
  if (!selected.value) return ''
  if (props.dirty) return 'warn'
  if (selected.value.id === props.confirmedId) return 'ok'
  if (!canConfirm.value) return 'warn'
  return 'ok'
})
const footerStatusText = computed(() => {
  if (!selected.value) return '请选择一个方案或手写新方案'
  if (props.dirty) return '方案台有未保存修改，请先保存作者版本'
  if (selected.value.id === props.confirmedId) return `已确认「${selected.value.title || '当前方案'}」为正式方向`
  if (!canConfirm.value) return '当前方案有未填写项，请进入方案台补齐后保存'
  return `当前选中「${selected.value.title || '未命名方案'}」，可保存或确认正式方向`
})
</script>
<style scoped>
.skeleton-picker {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  row-gap: 10px;
  width: 100%;
}
.toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.seg { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--line); flex: none; }
.seg button { height: 26px; padding: 0 11px; border-radius: 6px; font-size: 12px; color: var(--ink-3); white-space: nowrap; }
.seg button[aria-pressed="true"] { background: var(--paper); color: var(--ink); box-shadow: var(--shadow-1); font-weight: 600; }
.index { flex: 1; display: flex; gap: 6px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.index button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 4px; border-radius: 14px; border: 1px solid var(--line); background: var(--paper); color: var(--ink-2); font-size: 12px; white-space: nowrap; }
.index button:hover { border-color: var(--line-2); color: var(--ink); }
.mini-seal { width: 20px; height: 20px; border-radius: 10px; display: inline-grid; place-items: center; background: var(--panel-2); font: 600 12px/1 var(--f-kai); color: var(--ink-2); }
.index .is-editing { border-color: var(--zhu); border-style: dashed; }
.index .is-editing .mini-seal { background: var(--zhu-soft); color: var(--zhu); }
.index .is-confirmed { border-color: var(--zhu); color: var(--zhu); font-weight: 600; }
.index .is-confirmed .mini-seal { background: var(--zhu); color: #fff; }
.toolbar-right { display: flex; align-items: center; gap: 6px; flex: none; }

.stage { min-height: 0; min-width: 0; position: relative; }
.start-empty { display: grid; place-items: center; min-height: 280px; border: 1px dashed var(--line-2); border-radius: 12px; background: var(--paper); }
.start-inner { display: grid; gap: 10px; justify-items: center; text-align: center; max-width: 480px; padding: 20px; }
.start-inner h3 { margin: 0; font: 600 18px var(--f-serif); }
.start-inner p { margin: 0; color: var(--ink-3); font-size: 13px; }
.start-actions { display: flex; gap: 8px; }

/* 方案对照：三列 subgrid 卡片 */
.cards {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(290px, calc((100% - 24px) / 3));
  grid-template-rows: repeat(7, auto);
  column-gap: 12px;
  align-content: start;
  align-items: start;
  height: 100%;
  overflow: auto;
  padding: 4px 4px 10px;
  overscroll-behavior: contain;
}
.card {
  grid-row: span 7;
  display: grid;
  grid-template-rows: subgrid;
  min-width: 0;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow-1);
  position: relative;
}
.card.editing { border-color: var(--zhu); border-style: dashed; }
.card.confirmed { border-color: var(--zhu); box-shadow: 0 0 0 1px var(--zhu), 0 0 0 4px var(--zhu-soft); }
.card.confirmed .c-head, .card.confirmed .c-logline { background: var(--zhu-soft); }
.card.confirmed .c-head { border-radius: 11px 11px 0 0; }
.c-head { display: flex; gap: 10px; align-items: flex-start; padding: 14px 16px 8px; min-width: 0; }
.seal { width: 30px; height: 30px; flex: none; border: 1px solid var(--line-2); border-radius: 7px; display: grid; place-items: center; background: var(--panel); color: var(--ink-2); font: 600 16px/1 var(--f-kai); }
.card.editing .seal, .seal.editing { border-color: var(--zhu); background: var(--zhu-soft); color: var(--zhu); }
.card.confirmed .seal, .lane.confirmed .seal, .seal.confirmed { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.c-name { min-width: 0; flex: 1; }
.c-title { margin: 0; font: 600 16px/1.35 var(--f-serif); overflow-wrap: anywhere; }
.c-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 3px; color: var(--ink-3); font-size: 11.5px; }
.tag { display: inline-flex; align-items: center; gap: 4px; height: 19px; padding: 0 7px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--panel-2); color: var(--ink-2); white-space: nowrap; }
.tag.zhu { background: var(--zhu-soft); color: var(--zhu); }
.tag.jin { background: var(--jin-soft); color: var(--jin); }
.tag.official { background: var(--zhu); color: #fff; }
.c-logline { margin: 0; padding: 6px 16px 12px; font: 14.5px/1.75 var(--f-serif); color: var(--ink); border-left: 3px solid var(--line-2); margin-inline: 16px; padding-left: 10px; padding-right: 0; }
.card.confirmed .c-logline { border-left-color: var(--zhu); padding: 8px 14px 12px 12px; margin-inline: 0; }
.c-struct { padding: 10px 14px 12px; border-top: 1px dashed var(--line); background: color-mix(in srgb, var(--panel), transparent 40%); }
.c-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; color: var(--ink-3); font-size: 11.5px; font-weight: 600; }
.c-label small { font-weight: 400; color: var(--ink-4); }
.shape { display: block; width: 100%; height: auto; overflow: visible; }
.shape .curve { fill: none; stroke: var(--ink-3); stroke-width: 1.4; opacity: .75; }
.shape .area { fill: var(--ink); opacity: .05; }
.shape .base { stroke: var(--line-2); stroke-width: 1; stroke-dasharray: 2 3; }
.shape .node circle { stroke: var(--paper); stroke-width: 2; }
.shape .node text { fill: #fff; font: 600 9px/1 var(--f-num); text-anchor: middle; dominant-baseline: central; pointer-events: none; }
.c-beats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 10px; margin: 6px 0 0; padding: 0; list-style: none; }
.c-beats li { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 4px; border-radius: 5px; font-size: 12px; color: var(--ink-2); }
.c-beats li span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-beats li.hot { background: var(--paper); box-shadow: var(--shadow-1); color: var(--ink); }
.num { width: 18px; height: 18px; flex: none; border-radius: 50%; display: inline-grid; place-items: center; color: #fff; font: 600 9.5px/1 var(--f-num); }
.c-field { padding: 10px 16px; border-top: 1px solid var(--line); min-width: 0; }
.c-field b { display: block; margin-bottom: 4px; color: var(--ink-3); font-size: 11.5px; font-weight: 600; }
.c-field p { margin: 0; font-size: 13px; line-height: 1.7; color: var(--ink-2); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.cards.full .c-field p { display: block; -webkit-line-clamp: unset; }
.c-actions { display: flex; align-items: center; gap: 8px; padding: 12px 16px 14px; border-top: 1px solid var(--line); }
.c-actions .note { margin-left: auto; color: var(--zhu); font-size: 12px; font-weight: 600; }

/* 情节结构：泳道对照 */
.lanes { height: 100%; overflow: auto; padding: 4px 4px 10px; display: grid; align-content: start; gap: 10px; }
.legend { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 8px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink-3); font-size: 12px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 5px; vertical-align: -1px; }
.legend .sp { flex: 1; }
.lane { display: grid; grid-template-columns: 184px minmax(0, 1fr); border: 1px solid var(--line); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow-1); }
.lane.editing { border-color: var(--zhu); border-style: dashed; }
.lane.confirmed { border-color: var(--zhu); box-shadow: 0 0 0 1px var(--zhu), 0 0 0 4px var(--zhu-soft); }
.lane.confirmed .lane-head { background: var(--zhu-soft); border-radius: 11px 0 0 11px; }
.lane-head { display: flex; gap: 9px; align-items: flex-start; padding: 14px 12px 14px 14px; border-right: 1px solid var(--line); min-width: 0; }
.lane-open { font-size: 11.5px; color: var(--zhu); text-decoration: underline; }
.track { position: relative; padding: 16px 12px 12px; min-width: 0; }
.track-line { position: absolute; left: 24px; right: 24px; top: 30px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, var(--line), var(--line-2)); }
.track ol { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 4px; margin: 0; padding: 0; list-style: none; }
.track li button { display: grid; justify-items: center; gap: 5px; width: 100%; padding: 0 2px 4px; border-radius: 8px; text-align: center; }
.track li button:hover, .track li button[aria-expanded="true"] { background: var(--panel); }
.track .num { width: 26px; height: 26px; font-size: 11px; box-shadow: 0 0 0 3px var(--paper); }
.track .t { font: 600 12.5px/1.4 var(--f-serif); color: var(--ink); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.track .k { font-size: 10.5px; color: var(--ink-4); }
.lane-detail { grid-column: 2; margin: 0 12px 12px; padding: 10px 12px; border-radius: 8px; background: var(--panel); font-size: 13px; line-height: 1.7; color: var(--ink-2); }
.lane-detail b { color: var(--ink); font-family: var(--f-serif); margin-right: 6px; }

/* 方案台：左字段 + 右节点双栏独立滚动 */
.desk { height: 100%; display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr); gap: 12px; min-height: 0; }
.desk-col { min-height: 0; display: flex; flex-direction: column; border: 1px dashed var(--zhu); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow-1); overflow: hidden; }
.desk.is-confirmed .desk-col { border-style: solid; }
.desk-head { display: flex; align-items: center; gap: 8px; min-height: 50px; padding: 9px 14px; border-bottom: 1px solid var(--line); flex: none; }
.desk-head h2 { margin: 0; font: 600 15px/1.3 var(--f-serif); }
.desk-head .sp { flex: 1; }
.desk-body { flex: 1; min-height: 0; overflow: auto; padding: 12px 14px 16px; display: grid; align-content: start; gap: 10px; }
.field { border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px 10px; background: var(--paper); }
.field:focus-within { border-color: var(--ink-3); }
.field.missing { border-color: color-mix(in srgb, var(--jin), transparent 45%); background: var(--jin-soft); }
.field-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; min-width: 0; flex-wrap: wrap; }
.field-top b { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.field-top .sp { flex: 1; }
.src { display: inline-flex; align-items: center; gap: 4px; height: 19px; padding: 0 6px; border-radius: 10px; font-size: 11px; color: var(--ink-3); background: var(--panel-2); white-space: nowrap; }
.src i { font: 600 11px/1 var(--f-kai); font-style: normal; color: var(--ink-2); }
.src.borrowed { background: var(--dai-soft); color: var(--dai); }
.src.borrowed i { color: var(--dai); }
.src.edited { background: var(--jin-soft); color: var(--jin); }
.swap { display: inline-flex; align-items: center; gap: 3px; height: 26px; padding: 0 3px 0 8px; border: 1px solid var(--zhu); border-radius: 7px; background: var(--zhu-soft); color: var(--zhu); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
.swap > span { margin-right: 3px; }
.swap button { width: 22px; height: 20px; border-radius: 5px; border: 1px solid transparent; font: 600 12px/1 var(--f-kai); color: var(--ink-2); }
.swap button:hover:not(:disabled) { border-color: var(--zhu-mid); background: var(--paper); color: var(--zhu); }
.swap button[aria-pressed="true"] { border-color: var(--zhu); background: var(--paper); color: var(--zhu); }
.desk.pulse .swap { animation: swapPulse 1.4s ease-out 3; }
@keyframes swapPulse { 0% { box-shadow: 0 0 0 0 var(--zhu-mid); } 70%, 100% { box-shadow: 0 0 0 6px transparent; } }
.swap-tip { position: relative; display: flex; align-items: center; gap: 10px; padding: 9px 10px 9px 12px; border: 1px solid var(--zhu); border-radius: 10px; background: var(--zhu-soft); color: var(--ink-2); font-size: 12px; line-height: 1.6; }
.swap-tip .mark { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: var(--zhu); color: #fff; font: 700 12px/1 var(--f-serif); }
.swap-tip p { flex: 1; margin: 0; }
.swap-tip b { color: var(--zhu); margin-right: 4px; }
.dirty-note { margin: 0; padding: 6px 10px; border-radius: 7px; background: var(--jin-soft); color: var(--jin); font-size: 12px; }
.field textarea { width: 100%; border: 0; background: transparent; resize: vertical; outline: none; padding: 0; color: var(--ink); font: 13.5px/1.7 var(--f-serif); }

.mix-bar { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--dai); border-radius: 10px; background: var(--dai-soft); }
.mix-bar-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 12.5px; }
.mix-bar-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.mix-err { margin: 0; font-size: 12px; color: var(--zhu); }
.conflicts { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--jin); border-radius: 8px; background: var(--jin-soft); }
.conflicts h3 { margin: 0; font-size: 12.5px; color: var(--jin); }
.conflict { display: grid; gap: 6px; margin: 0; padding: 8px; border: 0; border-radius: 7px; background: var(--paper); font-size: 12px; }
.conflict p { margin: 0; color: var(--ink-2); }
.conflict .choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.conflict label { display: flex; gap: 6px; align-items: flex-start; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer; }
.conflict .reason { width: 100%; padding: 5px 8px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--paper); color: var(--ink); }

.shape-box { flex: none; padding: 6px 14px 4px; border-bottom: 1px dashed var(--line); background: color-mix(in srgb, var(--panel), transparent 40%); }
.borrow-wrap { position: relative; }
.pop { position: absolute; right: 0; top: 34px; z-index: 30; width: 320px; max-height: 320px; overflow: auto; padding: 8px; border: 1px solid var(--line-2); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow-2); }
.pop h4 { display: flex; align-items: center; gap: 6px; margin: 6px 4px 4px; color: var(--ink-3); font-size: 11.5px; }
.pop button.opt { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 2px 8px; width: 100%; padding: 6px 8px; border-radius: 8px; text-align: left; }
.pop button.opt:hover { background: var(--panel); }
.pop button.opt strong { font: 600 13px/1.4 var(--f-serif); }
.pop button.opt small { grid-column: 2; color: var(--ink-3); font-size: 11.5px; }
.pop button.opt .num { grid-row: span 2; margin-top: 2px; }

.beats { display: grid; gap: 8px; }
.beat { display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); }
.beat.missing { border-color: color-mix(in srgb, var(--jin), transparent 45%); }
.beat > .num { width: 22px; height: 22px; margin-top: 2px; }
.beat-main { display: grid; gap: 5px; min-width: 0; }
.beat-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.beat-top input { flex: 1; min-width: 0; border: 0; background: transparent; font: 600 14px/1.4 var(--f-serif); color: var(--ink); outline: none; }
.beat-kind { width: auto; height: 24px; padding: 0 24px 0 8px; font-size: 11px; border-radius: 12px; }
.beat-tools { display: flex; gap: 2px; flex: none; }
.beat-tools button { width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--line); background: var(--panel); color: var(--ink-2); font-size: 11px; }
.beat-tools button:hover:not(:disabled) { border-color: var(--zhu); color: var(--zhu); }
.beat-main textarea { width: 100%; border: 0; background: transparent; resize: vertical; outline: none; font-size: 12.5px; line-height: 1.6; color: var(--ink-2); }
.empty-beats { margin: 0; color: var(--ink-3); font-size: 12.5px; }

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 52px;
  padding: 8px 12px 8px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.f-status { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 13px; color: var(--ink-2); }
.f-status .lamp { width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--ink-4); }
.f-status[data-tone="ok"] { color: var(--qing); }
.f-status[data-tone="ok"] .lamp { background: var(--qing); }
.f-status[data-tone="warn"] { color: var(--jin); }
.f-status[data-tone="warn"] .lamp { background: var(--jin); }
.f-status .txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.checks { display: flex; gap: 4px; flex: none; }
.checks span { width: 8px; height: 8px; border-radius: 2px; background: var(--line-2); }
.checks span.ok { background: var(--qing); }
.f-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.f-empty-hint { margin: 0; font-size: 12.5px; color: var(--ink-3); }

@media (max-width: 960px) {
  .desk { grid-template-columns: minmax(0, 1fr); }
  .lane { grid-template-columns: minmax(0, 1fr); }
  .lane-head { border-right: 0; border-bottom: 1px solid var(--line); }
  .lane-detail { grid-column: 1; }
}
</style>
