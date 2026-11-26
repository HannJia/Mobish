<template>
  <div class="character-desk">
    <div class="panel-title">
      <strong>章初角色状态</strong>
      <router-link class="m-link" :to="{ path: `/codex/${novel.id}`, query: { returnTo } }">典籍 <V3Icon name="chevR" size="s" /></router-link>
    </div>

    <div class="char-toolbar">
      <div class="char-search">
        <V3Icon name="search" size="s" />
        <input
          v-model="query"
          type="search"
          aria-label="搜索角色"
          placeholder="按姓名、别称、身份或势力搜索…"
        />
        <button v-if="query" type="button" class="char-search-clear" aria-label="清空搜索" @click="query = ''">×</button>
      </div>
      <div v-if="desk.hiddenFutureCount > 0 || includeFuture" class="char-filter-row">
        <span class="char-count">共 {{ desk.items.length }} 人</span>
        <button
          type="button"
          class="m-chip char-future-chip"
          :class="{ on: includeFuture }"
          :aria-pressed="includeFuture"
          @click="includeFuture = !includeFuture"
        >
          {{ includeFuture ? '已含后续人物' : `含后续人物 (+${desk.hiddenFutureCount})` }}
        </button>
      </div>
    </div>

    <p v-if="!desk.items.length" class="char-empty">
      <template v-if="query.trim()">没有匹配「{{ query.trim() }}」的角色。</template>
      <template v-else-if="desk.hiddenFutureCount > 0">
        本章前暂无已出场角色，后续章节还有 {{ desk.hiddenFutureCount }} 位预建人物。
      </template>
      <template v-else>
        本书尚未记录角色，可在典籍中补充人物与数据面板。
        <router-link class="m-link" :to="{ path: `/characters/${novel.id}`, query: { returnTo } }">去添加人物</router-link>
      </template>
    </p>

    <div v-else class="char-list">
      <article
        v-for="item in desk.items"
        :key="item.character.id"
        class="char-card"
        :class="{ open: expandedId === item.character.id }"
      >
        <button
          type="button"
          class="char-card-head"
          :aria-expanded="expandedId === item.character.id"
          @click="toggleExpand(item.character.id)"
        >
          <CharacterAvatar :character="item.character" :size="30" />
          <div class="char-head-main">
            <div class="char-head-line">
              <strong>{{ item.character.name }}</strong>
              <span v-if="item.presenceLabel" class="char-tag" :class="`presence-${item.presence}`">{{ item.presenceLabel }}</span>
              <span class="char-tag" :class="statusTagClass(item.character.status)">{{ item.character.status }}</span>
            </div>
            <div class="char-head-sub">
              <span>{{ item.character.identity || '身份未记录' }}</span>
              <span v-if="!item.visibleAtChapter && item.presence === 'other'" class="char-future-note">
                · 第{{ item.character.firstAppearChapter + 1 }}章起
              </span>
              <span v-else-if="expandedId !== item.character.id && summaryHint(item)" class="char-mini-meta">
                · {{ summaryHint(item) }}
              </span>
            </div>
          </div>
          <V3Icon :name="expandedId === item.character.id ? 'chevD' : 'chevR'" size="s" class="char-chev" />
        </button>

        <div v-if="expandedId === item.character.id" class="char-card-body">
          <div v-if="metaChips(item.character).length" class="char-meta-grid">
            <div v-for="chip in metaChips(item.character)" :key="chip.label" class="char-meta-item">
              <span>{{ chip.label }}</span>
              <b>{{ chip.value }}</b>
            </div>
          </div>

          <section v-if="item.boundPanels.length" class="char-block">
            <div class="char-block-head">
              <h5>个人数据面板</h5>
              <router-link class="m-link" :to="{ path: `/data/${novel.id}`, query: { returnTo } }">管理</router-link>
            </div>
            <div v-for="panel in item.boundPanels" :key="panel.id" class="char-panel-box">
              <div class="char-panel-name">{{ panel.name }}</div>
              <div v-if="panel.metrics.length" class="char-metrics">
                <div v-for="metric in panel.metrics" :key="metric.fieldId" class="char-metric">
                  <div class="char-metric-top">
                    <span>{{ metric.name }}</span>
                    <em :class="`temporal-${metric.temporal}`">{{ temporalLabel[metric.temporal] }}</em>
                  </div>
                  <strong>{{ metric.value }}<small v-if="metric.unit">{{ metric.unit }}</small></strong>
                </div>
              </div>
              <p v-else class="char-muted">此面板暂无字段。</p>
            </div>
          </section>

          <section v-if="item.equipment.length" class="char-block">
            <h5>持有装备与道具</h5>
            <div v-for="eq in item.equipment" :key="eq.id" class="char-equip-row">
              <div class="char-equip-head">
                <strong>{{ eq.name }}</strong>
                <span class="char-tag" :class="equipmentTagClass(eq.state)">{{ eq.stateLabel }}</span>
              </div>
              <small v-if="eq.summary">{{ eq.summary }}</small>
            </div>
          </section>

          <section v-if="item.relations.length" class="char-block">
            <h5>有效关系</h5>
            <div v-for="(rel, idx) in item.relations.slice(0, 6)" :key="`${rel.targetId}:${rel.dimensionLabel}:${idx}`" class="char-rel-row">
              <span class="char-rel-target">{{ rel.targetName }}</span>
              <span v-if="rel.inChapter" class="char-tag presence-planned">本章</span>
              <small class="char-rel-dim">{{ rel.dimensionLabel }}</small>
              <span class="char-rel-text">{{ rel.relation }}</span>
            </div>
          </section>

          <section class="char-block">
            <h5>章前认知</h5>
            <div v-if="item.knowledge.length" class="char-knowledge-list">
              <div v-for="entry in item.knowledge" :key="entry.id" class="char-knowledge-item">
                <div class="char-knowledge-line">
                  <span class="knowledge-pill" :class="entry.state">{{ entry.stateLabel }}</span>
                  <span class="char-knowledge-fact">{{ entry.fact }}</span>
                </div>
                <p v-if="entry.belief" class="char-knowledge-belief">
                  {{ entry.state === 'false_belief' ? '误信' : '判断' }}：{{ entry.belief }}
                </p>
                <div v-if="entry.sourceLabel || entry.quote" class="char-knowledge-src">
                  <button
                    v-if="entry.quote"
                    type="button"
                    class="char-src-toggle"
                    @click="toggleQuote(entry.id)"
                  >
                    {{ entry.sourceLabel || '来源' }} · {{ openQuotes.has(entry.id) ? '收起原句' : '查看原句' }}
                  </button>
                  <span v-else>{{ entry.sourceLabel }}</span>
                </div>
                <blockquote v-if="entry.quote && openQuotes.has(entry.id)" class="char-quote">“{{ entry.quote }}”</blockquote>
              </div>
            </div>
            <p v-else class="char-muted">暂无认知记录</p>
          </section>

          <footer class="char-card-foot">
            <router-link class="m-btn xs" :to="{ path: `/characters/${novel.id}`, query: { character: item.character.id, returnTo } }">
              编辑人物资料
            </router-link>
            <router-link class="m-btn xs" :to="{ path: `/data/${novel.id}`, query: { returnTo } }">
              {{ item.boundPanels.length ? '管理数据面板' : '绑定数据面板' }}
            </router-link>
          </footer>
        </div>
      </article>
    </div>

    <p v-if="desk.invalidKnowledgeCount > 0" class="context-warning">
      {{ desk.invalidKnowledgeCount }} 条历史认知来源已失效，未作为当前认知展示。
    </p>
    <div class="context-isolation">
      <V3Icon name="lock" size="s" />
      <span>只展示本章之前已生效的角色状态、关系、认知与章前数据；全书设定会单独标注。</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import CharacterAvatar from '@/components/CharacterAvatar.vue'
