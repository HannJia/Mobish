<template>
  <section v-if="onboarding.showChecklist" class="guide-checklist" :class="{ compact, collapsed: isCollapsed, done: summary.allCoreDone }"
    aria-label="新手启程清单" data-guide="shelf.start">
    <header class="gc-head">
      <div class="gc-title">
        <span class="gc-dot" aria-hidden="true" />
        <strong>{{ summary.allCoreDone ? '上手已完成' : '新手启程' }}</strong>
        <span v-if="summary.path !== 'undecided'" class="gc-progress m-num">
          已完成 {{ summary.completedCore }} / {{ summary.totalCore }}
        </span>
        <span v-else class="gc-sub">选一个顺手的起点，随时可以切换</span>
      </div>
      <div class="gc-head-acts">
        <button v-if="summary.path !== 'undecided'" type="button" class="m-btn xs ghost" @click="toggleCollapse">
          {{ isCollapsed ? '展开' : '收起' }}
        </button>
        <button type="button" class="m-btn xs ghost" title="仅收起本清单，不关闭工作台轻提示" @click="dismissChecklist">关闭</button>
        <button type="button" class="m-btn xs ghost" title="关闭清单和所有首次使用提示，之后可在设置-关于重新开启" @click="onboarding.disableAll()">不再提示</button>
      </div>
    </header>

    <template v-if="!isCollapsed">
      <!-- 未选路径：双起点分流 -->
      <div v-if="summary.path === 'undecided'" class="gc-paths">
        <button type="button" class="gc-path-card" data-guide-path="manual" @click="chooseManual">
          <strong>先自己写（无需配置 AI）</strong>
          <small>直接用空白模板或已有大纲建立第一部作品，写下首章即上手，之后随时再接模型。</small>
          <span class="gc-path-cta">新建作品并带我找到 →</span>
        </button>
        <button type="button" class="gc-path-card ai" data-guide-path="ai" @click="chooseAi">
          <strong>先配置 AI 模型</strong>
          <small>添加一个写作或对话模型并测通连接，再用灵感对话、AI 协作或审校辅助创作。</small>
          <span class="gc-path-cta">前往模型配置并带我找到 →</span>
        </button>
      </div>

      <!-- 已选路径：实时派生进度清单 -->
      <div v-else class="gc-body">
        <div class="gc-mode-bar">
          <span>当前路线：<b>{{ summary.path === 'manual' ? '手工起步（2 步）' : 'AI 辅助起步（3 步）' }}</b></span>
          <button type="button" class="m-link" @click="onboarding.setPath(summary.path === 'manual' ? 'ai' : 'manual')">
            切换为{{ summary.path === 'manual' ? 'AI 辅助路线' : '手工起步路线' }}
          </button>
        </div>

        <ol class="gc-list">
          <li v-for="item in summary.coreItems" :key="item.id" class="gc-item" :class="{ done: item.done }">
            <span class="gc-check" :aria-label="item.done ? '已完成' : '待完成'">{{ item.done ? '✓' : '' }}</span>
            <div class="gc-item-text">
              <strong>{{ itemLabel(item.id, item.label) }}</strong>
              <small v-if="itemHint(item.id, item.done)">{{ itemHint(item.id, item.done) }}</small>
            </div>
            <div v-if="!item.done || item.id === 'model_ready'" class="gc-item-acts">
              <button v-if="item.id === 'model_ready' && !item.done" type="button" class="m-btn sm pri" @click="goModels">
                {{ summary.hasOnlyEmbeddingModels ? '添加写作／对话模型' : '去配置并测试' }}
              </button>
              <button v-else-if="item.id === 'model_ready' && item.done" type="button" class="m-btn xs ghost" @click="goAssign">
                查看任务分配
              </button>
              <button v-else-if="item.id === 'first_book_created'" type="button" class="m-btn sm zhu" @click="goCreate">
                新建第一部作品
              </button>
              <button v-else-if="item.id === 'first_chapter_saved'" type="button" class="m-btn sm pri" @click="goContinueBook">
                {{ summary.activeNovelId ? '继续这部作品' : '先建一部作品' }}
              </button>
            </div>
          </li>
        </ol>

        <div v-if="summary.optionalItems.length" class="gc-optional">
          <span class="gc-opt-label">选做</span>
          <div class="gc-opt-items">
            <div v-for="opt in summary.optionalItems" :key="opt.id" class="gc-opt-chip" :class="{ done: opt.done }">
              <span>{{ opt.done ? '✓' : '○' }} {{ opt.label }}</span>
              <button v-if="opt.id === 'first_backup_exported' && !opt.done" type="button" class="m-link" @click="locateBackup">
                带我找到
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useOnboardingStore } from '@/stores/onboarding'
import type { OnboardingMilestone } from '@/services/onboardingGuide'

const props = defineProps<{ compact?: boolean }>()
const router = useRouter()
const onboarding = useOnboardingStore()
const summary = computed(() => onboarding.checklistSummary)
const isCollapsed = computed(() => onboarding.state.checklist === 'collapsed')

function toggleCollapse() {
  onboarding.setChecklist(isCollapsed.value ? 'expanded' : 'collapsed')
}

function dismissChecklist() {
  onboarding.closeTour()
  onboarding.setChecklist('dismissed')
}

