<template>
  <Teleport defer to="#v3-crumb">
    <router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">{{ selectedKB?.name || '资料库' }}</span>
  </Teleport>
  <div class="kb-page page-container fade-in" id="knowledge-base">
    <div class="kb-header">
      <div>
        <h2 class="page-title">{{ selectedKB?.name || '知识库' }}</h2>
        <p v-if="!selectedKBId" class="page-subtitle">全局设定资料与书籍挂载</p>
      </div>
      <div class="header-actions">
        <button v-if="!hasNovelContext" type="button" class="m-btn sm ghost" @click="router.push('/')">返回书架</button>
        <button type="button" class="m-btn sm pri" @click="showCreateModal = true"><V3Icon name="plus" size="s" />创建知识库</button>
      </div>
    </div>

    <!-- 知识库列表 -->
    <div v-if="!selectedKBId" class="kb-list">
      <div class="kb-list-toolbar">
        <span class="kb-library-count">共 {{ knowledgeBases.length }} 个知识库</span>
        <V3Input v-model:value="libraryQuery" class="kb-library-search" placeholder="搜索知识库、描述或条目..." clearable aria-label="搜索知识库" />
        <V3Select v-model:value="librarySort" class="kb-library-sort" :options="librarySortOptions" aria-label="知识库排序" />
      </div>
      <div v-if="knowledgeBases.length === 0" class="empty-state paper-panel">
        <img class="m-art empty-art" :src="libraryArt" alt="">
        <h3>还没有知识库</h3>
        <p>知识库可以存储世界观、人物、势力等设定信息，在 AI 写作时自动注入</p>
        <button type="button" class="m-btn pri" @click="showCreateModal = true">创建第一个知识库</button>
      </div>
      <div
        v-for="kb in filteredKnowledgeBases"
        :key="kb.id"
        class="kb-card paper-panel"
        role="button"
        tabindex="0"
        @click="selectKB(kb.id)"
        @keydown.enter.self.prevent="selectKB(kb.id)"
        @keydown.space.self.prevent="selectKB(kb.id)"
      >
        <div class="kb-card-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H3zM21 4h-6a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h6z" /></svg></div>
        <div class="kb-card-info">
          <h3>{{ kb.name }}</h3>
          <p>{{ kb.description || '暂无描述' }}</p>
          <p v-if="kb.summary" class="kb-summary-preview">摘要：{{ kb.summary.slice(0, 180) }}{{ kb.summary.length > 180 ? '...' : '' }}</p>
          <span v-if="kb.summary" class="summary-status kb-summary-status" :class="`summary-status-${getBaseSummaryStatus(kb)}`">摘要：{{ summaryStatusLabel(getBaseSummaryStatus(kb)) }}</span>
          <span class="kb-card-meta">{{ kb.entries.length }} 条目 · {{ kbActivityTime(kb) ? formatDate(new Date(kbActivityTime(kb)).toISOString()) : '暂无编辑记录' }}{{ hasNovelContext && isBound(kb.id) ? ' · 本书已挂载' : '' }}</span>
        </div>
        <div class="kb-card-actions">
        <button v-if="hasNovelContext" type="button" class="m-btn xs" :class="{ pri: isBound(kb.id) }" :aria-pressed="isBound(kb.id)"
          @click.stop="toggleBind(kb.id)">{{ isBound(kb.id) ? '已绑定' : '绑定小说' }}</button>
        <button type="button" class="m-btn xs ghost danger" @click.stop="confirmDeleteKB(kb)">删除</button>
        </div>
      </div>
      <p v-if="knowledgeBases.length && !filteredKnowledgeBases.length" class="kb-no-results paper-panel">没有匹配的知识库，请尝试其他关键词。</p>
    </div>

    <!-- 知识库详情 -->
    <div v-else class="kb-detail">
      <div class="kb-detail-header">
        <button type="button" class="m-btn sm ghost" @click="selectedKBId = ''"><V3Icon name="chevR" size="s" class="back-icon" />返回列表</button>
        <div class="detail-actions">
          <button type="button" class="m-btn sm" @click="openImport()">导入资料</button>
          <button v-if="(selectedKB?.entries.length || 0) > 1" type="button" class="m-btn sm" @click="openMerge">合并条目</button>
          <button v-if="featureFlags.knowledgeAiSummary" type="button" class="m-btn sm" :aria-busy="summarizingKB" :disabled="baseSummaryBusy" @click="summarizeSelectedKB">{{ summarizingKB ? '正在整理…' : '整理摘要' }}</button>
          <button type="button" class="m-btn sm pri" @click="openAddEntry"><V3Icon name="plus" size="s" />添加条目</button>
        </div>
      </div>

      <details class="kb-summary-panel paper-panel" :open="baseSummaryOpen" @toggle="baseSummaryOpen = ($event.target as HTMLDetailsElement).open">
        <summary class="kb-summary-toggle">知识库摘要<span class="summary-status" :class="`summary-status-${selectedKB ? getBaseSummaryStatus(selectedKB) : 'empty'}`">{{ selectedKB ? summaryStatusLabel(getBaseSummaryStatus(selectedKB)) : '空' }}</span><small>{{ featureFlags.knowledgeAiSummary ? '可选；挂载到小说后 AI 会先读摘要。点击展开' : '可选；手写这个知识库的简介，AI 会一并参考。点击展开' }}</small></summary>
        <div v-if="featureFlags.knowledgeAiSummary" class="summary-budget">
          <label>本次请求上限<V3Number v-model:value="summaryBudget.requests" :min="1" :max="4096" :disabled="anySummaryRunning" aria-label="摘要请求上限" /></label>
          <label>本次 Token 额度<V3Number v-model:value="summaryBudget.tokens" :min="1" :max="50000000" :disabled="anySummaryRunning" aria-label="摘要 token 额度" /></label>
          <span>生成前检查完整处理额度；接口未报告用量时保守计入。导入批次共享此额度。</span>
          <button v-if="importSummaryRunning" type="button" class="m-btn sm" @click="cancelSummary('import')">取消导入摘要</button>
        </div>
        <div class="kb-summary-toolbar">
          <div>
            <h4>知识库摘要</h4>
            <p>摘要在书架层面维护，挂载到小说后 AI 优先读取摘要，再按问题读取相关条目。</p>
          </div>
          <V3Select v-model:value="summaryLevel" class="summary-level" :options="summaryLevelOptions" aria-label="摘要详略" :disabled="baseSummaryBusy" />
        </div>
        <div class="summary-status-row">
          <span class="summary-status" :class="`summary-status-${selectedKB ? getBaseSummaryStatus(selectedKB) : 'empty'}`">
            摘要状态：{{ selectedKB ? summaryStatusLabel(getBaseSummaryStatus(selectedKB)) : '空' }}
          </span>
          <span class="summary-status-hint">{{ selectedKB ? summaryStatusHint(getBaseSummaryStatus(selectedKB)) : '' }}</span>
        </div>
        <V3Input
          v-model:value="baseSummaryDraft"
          type="textarea"
          :rows="5"
          aria-label="知识库摘要"
          placeholder="可手工填写摘要；保存后会按你核对的结果使用。"
          :disabled="baseSummaryBusy"
          @focus="beginBaseSummaryEdit"
          @update:value="markBaseSummaryDirty"
        />
        <p class="summary-scope-hint">{{ basePlanHint }}</p>
        <p v-if="selectedKB?.summarySource?.coverage" class="summary-coverage">{{ coverageText(selectedKB.summarySource) }}</p>
        <div v-if="summaryProgress[baseJobKey]" class="summary-run-status" role="status">
          {{ progressText(summaryProgress[baseJobKey]) }}
          <button v-if="summarizingKB && ['extract', 'merge'].includes(summaryProgress[baseJobKey].phase)" type="button" class="m-btn sm" @click="cancelSummary(baseJobKey)">取消整库整理</button>
        </div>
        <p v-if="baseSummaryError" class="summary-error" role="alert">
          {{ baseSummaryError }}
          <button type="button" @click="reloadBaseSummaryDraft">重新载入当前来源</button>
          <button v-if="baseSummaryErrorKind === 'ai' && featureFlags.knowledgeAiSummary" type="button" @click="summarizeSelectedKB">重新整理</button>
        </p>
        <div class="summary-actions">
          <button type="button" class="m-btn sm" :disabled="baseSummaryBusy || !baseSummaryDraft.trim()" @click="saveBaseSummaryDraft">{{ selectedKB?.summary ? '核对并沿用' : '保存并核对' }}</button>
        </div>
        <span v-if="selectedKB?.summaryUpdatedAt" class="kb-summary-time">上次整理：{{ formatDateTime(selectedKB.summaryUpdatedAt) }}</span>
        <div v-if="selectedKB?.summaryHistory?.length" class="summary-history">
          <strong>摘要历史（最近 {{ selectedKB.summaryHistory.length }} 条）</strong>
          <article v-for="history in selectedKB.summaryHistory" :key="history.id" class="summary-history-item">
            <div>{{ formatDateTime(history.savedAt) }} · {{ history.summarySource?.origin === 'ai' ? 'AI' : history.summarySource?.origin === 'author' ? '作者' : '未记录来源' }}{{ history.summaryLevel ? ` · ${summaryLevelLabel(history.summaryLevel)}` : '' }}</div>
            <p>{{ history.summary }}</p>
          </article>
        </div>
      </details>

      <div class="kb-browser" :class="{ 'drop-active': pageDragging }" @dragenter.prevent="pageDragging = true" @dragover.prevent="pageDragging = true"
        @dragleave.self="pageDragging = false" @drop.prevent="onPageDrop">
        <section ref="entryListPanel" class="kb-entries paper-panel" aria-label="条目列表">
          <div class="filter-bar">
            <V3Input v-model:value="searchQuery" class="entry-search" placeholder="搜索条目..." clearable aria-label="搜索条目" />
            <V3Select v-if="usedTags.length" v-model:value="tagFilter" :options="tagOptions" aria-label="按标签筛选" />
            <span class="entry-count">{{ filteredEntries.length }} 条</span>
          </div>
          <div v-if="usedCategories.length > 1" class="kb-category-chips" role="group" aria-label="条目分类">
            <button type="button" class="kb-category-item" :class="{ active: !categoryFilter }" @click="categoryFilter = null">
              全部<span class="kb-category-count">{{ selectedKB?.entries.length ?? 0 }}</span>
            </button>
            <button v-for="cat in usedCategories" :key="cat" type="button" class="kb-category-item" :class="{ active: categoryFilter === cat }" @click="categoryFilter = cat">
              {{ categoryLabel(cat) }}<span class="kb-category-count">{{ countByCategory(cat) }}</span>
            </button>
          </div>
          <div class="entry-list">
            <div v-if="filteredEntries.length === 0" class="empty-hint">{{ selectedKB?.entries.length ? '没有匹配的条目' : '还没有条目。点“导入资料”，或把文件直接拖到这里。' }}</div>
            <div v-for="entry in filteredEntries" :key="entry.id" class="entry-card" :class="{ 'entry-selected': selectedEntryId === entry.id }"
              role="button" tabindex="0" :aria-pressed="selectedEntryId === entry.id" @click="selectEntry(entry.id)" @keydown.enter.self="selectEntry(entry.id)">
              <!-- 一行：标题、简要信息、操作；下面一行简短说明 -->
              <div class="entry-header">
                <h4 :title="entry.title">{{ entry.title }}</h4>
                <span class="entry-meta">{{ categoryLabel(entry.category) }} · {{ entry.content.length.toLocaleString('zh-CN') }} 字 · 摘要{{ summaryStatusLabel(getEntrySummaryStatus(selectedKBId, entry)) }}</span>
                <div class="entry-actions" @click.stop>
                  <button type="button" class="m-btn xs" :class="{ pri: selectedEntryId === entry.id }" :aria-pressed="selectedEntryId === entry.id" @click="selectEntry(entry.id)">查看</button>
                  <button type="button" class="m-btn xs" @click="editEntry(entry)">编辑</button>
                  <button type="button" class="m-btn xs ghost danger" @click="confirmRemoveEntry(entry)">删除</button>
                </div>
              </div>
              <p class="entry-preview">{{ entryPreview(entry) }}</p>
              <p v-if="entry.tags.length" class="entry-preview">{{ entry.tags.join(' · ') }}</p>
            </div>
          </div>
          <p class="kb-drop-hint">可以把 .txt / .md / .html / .docx / .epub / .pdf 文件直接拖到这里导入</p>
        </section>

        <!-- 下方：选中条目的内容 -->
        <section v-if="selectedEntryId && selectedEntry" ref="detailPanel" class="entry-detail-panel paper-panel" aria-label="条目内容">
          <div class="entry-detail-header">
            <div class="entry-detail-title-group">
              <h3>{{ selectedEntry.title }}</h3>
              <span class="entry-detail-cat">{{ categoryLabel(selectedEntry.category) }}</span>
              <span class="entry-size">{{ selectedEntry.content.length.toLocaleString('zh-CN') }} 字</span>
              <span v-if="selectedEntry.visibility" class="entry-size">{{ selectedEntry.visibility.mode === 'never' ? '仅供作者查看' : `第 ${selectedEntry.visibility.chapter} 章起可供 AI 使用` }}</span>
            </div>
            <div class="entry-detail-tools">
              <button v-if="entryOutline.length > 0 && !outlineInView" type="button" class="m-btn sm" @click="scrollToOutline"><V3Icon name="layers" size="s" />目录</button>
              <button v-if="!entryListInView" type="button" class="m-btn sm" @click="scrollToEntryList"><V3Icon name="chevR" size="s" class="back-up-icon" />返回条目列表</button>
              <button v-if="canUseKnowledgeEntry(selectedEntry) && selectedEntry.content.trim()" type="button" class="m-btn sm" @click="showCanonDraft = true">提取设定</button>
              <button type="button" class="m-btn sm" @click="editEntry(selectedEntry)">编辑</button>
            </div>
          </div>
          <details v-if="entryOutline.length > 0" ref="outlinePanel" class="entry-outline" open>
            <summary>目录<small>{{ entryOutline.length }} 项 · 点击跳转</small></summary>
            <nav ref="outlineList" class="entry-outline-list" aria-label="条目目录">
              <button v-for="item in entryOutline" :key="item.index" type="button" class="entry-outline-item" :class="`outline-level-${item.level}`" @click="jumpToHeading(item.index)">{{ item.title }}</button>
            </nav>
          </details>
          <div ref="detailContent" class="entry-detail-content" v-html="renderMd(selectedEntry.content)"></div>
          <details v-if="selectedEntry.mergedSources?.length" class="entry-outline">
            <summary>合并来源</summary>
            <ul><li v-for="(source, index) in selectedEntry.mergedSources" :key="index">{{ source.title }} · {{ categoryLabel(source.category) }}</li></ul>
          </details>
          <section class="entry-summary-editor">
            <div class="entry-summary-heading">
              <h4>条目摘要</h4>
              <span class="summary-status" :class="`summary-status-${getEntrySummaryStatus(selectedKBId, selectedEntry)}`">
                {{ summaryStatusLabel(getEntrySummaryStatus(selectedKBId, selectedEntry)) }}
              </span>
            </div>
            <p class="summary-status-hint">{{ summaryStatusHint(getEntrySummaryStatus(selectedKBId, selectedEntry)) }}</p>
            <V3Input
              v-model:value="entrySummaryDraft"
              type="textarea"
              :rows="5"
              aria-label="条目摘要"
              placeholder="可手工填写摘要；保存后会按你核对的结果使用。"
              :disabled="entrySummaryBusy(selectedEntry.id)"
              @focus="beginEntrySummaryEdit(selectedEntry.id)"
              @update:value="markEntrySummaryDirty"
            />
            <p class="summary-scope-hint">{{ entryPlanHint }}</p>
            <p v-if="selectedEntry.summarySource?.coverage" class="summary-coverage">{{ coverageText(selectedEntry.summarySource) }}</p>
            <div v-if="summaryProgress[entryJobKey]" class="summary-run-status" role="status">
              {{ progressText(summaryProgress[entryJobKey]) }}
              <button v-if="summarizingEntryIds.has(selectedEntry.id) && ['extract', 'merge'].includes(summaryProgress[entryJobKey].phase)" type="button" class="m-btn sm" @click="cancelSummary(entryJobKey)">取消条目整理</button>
            </div>
            <p v-if="entrySummaryErrors[entrySummaryErrorKey(selectedKBId, selectedEntry.id)]" class="summary-error" role="alert">
              {{ entrySummaryErrors[entrySummaryErrorKey(selectedKBId, selectedEntry.id)] }}
              <button type="button" @click="reloadEntrySummaryDraft(selectedEntry.id)">重新载入当前来源</button>
              <button v-if="entrySummaryErrorKinds[entrySummaryErrorKey(selectedKBId, selectedEntry.id)] === 'ai'" type="button" @click="retryEntrySummary(selectedEntry.id)">重新整理</button>
            </p>
            <div class="summary-actions">
              <button type="button" class="m-btn sm" :disabled="entrySummaryBusy(selectedEntry.id) || !entrySummaryDraft.trim()" @click="saveEntrySummaryDraft(selectedEntry.id)">{{ selectedEntry.summary ? '核对并沿用' : '保存并核对' }}</button>
              <button v-if="featureFlags.knowledgeAiSummary" type="button" class="m-btn sm ghost" :aria-busy="entrySummaryBusy(selectedEntry.id)" :disabled="entrySummaryBusy(selectedEntry.id)" @click="retryEntrySummary(selectedEntry.id)">重新整理摘要</button>
            </div>
            <div v-if="selectedEntry.summaryHistory?.length" class="summary-history">
              <strong>摘要历史（最近 {{ selectedEntry.summaryHistory.length }} 条）</strong>
              <article v-for="history in selectedEntry.summaryHistory" :key="history.id" class="summary-history-item">
                <div>{{ formatDateTime(history.savedAt) }} · {{ history.summarySource?.origin === 'ai' ? 'AI' : history.summarySource?.origin === 'author' ? '作者' : '未记录来源' }}{{ history.summaryLevel ? ` · ${summaryLevelLabel(history.summaryLevel)}` : '' }}</div>
                <p>{{ history.summary }}</p>
              </article>
            </div>
          </section>
          <div class="entry-detail-meta">
            <div v-if="selectedEntry.tags.length" class="entry-detail-tags">
              <span v-for="t in selectedEntry.tags" :key="t" class="tag-chip">{{ t }}</span>
            </div>
            <div class="entry-detail-timestamps">
              <span>创建：{{ formatDateTime(selectedEntry.createdAt) }}</span>
              <span v-if="selectedEntry.updatedAt !== selectedEntry.createdAt">更新：{{ formatDateTime(selectedEntry.updatedAt) }}</span>
            </div>
          </div>
        </section>
        <p v-else-if="filteredEntries.length" class="entry-detail-empty">点击上方的条目，在这里查看完整内容。</p>
      </div>
    </div>

    <!-- 创建知识库弹窗 -->
    <V3Modal v-model:show="showCreateModal" title="创建知识库" size="small" description="创建后可以导入资料或逐条添加，再挂载到作品。">
      <div class="kb-form">
        <V3Field label="名称"><V3Input v-model:value="createForm.name" placeholder="如：仙侠世界设定" @keydown.enter="createForm.name.trim() && doCreateKB()" /></V3Field>
        <V3Field label="描述"><V3Input v-model:value="createForm.description" placeholder="简要描述此知识库的用途" /></V3Field>
      </div>
      <template #footer>
        <button type="button" class="m-btn" @click="showCreateModal = false">取消</button>
        <button type="button" class="m-btn pri" :disabled="!createForm.name.trim()" @click="doCreateKB">创建</button>
      </template>
    </V3Modal>

    <!-- 添加/编辑条目弹窗 -->
    <V3Modal :show="showEntryModal" :title="editingEntryId ? '编辑条目' : '添加条目'" :closable="!entryFormBusy" @update:show="setEntryModalShow">
      <div class="kb-form">
        <div class="kb-form-row">
          <V3Field label="标题"><V3Input v-model:value="entryForm.title" placeholder="条目标题" :disabled="entryFormBusy" /></V3Field>
          <V3Field label="分类"><V3Select v-model:value="entryForm.category" :options="categoryOptions" :disabled="entryFormBusy" /></V3Field>
        </div>
        <V3Field label="内容"><V3Input v-model:value="entryForm.content" type="textarea" :rows="8" placeholder="条目内容（支持 Markdown）" :disabled="entryFormBusy" /></V3Field>
        <V3Field label="标签（逗号分隔）"><V3Input v-model:value="entryForm.tagsText" placeholder="如：剑法,武技" :disabled="entryFormBusy" /></V3Field>
        <div class="kb-form-row">
          <V3Field label="AI 使用权限"><V3Select v-model:value="entryForm.visibility" :options="visibilityOptions" :disabled="entryFormBusy" /></V3Field>
          <V3Field v-if="entryForm.visibility === 'from-chapter'" label="从第几章开始">
            <V3Number :value="entryForm.chapter" :min="1" :precision="0" :disabled="entryFormBusy" @update:value="value => { if (value !== null) entryForm.chapter = value }" />
          </V3Field>
        </div>
      </div>
      <template #footer>
        <button type="button" class="m-btn" :disabled="entryFormBusy" @click="setEntryModalShow(false)">取消</button>
        <button type="button" class="m-btn pri" :aria-busy="entryFormBusy" :disabled="entryFormBusy || !entryForm.title.trim()" @click="saveEntry">{{ entryFormBusy ? '正在保存…' : '保存' }}</button>
      </template>
    </V3Modal>

    <V3Modal :show="Boolean(mergeBaseId)" title="合并条目" :closable="!merging" @update:show="open => { if (!open && !merging) mergeBaseId = '' }">
      <div class="kb-form">
        <V3Field label="合并后的标题"><V3Input v-model:value="mergeTitle" :disabled="merging" /></V3Field>
        <div class="entry-list" role="group" aria-label="选择要合并的条目">
          <label v-for="entry in mergeOptions" :key="entry.id" class="merge-option">
            <input type="checkbox" :checked="mergeSelection.includes(entry.id)" :disabled="merging" @change="toggleMerge(entry.id)" />{{ entry.title }}
          </label>
        </div>
        <ol v-if="mergeSelection.length" class="merge-order" aria-label="正文合并顺序">
          <li v-for="(id, index) in mergeSelection" :key="id">
            {{ mergeOptions.find(entry => entry.id === id)?.title }}
            <button type="button" class="m-btn xs" :disabled="merging || index === 0" @click="moveMerge(index, -1)">上移</button>
            <button type="button" class="m-btn xs" :disabled="merging || index === mergeSelection.length - 1" @click="moveMerge(index, 1)">下移</button>
          </li>
        </ol>
        <p v-if="mergeSelection.length > 1">原条目将由合并后的条目替换。分类沿用首条，标签合并，AI 使用权限沿用最严格的一项。</p>
      </div>
      <template #footer>
        <button type="button" class="m-btn" :disabled="merging" @click="mergeBaseId = ''">取消</button>
        <button type="button" class="m-btn pri" :disabled="merging || mergeSelection.length < 2 || !mergeTitle.trim()" @click="saveMerge">{{ merging ? '正在合并…' : '确认合并' }}</button>
      </template>
    </V3Modal>

    <KnowledgeImportDialog v-model:show="showImportModal" :kb-id="selectedKBId" :initial-file="droppedFile" @imported="afterImport" />
    <KnowledgeCanonDraft v-if="showCanonDraft && selectedEntry" v-model:show="showCanonDraft" :kb-id="selectedKBId" :entry="selectedEntry" :preferred-novel-id="novelId" />
  </div>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import type { KnowledgeVisibility } from '@/types/knowledge'