import { deriveCharacterDesk, type CharacterDeskItem } from '@/v3/selectors/characterDesk'
import type { Chapter, Character, EquipmentState, Novel } from '@/types/novel'
import type { CanonMutationRecord } from '@/types/reconstruction'
import type { ChapterAppearances } from '@/services/characterAppearances'
import type { DataPanelFieldTemporalKind } from '@/services/dataPanelReference'

const props = defineProps<{
  novel: Novel
  chapter: Chapter
  draftContent: string
  planText: string
  canonMutations: CanonMutationRecord[]
  chapterAppearances?: ChapterAppearances
}>()

const query = ref('')
const includeFuture = ref(false)
const expandedId = ref('')
const openQuotes = ref(new Set<string>())
const returnTo = computed(() => `/write/${props.novel.id}/${props.chapter.id}?tab=character`)

const temporalLabel: Record<DataPanelFieldTemporalKind, string> = {
  'before-chapter': '章前',
  'global-setting': '全书设定',
  unrecorded: '时间未记录',
}

const desk = computed(() => deriveCharacterDesk({
  novel: props.novel,
  chapter: props.chapter,
  draftContent: props.draftContent,
  planText: props.planText,
  canonMutations: props.canonMutations,
  chapterAppearances: props.chapterAppearances,
  query: query.value,
  includeFuture: includeFuture.value,
}))