function itemLabel(id: OnboardingMilestone | 'model_ready', fallback: string) {
  if (id === 'model_ready' && summary.value.hasOnlyEmbeddingModels) return '添加写作／对话模型'
  if (id === 'first_book_created' && summary.value.activeNovelTitle) return `已有作品《${summary.value.activeNovelTitle}》`
  return fallback
}

function itemHint(id: OnboardingMilestone | 'model_ready', done: boolean) {
  if (done) return ''
  if (id === 'model_ready') return '填写常用服务商与密钥后点一次“测试”，首台模型会自动分配给大纲、正文与审校。'
  if (id === 'first_book_created') return '支持空白模板手工起步，也支持灵感对话或导入大纲。'
  if (id === 'first_chapter_saved') return summary.value.activeNovelId
    ? '打开作品进入第一章，写下第一段并保存正文即可完成。'
    : '建好作品进入写作台，写下第一段正文保存即可完成。'
  return ''
}

async function chooseManual() {
  onboarding.setPath('manual')
  onboarding.markSeen('shelf.start')
  await router.push('/create')
  onboarding.startTour('create_picker')
}

async function chooseAi() {
  onboarding.setPath('ai')
  onboarding.markSeen('shelf.start')
  await router.push({ path: '/settings', query: { section: 'models' } })
  onboarding.startTour('settings_models')
}

async function goModels() {
  await router.push({ path: '/settings', query: { section: 'models' } })
  onboarding.startTour('settings_models')
}

async function goAssign() {
  await router.push({ path: '/settings', query: { section: 'assign' } })
  onboarding.startTour('settings_assign')
}

async function goCreate() {
  await router.push('/create')
  onboarding.startTour('create_picker')
}

async function goContinueBook() {
  if (!summary.value.activeNovelPath) {
    await goCreate()
    return
  }
  const target = summary.value.activeNovelPath
  await router.push(target)
  if (target.startsWith('/generate/')) onboarding.startTour('create_flow')
  else if (target.startsWith('/write/')) onboarding.startTour('write_first', 'write.save')
}

function locateBackup() {
  onboarding.startTour('shelf', 'shelf.backup')
}
</script>

<style scoped>
.guide-checklist {
  border: 1px solid var(--line);
  border-radius: var(--r-m);
  background: var(--paper);
  padding: 16px 18px;
  display: grid;
  gap: 12px;
  text-align: left;
  margin-top: 16px;
}
.guide-checklist.compact { margin: 0 0 18px; padding: 12px 16px; }
.guide-checklist.collapsed { gap: 0; }
.gc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.gc-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.gc-title strong { font: 600 15px var(--f-serif); color: var(--ink); }
.gc-dot { width: 8px; height: 8px; border-radius: 50%; border: 2px solid var(--zhu); background: transparent; flex: none; }
.guide-checklist.done .gc-dot { border-color: var(--qing); background: var(--qing); }
.gc-progress { font-size: 12px; color: var(--zhu); padding: 1px 8px; border-radius: 99px; background: var(--zhu-soft); }
.guide-checklist.done .gc-progress { color: var(--qing); background: var(--qing-soft); }
.gc-sub { font-size: 13px; color: var(--ink-3); }
.gc-head-acts { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.gc-paths { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.gc-path-card {
  display: grid; gap: 6px; padding: 14px 16px; text-align: left;
  border: 1px solid var(--line-2); border-radius: var(--r-s);
  background: var(--panel); color: var(--ink); cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.gc-path-card:hover { border-color: var(--zhu); box-shadow: var(--shadow-1); }
.gc-path-card strong { font-size: 14px; font-weight: 600; color: var(--ink); }
.gc-path-card small { font-size: 12.5px; line-height: 1.6; color: var(--ink-2); }
.gc-path-cta { font-size: 12.5px; color: var(--zhu); font-weight: 600; margin-top: 2px; }
.gc-body { display: grid; gap: 10px; }
.gc-mode-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--ink-3); }
.gc-mode-bar b { color: var(--ink-2); font-weight: 600; }
.gc-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.gc-item {
  display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-s); background: var(--panel);
}
.gc-item.done { opacity: .78; background: transparent; }
.gc-check {
  width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid var(--line-2);
  display: inline-grid; place-items: center; font-size: 12px; color: var(--paper); flex: none;
}
.gc-item.done .gc-check { border-color: var(--qing); background: var(--qing); }
.gc-item-text { display: grid; gap: 2px; min-width: 0; }
.gc-item-text strong { font-size: 13.5px; color: var(--ink); }
.gc-item-text small { font-size: 13px; line-height: 1.5; color: var(--ink-3); }
.gc-item-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.gc-optional { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 8px; border-top: 1px dashed var(--line); font-size: 12px; color: var(--ink-3); }
.gc-opt-label { padding: 1px 6px; border-radius: 4px; background: var(--panel); border: 1px solid var(--line); }
.gc-opt-items { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.gc-opt-chip { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-2); }
.gc-opt-chip.done { color: var(--qing); }
@media (max-width: 680px) {
  .gc-paths { grid-template-columns: minmax(0, 1fr); }
  .gc-item { grid-template-columns: 20px minmax(0, 1fr); }
  .gc-item-acts { grid-column: 2; }
}
</style>