import { canUseKnowledgeEntry } from '@/services/knowledgeVisibility'
import KnowledgeCanonDraft from './KnowledgeCanonDraft.vue'
import { ref, shallowRef, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDialog, useMessage } from '@/v3/feedback'
import V3Icon from '@/v3/components/V3Icon.vue'
import V3Modal from '@/v3/components/V3Modal.vue'
import V3Field from '@/v3/components/form/V3Field.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Number from '@/v3/components/form/V3Number.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import { useKnowledgeStore, kbCategories, knowledgeSummaryEditVersion, type KBEntry, type KnowledgeBase } from '@/stores/knowledge'
import { useNovelStore } from '@/stores/novel'
import { useConfigStore } from '@/stores/config'
import { createKnowledgeSummaryBudget, planKnowledgeSummary, generateKnowledgeSummary, estimateKnowledgeSummaryTokens, DEFAULT_SUMMARY_REQUESTS, DEFAULT_SUMMARY_TOKENS, type KnowledgeSummaryBudget, type KnowledgeSummaryProgress } from '@/services/knowledgeSummary'
import type { KnowledgeSummarySource } from '@/types/knowledge'
import KnowledgeImportDialog from '@/components/KnowledgeImportDialog.vue'
import { renderMd } from '@/utils/markdown'
import { knowledgeOutline } from '@/services/knowledgeText'
import { featureFlags } from '@/services/features'
import libraryArt from '@/assets/v3/empty/library.webp'
import {
  baseSourceVersion,
  entrySourceVersion,
  getBaseSummaryStatus,
  getEntrySummaryStatus,
  type KnowledgeSummaryStatus,
} from '@/services/knowledgeSources'