watch(() => [props.chapter.id, desk.value.items.map(item => item.character.id).join(',')], () => {
  const ids = desk.value.items.map(item => item.character.id)
  if (!ids.length) { expandedId.value = ''; return }
  if (!expandedId.value || !ids.includes(expandedId.value)) expandedId.value = ids[0]
}, { immediate: true })

watch(() => props.chapter.id, () => {
  openQuotes.value = new Set()
})

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? '' : id
}

function toggleQuote(id: string) {
  const next = new Set(openQuotes.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openQuotes.value = next
}

function statusTagClass(status: Character['status']): string {
  if (status === '活跃') return 'status-ok'
  if (status === '死亡') return 'status-bad'
  if (status === '失踪' || status === '待核对') return 'status-warn'
  return 'status-muted'
}

function equipmentTagClass(state: EquipmentState): string {
  if (state === 'equipped') return 'status-ok'
  if (state === 'lost' || state === 'consumed') return 'status-bad'
  return 'status-muted'
}

function metaChips(character: Character): Array<{ label: string; value: string }> {
  return [
    character.faction ? { label: '阵营', value: character.faction } : null,
    character.powerLevel ? { label: '实力', value: character.powerLevel } : null,
    character.aliases?.length ? { label: '别称', value: character.aliases.join('、') } : null,
    character.personality ? { label: '性格', value: character.personality } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item))
}

function summaryHint(item: CharacterDeskItem): string {
  const parts: string[] = []
  const metricCount = item.boundPanels.reduce((sum, panel) => sum + panel.metrics.length, 0)
  if (metricCount) parts.push(`${metricCount} 项数据`)
  if (item.equipment.length) parts.push(`${item.equipment.length} 件装备`)
  if (item.knowledge.length) parts.push(`${item.knowledge.length} 条认知`)
  return parts.join(' · ')
}
</script>

<style scoped>
.character-desk { display: flex; flex-direction: column; gap: 12px; }
.panel-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: -14px -14px 2px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.panel-title strong { font: 600 14px var(--f-serif); }
.panel-title .m-link { display: inline-flex; align-items: center; color: var(--dai); text-decoration: none; font-size: 12px; }

.char-toolbar { display: grid; gap: 8px; }
.char-search {
  display: flex; align-items: center; gap: 6px; padding: 0 9px; height: 32px;
  border: 1px solid var(--line-2); border-radius: 7px; background: var(--paper); color: var(--ink-3);
}
.char-search:focus-within { border-color: var(--zhu); }
.char-search input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  color: var(--ink); font: 12.5px var(--f-ui);
}
.char-search input::placeholder { color: var(--ink-4); }
.char-search-clear {
  border: 0; background: transparent; color: var(--ink-3); cursor: pointer;
  font-size: 15px; line-height: 1; padding: 0 2px;
}
.char-search-clear:hover { color: var(--ink); }

.char-filter-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.char-count { font-size: 11px; color: var(--ink-3); }
.char-future-chip { height: 24px; font-size: 11px; }

.char-empty { margin: 12px 0; padding: 16px 12px; border: 1px dashed var(--line-2); border-radius: 8px; text-align: center; font-size: 12px; color: var(--ink-3); line-height: 1.7; }
.char-empty .m-link { display: inline-block; margin-left: 6px; color: var(--zhu); }

.char-list { display: grid; gap: 8px; }
.char-card { border: 1px solid var(--line); border-radius: 9px; background: var(--paper); overflow: hidden; transition: border-color .15s; }
.char-card.open { border-color: color-mix(in srgb, var(--zhu) 35%, var(--line-2)); box-shadow: var(--shadow-1); }