const route = useRoute()
const router = useRouter()
const kbStore = useKnowledgeStore()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const msg = useMessage()
const dialog = useDialog()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const hasNovelContext = computed(() => Boolean(route.params.novelId))

const knowledgeBases = computed(() => kbStore.knowledgeBases)
const selectedKBId = ref('')
const selectedKB = computed(() => kbStore.getKB(selectedKBId.value))
const searchQuery = ref('')
const categoryFilter = ref<string | null>(null)
const tagFilter = ref('')
const libraryQuery = ref('')
const librarySort = ref<'recent' | 'name'>('recent')
const librarySortOptions = [{ label: '最近编辑', value: 'recent' }, { label: '名称', value: 'name' }]
function kbActivityTime(kb: KnowledgeBase) {
  const time = (value: string | undefined) => {
    const parsed = value ? Date.parse(value) : NaN
    return Number.isFinite(parsed) ? parsed : 0
  }
  return kb.entries.reduce((latest, entry) => Math.max(latest, time(entry.updatedAt)), Math.max(time(kb.createdAt), time(kb.summaryUpdatedAt)))
}
const filteredKnowledgeBases = computed(() => {
  const query = libraryQuery.value.trim().toLowerCase()
  return knowledgeBases.value.filter(kb => !query || kb.name.toLowerCase().includes(query)
    || kb.description.toLowerCase().includes(query) || kb.entries.some(entry => entry.title.toLowerCase().includes(query)))
    .sort((a, b) => librarySort.value === 'name' ? a.name.localeCompare(b.name, 'zh-CN') : kbActivityTime(b) - kbActivityTime(a))
})
const selectedEntryId = ref('')
const selectedEntry = computed(() => {
  if (!selectedEntryId.value || !selectedKB.value) return null
  return selectedKB.value.entries.find(e => e.id === selectedEntryId.value) || null
})

const showCreateModal = ref(false)
const showEntryModal = ref(false)
const showImportModal = ref(false)
const showCanonDraft = ref(false)
const droppedFile = shallowRef<File | null>(null)
const pageDragging = ref(false)
const baseSummaryOpen = ref(false)
const detailPanel = ref<HTMLElement | null>(null)
const detailContent = ref<HTMLElement | null>(null)
const outlinePanel = ref<HTMLDetailsElement | null>(null)
const entryListPanel = ref<HTMLElement | null>(null)
const outlineList = ref<HTMLElement | null>(null)
function scrollToOutline() {
  if (outlinePanel.value) outlinePanel.value.open = true
  // 目录框内部也回到开头，再整体滚到标题栏下方
  if (outlineList.value) outlineList.value.scrollTop = 0
  outlinePanel.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

// 目录框、条目列表还在画面里时，不显示对应的跳转按钮；滚出画面后再出现。
const outlineInView = ref(true)
const entryListInView = ref(true)
let panelObserver: IntersectionObserver | null = null
function observePanels() {
  panelObserver?.disconnect()
  if (typeof IntersectionObserver === 'undefined') return
  const root = document.querySelector<HTMLElement>('.kb-page')
  panelObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target === outlinePanel.value) outlineInView.value = entry.isIntersecting
      if (entry.target === entryListPanel.value) entryListInView.value = entry.isIntersecting
    }
  }, { root, rootMargin: '-140px 0px 0px 0px' })
  if (outlinePanel.value) panelObserver.observe(outlinePanel.value)
  else outlineInView.value = false
  if (entryListPanel.value) panelObserver.observe(entryListPanel.value)
}
watch([outlinePanel, entryListPanel], () => { void nextTick(observePanels) })
onBeforeUnmount(() => panelObserver?.disconnect())
function scrollToEntryList() {
  entryListPanel.value?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
// 目录里不重复列出和条目名称相同的一级标题
const entryOutline = computed(() => selectedEntry.value
  ? knowledgeOutline(selectedEntry.value.content).filter(item => !(item.level === 1 && item.title === selectedEntry.value!.title.trim()))
  : [])
// 只列出当前知识库里实际用到的分类
const usedCategories = computed(() => [...new Set(selectedKB.value?.entries.map(entry => entry.category) || [])])
const usedTags = computed(() => [...new Set(selectedKB.value?.entries.flatMap(entry => entry.tags) || [])].sort((a, b) => a.localeCompare(b, 'zh-CN')))
const tagOptions = computed(() => [{ value: '', label: '全部标签' }, ...usedTags.value.map(tag => ({ value: tag, label: tag }))])
watch(usedTags, tags => { if (!tags.includes(tagFilter.value)) tagFilter.value = '' })

watch(showImportModal, open => { if (!open) droppedFile.value = null })
function openImport(file: File | null = null) {
  droppedFile.value = file
  showImportModal.value = true
}
function onPageDrop(event: DragEvent) {
  pageDragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) openImport(file)
}
/** 列表里的一行说明：有摘要用摘要，否则取正文开头（去掉与标题重复的部分和 Markdown 符号）。 */
function entryPreview(entry: KBEntry) {
  let text = (entry.summary?.trim() || entry.content)
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*\|?[\s|:-]*-{3,}[\s|:-]*$/gm, '')
    .replace(/^\s*(?:[-*]|>)\s+/gm, '')
    .replace(/\|/g, ' ').replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim()
  const title = entry.title.trim()
  if (title && text.startsWith(title)) text = text.slice(title.length).trim()
  return text.length > 80 ? text.slice(0, 80) + '…' : text
}
function jumpToHeading(index: number) {
  const heading = detailContent.value?.querySelectorAll('h2, h3, h4, h5')[index] as HTMLElement | undefined
  heading?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
const editingEntryId = ref('')

// 标签里可能带 emoji 前缀，界面只显示文字
const categoryOptions = kbCategories.map(c => ({ label: categoryText(c.label), value: c.value }))

function categoryText(label: string) {
  return label.replace(/^[^\p{L}\p{N}]+/u, '').trim() || label
}

// 条目分类显示中文名
function categoryLabel(cat: string) {
  const match = kbCategories.find(c => c.value === cat || categoryText(c.label) === cat)
  return match ? categoryText(match.label) : cat
}

const createForm = ref({ name: '', description: '' })
const visibilityOptions = [
  { value: 'always', label: '可供 AI 使用' },
  { value: 'never', label: '仅供作者查看' },
  { value: 'from-chapter', label: '指定章节起可供 AI 使用' },
]
const emptyEntryForm = () => ({ title: '', category: '其他', content: '', tagsText: '', visibility: 'always', chapter: 1 })
const entryForm = ref(emptyEntryForm())
const mergeBaseId = ref('')
const mergeOptions = ref<Array<{ id: string; title: string; revision: string }>>([])
const mergeSelection = ref<string[]>([])
const mergeTitle = ref('')
const merging = ref(false)
const summarizingEntryIds = ref(new Set<string>())
const summarizingKB = ref(false)
const entrySummarySavingIds = ref(new Set<string>())
const baseSummarySaving = ref(false)
const entryFormBusy = ref(false)
const baseSummaryDraft = ref('')
const entrySummaryDraft = ref('')
const entrySummaryErrors = ref<Record<string, string>>({})
const entrySummaryErrorKinds = ref<Record<string, 'save' | 'ai'>>({})
const baseSummaryError = ref('')
const baseSummaryErrorKind = ref<'save' | 'ai' | ''>('')
type SummaryEditBaseline = { targetId: string; sourceVersion: string; summaryVersion: string }
const entrySummaryBaseline = ref<SummaryEditBaseline | null>(null)
const baseSummaryBaseline = ref<SummaryEditBaseline | null>(null)
const entrySummaryDraftDirty = ref(false)
const baseSummaryDraftDirty = ref(false)
const entryEditorSession = ref(0)
const baseEditorSession = ref(0)
const summaryLevel = ref<NonNullable<KnowledgeBase['summaryLevel']>>('standard')
const summaryLevelOptions = [
  { label: '简略', value: 'brief' },
  { label: '标准', value: 'standard' },
  { label: '详细', value: 'detailed' },
]
const baseSummaryBusy = computed(() => summarizingKB.value || baseSummarySaving.value)
const summaryBudget = ref({ requests: DEFAULT_SUMMARY_REQUESTS, tokens: DEFAULT_SUMMARY_TOKENS })
const summaryProgress = ref<Record<string, KnowledgeSummaryProgress>>({})
const summaryControllers = new Map<string, AbortController>()
const importSummaryRunning = ref(false)
const anySummaryRunning = computed(() => summarizingKB.value || summarizingEntryIds.value.size > 0 || importSummaryRunning.value)
const entryJobKey = computed(() => 'entry:' + entrySummaryErrorKey(selectedKBId.value, selectedEntryId.value))
const baseJobKey = computed(() => 'base:' + selectedKBId.value)
function cancelSummary(key: string) { summaryControllers.get(key)?.abort(new Error('已取消摘要整理')) }
onBeforeUnmount(() => { for (const controller of summaryControllers.values()) controller.abort(new Error('已离开资料页，摘要整理停止')) })

function planHint(entryId?: string) {
  const kb = selectedKB.value
  if (!kb) return ''
  try {
    const plan = planKnowledgeSummary(kb, entryId, entryId ? 'standard' : summaryLevel.value)
    const chars = plan.chunks.reduce((sum, chunk) => sum + chunk.end - chunk.start, 0)
    const model = configStore.getModelForTask('review')
    const tokens = model ? estimateKnowledgeSummaryTokens(plan, model, configStore.getSkillPrompt('analysis')) : undefined
    return '全文分批读取：' + chars + ' 字，' + plan.chunks.length + ' 段，预计 ' + plan.plannedRequests + ' 次请求'
      + (tokens === undefined ? '；配置模型后可估算 Token 额度。' : '，保守额度 ' + tokens.toLocaleString() + ' Token。')
      + ' 摘要可能遗漏细节，检索时仍会查找原文。'
  } catch (error) { return errorText(error, '资料暂不能整理') }
}
const basePlanHint = computed(() => planHint())
const entryPlanHint = computed(() => selectedEntry.value ? planHint(selectedEntry.value.id) : '')
function progressText(progress: KnowledgeSummaryProgress) {
  const phase = { extract: '分段提取', merge: '逐层合并', complete: '处理完成', failed: '已停止', cancelled: '已取消' }[progress.phase]
  return phase + ' · 已读 ' + progress.completedChunks + '/' + progress.totalChunks + ' 段 · 请求 ' + progress.completedRequests + '/' + progress.plannedRequests
    + ' · ' + (progress.usageEstimated ? '保守计入 ' : '接口报告 ') + (progress.inputTokens + progress.outputTokens).toLocaleString() + ' token'
}
function coverageText(source?: KnowledgeSummarySource) {
  const coverage = source?.coverage
  return coverage ? '上次生成完整读取 ' + coverage.sources.length + ' 个条目、' + coverage.leafCount + ' 段原文，使用 ' + coverage.requestCount + ' 次请求；'
    + (coverage.usageEstimated ? '保守计入 ' : '接口报告 ') + (coverage.inputTokens + coverage.outputTokens).toLocaleString() + ' Token。' : ''
}

function summaryStatusLabel(status: KnowledgeSummaryStatus) {
  return ({ empty: '未填写', current: '当前', unverified: '待核对', stale: '来源已失效' } satisfies Record<KnowledgeSummaryStatus, string>)[status]
}

function entrySummaryErrorKey(kbId: string, entryId: string) {
  return `${kbId}:${entryId}`
}

function summaryStatusHint(status: KnowledgeSummaryStatus) {
  return ({
    empty: '还没有摘要，可以手工填写或整理。',
    current: '摘要对应当前资料，可继续沿用。',
    unverified: '摘要还没有来源记录，核对后才会用于写作。',
    stale: '资料已修改，旧摘要需要核对或重新整理后才会继续用于写作。',
  } satisfies Record<KnowledgeSummaryStatus, string>)[status]
}

function summaryLevelLabel(level: NonNullable<KnowledgeBase['summaryLevel']>) {
  return summaryLevelOptions.find(option => option.value === level)?.label || level
}

const filteredEntries = computed(() => {
  if (!selectedKB.value) return []
  let list = selectedKB.value.entries
  if (categoryFilter.value) {
    list = list.filter(e => e.category === categoryFilter.value)
  }
  if (tagFilter.value) list = list.filter(entry => entry.tags.includes(tagFilter.value))
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some(tag => tag.toLowerCase().includes(q))
    )
  }
  return list
})