.char-card-head {
  width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 11px;
  border: 0; background: transparent; text-align: left; cursor: pointer;
}
.char-card-head:hover { background: var(--hover); }
.char-head-main { flex: 1; min-width: 0; display: grid; gap: 3px; }
.char-head-line { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.char-head-line strong { font-size: 13.5px; color: var(--ink); }
.char-head-sub { font-size: 11.5px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.char-mini-meta { color: var(--ink-4); }
.char-future-note { color: var(--jin); }
.char-chev { flex: none; color: var(--ink-4); }

.char-tag { padding: 1px 6px; border-radius: 4px; font-size: 10.5px; line-height: 1.45; white-space: nowrap; }
.presence-actual { background: var(--zhu-soft); color: var(--zhu); font-weight: 600; }
.presence-mentioned { background: var(--dai-soft); color: var(--dai); }
.presence-planned { background: var(--panel-2); color: var(--ink-3); }
.status-ok { background: var(--qing-soft); color: var(--qing); }
.status-bad { background: var(--zhu-soft); color: var(--zhu); }
.status-warn { background: var(--jin-soft); color: var(--jin); }
.status-muted { background: var(--panel-2); color: var(--ink-3); }

.char-card-body { display: grid; gap: 11px; padding: 0 11px 11px; border-top: 1px solid var(--line); padding-top: 10px; }

.char-meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.char-meta-item { padding: 6px 8px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); min-width: 0; }
.char-meta-item span { display: block; font-size: 10.5px; color: var(--ink-4); }
.char-meta-item b { display: block; margin-top: 2px; font-size: 12px; font-weight: 500; color: var(--ink); overflow-wrap: anywhere; }

.char-block { display: grid; gap: 6px; }
.char-block h5 { margin: 0; font: 600 11.5px var(--f-ui); color: var(--ink-3); letter-spacing: .04em; }
.char-block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.char-block-head .m-link { font-size: 11px; color: var(--dai); text-decoration: none; }

.char-panel-box { display: grid; gap: 6px; padding: 8px 9px; border-radius: 7px; background: var(--panel); border: 1px solid var(--line); }
.char-panel-name { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.char-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.char-metric { padding: 6px 7px; border-radius: 6px; background: var(--paper); border: 1px solid var(--line); min-width: 0; }
.char-metric-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; font-size: 10.5px; color: var(--ink-3); }
.char-metric-top span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.char-metric-top em { font-style: normal; font-size: 9.5px; padding: 0 4px; border-radius: 3px; flex: none; }
.temporal-before-chapter { background: var(--qing-soft); color: var(--qing); }
.temporal-global-setting { background: var(--panel-2); color: var(--ink-3); }
.temporal-unrecorded { background: var(--jin-soft); color: var(--jin); }
.char-metric strong { display: block; margin-top: 3px; font: 600 14px/1.25 var(--f-num); color: var(--ink); overflow-wrap: anywhere; }
.char-metric strong small { margin-left: 2px; font: 400 11px var(--f-ui); color: var(--ink-3); }

.char-equip-row { padding: 6px 8px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); }
.char-equip-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 12px; }
.char-equip-row small { display: block; margin-top: 3px; font-size: 11px; color: var(--ink-3); line-height: 1.5; }

.char-rel-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 5px; font-size: 12px; line-height: 1.55; padding: 4px 0; border-bottom: 1px dashed var(--line); }
.char-rel-row:last-child { border-bottom: 0; }
.char-rel-target { font-weight: 600; color: var(--ink); }
.char-rel-dim { font-size: 11px; color: var(--ink-4); }
.char-rel-text { color: var(--ink-2); }

.char-knowledge-list { display: grid; gap: 6px; }
.char-knowledge-item { padding: 7px 8px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); display: grid; gap: 4px; }
.char-knowledge-line { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; line-height: 1.5; }
.knowledge-pill { flex: none; padding: 1px 6px; border-radius: 4px; font-size: 10.5px; background: var(--panel-2); color: var(--ink-3); }
.knowledge-pill.knows { background: var(--qing-soft); color: var(--qing); }
.knowledge-pill.suspects { background: var(--jin-soft); color: var(--jin); }
.knowledge-pill.false_belief { background: var(--zi-soft); color: var(--zi); }
.char-knowledge-fact { color: var(--ink); overflow-wrap: anywhere; }
.char-knowledge-belief { margin: 0; font-size: 11.5px; color: var(--zi); line-height: 1.5; }
.char-knowledge-src { font-size: 11px; color: var(--ink-4); }
.char-src-toggle { border: 0; padding: 0; background: transparent; color: var(--dai); font: inherit; cursor: pointer; }
.char-src-toggle:hover { text-decoration: underline; }
.char-quote { margin: 2px 0 0; padding: 5px 8px; border-left: 2px solid var(--zhu-mid); background: var(--paper); font: 12px/1.6 var(--f-serif); color: var(--ink-2); }

.char-muted { margin: 0; font-size: 11.5px; color: var(--ink-4); }
.char-card-foot { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; }
.char-card-foot .m-btn { text-decoration: none; }

.context-warning { margin: 0; font-size: 11px; color: var(--zi); }
.context-isolation { display: flex; gap: 8px; padding: 9px 10px; border: 1px dashed var(--line-2); border-radius: 8px; font-size: 11px; color: var(--ink-3); line-height: 1.6; }
</style>