function selectEntry(id: string) {
  selectedEntryId.value = id
  // 内容显示在条目列表下方，选中后滚动过去
  void nextTick(() => detailPanel.value?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
}

watch(() => [selectedKBId.value, selectedEntry.value?.id], () => {
  entryEditorSession.value++
  const entry = selectedEntry.value
  entrySummaryDraft.value = entry?.summary || ''
  entrySummaryDraftDirty.value = false
  entrySummaryBaseline.value = entry ? {
    targetId: entry.id,
    sourceVersion: entrySourceVersion(selectedKBId.value, entry),
    summaryVersion: knowledgeSummaryEditVersion(entry),
  } : null
}, { immediate: true })

watch(() => selectedKBId.value, () => {
  baseEditorSession.value++
  const kb = selectedKB.value
  baseSummaryDraft.value = kb?.summary || ''
  baseSummaryDraftDirty.value = false
  baseSummaryBaseline.value = kb ? {
    targetId: kb.id,
    sourceVersion: baseSourceVersion(kb),
    summaryVersion: knowledgeSummaryEditVersion(kb),
  } : null
}, { immediate: true })

// Auto-select first visible entry when filters or KB change
watch([filteredEntries, selectedKBId], ([entries, kbId]) => {
  if (!kbId) {
    selectedEntryId.value = ''
    return
  }
  // If current selection is no longer visible, select first visible entry
  const currentVisible = entries.some(e => e.id === selectedEntryId.value)
  if (!currentVisible && entries.length > 0) {
    selectedEntryId.value = entries[0].id
  } else if (entries.length === 0) {
    selectedEntryId.value = ''
  }
}, { immediate: true })

function selectKB(id: string) {
  tagFilter.value = ''
  selectedKBId.value = id
  const kb = kbStore.getKB(id)
  summaryLevel.value = kb?.summaryLevel || 'standard'
  baseSummaryDraft.value = kb?.summary || ''
  baseSummaryError.value = ''
  baseSummaryErrorKind.value = ''
}

watch(() => {
  const kbId = route.query?.base
  const entryId = route.query?.entry
  const base = typeof kbId === 'string' ? kbStore.getKB(kbId) : undefined
  return base && typeof entryId === 'string' && base.entries.some(entry => entry.id === entryId)
    ? [base.id, entryId] : null
}, target => {
  if (!target) return
  searchQuery.value = ''
  categoryFilter.value = null
  selectKB(target[0])
  selectEntry(target[1])
}, { immediate: true })

function beginEntrySummaryEdit(entryId: string) {
  const entry = kbStore.getKB(selectedKBId.value)?.entries.find(item => item.id === entryId)
  if (!entry) return
  const draftShowsCurrentSummary = !entrySummaryDraftDirty.value
    && entrySummaryDraft.value.trim() === (entry.summary || '').trim()
  if (draftShowsCurrentSummary || !entrySummaryBaseline.value || entrySummaryBaseline.value.targetId !== entry.id) {
    entrySummaryBaseline.value = {
      targetId: entry.id,
      sourceVersion: entrySourceVersion(selectedKBId.value, entry),
      summaryVersion: knowledgeSummaryEditVersion(entry),
    }
  }
}

function markEntrySummaryDirty() {
  entrySummaryDraftDirty.value = true
}

function beginBaseSummaryEdit() {
  const kb = selectedKB.value
  if (!kb) return
  const draftShowsCurrentSummary = !baseSummaryDraftDirty.value
    && baseSummaryDraft.value.trim() === (kb.summary || '').trim()
  if (draftShowsCurrentSummary || !baseSummaryBaseline.value || baseSummaryBaseline.value.targetId !== kb.id) {
    baseSummaryBaseline.value = {
      targetId: kb.id,
      sourceVersion: baseSourceVersion(kb),
      summaryVersion: knowledgeSummaryEditVersion(kb),
    }
  }
}

function markBaseSummaryDirty() {
  baseSummaryDraftDirty.value = true
}

// 分类栏计数，仅用于展示
function countByCategory(cat: string) {
  return selectedKB.value?.entries.filter(e => e.category === cat).length ?? 0
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('zh-CN')
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

function doCreateKB() {
  const name = createForm.value.name.trim()
  if (!name) return
  const kb = kbStore.createKB(name, createForm.value.description.trim())
  searchQuery.value = ''
  categoryFilter.value = null
  selectKB(kb.id)
  createForm.value = { name: '', description: '' }
  showCreateModal.value = false
  msg.success('知识库已创建')
}

async function deleteKB(id: string) {
  try {
    for (const book of novelStore.novels) {
      if (book.knowledgeBaseIds.includes(id)) novelStore.unbindKnowledgeBase(book.id, id)
    }
    await novelStore.flushPendingSaves()
    await kbStore.deleteKB(id)
    msg.success('已删除')
  } catch (error) { msg.error(errorText(error, '删除失败，请重试')) }
}

function confirmDeleteKB(kb: KnowledgeBase) {
  const bound = novelStore.novels.filter(book => book.knowledgeBaseIds.includes(kb.id)).length
  dialog.warning({
    title: '删除知识库',
    content: `删除「${kb.name}」及其 ${kb.entries.length} 条资料？${bound ? `已挂载它的 ${bound} 部作品会同时取消挂载。` : ''}此操作无法撤销。`,
    positiveText: '删除', negativeText: '取消',
    onPositiveClick: () => { void deleteKB(kb.id) },
  })
}

function confirmRemoveEntry(entry: KBEntry) {
  dialog.warning({
    title: '删除条目',
    content: `删除条目「${entry.title}」？此操作无法撤销。`,
    positiveText: '删除', negativeText: '取消',
    onPositiveClick: () => removeEntry(entry.id),
  })
}

function openAddEntry() {
  editingEntryId.value = ''
  entryForm.value = emptyEntryForm()
  showEntryModal.value = true
}

function editEntry(entry: KBEntry) {
  editingEntryId.value = entry.id
  entryForm.value = {
    title: entry.title,
    category: entry.category,
    content: entry.content,
    tagsText: entry.tags.join('、'),
    visibility: entry.visibility?.mode || 'always',
    chapter: entry.visibility?.mode === 'from-chapter' ? entry.visibility.chapter : 1,
  }
  showEntryModal.value = true
}

async function saveEntry() {
  if (entryFormBusy.value) return
  const kbId = selectedKBId.value
  const { visibility: mode, chapter } = entryForm.value
  if (mode === 'from-chapter' && (!Number.isSafeInteger(chapter) || chapter < 1)) {
    msg.error('请输入大于 0 的整数章节号')
    return
  }
  const visibility: KnowledgeVisibility | undefined = mode === 'never' ? { mode } : mode === 'from-chapter' ? { mode, chapter } : undefined
  const data = {
    title: entryForm.value.title.trim(),
    category: entryForm.value.category,
    content: entryForm.value.content,
    tags: [...new Set(entryForm.value.tagsText.split(/[,，、]/).map(s => s.trim()).filter(Boolean))],
    visibility,
  }
  entryFormBusy.value = true
  let saved = false
  try {
    let entryId = editingEntryId.value
    if (entryId) {
      kbStore.updateEntry(kbId, entryId, data)
    } else {
      const newEntry = kbStore.addEntry(kbId, { ...data, summary: '' })
      entryId = newEntry?.id || ''
      editingEntryId.value = entryId
    }
    if (!entryId) throw new Error('资料已不存在')
    await kbStore.flushPendingSaves()
    msg.success('资料已保存；可以核对摘要，或点击重新整理')
    saved = Boolean(entryId)
  } catch (error) {
    msg.error((errorText(error, '资料保存失败')) + '，表单已保留')
  } finally {
    entryFormBusy.value = false
  }
  if (saved) {
    setEntryModalShow(false)
  }
}

function openMerge() {
  const kb = selectedKB.value
  if (!kb) return
  mergeOptions.value = kb.entries.map(entry => ({ id: entry.id, title: entry.title, revision: JSON.stringify(entry) }))
  mergeSelection.value = []
  mergeTitle.value = ''
  mergeBaseId.value = kb.id
}

function toggleMerge(id: string) {
  if (mergeSelection.value.includes(id)) mergeSelection.value = mergeSelection.value.filter(item => item !== id)
  else {
    mergeSelection.value.push(id)
    if (!mergeTitle.value.trim()) mergeTitle.value = mergeOptions.value.find(entry => entry.id === id)?.title || ''
  }
}

function moveMerge(index: number, step: number) {
  const order = [...mergeSelection.value]
  const [id] = order.splice(index, 1)
  order.splice(index + step, 0, id)
  mergeSelection.value = order
}

async function saveMerge() {
  const kbId = mergeBaseId.value
  const entries = mergeSelection.value.flatMap(id => mergeOptions.value.filter(entry => entry.id === id))
  merging.value = true
  try {
    const id = await kbStore.mergeEntries(kbId, entries, mergeTitle.value)
    mergeBaseId.value = ''
    if (selectedKBId.value === kbId) {
      categoryFilter.value = null
      searchQuery.value = ''
      tagFilter.value = ''
      selectEntry(id)
    }
    msg.success('合并后的条目已保存')
  } catch (error) {
    msg.error(errorText(error, '合并条目失败'))
  } finally {
    merging.value = false
  }
}

function removeEntry(id: string) {
  kbStore.deleteEntry(selectedKBId.value, id)
  msg.success('已删除')
  // After deletion, auto-select first visible entry
  if (selectedEntryId.value === id) {
    const remaining = filteredEntries.value
    selectedEntryId.value = remaining.length > 0 ? remaining[0].id : ''
  }
}

async function afterImport(result: { kbId: string; entryIds: string[]; summarize: boolean }) {
  msg.success('已导入 ' + result.entryIds.length + ' 个条目')
  if (!result.summarize) return
  if (importSummaryRunning.value) { msg.warning('已有导入摘要任务，请稍后手动整理新资料'); return }
  const controller = new AbortController()
  summaryControllers.set('import', controller)
  importSummaryRunning.value = true
  let completed = 0
  try {
    const budget = createKnowledgeSummaryBudget(summaryBudget.value.requests, summaryBudget.value.tokens)
    for (const id of result.entryIds) {
      controller.signal.throwIfAborted()
      const entry = kbStore.getKB(result.kbId)?.entries.find(item => item.id === id)
      if (!entry || !entry.content.trim()) continue
      if (!await autoSummarizeEntry(result.kbId, id, true, { budget, controller })) {
        msg.warning('本批摘要未全部完成，已保存 ' + completed + ' 个条目；剩余资料可稍后继续整理')
        return
      }
      completed++
    }
    msg.success('本批摘要已保存 ' + completed + ' 个条目')
  } catch (error) {
    msg.warning((errorText(error, '批次已停止')) + '；已保存 ' + completed + ' 个条目')
  } finally {
    importSummaryRunning.value = false
    summaryControllers.delete('import')
  }
}

// AI 自动总结知识库条目
async function autoSummarizeEntry(kbId: string, entryId: string, notifyUnavailable = false, batch?: { budget: KnowledgeSummaryBudget; controller: AbortController }): Promise<boolean> {
  const model = configStore.getModelForTask('review')
  const sourceKB = kbStore.getKB(kbId)
  const sourceEntry = sourceKB?.entries.find(entry => entry.id === entryId)
  if (!sourceEntry || !model || !sourceEntry.content.trim()) {
    if (notifyUnavailable && !model) {
      const message = '未配置可用模型，可以手工填写并核对摘要。'
      const errorKey = entrySummaryErrorKey(kbId, entryId)
      entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: message }
      entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'ai' }
      msg.warning(message)
    }
    return false
  }
  if (summarizingEntryIds.value.has(entryId)) return false
  // Capture every request input before the first await. Later edits must make
  // the versioned save reject this result instead of being overwritten.
  const sourceSnapshot = JSON.parse(JSON.stringify(sourceEntry)) as KBEntry
  const jobKey = 'entry:' + entrySummaryErrorKey(kbId, entryId)
  const controller = batch?.controller || new AbortController()
  summaryControllers.set(jobKey, controller)
  const expectedSourceVersion = entrySourceVersion(kbId, sourceSnapshot)
  const expectedSummaryVersion = knowledgeSummaryEditVersion(sourceSnapshot)
  const editorSession = selectedKBId.value === kbId && selectedEntryId.value === entryId ? entryEditorSession.value : -1
  summarizingEntryIds.value = new Set(summarizingEntryIds.value).add(entryId)
  const errorKey = entrySummaryErrorKey(kbId, entryId)
  entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: '' }
  try {
    const plan = planKnowledgeSummary(sourceKB!, entryId)
    const result = await generateKnowledgeSummary(plan, {
      model, budget: batch?.budget || createKnowledgeSummaryBudget(summaryBudget.value.requests, summaryBudget.value.tokens),
      instructions: configStore.getSkillPrompt('analysis'), signal: controller.signal,
      isCurrent: () => {
        const current = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
        return Boolean(current && entrySourceVersion(kbId, current) === expectedSourceVersion && knowledgeSummaryEditVersion(current) === expectedSummaryVersion)
      },
      onProgress: progress => { summaryProgress.value = { ...summaryProgress.value, [jobKey]: progress } },
    })
    controller.signal.throwIfAborted()
    await kbStore.saveEntrySummary(kbId, entryId, expectedSourceVersion, expectedSummaryVersion, result.summary, 'ai', result.coverage)
    const committed = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
    if (editorSession >= 0 && selectedKBId.value === kbId && selectedEntryId.value === entryId
      && entryEditorSession.value === editorSession && !entrySummaryDraftDirty.value && committed) {
      entrySummaryDraft.value = committed.summary
      entrySummaryBaseline.value = {
        targetId: committed.id,
        sourceVersion: entrySourceVersion(kbId, committed),
        summaryVersion: knowledgeSummaryEditVersion(committed),
      }
    }
    msg.success('条目摘要已更新')
    return true
  } catch (error) {
    const message = errorText(error, '摘要整理失败')
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '资料或摘要已在整理期间变化，迟到的 AI 结果已拒绝，请重新核对。'
      : `${message}，可点击“重新整理摘要”重试。`
    entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: visibleMessage }
    entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'ai' }
    if (summaryProgress.value[jobKey]) summaryProgress.value[jobKey].phase = controller.signal.aborted ? 'cancelled' : 'failed'
    msg.error(visibleMessage)
    return false
  } finally {
    summaryControllers.delete(jobKey)
    const next = new Set(summarizingEntryIds.value)
    next.delete(entryId)
    summarizingEntryIds.value = next
  }
}

async function summarizeSelectedKB() {
  const kb = selectedKB.value
  const model = configStore.getModelForTask('review')
  if (!kb || summarizingKB.value) return
  if (!model) {
    baseSummaryError.value = '未配置可用模型，可以手工填写并核对摘要。'
    baseSummaryErrorKind.value = 'ai'
    msg.warning(baseSummaryError.value)
    return
  }
  if (!kb.entries.length) {
    msg.warning('请先添加或导入资料')
    return
  }
  summarizingKB.value = true
  baseSummaryError.value = ''
  // Keep an independent request snapshot. The selected KB, level, source
  // text, and version guards must not be reconstructed after AI awaits.
  const sourceSnapshot = JSON.parse(JSON.stringify(kb)) as KnowledgeBase
  const requestKbId = sourceSnapshot.id
  const requestLevel = summaryLevel.value
  const expectedSourceVersion = baseSourceVersion(sourceSnapshot)
  const expectedSummaryVersion = knowledgeSummaryEditVersion(sourceSnapshot)
  const editorSession = baseEditorSession.value
  const jobKey = 'base:' + requestKbId
  const controller = new AbortController()
  summaryControllers.set(jobKey, controller)
  try {
    const plan = planKnowledgeSummary(sourceSnapshot, undefined, requestLevel)
    const result = await generateKnowledgeSummary(plan, {
      model, budget: createKnowledgeSummaryBudget(summaryBudget.value.requests, summaryBudget.value.tokens),
      instructions: configStore.getSkillPrompt('analysis'), signal: controller.signal,
      isCurrent: () => {
        const current = kbStore.getKB(requestKbId)
        return Boolean(current && baseSourceVersion(current) === expectedSourceVersion && knowledgeSummaryEditVersion(current) === expectedSummaryVersion)
      },
      onProgress: progress => { summaryProgress.value = { ...summaryProgress.value, [jobKey]: progress } },
    })
    controller.signal.throwIfAborted()
    await kbStore.saveBaseSummary(requestKbId, expectedSourceVersion, expectedSummaryVersion, result.summary, requestLevel, 'ai', result.coverage)
    const committed = kbStore.getKB(requestKbId)
    if (selectedKBId.value === requestKbId && baseEditorSession.value === editorSession
      && !baseSummaryDraftDirty.value && committed) {
      baseSummaryDraft.value = committed.summary || result.summary
      baseSummaryBaseline.value = {
        targetId: committed.id,
        sourceVersion: baseSourceVersion(committed),
        summaryVersion: knowledgeSummaryEditVersion(committed),
      }
    }
    msg.success('知识库摘要已更新')
  } catch (error) {
    const message = errorText(error, '摘要整理失败')
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '知识库资料或摘要已在整理期间变化，迟到的 AI 结果已拒绝，请重新核对。'
      : `${message}，可点击“重新整理”重试。`
    if (summaryProgress.value[jobKey]) summaryProgress.value[jobKey].phase = controller.signal.aborted ? 'cancelled' : 'failed'
    if (selectedKBId.value === requestKbId && baseEditorSession.value === editorSession) {
      baseSummaryError.value = visibleMessage
      baseSummaryErrorKind.value = 'ai'
    }
    msg.error(visibleMessage)
  } finally {
    summaryControllers.delete(jobKey)
    summarizingKB.value = false
  }
}

function entrySummaryBusy(entryId: string) {
  return summarizingEntryIds.value.has(entryId) || entrySummarySavingIds.value.has(entryId)
}

async function saveEntrySummaryDraft(entryId: string) {
  const kbId = selectedKBId.value
  const session = entryEditorSession.value
  const entry = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
  if (!entry) return
  const summary = entrySummaryDraft.value.trim()
  if (!summary) {
    msg.warning('摘要不能为空')
    return
  }
  const draftShowsCurrentSummary = !entrySummaryDraftDirty.value
    && entrySummaryDraft.value.trim() === (entry.summary || '').trim()
  const baseline = draftShowsCurrentSummary || entrySummaryBaseline.value?.targetId !== entry.id
    ? {
        targetId: entry.id,
        sourceVersion: entrySourceVersion(kbId, entry),
        summaryVersion: knowledgeSummaryEditVersion(entry),
      }
    : entrySummaryBaseline.value
  entrySummaryBaseline.value = baseline
  entrySummarySavingIds.value = new Set(entrySummarySavingIds.value).add(entryId)
  const errorKey = entrySummaryErrorKey(kbId, entryId)
  try {
    await kbStore.saveEntrySummary(kbId, entryId, baseline.sourceVersion, baseline.summaryVersion, summary, 'author')
    const committed = kbStore.getKB(kbId)?.entries.find(item => item.id === entryId)
    if (selectedKBId.value === kbId && selectedEntryId.value === entryId && entryEditorSession.value === session) {
      entrySummaryDraft.value = committed?.summary || summary
      entrySummaryDraftDirty.value = false
      if (committed) {
        entrySummaryBaseline.value = {
          targetId: committed.id,
          sourceVersion: entrySourceVersion(kbId, committed),
          summaryVersion: knowledgeSummaryEditVersion(committed),
        }
      }
    }
    entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: '' }
    entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'save' }
    msg.success('条目摘要已保存并核对')
  } catch (error) {
    const message = errorText(error, '摘要保存失败')
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '资料或摘要已发生变化，摘要未保存，请重新核对。'
      : `${message}，表单内容已保留。`
    entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: visibleMessage }
    entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'save' }
    msg.error(visibleMessage)
  } finally {
    const next = new Set(entrySummarySavingIds.value)
    next.delete(entryId)
    entrySummarySavingIds.value = next
  }
}

async function saveBaseSummaryDraft() {
  const kb = selectedKB.value
  const kbId = kb?.id || ''
  const session = baseEditorSession.value
  const summary = baseSummaryDraft.value.trim()
  if (!kb || !summary) {
    msg.warning('摘要不能为空')
    return
  }
  const draftShowsCurrentSummary = !baseSummaryDraftDirty.value
    && baseSummaryDraft.value.trim() === (kb.summary || '').trim()
  const baseline = draftShowsCurrentSummary || baseSummaryBaseline.value?.targetId !== kb.id
    ? {
        targetId: kb.id,
        sourceVersion: baseSourceVersion(kb),
        summaryVersion: knowledgeSummaryEditVersion(kb),
      }
    : baseSummaryBaseline.value
  baseSummaryBaseline.value = baseline
  const level = summaryLevel.value
  baseSummarySaving.value = true
  try {
    await kbStore.saveBaseSummary(kbId, baseline.sourceVersion, baseline.summaryVersion, summary, level, 'author')
    const committed = kbStore.getKB(kbId)
    if (selectedKBId.value === kbId && baseEditorSession.value === session) {
      baseSummaryDraft.value = committed?.summary || summary
      baseSummaryDraftDirty.value = false
      if (committed) {
        baseSummaryBaseline.value = {
          targetId: committed.id,
          sourceVersion: baseSourceVersion(committed),
          summaryVersion: knowledgeSummaryEditVersion(committed),
        }
      }
    }
    if (selectedKBId.value === kbId && baseEditorSession.value === session) {
      baseSummaryError.value = ''
      baseSummaryErrorKind.value = 'save'
    }
    msg.success('知识库摘要已保存并核对')
  } catch (error) {
    const message = errorText(error, '摘要保存失败')
    const visibleMessage = /发生变化|重新核对|过期/.test(message)
      ? '知识库资料或摘要已发生变化，摘要未保存，请重新核对。'
      : `${message}，表单内容已保留。`
    if (selectedKBId.value === kbId && baseEditorSession.value === session) {
      baseSummaryError.value = visibleMessage
      baseSummaryErrorKind.value = 'save'
    }
    msg.error(visibleMessage)
  } finally {
    baseSummarySaving.value = false
  }
}

function reloadEntrySummaryDraft(entryId: string) {
  const entry = kbStore.getKB(selectedKBId.value)?.entries.find(item => item.id === entryId)
  if (!entry) return
  entrySummaryDraft.value = entry.summary || ''
  entrySummaryDraftDirty.value = false
  entrySummaryBaseline.value = {
    targetId: entry.id,
    sourceVersion: entrySourceVersion(selectedKBId.value, entry),
    summaryVersion: knowledgeSummaryEditVersion(entry),
  }
  const errorKey = entrySummaryErrorKey(selectedKBId.value, entryId)
  entrySummaryErrors.value = { ...entrySummaryErrors.value, [errorKey]: '' }
  entrySummaryErrorKinds.value = { ...entrySummaryErrorKinds.value, [errorKey]: 'save' }
}

function reloadBaseSummaryDraft() {
  const kb = selectedKB.value
  if (!kb) return
  baseSummaryDraft.value = kb.summary || ''
  baseSummaryDraftDirty.value = false
  baseSummaryBaseline.value = {
    targetId: kb.id,
    sourceVersion: baseSourceVersion(kb),
    summaryVersion: knowledgeSummaryEditVersion(kb),
  }
  baseSummaryError.value = ''
  baseSummaryErrorKind.value = ''
}

function retryEntrySummary(entryId: string) {
  void autoSummarizeEntry(selectedKBId.value, entryId, true)
}

function setEntryModalShow(show: boolean) {
  if (!show && entryFormBusy.value) return
  showEntryModal.value = show
}

// 知识库绑定
function isBound(kbId: string) {
  return novel.value?.knowledgeBaseIds?.includes(kbId) || false
}

function toggleBind(kbId: string) {
  if (!hasNovelContext.value) return
  if (isBound(kbId)) {
    novelStore.unbindKnowledgeBase(novelId.value, kbId)
    msg.success('已解绑知识库')
  } else {
    novelStore.bindKnowledgeBase(novelId.value, kbId)
    msg.success('已绑定知识库，AI 写作时将自动注入相关知识')
  }
}
</script>

<style scoped>
/* 页面铺满内容区并自己滚动：外层 .main 不滚动且隐藏溢出，不限高度的话整页无法滚动，跳转后也滚不回来。 */
.kb-page { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; }
.summary-budget { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 20px; }
.summary-budget label { display: grid; gap: 6px; width: 180px; font-size: 12px; }
.summary-budget > span { flex-basis: 100%; color: var(--ink-3); font-size: 12px; }
.summary-run-status, .summary-coverage { margin: 10px 0; font-size: 12px; line-height: 1.8; color: var(--ink-2); }
.summary-run-status { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.kb-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: var(--space-lg);
}
.kb-header .page-title { font-family: var(--f-serif); font-weight: 700; letter-spacing: 0.04em; margin: 0; }
.page-subtitle { margin: 6px 0 0; color: var(--ink-3); font-size: 13px; }
.header-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; min-height: 40vh; gap: 12px; text-align: center;
}
.empty-state h3 { font-family: var(--f-serif); font-size: 18px; color: var(--ink); }
.empty-state p { font-size: 14px; color: var(--ink-3); max-width: 360px; }

/* 知识库卡片 */
.kb-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-md);
}
.kb-list > .empty-state { grid-column: 1 / -1; }
.kb-list-toolbar { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; }
.kb-library-count { margin-right: auto; color: var(--ink-2); }
.kb-list-toolbar .kb-library-search { width: min(100%, 300px); }
.kb-list-toolbar .kb-library-sort { width: 130px; }
.back-icon { transform: rotate(180deg); }
.summary-level { width: 120px; flex-shrink: 0; }
.entry-search { width: min(100%, 260px); }
.kb-no-results { grid-column: 1 / -1; padding: 40px; text-align: center; color: var(--ink-2); }
@media (max-width: 1100px) { .kb-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 650px) { .kb-list { grid-template-columns: 1fr; } }

.kb-card {
  display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: start; gap: 16px;
  padding: 24px; cursor: pointer;
  border: 1px solid var(--line-2);
  border-radius: var(--r-l);
  box-shadow: var(--shadow-1);
  transition: border-color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast);
}
.kb-card:hover { transform: translateY(-1px); border-color: var(--ink-3); box-shadow: var(--shadow-2); }
.kb-card:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
.kb-card-info { min-width: 0; overflow-wrap: anywhere; }
.kb-card-actions { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }

.kb-card-icon {
  flex-shrink: 0;
  width: 64px; height: 72px;
  display: grid; place-items: center;
  font-family: var(--f-serif); font-size: 18px;
  color: var(--zhu); background: var(--hover);
  border-radius: var(--r-s);
}
.kb-card-icon svg { width: 32px; height: 32px; }
.kb-card:nth-of-type(3n) .kb-card-icon { color: var(--dai); }
.kb-card:nth-of-type(3n + 1) .kb-card-icon { color: var(--qing); }
.kb-card-info { flex: 1; min-width: 0; }
.kb-card-info h3 {
  font-family: var(--f-serif); font-size: 18px; font-weight: 700;
  color: var(--ink); margin: 0 0 6px; letter-spacing: 0.02em;
}
.kb-card-info p { font-size: 13px; color: var(--ink-3); margin: 0; line-height: 1.6; }
.kb-summary-preview {
  color: var(--ink-2) !important; line-height: 1.6;
  margin-top: 6px !important;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.kb-summary-status { margin-top: 6px; }
.kb-card-meta {
  display: inline-block; margin-top: 8px;
  font-size: 12px; color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

/* 知识库详情 */
.kb-detail-header {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-bottom: var(--space-md);
}
.kb-detail-header h3 {
  flex: 1; margin: 0;
  font-family: var(--f-serif); font-size: 24px; font-weight: 700;
  color: var(--ink); letter-spacing: 0.03em;
}
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-left: auto; }

/* 左侧分类 + 中间列表 + 右侧详情 */
.kb-browser {
  display: flex; flex-direction: column; gap: var(--space-lg);
  border-radius: var(--r-l); outline: 2px dashed transparent; outline-offset: 4px;
  transition: outline-color var(--motion-fast);
}
.kb-browser.drop-active { outline-color: var(--zhu); }
.kb-entries { scroll-margin-top: 12px; padding: 16px 18px; border: 1px solid var(--line-2); border-radius: var(--r-l); box-shadow: var(--shadow-1); }
.kb-category-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: -4px 0 12px; }
.kb-category-item {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  font: inherit; font-size: 13px; text-align: left;
  color: var(--ink-2);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  cursor: pointer;
  transition: background var(--motion-fast), color var(--motion-fast);
}
.kb-category-item:hover { background: var(--hover); color: var(--ink); }
.kb-category-item.active {
  background: var(--zhu-soft);
  color: var(--zhu);
  border-color: var(--zhu);
  font-weight: 600;
}
.kb-category-item:focus-visible { outline: 2px solid var(--zhu); outline-offset: 1px; }
.kb-category-count { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.kb-category-item.active .kb-category-count { color: var(--zhu); }
.kb-entries { min-width: 0; }
.kb-drop-hint { margin: 10px 0 0; font-size: 12px; color: var(--ink-3); }

.filter-bar {
  display: flex; gap: 12px; margin-bottom: var(--space-md); align-items: center;
}
.entry-count { flex-shrink: 0; white-space: nowrap; font-size: 12px; color: var(--ink-3); margin-left: auto; font-variant-numeric: tabular-nums; }
.kb-summary-panel .empty-hint { padding: 12px 0; }

/* 条目列表 */
.entry-list { display: flex; flex-direction: column; gap: 8px; max-height: min(46vh, 520px); overflow-y: auto; padding-right: 4px; overscroll-behavior: contain; }
.merge-option { display: flex; align-items: center; gap: 9px; }
.merge-order { margin: 0; padding-left: 24px; }
.merge-order li { margin-block: 5px; }

.entry-card {
  flex-shrink: 0;
  padding: 7px 12px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-m);
  background: var(--paper);
  cursor: pointer;
  transition: border-color var(--motion-fast), background var(--motion-fast);
}
.entry-card:focus-visible { outline: 2px solid var(--zhu); outline-offset: 1px; }
.entry-card:hover { border-color: var(--ink-3); }
.entry-card.entry-selected {
  border-color: var(--zhu);
  background: var(--zhu-soft);
}
.entry-header { display: flex; align-items: center; gap: 10px; min-width: 0; }
.entry-meta { flex-shrink: 0; font-size: 12px; color: var(--ink-3); white-space: nowrap; }
.entry-header .entry-actions { flex-shrink: 0; margin-left: auto; }
.entry-size { flex-shrink: 0; font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.entry-cat {
  flex-shrink: 0;
  font-size: 11px; padding: 1px 8px; border-radius: var(--r-s);
  background: var(--dai-soft); color: var(--dai);
}
.entry-summary-status { margin-left: auto; }
.entry-header h4 {
  font-family: var(--f-serif); font-size: 15px; font-weight: 700;
  color: var(--ink); margin: 0; letter-spacing: 0.01em; min-width: 0; flex: 0 1 auto;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.entry-preview { font-size: 12px; color: var(--ink-3); line-height: 1.5; margin: 2px 0 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 700px) { .entry-meta { display: none; } }

.entry-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.entry-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.tag-chip {
  font-size: 11px; padding: 1px 6px; border-radius: var(--r-s);
  background: var(--zhu-soft); color: var(--zhu);
}
.entry-actions { display: flex; gap: 4px; margin-left: auto; }

.empty-hint { text-align: center; color: var(--ink-3); padding: 40px; font-size: 14px; }

.kb-summary-panel {
  margin-bottom: var(--space-lg); padding: 12px 18px;
  border: 1px solid var(--line-2);
  border-left: 3px solid var(--dai);
  border-radius: var(--r-l);
  box-shadow: var(--shadow-1);
}
.kb-summary-toggle { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; cursor: pointer; font-family: var(--f-serif); font-size: 16px; font-weight: 600; color: var(--ink); }
.kb-summary-toggle small { font-family: var(--f-sans, inherit); font-size: 12px; font-weight: 400; color: var(--ink-3); }
.kb-summary-panel[open] .kb-summary-toggle { margin-bottom: 12px; }
.kb-summary-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.kb-summary-toolbar h4 { margin: 0 0 4px; font-family: var(--f-serif); font-size: 16px; color: var(--ink); }

/* Entry detail panel */
.entry-detail-panel {
  padding: 20px 24px;
  background: var(--paper);
  border: 1px solid var(--line-2);
  border-radius: var(--r-l);
  box-shadow: var(--shadow-1);
  scroll-margin-top: 12px;
}
.entry-detail-empty { margin: 0; padding: 18px; text-align: center; color: var(--ink-3); font-size: 13px; border: 1px dashed var(--line-2); border-radius: var(--r-l); }
.entry-outline { scroll-margin-top: 140px; margin: -6px 0 18px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--panel-2); }
.entry-outline > summary { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px; cursor: pointer; font-weight: 600; color: var(--ink); }
.entry-outline > summary small { font-weight: 400; font-size: 12px; color: var(--ink-3); }
/* 一、二级标题各占一行并加分隔，三级标题缩进、两列排列 */
.entry-outline-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 12px; max-height: 320px; overflow-y: auto; padding: 0 12px 10px; }
.entry-outline-item { padding: 3px 8px; border: 0; border-radius: var(--r-s); background: transparent; color: var(--ink-2); font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.entry-outline-item:hover { background: var(--hover); color: var(--zhu); }
.entry-outline-item.outline-level-1, .entry-outline-item.outline-level-2 { grid-column: 1 / -1; margin-top: 6px; padding-top: 7px; border-top: 1px solid var(--line); border-radius: 0; font-weight: 700; color: var(--ink); }
.entry-outline-item.outline-level-1:first-child, .entry-outline-item.outline-level-2:first-child { margin-top: 0; border-top: 0; }
.entry-outline-item.outline-level-3 { padding-left: 22px; position: relative; }
.entry-outline-item.outline-level-3::before { content: ''; position: absolute; left: 10px; top: 50%; width: 5px; height: 5px; border-radius: 50%; background: var(--line-2); transform: translateY(-50%); }
/* 跳转时标题不被固定的标题栏挡住 */
.entry-detail-content :deep(h2), .entry-detail-content :deep(h3), .entry-detail-content :deep(h4), .entry-detail-content :deep(h5) { scroll-margin-top: 160px; }
.entry-detail-content :deep(blockquote) { margin: 8px 0; padding: 6px 12px; border-left: 3px solid var(--line-2); color: var(--ink-2); }
.entry-detail-content :deep(code) { padding: 0 4px; border-radius: 4px; background: var(--panel-2); font-size: .92em; }
@media (max-width: 700px) { .entry-outline-list { grid-template-columns: 1fr; } }

.entry-detail-tools { display: flex; flex-wrap: wrap; gap: 6px; flex-shrink: 0; }
.back-up-icon { transform: rotate(-90deg); }
/* 阅读长资料时标题栏固定在顶部，随时可回到目录或条目列表 */
.entry-detail-header {
  position: sticky; top: calc(-1 * var(--space-xl)); z-index: 2; background: var(--paper);
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin: -20px -24px 20px; padding: 14px 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line-2);
}

.entry-detail-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.entry-detail-panel h3 {
  font-family: var(--f-serif);
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
  margin: 0;
  letter-spacing: 0.02em;
}

.entry-detail-cat {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: var(--r-s);
  background: var(--dai-soft);
  color: var(--dai);
}

.entry-detail-content {
  font-size: 16px;
  line-height: 1.85;
  color: var(--ink);
  overflow-wrap: break-word;
}

.entry-detail-content :deep(h1),
.entry-detail-content :deep(h2),
.entry-detail-content :deep(h3),
.entry-detail-content :deep(h4),
.entry-detail-content :deep(h5),
.entry-detail-content :deep(h6) {
  font-family: var(--f-serif);
  margin-top: 1.5em;
  margin-bottom: 0.6em;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.entry-detail-content :deep(p) {
  margin: 0.8em 0;
}

.entry-detail-content :deep(ul),
.entry-detail-content :deep(ol) {
  margin: 0.8em 0;
  padding-left: 1.8em;
}

.entry-detail-content :deep(li) {
  margin: 0.4em 0;
}

.entry-detail-content :deep(code) {
  font-family: var(--f-num);
  font-size: 0.9em;
  padding: 2px 6px;
  background: var(--hover);
  border-radius: var(--r-s);
}

.entry-detail-content :deep(pre) {
  background: var(--hover);
  padding: 12px;
  border-radius: var(--r-s);
  overflow-x: auto;
  margin: 1em 0;
}

.entry-detail-content :deep(blockquote) {
  margin: 1em 0;
  padding-left: 16px;
  border-left: 3px solid var(--line-2);
  color: var(--ink-2);
}

.entry-detail-meta {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--line-2);
}

.summary-status-row,
.entry-summary-heading,
.summary-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-status-row { margin: 12px 0 8px; }
.summary-status {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 2px 7px;
  border-radius: var(--r-s);
  font-size: 11px;
  white-space: nowrap;
}
.summary-status-empty { color: var(--ink-3); background: var(--hover); }
.summary-status-current { color: var(--qing); background: color-mix(in srgb, var(--qing) 12%, transparent); }
.summary-status-unverified { color: var(--jin); background: color-mix(in srgb, var(--jin) 12%, transparent); }
.summary-status-stale { color: var(--zhu); background: color-mix(in srgb, var(--zhu) 12%, transparent); }
.summary-status-hint,
.summary-scope-hint {
  margin: 6px 0;
  color: var(--ink-3);
  font-size: 12px;
  line-height: 1.6;
}
.summary-scope-hint { font-size: 11px; }
.summary-error {
  margin: 8px 0;
  color: var(--zhu);
  font-size: 12px;
  line-height: 1.6;
}
.summary-error button {
  margin-left: 6px;
  padding: 0;
  color: inherit;
  background: transparent;
  border: 0;
  text-decoration: underline;
  cursor: pointer;
}
.summary-actions { margin-top: 8px; }
.summary-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line-2);
  color: var(--ink-2);
  font-size: 12px;
}
.summary-history-item {
  padding: 8px 10px;
  background: var(--hover);
  border-radius: var(--r-s);
}
.summary-history-item > div { color: var(--ink-3); font-size: 11px; }
.summary-history-item p { margin: 4px 0 0; white-space: pre-wrap; line-height: 1.6; }
.entry-summary-editor {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--line-2);
}
.entry-summary-heading h4 { margin: 0; font-family: var(--f-serif); color: var(--ink); }
.entry-summary-editor .m-input-wrap { margin-top: 8px; }

.entry-detail-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.entry-detail-timestamps {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 700px) {
  .kb-entries, .entry-detail-panel { padding: 14px; }
  .entry-summary-status { margin-left: 0; }
}
.kb-summary-toolbar p { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.kb-summary-content { margin: 14px 0 0; white-space: pre-wrap; color: var(--ink-2); line-height: 1.7; font-size: 13px; }
.kb-summary-time { display: block; margin-top: 10px; color: var(--ink-4); font-size: 11px; }

/* 表单 */
.kb-form { display: grid; gap: 4px; }
.kb-form-row { display: grid; grid-template-columns: minmax(0, 1fr) 140px; gap: 12px; }
@media (max-width: 560px) { .kb-form-row { grid-template-columns: 1fr; } }

.file-upload-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.file-name {
  font-size: 12px;
  color: var(--ink-3);
}
</style>
