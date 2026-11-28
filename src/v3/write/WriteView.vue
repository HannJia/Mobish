<template>
  <Teleport defer to="#v3-crumb">
    <router-link v-if="session.novel.value" class="crumb-link" to="/" :title="session.novel.value.title">《{{ session.novel.value.title }}》</router-link>
    <template v-if="currentGroup"><span class="crumb-sep">/</span><span class="crumb-volume">{{ currentGroup.label }}</span></template>
    <span class="crumb-sep">/</span><span class="crumb-b" :title="session.title.value">第{{ (session.chapter.value?.chapterIndex ?? 0) + 1 }}章 {{ chapterTitleForDisplay(session.title.value, session.chapter.value?.chapterIndex ?? 0) }}</span>
  </Teleport>
  <Teleport defer to="#v3-lifecycle">
    <div class="lifecycle" aria-label="章节生命周期" :title="WORKFLOW_STEPS.map(item => item.label).join(' → ')">
      <template v-for="(item, index) in WORKFLOW_STEPS" :key="item.status">
        <span v-if="index" class="lc-bar" />
        <span class="lc-step" :class="{ done: index < workflowIndex, cur: index === workflowIndex }" :aria-current="index === workflowIndex ? 'step' : undefined" :title="item.label"><i /><span>{{ item.label }}</span></span>
      </template>
      <V3Icon v-if="locked" name="lock" size="s" />
    </div>
  </Teleport>
  <Teleport defer to="#v3-tools">
    <button type="button" class="top-gate-status" :title="deskReview.detail" :disabled="busy" @click="openCompletion">
      <i :class="displayStatus === 'finalized' || gateReady ? 'ok' : session.workflow.value?.blockers.length ? 'warn' : 'todo'" />
      <span>定稿检查 · {{ displayStatus === 'finalized' ? '已定稿' : gateReady ? '可提交定稿' : session.workflow.value?.blockers.length ? `${session.workflow.value.blockers.length} 处阻塞` : '待核对' }}</span>
    </button>
    <button type="button" class="m-btn top-gate-btn top-review-btn" data-guide="write.review" :title="deskReview.detail" :disabled="busy || locked || !session.content.value.trim()" @click="reviewChapter"><V3Icon name="refresh" size="s" />全章审校</button>
    <button type="button" class="m-btn zhu top-gate-btn" data-guide="write.finalize" :title="deskReview.detail" :disabled="busy || !session.workflow.value?.primary || locked" @click="openCompletionWithGuide"><V3Icon name="stamp" size="s" />{{ primaryLabel }} · 核对</button>
    <GuideBeacon :visible="writeBeacons.includes('write.finalize')" beacon-id="write.finalize" />
    <span class="top-sep" aria-hidden="true" />
    <div class="mode-wrap">
      <div class="m-seg" role="group" aria-label="写作模式">
        <button type="button" :class="{ on: session.novel.value?.writingMode !== 'ai' }" :disabled="busy" @click="setMode('manual')">主笔</button>
        <button type="button" :class="{ on: session.novel.value?.writingMode === 'ai' }" :disabled="busy" @click="setMode('ai')">协作</button>
        <button type="button" :disabled="busy" @click="openAuto">自动</button>
      </div>
      <button type="button" class="m-ibtn mode-info" data-guide="write.mode" aria-label="三种写作模式的区别" :aria-expanded="modeInfoOpen" @click="toggleModeInfo"><V3Icon name="info" size="s" /></button>
      <GuideBeacon :visible="writeBeacons.includes('write.mode')" beacon-id="write.mode" />
      <div class="mode-pop" :class="{ open: modeInfoOpen }" role="tooltip">
        <strong>写作模式 · 区别在于谁来写正文</strong>
        <div><b>主笔</b><p>你写正文，AI 提供批注、检索、选区候选与审校。</p></div>
        <div><b>协作</b><p>你确认章纲，AI 提供候选稿。</p></div>
        <div><b>自动</b><p>在运行中心设置章节范围、预算和检查点。</p></div>
        <small><V3Icon name="lock" size="s" />AI 正文先是候选；故事变化需逐条确认后入典。</small>
      </div>
    </div>
    <button class="top-save" data-guide="write.save" type="button" :disabled="session.saving.value || locked" aria-label="保存正文" @click="save"><i :class="session.saved.value ? 'ok' : 'warn'" />{{ session.saving.value ? '保存中…' : session.saved.value ? '已保存' : '未保存' }}</button>
  </Teleport>
  <Teleport defer to="#v3-view-tools">
    <button type="button" class="m-ibtn" :class="{ 'view-on': sideOpen && !focused }" title="目录" aria-label="切换目录" :aria-pressed="sideOpen && !focused" @click="toggleSide"><V3Icon name="sideL" /></button>
    <button type="button" class="m-ibtn" :class="{ 'view-on': deskOpen && !focused }" title="案头" aria-label="切换案头" :aria-pressed="deskOpen && !focused" @click="toggleDesk"><V3Icon name="sideR" /></button>
    <button type="button" class="m-ibtn" :class="{ 'view-on': focused }" title="专注（Esc 退出）" aria-label="切换专注模式" :aria-pressed="focused" @click="focused = !focused"><V3Icon name="expand" /></button>
  </Teleport>
  <Teleport defer to="#v3-status">
    <router-link v-if="foreshadowAlerts.length && session.novel.value" class="status-it foreshadow-chip" :to="`/plan/${session.novel.value.id}`"
      :title="foreshadowAlerts.map(alert => `${alert.title}：${alert.text}`).join('；')">伏笔提醒 {{ foreshadowAlerts.length }}</router-link>
    <span class="status-it"><V3Icon name="type" size="s" />本章 <b class="m-num">{{ wordCount.toLocaleString() }}</b> 字 · 目标 {{ lengthPolicy.minWords }}–{{ lengthPolicy.maxWords }}</span>
    <div ref="typographyControl" class="write-type-control" @click.stop @keydown.esc.stop.prevent="typographyOpen = false">
      <button type="button" class="status-it write-type-trigger" data-guide="write.type" aria-label="正文排版" title="正文排版"
        :aria-expanded="typographyOpen" @click="toggleTypography"><V3Icon name="type" size="s" />正文排版</button>
      <section v-if="typographyOpen" class="write-type-pop" role="dialog" aria-label="正文排版设置">
        <header><strong>正文排版</strong><button type="button" class="m-ibtn" title="恢复默认排版" aria-label="恢复默认排版" @click="resetTypography"><V3Icon name="refresh" size="s" /></button></header>
        <label class="write-type-field" for="write-font-size"><span>字号</span><output>{{ typography.fontSize }} px</output>
          <input id="write-font-size" type="range" min="14" max="30" step="1" :value="typography.fontSize" aria-label="字号"
            @input="setTypography('fontSize', Number(($event.target as HTMLInputElement).value))">
        </label>
        <label class="write-type-field" for="write-paragraph-spacing"><span>段落间距</span><output>{{ typography.paragraphSpacing.toFixed(1) }} em</output>
          <input id="write-paragraph-spacing" type="range" min="0" max="2" step="0.1" :value="typography.paragraphSpacing" aria-label="段落间距"
            @input="setTypography('paragraphSpacing', Number(($event.target as HTMLInputElement).value))">
        </label>
        <label class="write-type-field" for="write-letter-spacing"><span>字间距</span><output>{{ typography.letterSpacing.toFixed(2) }} em</output>
          <input id="write-letter-spacing" type="range" min="0" max="0.12" step="0.01" :value="typography.letterSpacing" aria-label="字间距"
            @input="setTypography('letterSpacing', Number(($event.target as HTMLInputElement).value))">
        </label>
        <label class="write-type-toggle">
          <span>手机阅读宽度（390px）</span>
          <input type="checkbox" :checked="mobilePreview" aria-label="手机阅读宽度预览" @change="setMobilePreview(($event.target as HTMLInputElement).checked)">
        </label>
      </section>
    </div>
    <button type="button" class="status-it write-type-trigger" data-guide="write.mobile" :class="{ on: mobilePreview }" :aria-pressed="mobilePreview"
      aria-label="手机阅读宽度预览" title="按手机阅读宽度（390px）预览段落换行" @click="setMobilePreview(!mobilePreview)">
      {{ mobilePreview ? '退出手机预览' : '手机预览' }}
    </button>
    <GuideBeacon :visible="writeBeacons.includes('write.type')" beacon-id="write.type" />
    <GuideBeacon :visible="writeBeacons.includes('write.margin')" beacon-id="write.margin" />
    <GuideBeacon :visible="writeBeacons.includes('write.candidate')" beacon-id="write.candidate" />
    <span v-if="ai.statusText.value" class="status-it status-note" :title="ai.statusText.value">{{ ai.statusText.value }}</span>
  </Teleport>

  <div v-if="session.loading.value" class="write-loading">正在打开写作台…</div>
  <div v-else-if="session.loadError.value" class="write-error" role="alert">{{ session.loadError.value }}</div>
  <div v-else-if="!session.novel.value || !session.chapter.value" class="write-error">作品或章节不存在。</div>
  <div v-else class="write-page" :class="{ 'no-side': !sideOpen || focused, 'no-desk': !deskOpen || focused, 'is-focused': focused }">
    <aside v-if="sideOpen && !focused" class="write-side tree-side" aria-label="章节目录">
      <div class="side-head"><strong>目录</strong><button type="button" class="m-ibtn" title="新建章节" aria-label="新建章节" :disabled="busy" @click="addChapter"><V3Icon name="plus" size="s" /></button></div>
      <div ref="chapterTreeEl" class="chapter-tree">
        <section v-for="group in chapterGroups" :key="group.key" class="tree-volume">
          <button type="button" class="volume-head" :aria-expanded="!closedGroups.has(group.key)" @click="toggleGroup(group.key)"><V3Icon :name="closedGroups.has(group.key) ? 'chevR' : 'chevD'" size="s" /><span>{{ group.label }}</span><small v-if="group.chapters.length">{{ group.chapters[0].chapterIndex + 1 }}–{{ group.chapters[group.chapters.length - 1].chapterIndex + 1 }}</small></button>
          <template v-if="!closedGroups.has(group.key)">
            <template v-for="item in group.chapters" :key="item.id">
              <button type="button" class="tree-item" :class="{ on: item.id === session.chapter.value.id }" :aria-current="item.id === chapterId ? 'page' : undefined" @click="openChapter(item.id)">
                <span class="tree-number">{{ item.chapterIndex + 1 }}</span><span class="tree-dot" :class="item.id === chapterId ? currentChapterDot : chapterDot(item)" />
                <span class="tree-label">{{ chapterTitleForDisplay(item.id === chapterId ? session.title.value : item.title, item.chapterIndex, '未命名') }}</span><small class="m-num">{{ (item.id === chapterId ? wordCount : item.wordCount).toLocaleString() }}</small>
              </button>
              <div v-if="item.id === chapterId && scenes.length" class="tree-scenes">
                <button v-for="scene in scenes" :key="scene.id" type="button" :class="{ on: selectedSceneId === scene.id }" @click="openScene(scene.id)"><i class="m-dot outlined" />{{ scene.title }}</button>
              </div>
            </template>
            <p v-if="!group.chapters.length" class="tree-empty">尚无章节</p>
          </template>
        </section>
      </div>
      <div class="tree-foot">
        <div class="tree-progress"><span>{{ currentGroup?.label || '全书' }} · 定稿</span><span class="m-num">{{ groupFinalized }} / {{ currentGroup?.chapters.length || 0 }}</span></div>
        <div class="m-prog"><i :style="{ width: groupProgress + '%' }" /></div>
        <div class="tree-legend"><span><i class="tree-dot done" />定稿</span><span><i class="tree-dot work" />起草</span><span><i class="tree-dot revision" />待修订</span><span><i class="tree-dot stale" />需重审</span><span><i class="tree-dot empty" />待写</span></div>
        <router-link class="m-link" :to="{ path: `/plan/${session.novel.value.id}`, query: { view: 'workbench', plannerTab: 'plans' } }">章纲与规划 <V3Icon name="chevR" size="s" /></router-link>
      </div>
    </aside>

    <main class="write-main" @scroll.passive="selectionRect = null">
      <EditorRecoveryPicker :drafts="session.drafts.value" :busy="busy" @restore="restoreDraft" @discard="discardDraft" />
      <div v-if="session.novel.value.writingMode === 'ai'" class="write-banner"><V3Icon name="info" size="s" /><span>协作模式：AI 内容先保存为候选，由你预览、采纳或拒绝。批量起草请进入自动写作运行中心。</span></div>
      <div v-if="previousPendingCanon?.total" class="write-banner canon-reminder-banner" role="status">
        <V3Icon name="info" size="s" />
        <span>{{ previousPendingCanon.summary }}</span>
        <router-link v-if="previousPendingCanon.route" class="m-btn xs" :to="previousPendingCanon.route">去确认上一章入典</router-link>
      </div>
      <div v-if="displayStatus === 'finalized'" class="write-banner finalized-banner"><V3Icon :name="locked ? 'lock' : 'check'" size="s" /><span>{{ locked ? '本章已锁定，正文只读。' : '本章已定稿。仍可修订，保存修改后需要重新审校。' }}</span></div>
      <section ref="paper" class="paper" :class="{ 'with-margins': showMargins, 'mobile-preview': mobilePreview }">
        <div v-if="mobilePreview" class="mobile-preview-bar" role="status">
          <span>手机阅读宽度预览（390px）· 便于检查段落长度与换行</span>
          <button type="button" class="m-link" @click="setMobilePreview(false)">恢复常规稿纸</button>
        </div>
        <header class="paper-head">
          <div class="paper-kicker" :aria-label="'第' + (session.chapter.value.chapterIndex + 1) + '章'">{{ chapterHeading(session.chapter.value.chapterIndex) }}</div>
          <input v-model="session.title.value" class="chapter-title" :readonly="locked || busy" aria-label="章节标题" placeholder="章节标题" @blur="saveTitle">
          <div class="paper-meta">
            <span><V3Icon name="type" size="s" />{{ wordCount.toLocaleString() }} / {{ lengthPolicy.minWords }}–{{ lengthPolicy.maxWords }} 字</span>
            <span v-if="scenes.length"><V3Icon name="layers" size="s" />{{ scenes.length }} 个计划场景</span>
            <span v-if="viewpointLabel"><V3Icon name="user" size="s" />{{ viewpointLabel }}</span>
            <span><V3Icon name="clock" size="s" />{{ storyTimeLabel }}</span>
            <button v-if="session.chapter.value.versions?.length" type="button" class="m-link" :disabled="versionBusy" @click="openVersionPanel">版本历史 {{ session.chapter.value.versions.length }}</button>
          </div>
          <button v-if="showMargins && marginSummary" type="button" class="paper-mnote" :title="marginOffCount ? '跳到当前屏幕外的批注或候选' : '定位到第一条批注或候选'" @click="revealMargin()">{{ marginSummary }}<span v-if="marginOffCount" class="paper-mnote-go" aria-hidden="true">{{ marginOff.below.length ? ' ↓' : ' ↑' }}</span></button>
        </header>
        <div v-if="versionOpen" class="version-panel">
          <div class="version-panel-head"><strong>正文历史版本</strong><button type="button" class="m-btn xs" @click="versionOpen = false">收起</button></div>
          <p class="m-muted m-tiny">恢复前会自动保留当前正文，恢复后需要重新审校。</p>
          <div class="version-actions">
            <select v-model="selectedVersionId" class="version-select" :disabled="versionBusy">
              <option v-for="version in versionOptions" :key="version.id" :value="version.id">{{ version.label }} · {{ new Date(version.savedAt).toLocaleString('zh-CN') }}</option>
            </select>
            <button type="button" class="m-btn xs zhu" :disabled="versionBusy || locked || !selectedVersionId" @click="restoreSelectedVersion">{{ versionBusy ? '恢复中…' : '恢复此版本' }}</button>
          </div>
        </div>
        <div ref="editorHost" class="editor-host" :style="typographyStyle">
          <PlainTextEditor ref="editor" v-model="session.content.value" :readonly="locked || busy" :marks="ai.currentMarks.value" placeholder="从这里开始写下本章……" @selection="onSelection" @scroll="onEditorHostScroll" @mark-click="onMarkClick" @layout="scheduleMargins" @ready="revealRouteEvidence" />
        </div>
        <div v-if="showMargins" class="paper-margins" aria-label="页边批注与候选" :style="{ top: marginViewport.top + 'px', height: marginViewport.height + 'px' }">
          <button v-if="marginOff.above.length" type="button" class="margin-edge top" @click="revealMargin(marginOff.above[marginOff.above.length - 1])">↑ 上方还有 {{ marginOff.above.length }} 项</button>
          <button v-if="marginOff.below.length" type="button" class="margin-edge bottom" @click="revealMargin(marginOff.below[0])">↓ 下方还有 {{ marginOff.below.length }} 项</button>
          <div v-for="item in marginItems" :key="item.id" :ref="value => setMarginElement(item.id, value)" class="margin-item" :style="{ top: (marginPositions[item.id] || 0) + 'px', visibility: marginPositions[item.id] === undefined ? 'hidden' : undefined }">
            <button v-if="item.finding" type="button" class="margin-note" :data-guide="firstMarginFindingId === item.id ? 'write.margin' : undefined" :class="[item.finding.severity, { foreshadowing: item.finding.type === 'foreshadowing', done: !['open', 'deferred'].includes(item.finding.status), stale: item.stale, on: selectedFindingId === item.finding.id }]" @click="onMarkClick(item.id); onboarding.markSeen('write.margin')"><b>{{ item.number }}</b>{{ item.finding.suggestedFix || item.finding.title }}<span>{{ findingTypeLabel[item.finding.type] }} · {{ item.stale ? '待重审' : severityLabel[item.finding.severity] }}</span></button>
            <article v-else-if="item.candidate" class="margin-slip">
              <div class="slip-head"><span>{{ candidateTypeLabel[item.candidate.type] }}候选</span><span>未入典</span></div>
              <p class="slip-story">{{ previewCandidate(item.candidate).title }}</p><p class="slip-detail">{{ previewCandidate(item.candidate).detail }}</p>
              <button type="button" class="m-btn xs" @click="showCandidate(item.id)">核对候选 <V3Icon name="chevR" size="s" /></button>
            </article>
            <article v-else-if="item.revisionId && revisionMap[item.revisionId]" class="margin-slip" :data-guide="firstMarginRevisionId === item.id ? 'write.candidate' : undefined">
              <div class="slip-head"><span>正文修订候选</span><span>未入正文</span></div>
              <div class="slip-body"><del v-if="revisionMap[item.revisionId].before">{{ revisionMap[item.revisionId].before }}</del><ins>{{ revisionMap[item.revisionId].after || '（删除此段）' }}</ins></div>
              <div class="slip-acts">
                <button type="button" class="m-btn xs pri" :disabled="busy || locked" @click="onboarding.markSeen('write.candidate'); acceptRevision(item.revisionId)">采纳</button>
                <button type="button" class="m-btn xs" :disabled="busy || locked" title="放弃这一版并按同样要求重新生成" @click="onboarding.markSeen('write.candidate'); regenerateRevision(item.revisionId)">换一版</button>
                <button type="button" class="m-btn xs" title="从页边收起，稍后在“候选”中处理" @click="onboarding.markSeen('write.candidate'); parkRevision(item.revisionId)">暂存</button>
                <button type="button" class="m-btn xs" :disabled="busy" @click="onboarding.markSeen('write.candidate'); rejectRevision(item.revisionId)">不用</button>
              </div>
            </article>
          </div>
        </div>
      </section>
    </main>

    <aside v-show="deskOpen && !focused" class="write-side desk-side" aria-label="案头">
      <div class="desk-tabs" role="tablist" aria-label="案头">
        <button v-for="tab in tabs" :id="'desk-tab-' + tab.id" :key="tab.id" type="button" role="tab" :data-guide="tab.id === 'review' ? 'write.margin.desk' : tab.id === 'candidate' ? 'write.candidate.desk' : undefined" :aria-selected="activeTab === tab.id" :aria-controls="'desk-panel-' + tab.id" :tabindex="activeTab === tab.id ? 0 : -1" :class="{ on: activeTab === tab.id }" @click="activeTab = tab.id" @keydown="onTabKey">{{ tab.label }}<b v-if="tab.count">{{ tab.count }}</b></button>
      </div>

      <section v-if="activeTab === 'review'" id="desk-panel-review" class="desk-panel" role="tabpanel" aria-labelledby="desk-tab-review">
        <div v-if="chapterBackgroundTasks.length" class="background-checks">
          <strong>后台检查</strong>
          <div v-for="task in chapterBackgroundTasks" :key="task.id" class="background-task">
            <span>{{ task.name }}</span><span class="m-muted">{{ backgroundTaskLabel[task.status] }}</span>
            <small v-if="task.error" role="alert">{{ task.error }}</small>
          </div>
        </div>
        <section v-if="session.chapter.value.bannedReview" class="banned-report">
          <strong>违禁词审查结果</strong><pre>{{ session.chapter.value.bannedReview }}</pre>
        </section>
        <div class="review-summary">
          <div class="review-summary-head"><strong>全章审校</strong><span class="m-tag" :class="deskReview.valid ? 'qing' : 'zi'">{{ deskReview.label }}</span></div>
          <div class="m-muted review-summary-meta">{{ deskReview.detail }}</div>
          <div class="coverage-bars" aria-label="审校覆盖情况"><i v-for="index in deskReview.total" :key="index" :class="{ off: index > deskReview.completed }" /></div>
          <div class="review-summary-foot"><span class="m-muted">基础检查 · 信息提取 · 连贯性 · 语义审校 · 作者确认</span><button class="m-btn ghost sm" type="button" :disabled="busy || !session.content.value.trim()" @click="reviewChapter">↻ 重审</button></div>
        </div>
        <div class="review-filters" role="toolbar" aria-label="审校筛选">
          <button v-for="filter in reviewFilters" :key="filter.id" type="button" class="m-chip" :class="{ on: reviewFilter === filter.id }" @click="reviewFilter = filter.id">{{ filter.label }} <span class="m-num">{{ filter.count }}</span></button>
        </div>
        <p v-if="!session.findings.value.length" class="m-muted desk-empty">当前正文还没有批注。</p>
        <p v-else-if="!visibleFindings.length" class="m-muted desk-empty">没有符合条件的批注。</p>
        <article v-for="finding in visibleFindings" :key="finding.id" class="finding" :data-finding="finding.id" tabindex="0" :aria-expanded="selectedFindingId === finding.id"
          :class="[finding.status, finding.severity, { on: selectedFindingId === finding.id, foreshadowing: finding.type === 'foreshadowing', previous: !isCurrentFinding(finding) }]"
          @click="onMarkClick('f:' + finding.id)" @keydown.enter.self.prevent="onMarkClick('f:' + finding.id)" @keydown.space.self.prevent="onMarkClick('f:' + finding.id)">
          <div class="finding-head"><span class="m-tag" :class="findingTagClass(finding.severity)">{{ severityLabel[finding.severity] }}</span><span class="finding-type">{{ findingTypeLabel[finding.type] }}</span><span class="finding-loc m-num">{{ anyFindingAnchor(finding) ? `字 ${anyFindingAnchor(finding)!.start}` : '本章' }}</span></div>
          <strong class="finding-title">{{ finding.title }}</strong>
          <small v-if="!isCurrentFinding(finding) && isOpenFinding(finding)" class="finding-stale">{{ relocatedAnchor(finding) ? '正文已改，这段未动 · 待重审' : '所在段落已改 · 待重审' }}</small>
          <small v-else-if="!isCurrentFinding(finding)" class="finding-stale">上一版正文的记录</small>
          <p v-if="findingEvidence(finding)" class="finding-quote">“{{ findingEvidence(finding) }}”</p>
          <div v-if="selectedFindingId === finding.id" class="finding-detail">
            <p>{{ finding.explanation }}</p>
            <div v-if="finding.suggestedFix" class="finding-suggestion">{{ finding.suggestedFix }}</div>
          </div>
          <div class="finding-actions" v-if="isCurrentFinding(finding) && isOpenFinding(finding)">
            <button v-if="findingAnchor(finding)" class="m-btn xs pri" type="button" :disabled="busy || locked" @click.stop="generateFindingRevision(finding)"><V3Icon name="spark" size="s" />修改候选</button>
            <button class="m-btn xs" type="button" :disabled="busy" @click.stop="resolveFinding(finding, 'accepted')">已处理</button>
            <button class="m-btn xs" type="button" :disabled="busy" @click.stop="resolveFinding(finding, 'intentional')">有意设计</button>
            <button class="m-btn xs" type="button" :disabled="busy" @click.stop="resolveFinding(finding, 'deferred')">延后</button>
          </div>
          <div class="finding-actions" v-else-if="relocatedAnchor(finding)">
            <button class="m-btn xs pri" type="button" :disabled="busy || locked" @click.stop="generateFindingRevision(finding)"><V3Icon name="spark" size="s" />修改候选</button>
            <span class="finding-hint">重审后可标记处理</span>
          </div>
        </article>
        <pre v-if="ai.reviewReport.value" class="review-report">{{ ai.reviewReport.value }}</pre>
      </section>

      <section v-else-if="activeTab === 'candidate'" id="desk-panel-candidate" class="desk-panel" role="tabpanel" aria-labelledby="desk-tab-candidate">
        <div class="panel-title"><strong>待确认候选</strong></div>
        <article v-for="item in revisionViews" :key="item.id" class="candidate revision-card" :data-candidate="'r:' + item.id">
          <div class="finding-head"><span class="m-tag jin">未入正文</span><strong>正文修订候选</strong><span v-if="parkedRevisions.has(item.id)" class="m-tag dai">已暂存</span></div>
          <p>{{ item.row.reason }}</p>
          <p v-if="!item.current" class="revision-stale" role="alert">正文已变化，这一版不能直接采纳，可以换一版。</p>
          <div class="revision-diff"><del v-if="item.before">{{ item.before }}</del><ins>{{ item.after || '（删除此段）' }}</ins></div>
          <div class="finding-actions">
            <button class="m-btn xs zhu" type="button" :disabled="busy || locked || !item.current" @click="acceptRevision(item.id)">采纳入正文</button>
            <button class="m-btn xs" type="button" :disabled="busy || locked" @click="regenerateRevision(item.id)">换一版</button>
            <button class="m-btn xs" type="button" :disabled="!item.current" @click="editor?.revealRange(item.start, item.end)">定位</button>
            <button v-if="parkedRevisions.has(item.id)" class="m-btn xs" type="button" @click="unparkRevision(item.id)">放回页边</button>
            <button class="m-btn xs" type="button" :disabled="busy" @click="rejectRevision(item.id)">不用</button>
          </div>
        </article>
        <div class="candidate-section-title">故事变化 · 逐条确认后入典</div>
        <p v-if="editingCandidate && editingDecisionVersion !== session.reviewSourceVersion.value" class="m-muted" role="alert">正文或依据已变化，修改输入仍保留；请取消修改后重新核对。</p>
        <StoryCandidateEditor v-if="editingCandidate" :key="editingCandidate.id" :candidate="editingCandidate" :busy="decisionBusy"
          :disabled="busy || editingDecisionVersion !== session.reviewSourceVersion.value" @confirm="confirmEditedCandidate" @cancel="editingCandidate = undefined" />
        <div v-if="causalityCandidateId"><button class="m-btn xs" @click="causalityCandidateId = ''">收起因果核对</button><EventCausalityPanel :novel="session.novel.value" :focus-candidate-id="causalityCandidateId" /></div>
        <p v-if="!pendingCandidates.length" class="m-muted desk-empty">没有待确认候选。</p>
        <article v-for="candidate in pendingCandidates" :key="candidate.id" class="candidate" :data-candidate="'c:' + candidate.id">
          <div class="finding-head"><span class="m-tag zhu">{{ candidateTypeLabel[candidate.type] }}</span><strong>{{ previewCandidate(candidate).title }}</strong></div>
          <pre class="candidate-preview">{{ previewCandidate(candidate).detail }}</pre>
          <p v-if="candidate.evidence[0]?.quote" class="quote">“{{ candidate.evidence[0].quote }}”</p>
          <div class="finding-actions">
            <button v-if="candidate.type === 'event_causality'" class="m-btn xs zhu" :disabled="busy" @click="openCausality(candidate)">核对因果决定</button>
            <template v-else><button class="m-btn xs zhu" type="button" :disabled="busy || !!editingCandidate || !candidate.evidence.length" @click="acceptCandidate(candidate)">采纳入典</button><button class="m-btn xs" type="button" :disabled="busy || !!editingCandidate" @click="editCandidate(candidate)">修改后确认</button>
            <button class="m-btn xs" type="button" :disabled="busy || !!editingCandidate" @click="deferCandidate(candidate)">收起</button><button class="m-btn xs" type="button" :disabled="busy || !!editingCandidate" @click="rejectCandidate(candidate)">驳回</button></template>
          </div>
        </article>
      </section>

      <section v-else-if="activeTab === 'character'" id="desk-panel-character" class="desk-panel character-panel" role="tabpanel" aria-labelledby="desk-tab-character">
        <CharacterDeskPanel
          :novel="session.novel.value"
          :chapter="session.chapter.value"
          :draft-content="session.content.value"
          :plan-text="planBeats.join('\n')"
          :canon-mutations="canonMutations"
        />
      </section>

      <section v-else-if="activeTab === 'memory'" id="desk-panel-memory" class="desk-panel memory-panel" role="tabpanel" aria-labelledby="desk-tab-memory">
        <div class="panel-title"><strong>本章剧情记忆</strong><router-link class="m-link" :to="`/codex/${novelId}`">典籍 <V3Icon name="chevR" size="s" /></router-link></div>
        <p class="context-note">汇总本章之前的伏笔、章纲要点、场景计划与本章笔记；人物状态、关系与数据请看「角色」页。</p>
        <section class="context-section"><h4>相关伏笔 · 本章之前</h4><div v-for="event in openPromises" :key="event.id" class="memory-promise"><i class="m-dot" /><span>{{ event.title }}</span><small>第{{ event.chapterIndex + 1 }}章</small></div><p v-if="!openPromises.length" class="m-muted m-tiny">没有可用的未兑现伏笔记录。</p></section>
        <section class="context-section"><h4>章纲要点 · {{ planBeats.length }} 项计划</h4><div v-for="(beat, index) in planBeats" :key="index" class="memory-beat"><V3Icon name="target" size="s" /><span>{{ beat }}</span></div><p v-if="!planBeats.length" class="m-muted m-tiny">尚无本章可用章纲。</p><div class="memory-plan-links"><router-link class="m-link" :to="{ path: `/plan/${novelId}`, query: { view: 'workbench', plannerTab: 'plans' } }">核对与修改章纲</router-link><button v-if="!session.content.value.trim()" type="button" class="m-btn xs zhu-soft-btn" :disabled="advisor.analyzing.value" @click="requestChatDirections()">✦ 按章纲想两个开场</button></div></section>
        <section v-if="scenes.length" class="context-section"><h4>本章场景计划</h4><article v-for="scene in scenes" :key="scene.id" class="memory-scene" :class="{ on: selectedSceneId === scene.id }"><strong>{{ scene.title }}</strong><p>{{ scene.purpose }}</p><small v-if="scene.outputState">预期结束：{{ scene.outputState }}</small></article></section>
        <section v-if="session.chapter.value.sceneNotes?.length" class="context-section"><h4>本章笔记 · {{ session.chapter.value.sceneNotes.length }} 条</h4><article v-for="note in session.chapter.value.sceneNotes" :key="note.id" class="memory-scene"><strong>{{ note.title }}</strong><p class="memory-note-body">{{ note.content }}</p></article></section>
        <ChapterTimePanel :novel="session.novel.value" :chapter="session.chapter.value" :busy="busy" :save-content="session.saveNow" @saved="session.markChanged" />
        <div class="context-isolation"><V3Icon name="lock" size="s" /><span>伏笔与剧情记忆只取本章之前已确认的记录。</span></div>
      </section>

      <section v-if="chatMounted" v-show="activeTab === 'chat'" id="desk-panel-chat" class="desk-panel chat-panel" role="tabpanel" aria-labelledby="desk-tab-chat">
        <div class="chat-host">
          <BookChat
            v-if="session.novel.value"
            :novel-id="session.novel.value.id"
            :chapter-id="session.chapter.value?.id"
            :draft-content="session.content.value"
            :prefill="chatPrefill"
            :prefill-version="chatPrefillVersion"
            :advice-result="advisor.result.value"
            :advice-loading="advisor.analyzing.value"
            :advice-stale="advisor.stale.value"
            :advice-saving="advisorSaving"
            :advice-error="advisorError"
            @request-directions="requestChatDirections()"
            @stop-directions="advisor.stop()"
            @clear-directions="advisor.clear()"
            @save-direction="saveAdvisorSuggestion($event.action, $event.suggestion)"
            @copy-direction="copyAdvisorSuggestion"
          />
        </div>
      </section>
    </aside>
  </div>

  <div v-if="selectedText && selectionRect && !busy && !styleSample" ref="selectionTools" class="selection-tools" role="toolbar" aria-label="选区 AI 操作" :style="selectionToolStyle" @mousedown.prevent>
    <span>{{ selectedText.length }} 字</span>
    <template v-if="!locked">
      <button v-for="item in selectionActions" :key="item.mode" type="button" :data-guide="item.mode === 'rewrite' ? 'write.selection' : undefined" @click="onboarding.markSeen('write.selection'); runSelection(item.mode)">{{ item.label }}</button><i />
      <button type="button" @click="onboarding.markSeen('write.selection'); openSelectionDirections()">接下来怎么写</button>
      <button type="button" @click="onboarding.markSeen('write.selection'); openSelectionChat('check')">设定核对</button><button type="button" @click="onboarding.markSeen('write.selection'); openSelectionChat('chat')">问 AI</button>
      <GuideBeacon :visible="writeBeacons.includes('write.selection')" beacon-id="write.selection" />
    </template>
    <button type="button" @click="openSampleStyle">提炼写法</button>
  </div>
  <SampleStyleDialog v-if="styleSample" :novel-id="styleSample.novelId" :sample="styleSample.text" :previous-rules="styleSample.previousRules"
    @close="styleSample = undefined" @saved="finishSampleStyle" />
  <button v-if="focused" type="button" class="focus-hint" @click="focused = false">专注模式 · 按 Esc 退出</button>
  <div v-if="completionOpen" class="m-overlay completion-overlay" @click.self="closeCompletion" @keydown="onCompletionKey">
    <section ref="completionDialog" class="m-modal" role="dialog" aria-modal="true" aria-labelledby="completion-title" aria-describedby="completion-description" tabindex="-1">
      <header class="m-modal-h"><div><h3 id="completion-title">{{ primaryLabel }}前核对</h3><p id="completion-description">第{{ (session.chapter.value?.chapterIndex ?? 0) + 1 }}章 · {{ chapterTitleForDisplay(session.title.value, session.chapter.value?.chapterIndex ?? 0) }}。故事变化逐条决定，定稿不会代替作者采纳或驳回。</p></div><button type="button" class="m-ibtn" :disabled="busy" aria-label="关闭定稿核对" @click="closeCompletion"><V3Icon name="x" /></button></header>
      <div class="m-modal-b">
        <div class="gate-stats">
          <div :class="{ bad: !!session.workflow.value?.blockers.length }"><b>{{ session.workflow.value?.blockers.length || 0 }}</b><span>阻塞问题</span></div>
          <div><b>{{ openFindings.filter(item => item.severity !== 'blocker').length }}</b><span>其余待处理</span></div>
          <div :class="{ bad: !deskReview.valid }"><b>{{ session.workflow.value?.coverage ? `${session.workflow.value.coverage.completed}/${session.workflow.value.coverage.total}` : '—' }}</b><span>审校分段覆盖</span></div>
          <div><b>{{ planBeats.length }}</b><span>计划要点</span></div>
        </div>
        <p class="gate-detail">{{ deskReview.detail }}</p>
        <p v-if="currentPendingCanon?.total" class="gate-canon-note" role="status">{{ currentPendingCanon.summary }}</p>
        <div class="gate-list"><div v-for="gate in session.workflow.value?.gate || []" :key="gate.key" class="gate-row"><i :class="gate.state" /><span>{{ gate.label }}</span><small>{{ gate.detail }}</small></div></div>
        <section class="completion-changes"><h4>待处理 · {{ pendingCandidates.length }} 条故事变化{{ revisionViews.length ? ` / ${revisionViews.length} 份正文修订` : '' }}</h4><p v-if="!pendingCandidates.length && !revisionViews.length" class="m-muted m-tiny">没有待处理候选。</p><p v-for="candidate in pendingCandidates" :key="candidate.id"><span class="m-tag jin">{{ candidateTypeLabel[candidate.type] }}</span>{{ previewCandidate(candidate).title }}</p><button v-if="pendingCandidates.length || revisionViews.length" type="button" class="m-btn sm" :disabled="busy" @click="handlePendingFromCompletion">去案头逐条核对</button></section>
        <section class="completion-changes"><h4>本章入典记录 · {{ chapterMutations.length }} 条</h4><p v-for="record in chapterMutations" :key="record.id"><span class="m-tag qing">{{ candidateTypeLabel[record.type] }}</span>{{ record.summary }}</p></section>
        <p v-if="session.workflow.value?.primary === 'complete'" class="completion-note">“完成本章”会生成总结、检查结尾、审校并提取故事变化；没有待处理的候选时会直接定稿，否则会停下来让你核对。</p>
        <p v-if="confirmationVersion !== session.reviewSourceVersion.value" class="revision-stale" role="alert">正文或审校依据已变化，请关闭后重新核对。</p>
      </div>
      <footer class="m-modal-f"><span class="l">{{ session.workflow.value?.primary === 'finalize' ? '全部门槛通过后才可定稿' : '先满足篇幅、时间与正文修订检查' }}</span><button type="button" class="m-btn" :disabled="busy" @click="closeCompletion">返回写作</button><button type="button" class="m-btn zhu" :disabled="busy || !canSubmitCompletion || confirmationVersion !== session.reviewSourceVersion.value" @click="primaryAction">{{ busy ? '处理中…' : '确认' + primaryLabel }}</button></footer>
    </section>
  </div>
  <div v-if="sealVisible" class="seal-overlay" role="status" aria-live="polite"><div class="chapter-seal">定稿</div><span>本章已通过定稿检查</span></div>
  <div v-if="session.saveError.value || ai.error.value" class="write-toast" role="alert">{{ [session.saveError.value, ai.error.value].filter(Boolean).join('；') }}<button type="button" class="m-btn xs" @click="clearErrors">知道了</button></div>
</template>

<script setup lang="ts">
import { foreshadowReminders, lastWrittenChapterIndex } from '../selectors/foreshadowReminders'
import { errorText } from '@/services/userFacingError'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import V3Icon from '../components/V3Icon.vue'
import GuideBeacon from '../components/GuideBeacon.vue'
import { useOnboardingStore } from '@/stores/onboarding'
import type { GuideBeaconId } from '@/services/onboardingGuide'
import PlainTextEditor, { type SelectionInfo } from '../editor/PlainTextEditor.vue'
import BookChat from '@/v3/write/BookChat.vue'
import CharacterDeskPanel from '@/v3/write/CharacterDeskPanel.vue'
import EditorRecoveryPicker from '@/components/EditorRecoveryPicker.vue'
import { useChapterSession } from './useChapterSession'
import { chapterHeading, chapterTitleForDisplay } from './chapterNumber'
import ChapterTimePanel from './ChapterTimePanel.vue'
import { deriveDeskReview } from '../selectors/reviewDesk'
import { candidatePreview } from '../selectors/candidatePreview'
import StoryCandidateEditor from '@/v3/write/StoryCandidateEditor.vue'
import EventCausalityPanel from '@/components/EventCausalityPanel.vue'
import type { CharacterMemoryAuthorDecision } from '@/types/characterMemory'
import { useChapterAi } from './useChapterAi'
import { useWritingAdvisor } from '@/composables/useWritingAdvisor'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { useNovelStore } from '@/stores/novel'
import { WORKFLOW_STEPS, chapterDot, deriveChapterPendingCanon, derivePreviousChapterPendingCanon } from '../selectors/chapterWorkflow'
import { anchorFindings, candidateAnchor, locateQuote, relocateFindings, revisionPreview, type Anchor } from './marks'
import { getApprovedPlanning } from '@/services/reconstructionPlanning'
import { resolveChapterLengthPolicy } from '@/services/chapterLength'
import { withCurrentStoryEntities } from '@/services/effectiveStory'
import type { EditorDraft } from '@/types/editorRecovery'
import type { ReviewFinding, CandidateChange } from '@/types/reconstruction'
import type { WritingAdviceSuggestion } from '@/services/writingAdvisor'
import type { SelectionRevisionMode } from '@/services/selectionRevision'
import { copyText } from '@/utils/clipboard'
import { placeSelectionToolbar } from './selectionToolbar'
import { writeCommand } from '../shell'
import { useMessage } from '../feedback'
import { MAX_STYLE_SAMPLE_LENGTH } from '@/services/sampleStyle'
import SampleStyleDialog from './SampleStyleDialog.vue'

defineOptions({ name: 'V3WriteView' })
const route = useRoute(), router = useRouter()
const novelId = computed(() => typeof route.params.novelId === 'string' ? route.params.novelId : '')
const chapterId = computed(() => typeof route.params.chapterId === 'string' ? route.params.chapterId : '')
const session = useChapterSession({ novelId, chapterId })
const editor = ref<InstanceType<typeof PlainTextEditor>>()
const ai = useChapterAi({ session, editor })
const workspace = useReconstructionWorkspaceStore(), novels = useNovelStore()
const message = useMessage()
const styleSample = ref<{ novelId: string; text: string; previousRules: string }>()
watch([novelId, chapterId], () => { styleSample.value = undefined })
const paper = ref<HTMLElement>(), editorHost = ref<HTMLElement>()
const sideOpen = ref(window.innerWidth > 800), deskOpen = ref(window.innerWidth > 1120), focused = ref(false)
const closedGroups = ref(new Set<string>()), selectedSceneId = ref(''), modeInfoOpen = ref(false)
type TypographySetting = 'fontSize' | 'paragraphSpacing' | 'letterSpacing'
const typographyKey = 'mojian-v3-writing-typography'
const defaultTypography = { fontSize: 18, paragraphSpacing: 0.9, letterSpacing: 0.03, mobilePreview: false }
function readTypography() {
  try {
    const saved = JSON.parse(localStorage.getItem(typographyKey) || 'null') as Partial<typeof defaultTypography> | null
    if (!saved) return { ...defaultTypography }
    const clamp = (value: unknown, fallback: number, min: number, max: number) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
    return { fontSize: clamp(saved.fontSize, 18, 14, 30), paragraphSpacing: clamp(saved.paragraphSpacing, 0.9, 0, 2),
      letterSpacing: clamp(saved.letterSpacing, 0.03, 0, 0.12), mobilePreview: saved.mobilePreview === true }
  } catch { return { ...defaultTypography } }
}
const typography = ref(readTypography())
const mobilePreview = computed(() => typography.value.mobilePreview)
const typographyOpen = ref(false), typographyControl = ref<HTMLElement>()
const typographyStyle = computed(() => ({ '--write-font-size': `${typography.value.fontSize}px`,
  '--write-paragraph-spacing': `${typography.value.paragraphSpacing}em`, '--write-letter-spacing': `${typography.value.letterSpacing}em` }))
function persistTypography() {
  try { localStorage.setItem(typographyKey, JSON.stringify(typography.value)) } catch { /* Keep the current session setting when storage is unavailable. */ }
}
function setTypography(key: TypographySetting, value: number) {
  typography.value = { ...typography.value, [key]: value }
  persistTypography()
}
const onboarding = useOnboardingStore()
const firstMarginFindingId = computed(() => marginItems.value.find(item => item.finding)?.id ?? null)
const firstMarginRevisionId = computed(() => marginItems.value.find(item => item.revisionId && revisionMap.value[item.revisionId])?.id ?? null)
const writeBeacons = computed(() => {
  const candidates: GuideBeaconId[] = ['write.mode', 'write.type']
  if (selectedText.value && selectionRect.value && !locked.value && !busy.value) candidates.push('write.selection')
  if (openFindings.value.length > 0) candidates.push('write.margin')
  if (Object.keys(revisionMap.value).length > 0) candidates.push('write.candidate')
  if (!locked.value && session.workflow.value?.primary && session.content.value.trim().length > 0) candidates.push('write.finalize')
  return onboarding.visibleBeaconsFor(candidates, 2)
})
function openCompletionWithGuide() {
  onboarding.markSeen('write.finalize')
  openCompletion()
}
function toggleModeInfo() {
  modeInfoOpen.value = !modeInfoOpen.value
  onboarding.markSeen('write.mode')
}
function toggleTypography() {
  typographyOpen.value = !typographyOpen.value
  onboarding.markSeen('write.type')
}
function setMobilePreview(enabled: boolean) {
  typography.value = { ...typography.value, mobilePreview: enabled }
  onboarding.markSeen('write.type')
  persistTypography()
}
function resetTypography() {
  typography.value = { ...defaultTypography }
  try { localStorage.removeItem(typographyKey) } catch { /* Keep the current session setting when storage is unavailable. */ }
}
function closeTypographyOutside(event: PointerEvent) {
  if (!typographyControl.value?.contains(event.target as Node)) typographyOpen.value = false
}
watch(typographyOpen, open => {
  if (open) document.addEventListener('pointerdown', closeTypographyOutside, true)
  else document.removeEventListener('pointerdown', closeTypographyOutside, true)
})
const selectionRect = ref<SelectionInfo['rect']>(null)
const selectionTools = ref<HTMLElement>()
const selectionToolsSize = ref({ width: 0, height: 0 })
let selectionToolsObserver: ResizeObserver | undefined
watch(selectionTools, element => {
  selectionToolsObserver?.disconnect()
  if (!element) return
  const measure = () => {
    const rect = element.getBoundingClientRect()
    selectionToolsSize.value = { width: rect.width, height: rect.height }
  }
  measure()
  selectionToolsObserver = new ResizeObserver(measure)
  selectionToolsObserver.observe(element)
}, { flush: 'post' })
onBeforeUnmount(() => {
  selectionToolsObserver?.disconnect()
  document.removeEventListener('pointerdown', closeTypographyOutside, true)
})
watch([sideOpen, deskOpen, focused], () => { selectionRect.value = null })
const completionOpen = ref(false), confirmationVersion = ref(''), completionDialog = ref<HTMLElement>()
const sealVisible = ref(false)
let completionTrigger: HTMLElement | null = null
let sealTimer: ReturnType<typeof setTimeout> | undefined
type DeskTab = 'review' | 'candidate' | 'memory' | 'character' | 'chat'
const deskTabIds: DeskTab[] = ['chat', 'character', 'memory', 'candidate', 'review']
function routeTab(): DeskTab | undefined {
  const tab = route.query.tab
  if (tab === 'advisor') return 'chat'
  return typeof tab === 'string' && (deskTabIds as string[]).includes(tab) ? tab as DeskTab : undefined
}
const activeTab = ref<DeskTab>(routeTab() || 'chat')
/** 暂存的正文修订候选：从页边收起，仍在“候选”标签中保留。仅本次打开有效。 */
const parkedRevisions = ref(new Set<string>())
/** 记住每份修订候选的生成要求，换一版时沿用。 */
const revisionInstructions = new Map<string, string>()
const decisionBusy = ref(false)
const editingCandidate = ref<CandidateChange>()
const editingDecisionVersion = ref('')
const causalityCandidateId = ref('')
const chatMounted = ref(activeTab.value === 'chat')
watch(activeTab, tab => { if (tab === 'chat') chatMounted.value = true })
const selection = ref({ start: 0, end: 0, text: '' })
const chatPrefill = ref('')
const chatPrefillVersion = ref(0)
const advisorSelection = computed(() => ({ selectionStart: selection.value.start, selectionEnd: selection.value.end }))
const advisor = useWritingAdvisor({
  currentNovel: session.novel,
  currentChapter: session.chapter,
  currentContent: session.content,
  textarea: advisorSelection,
})
const advisorSaving = ref(false)
const advisorSaveError = ref('')
const advisorError = computed(() => advisorSaveError.value || advisor.error.value)
const selectedText = computed(() => {
  const current = session.content.value.slice(selection.value.start, selection.value.end)
  return current && current === selection.value.text ? current : ''
})
const revealedEvidenceKey = ref('')
const versionOpen = ref(false)
const selectedVersionId = ref('')
const versionBusy = ref(false)
const versionOptions = computed(() => (session.chapter.value?.versions || []).slice().reverse())
const selectionActions: Array<{ mode: SelectionRevisionMode; label: string }> = [
  { mode: 'continue', label: '续写' }, { mode: 'polish', label: '润色' }, { mode: 'rewrite', label: '改写' }, { mode: 'expand', label: '扩写' }, { mode: 'shorten', label: '缩写' },
]
const severityLabel = { blocker: '阻塞', warning: '提醒', suggestion: '建议' } as const
const findingTypeLabel: Record<ReviewFinding['type'], string> = {
  continuity: '连续性', character: '角色一致性', timeline: '时间线', plot: '情节', foreshadowing: '伏笔', knowledge: '知情冲突',
  world_rule: '设定冲突', style: '叙事质量', pacing: '节奏', format: '格式',
}
const reviewFilter = ref<'all' | 'open' | 'blocker' | 'warning' | 'suggestion' | 'foreshadowing'>('all')
const selectedFindingId = ref('')
const candidateTypeLabel: Record<CandidateChange['type'], string> = { fact: '事实', state: '状态', relationship: '关系', timeline: '时间', plotline: '情节线', foreshadowing: '伏笔', knowledge: '知情', event_causality: '因果' }
const chapters = computed(() => [...(session.novel.value?.chapters || [])].sort((a, b) => a.chapterIndex - b.chapterIndex))
const chapterGroups = computed(() => {
  const volumes = [...(session.novel.value?.volumes || [])].sort((a, b) => a.volumeIndex - b.volumeIndex)
  const groups = volumes.map(volume => ({ key: volume.id, label: `卷${volume.volumeIndex + 1} · ${volume.title || '未命名'}`,
    chapters: chapters.value.filter(chapter => chapter.volumeIndex === volume.volumeIndex) }))
  const ungrouped = chapters.value.filter(chapter => !volumes.some(volume => volume.volumeIndex === chapter.volumeIndex))
  if (ungrouped.length) groups.push({ key: 'ungrouped', label: '未分卷', chapters: ungrouped })
  return groups
})
const currentGroup = computed(() => chapterGroups.value.find(group => group.chapters.some(chapter => chapter.id === chapterId.value)))
// 目录默认只展开当前章所在的卷，其余卷折叠；之后作者手动展开或折叠的状态保留，切到别的卷的章时只补展开那一卷，并把当前章滚到可见处。
const chapterTreeEl = ref<HTMLElement>()
let treeCollapsedFor = ''
const treeTouched = new Set<string>()
let treeAutoKey = ''
function revealCurrentChapterInTree() {
  void nextTick(() => chapterTreeEl.value?.querySelector<HTMLElement>('.tree-item.on')?.scrollIntoView?.({ block: 'center' }))
}
watch([novelId, () => currentGroup.value?.key, () => chapterGroups.value.length], () => {
  const current = currentGroup.value
  if (!current) return
  if (treeCollapsedFor !== novelId.value) {
    treeCollapsedFor = novelId.value
    treeTouched.clear()
    closedGroups.value = new Set(chapterGroups.value.filter(group => group.key !== current.key).map(group => group.key))
  } else {
    const next = new Set(closedGroups.value)
    next.delete(current.key)
    // 上一卷是自动展开的、作者没碰过，就随着离开自动收起；作者手动展开过的保留。
    if (treeAutoKey && treeAutoKey !== current.key && !treeTouched.has(treeAutoKey)) next.add(treeAutoKey)
    closedGroups.value = next
  }
  treeAutoKey = current.key
  revealCurrentChapterInTree()
}, { immediate: true, flush: 'post' })
const groupFinalized = computed(() => currentGroup.value?.chapters.filter(chapter => ['finalized', 'locked'].includes(chapter.status)).length || 0)
const groupProgress = computed(() => currentGroup.value?.chapters.length ? groupFinalized.value / currentGroup.value.chapters.length * 100 : 0)
const displayStatus = computed(() => ai.reviewBusy.value ? 'reviewing' : !session.saved.value && !locked.value ? 'drafting' : session.workflow.value?.status || 'idea')
const workflowIndex = computed(() => WORKFLOW_STEPS.findIndex(item => item.status === displayStatus.value))
const currentChapterDot = computed(() => displayStatus.value === 'needs_revision' ? 'revision'
  : locked.value ? 'lock' : !session.saved.value ? 'work' : displayStatus.value === 'finalized' ? 'done'
    : session.latestReview.value && !session.workflow.value?.reviewCurrent ? 'stale' : session.chapter.value ? chapterDot(session.chapter.value) : 'empty')
const wordCount = computed(() => session.content.value.replace(/\s/g, '').length)
const lengthPolicy = computed(() => resolveChapterLengthPolicy(session.novel.value?.chapterLengthPolicy))
const storyTimeLabel = computed(() => {
  const time = session.storyTime.value
  return time?.known ? `故事日 ${time.startDay}–${time.endDay}${time.label ? ' · ' + time.label : ''}` : '故事时间待确认'
})
const approvedPlanning = computed(() => session.novel.value && session.chapter.value
  ? getApprovedPlanning(workspace.getCreationDraft(novelId.value), session.chapter.value.chapterIndex, session.novel.value) : undefined)
const scenes = computed(() => approvedPlanning.value?.chapters.flatMap(plan => plan.scenes) || [])
const viewpointLabel = computed(() => [...new Set(scenes.value.map(scene => session.novel.value?.characters.find(character => character.id === scene.viewpointCharacterId)?.name).filter(Boolean))].join('、'))
const planBeats = computed(() => {
  if (approvedPlanning.value?.chapters.length) return approvedPlanning.value.chapters.flatMap(plan => [plan.objective, ...plan.requiredEvents]).filter(Boolean)
  const chapter = session.chapter.value
  return chapter ? (session.novel.value?.chapterPlans || []).filter(plan => plan.status !== 'archived'
    && plan.targetChapterStart <= chapter.chapterIndex && plan.targetChapterEnd >= chapter.chapterIndex).flatMap(plan => [plan.objective, ...plan.beats]).filter(Boolean) : []
})
const canonMutations = computed(() => workspace.getCanonMutations(novelId.value))
const chapterMutations = computed(() => canonMutations.value.filter(record => record.chapterId === chapterId.value))
const effectiveNovel = computed(() => session.novel.value && session.chapter.value ? withCurrentStoryEntities(session.novel.value, session.chapter.value.chapterIndex) : undefined)
const openPromises = computed(() => (effectiveNovel.value?.eventLog || []).filter(event => event.type === '伏笔' && event.chapterIndex >= 0
  && event.chapterIndex < (session.chapter.value?.chapterIndex ?? 0) && !['resolved', 'abandoned', 'unverified'].includes(event.status || '')))
const pendingRevisionRows = computed(() => session.pendingRevisions?.value ?? (session.pendingRevision.value ? [session.pendingRevision.value] : []))
const revisionViews = computed(() => pendingRevisionRows.value.map(row => ({ id: row.id, row,
  ...revisionPreview(row, session.content.value, session.contextVersion.value) })))
const revisionMap = computed(() => Object.fromEntries(revisionViews.value.map(item => [item.id, item])))
const selectionToolStyle = computed(() => {
  const rect = selectionRect.value
  if (!rect) return {}
  const doc = editorHost.value?.querySelector<HTMLElement>('.pte-doc')
  const column = doc?.getBoundingClientRect()
  const paddingRight = doc ? parseFloat(getComputedStyle(doc).paddingRight) || 0 : 0
  return placeSelectionToolbar(rect, {
    left: Math.max(12, column?.width ? column.left : 12),
    right: Math.min(window.innerWidth - 12, column?.width ? column.right - paddingRight : window.innerWidth - 12),
    top: 60, bottom: window.innerHeight - 38,
  }, selectionToolsSize.value)
})
const pendingCandidates = computed(() => session.candidates.value.filter(row => ['proposed', 'deferred'].includes(row.status)
  && (!row.sourceVersionId || row.sourceVersionId === session.contentVersion.value)))
// 定稿是当前版本的工作流状态，不是永久锁定。作者仍可打开定稿章节
// 做修订；保存后由工作流重新要求审校并使旧记忆失效。只有明确锁定才禁用正文。
const locked = computed(() => session.chapter.value?.status === 'locked')
const busy = computed(() => ai.reviewBusy.value || ai.selectionBusy.value || ai.completeBusy.value || session.saving.value || decisionBusy.value || versionBusy.value)
const primaryLabel = computed(() => session.workflow.value?.primary === 'finalize' ? '定稿' : session.workflow.value?.primary === 'complete' ? '完成本章' : '已定稿')
const reviewCoverage = computed(() => ai.reviewCoverage.value || session.chapter.value?.contentReviewCoverage)
const deskReview = computed(() => deriveDeskReview({ signature: session.reviewSignature.value, characters: session.content.value.length,
  coverage: reviewCoverage.value, reviewCurrent: session.workflow.value?.reviewCurrent === true,
  running: ai.reviewBusy.value, hasPreviousReview: !!session.latestReview.value || session.findings.value.length > 0 }))
function isCurrentFinding(finding: ReviewFinding) {
  return session.workflow.value?.reviewCurrent === true && finding.status !== 'stale' && finding.sourceVersionId === session.contentVersion.value
}
function isOpenFinding(finding: ReviewFinding) { return finding.status === 'open' || finding.status === 'deferred' }
const currentFindings = computed(() => session.findings.value.filter(isCurrentFinding))
const openFindings = computed(() => currentFindings.value.filter(isOpenFinding))
const anchoredFindings = computed(() => anchorFindings(session.content.value, currentFindings.value))
function findingAnchor(finding: ReviewFinding) { return anchoredFindings.value.find(item => item.finding.id === finding.id)?.anchor }
// 正文或依据改动后，上一轮仍待处理的批注按引文重新定位；记录本身不改，重审前不能标记处理。
const relocatedFindings = computed(() => relocateFindings(session.content.value,
  session.findings.value.filter(finding => finding.status !== 'stale' && !isCurrentFinding(finding))))
function relocatedAnchor(finding: ReviewFinding) { return relocatedFindings.value.find(item => item.finding.id === finding.id)?.anchor ?? null }
function anyFindingAnchor(finding: ReviewFinding) { return findingAnchor(finding) || relocatedAnchor(finding) }
interface MarginItem { id: string; start: number; finding?: ReviewFinding; stale?: boolean; candidate?: CandidateChange; revisionId?: string; number?: number }
// 页边批注与候选并排显示，不随案头标签切换。
const marginItems = computed<MarginItem[]>(() => {
  const items: MarginItem[] = []
  for (const { finding, anchor } of anchoredFindings.value) if (anchor) items.push({ id: 'f:' + finding.id, start: anchor.start, finding })
  for (const { finding, anchor } of relocatedFindings.value) if (anchor) items.push({ id: 'f:' + finding.id, start: anchor.start, finding, stale: true })
  for (const candidate of pendingCandidates.value) {
    const anchor = candidateAnchor(session.content.value, candidate)
    if (anchor) items.push({ id: 'c:' + candidate.id, start: anchor.start, candidate })
  }
  for (const item of revisionViews.value) {
    if (item.current && !parkedRevisions.value.has(item.id)) items.push({ id: 'r:' + item.id, start: item.start, revisionId: item.id })
  }
  items.sort((left, right) => left.start - right.start)
  let number = 0
  for (const item of items) if (item.finding) item.number = ++number
  return items
})
const showMargins = computed(() => !mobilePreview.value && marginItems.value.length > 0)
// 页边底部摘要：只统计页边上看得到的项，数量为 0 的不显示。
const marginSummary = computed(() => {
  const open = marginItems.value.filter(item => item.finding && !item.stale && ['open', 'deferred'].includes(item.finding.status)).length
  const stale = marginItems.value.filter(item => item.stale).length
  const slips = marginItems.value.filter(item => item.candidate || item.revisionId).length
  return [open && `${open} 条待处理`, stale && `${stale} 条待重审`, slips && `${slips} 份候选`].filter(Boolean).join(' · ')
})
const marginPositions = ref<Record<string, number>>({})
// 滚出当前屏幕的页边项：页边只有汇总文字时，用它提示方向并支持一键跳转。
const marginOff = ref<{ above: MarginItem[]; below: MarginItem[] }>({ above: [], below: [] })
const marginOffCount = computed(() => marginOff.value.above.length + marginOff.value.below.length)
function revealMargin(item?: MarginItem) {
  const target = item ?? marginOff.value.below[0] ?? marginOff.value.above[marginOff.value.above.length - 1] ?? marginItems.value[0]
  if (!target) return
  editor.value?.revealRange(target.start, target.start, { focus: false })
  scheduleMargins()
}
const marginViewport = ref({ top: 0, height: 0 })
const marginElements = new Map<string, HTMLElement>()
let marginFrame = 0, layoutObserver: ResizeObserver | undefined
function setMarginElement(id: string, value: unknown) {
  const previous = marginElements.get(id)
  if (previous === value) return
  if (previous) layoutObserver?.unobserve(previous)
  if (value instanceof HTMLElement) { marginElements.set(id, value); layoutObserver?.observe(value) }
  else marginElements.delete(id)
  scheduleMargins()
}
function scheduleMargins() {
  cancelAnimationFrame(marginFrame)
  marginFrame = requestAnimationFrame(() => {
    if (!showMargins.value) {
      marginPositions.value = {}
      marginOff.value = { above: [], below: [] }
      return
    }
    if (!paper.value || !editor.value || !editorHost.value) return
    const paperTop = paper.value.getBoundingClientRect().top
    const bounds = editorHost.value.getBoundingClientRect()
    marginViewport.value = { top: bounds.top - paperTop, height: bounds.height }
    let previousBottom = 0
    const positions: Record<string, number> = {}
    const above: MarginItem[] = [], below: MarginItem[] = []
    for (const item of marginItems.value) {
      const element = marginElements.get(item.id), coords = editor.value.coordsAtOffset(item.start)
      if (!element || !coords) continue
      if (coords.bottom < bounds.top) { above.push(item); continue }
      if (coords.top >= bounds.bottom) { below.push(item); continue }
      const top = Math.max(coords.top - bounds.top - 4, previousBottom + 10)
      positions[item.id] = top
      previousBottom = top + element.offsetHeight
    }
    marginPositions.value = positions
    marginOff.value = { above, below }
  })
}
function onEditorHostScroll() {
  selectionRect.value = null
  scheduleMargins()
}
const gateReady = computed(() => session.saved.value && session.workflow.value?.gate.every(gate => gate.state === 'ok') === true)
const canSubmitCompletion = computed(() => !!session.workflow.value?.primary && !locked.value && (session.workflow.value.primary === 'finalize' ? gateReady.value
  : session.workflow.value.length.status === 'within' && session.storyTime.value?.known === true && !revisionViews.value.length))
const visibleFindings = computed(() => session.findings.value.filter(finding => {
  if (reviewFilter.value === 'all') return true
  if (!isCurrentFinding(finding)) return false
  if (reviewFilter.value === 'open') return finding.status === 'open' || finding.status === 'deferred'
  if (reviewFilter.value === 'foreshadowing') return finding.type === 'foreshadowing'
  return finding.severity === reviewFilter.value
}))
const reviewFilters = computed(() => [
  { id: 'all' as const, label: '全部', count: session.findings.value.length },
  { id: 'open' as const, label: '待处理', count: currentFindings.value.filter(item => item.status === 'open' || item.status === 'deferred').length },
  { id: 'blocker' as const, label: '阻塞', count: currentFindings.value.filter(item => item.severity === 'blocker').length },
  { id: 'warning' as const, label: '警告', count: currentFindings.value.filter(item => item.severity === 'warning').length },
  { id: 'suggestion' as const, label: '建议', count: currentFindings.value.filter(item => item.severity === 'suggestion').length },
  { id: 'foreshadowing' as const, label: '伏笔', count: currentFindings.value.filter(item => item.type === 'foreshadowing').length },
])
const chapterBackgroundTasks = computed(() => ai.backgroundTasks.value.filter(task => task.chapterId === session.chapter.value?.id))
const backgroundTaskLabel: Record<'pending' | 'running' | 'completed' | 'failed', string> = {
  pending: '等待中', running: '进行中', completed: '已完成', failed: '失败',
}
const tabs = computed(() => [
  // 按使用时机排列：写的时候用的对话、角色与记忆在前，写完后的候选与审校在后。
  { id: 'chat' as const, label: '对话', count: 0 },
  { id: 'character' as const, label: '角色', count: 0 },
  { id: 'memory' as const, label: '记忆', count: 0 },
  { id: 'candidate' as const, label: '候选', count: pendingCandidates.value.length + revisionViews.value.length },
  { id: 'review' as const, label: '审校', count: openFindings.value.length },
])
function onTabKey(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  event.preventDefault()
  const ids = tabs.value.map(tab => tab.id)
  const next = ids[(ids.indexOf(activeTab.value) + step + ids.length) % ids.length]
  activeTab.value = next
  void nextTick(() => document.getElementById('desk-tab-' + next)?.focus())
}

watch([() => session.novel.value?.chapters, chapterId], () => {
  if (chapterId.value || !session.novel.value) return
  const first = [...session.novel.value.chapters].sort((a, b) => a.chapterIndex - b.chapterIndex)[0]
  if (first) router.replace(`/write/${novelId.value}/${first.id}`)
}, { immediate: true })
function revealRouteEvidence() {
  if (session.loading.value) { revealedEvidenceKey.value = ''; return }
  const version = typeof route.query.evidenceVersion === 'string' ? route.query.evidenceVersion : ''
  const start = Number(route.query.evidenceStart), end = Number(route.query.evidenceEnd)
  const key = `${version}:${start}:${end}:${chapterId.value}`
  if (!version) { revealedEvidenceKey.value = ''; return }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > session.content.value.length
    || version !== session.contentVersion.value || revealedEvidenceKey.value === key) return
  if (editor.value?.revealRange(start, end)) revealedEvidenceKey.value = key
}
watch([() => route.query.evidenceVersion, () => route.query.evidenceStart, () => route.query.evidenceEnd,
  () => session.loading.value, () => session.contentVersion.value, editor], revealRouteEvidence, { flush: 'post' })

// 从审校中心、书架等处跳进来时，按 ?tab=&finding= 打开对应标签并定位到那条批注。
const focusedRouteKey = ref('')
function applyRouteFocus() {
  if (session.loading.value || !session.chapter.value || !editor.value) return
  const tab = routeTab()
  const findingId = typeof route.query.finding === 'string' ? route.query.finding : ''
  const key = `${chapterId.value}:${tab || ''}:${findingId}`
  if ((!tab && !findingId) || focusedRouteKey.value === key) return
  const finding = findingId ? session.findings.value.find(item => item.id === findingId) : undefined
  if (findingId && !finding) return
  focusedRouteKey.value = key
  showDesk(finding ? 'review' : tab!)
  if (!finding) return
  selectedFindingId.value = finding.id
  if (reviewFilter.value !== 'all' && !visibleFindings.value.some(item => item.id === finding.id)) reviewFilter.value = 'all'
  void nextTick(() => {
    const anchor = anyFindingAnchor(finding)
    if (anchor) editor.value?.revealRange(anchor.start, anchor.end, { focus: false })
    scrollFindingCard(finding.id)
  })
}
function scrollFindingCard(id: string) {
  void nextTick(() => {
    for (const element of document.querySelectorAll<HTMLElement>('[data-finding]')) {
      if (element.dataset.finding === id) { element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); break }
    }
  })
}
watch([() => route.query.tab, () => route.query.finding, chapterId, () => session.loading.value, () => session.findings.value, editor],
  applyRouteFocus, { flush: 'post', immediate: true })

watch(() => session.chapter.value?.id, () => {
  activeTab.value = routeTab() || 'review'
  parkedRevisions.value = new Set()
  editingCandidate.value = undefined
  causalityCandidateId.value = ''
  versionOpen.value = false
  selectedVersionId.value = versionOptions.value[0]?.id || ''
  selection.value = { start: 0, end: 0, text: '' }
  selectionRect.value = null
  selectedSceneId.value = ''
  completionOpen.value = false
  sealVisible.value = false
  marginPositions.value = {}
  clearChatPrefill()
})
watch(() => session.findings.value, findings => {
  if (selectedFindingId.value && findings.some(item => item.id === selectedFindingId.value)) return
  selectedFindingId.value = findings.find(item => item.status === 'open')?.id || findings[0]?.id || ''
}, { immediate: true })
watch(activeTab, tab => { if (tab !== 'chat') clearChatPrefill() })
function clearChatPrefill() {
  if (!chatPrefill.value) return
  chatPrefill.value = ''
  chatPrefillVersion.value++
}
function toggleGroup(key: string) {
  treeTouched.add(key)
  const next = new Set(closedGroups.value)
  if (next.has(key)) next.delete(key); else next.add(key)
  closedGroups.value = next
}
function toggleSide() {
  sideOpen.value = focused.value || !sideOpen.value
  focused.value = false
  if (sideOpen.value && window.innerWidth <= 1120) deskOpen.value = false
}
function toggleDesk() {
  deskOpen.value = focused.value || !deskOpen.value
  focused.value = false
  if (deskOpen.value && window.innerWidth <= 1120) sideOpen.value = false
}
function showDesk(tab: typeof activeTab.value) {
  focused.value = false; deskOpen.value = true; activeTab.value = tab
  if (window.innerWidth <= 1120) sideOpen.value = false
}
function openScene(id: string) { selectedSceneId.value = id; showDesk('memory') }
async function setMode(mode: 'manual' | 'ai') {
  await runDecision(async () => { novels.setWritingMode(novelId.value, mode); await novels.saveNovelNow(novelId.value) })
}
function openAuto() { void router.push(`/auto/${novelId.value}`) }
async function addChapter() {
  await runDecision(async () => {
    if (!session.saved.value && !await session.saveNow()) return
    const chapter = novels.addChapter(novelId.value, { volumeIndex: session.chapter.value?.volumeIndex ?? -1 })
    if (!chapter) throw new Error('章节创建失败。')
    await novels.saveNovelNow(novelId.value)
    await router.push(`/write/${novelId.value}/${chapter.id}`)
  })
}
async function openChapter(id: string) {
  if (id === chapterId.value || busy.value) return
  await runDecision(async () => {
    if (!session.saved.value && !await session.saveNow()) return
    await router.push(`/write/${novelId.value}/${id}`)
  })
}
function openVersionPanel() {
  selectedVersionId.value = versionOptions.value[0]?.id || ''
  versionOpen.value = true
}
async function restoreSelectedVersion() {
  if (!selectedVersionId.value || versionBusy.value || locked.value) return
  versionBusy.value = true
  try {
    if (!session.saved.value) await session.saveNow()
    const restored = await session.restoreVersion(selectedVersionId.value)
    if (restored) selection.value = { start: 0, end: 0, text: '' }
    versionOpen.value = false
  } catch (cause) {
    session.saveError.value = errorText(cause, String(cause))
  } finally { versionBusy.value = false }
}
async function save() {
  try { await session.saveNow() } catch (cause) { session.saveError.value = errorText(cause, String(cause)) }
}
async function saveTitle() { if (!session.saved.value && !locked.value) await save() }
// 命令面板中的“本章操作”。
watch(writeCommand, command => {
  if (!command || session.loading.value || !session.chapter.value) return
  if (command.name === 'focus') focused.value = true
  else if (command.name === 'save') { if (!busy.value && !locked.value) void save() }
  else if (command.name === 'review') { if (!busy.value && !locked.value && session.content.value.trim()) void reviewChapter() }
  else if (command.name === 'completion') { if (!busy.value && session.workflow.value?.primary && !locked.value) openCompletion() }
})
function openCompletion(event?: MouseEvent) {
  confirmationVersion.value = session.reviewSourceVersion.value
  completionTrigger = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement instanceof HTMLElement ? document.activeElement : null
  selectionRect.value = null
  completionOpen.value = true
  void nextTick(() => completionDialog.value?.focus())
}
function closeCompletion() {
  if (busy.value) return
  completionOpen.value = false
  void nextTick(() => completionTrigger?.focus())
}
function onCompletionKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.stopPropagation(); closeCompletion(); return }
  if (event.key !== 'Tab') return
  const buttons = [...(completionDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]') || [])]
  const first = buttons[0], last = buttons[buttons.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === completionDialog.value)) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === completionDialog.value)) { event.preventDefault(); first?.focus() }
}
function handlePendingFromCompletion() { closeCompletion(); showDesk('candidate') }
async function primaryAction() {
  if (!canSubmitCompletion.value || confirmationVersion.value !== session.reviewSourceVersion.value) return
  let finished = false, finalized = false
  await runDecision(async () => {
    if (session.workflow.value?.primary === 'finalize') await ai.finalizeChapter()
    else if (session.workflow.value?.primary === 'complete') await ai.completeChapter()
    finished = true
    finalized = session.chapter.value?.status === 'finalized'
  })
  if (!finished) return
  closeCompletion()
  if (finalized) {
    sealVisible.value = true
    if (sealTimer) clearTimeout(sealTimer)
    sealTimer = setTimeout(() => { sealVisible.value = false }, 1800)
  } else if (pendingCandidates.value.length || revisionViews.value.length) showDesk('candidate')
}
async function reviewChapter() {
  showDesk('review')
  await runDecision(() => ai.reviewChapter())
}
watch(ai.reviewBusy, reviewing => { if (reviewing) showDesk('review') }, { immediate: true })
function onSelection(value: SelectionInfo) {
  selection.value = { start: value.start, end: value.end, text: value.text }
  selectionRect.value = value.rect
}
function openSampleStyle() {
  const source = session.novel.value
  const text = selectedText.value.trim()
  if (!source || !text) return
  if (text.length > MAX_STYLE_SAMPLE_LENGTH) {
    message.warning(`请圈选不超过 ${MAX_STYLE_SAMPLE_LENGTH} 字的样文。`)
    return
  }
  styleSample.value = { novelId: source.id, text, previousRules: source.writingStyle.sampleRules || '' }
  selectionRect.value = null
}

function finishSampleStyle() {
  styleSample.value = undefined
  message.success('已应用本书写法')
}

function marginsVisible(): boolean {
  const el = paper.value?.querySelector<HTMLElement>('.paper-margins')
  return Boolean(el && getComputedStyle(el).display !== 'none')
}

// 生成的修订候选直接出现在页边，与对应批注并排；窄屏页边隐藏时切到“候选”标签，
// 页边可见但锚点滚出视口时自动滚回可见位置并重排浮签。
async function proposeRevision(mode: SelectionRevisionMode, instruction: string, range: { start: number; end: number }) {
  const before = new Set(pendingRevisionRows.value.map(row => row.id))
  await ai.generateSelection(mode, instruction, range)
  const created = pendingRevisionRows.value.find(row => !before.has(row.id))
  if (created) revisionInstructions.set(created.id, instruction)
  await nextTick()
  if (!showMargins.value || !marginsVisible()) {
    showDesk('candidate')
    return
  }
  const view = created ? revisionMap.value[created.id] : undefined
  if (view?.current && editor.value && editorHost.value) {
    const bounds = editorHost.value.getBoundingClientRect()
    const coords = editor.value.coordsAtOffset(view.start)
    if (!coords || (bounds.height > 0 && (coords.bottom < bounds.top || coords.top >= bounds.bottom))) {
      editor.value.revealRange(view.start, view.end, { focus: false })
    }
    scheduleMargins()
  }
}
async function runSelection(mode: SelectionRevisionMode) {
  if (!selectedText.value || locked.value) return
  const range = { start: selection.value.start, end: selection.value.end }
  selectionRect.value = null
  await runDecision(() => proposeRevision(mode, '', range))
}
async function generateFindingRevision(finding: ReviewFinding) {
  const anchor = anyFindingAnchor(finding)
  if (!anchor || !isOpenFinding(finding) || locked.value) return
  await runDecision(() => proposeRevision('rewrite', [finding.title, finding.explanation, finding.suggestedFix].filter(Boolean).join('\n'), anchor))
}
/** 换一版：按原要求在同一位置重新生成，新版生成成功后才放弃旧版。 */
async function regenerateRevision(id: string) {
  const item = revisionMap.value[id]
  if (!item || locked.value) return
  const mode = item.row.selection?.mode || 'rewrite'
  const range = item.current
    ? (item.row.selection ? { start: item.row.selection.startOffset, end: item.row.selection.endOffset } : { start: item.start, end: item.end })
    : item.before ? locateQuote(session.content.value, item.before) : null
  if (!range || (mode !== 'continue' && range.end <= range.start)) {
    ai.error.value = '原文这段已经改动，找不到这份候选对应的位置。请重新选中正文再生成。'
    return
  }
  const instruction = [revisionInstructions.get(id), '请给出与上一版明显不同的写法。'].filter(Boolean).join('\n')
  await runDecision(async () => {
    await proposeRevision(mode, instruction, range)
    await session.rejectRevision(id)
    revisionInstructions.delete(id)
  })
}
function parkRevision(id: string) { parkedRevisions.value = new Set([...parkedRevisions.value, id]) }
function unparkRevision(id: string) {
  const next = new Set(parkedRevisions.value); next.delete(id); parkedRevisions.value = next
}
function openSelectionChat(kind: 'check' | 'chat') {
  if (!selectedText.value) return
  chatPrefill.value = kind === 'check'
    ? `请核对下面这段正文与当前已确认的设定、人物状态和前文是否一致。指出具体冲突并引用依据，不要改写正文。\n\n【选区】\n${selectedText.value}`
    : `请围绕下面这段正文回答我的问题，结合本章计划和前文资料给出建议，不要直接改写正文。\n\n【选区】\n${selectedText.value}\n\n我的问题：`
  chatPrefillVersion.value++
  selectionRect.value = null
  showDesk('chat')
}
function requestChatDirections(focusOverride?: string) {
  advisorSaveError.value = ''
  showDesk('chat')
  void advisor.analyze('scene', { suggestionCount: 2, focusOverride })
}
function openSelectionDirections() {
  if (!selectedText.value) return
  const focus = selectedText.value
  selectionRect.value = null
  requestChatDirections(focus)
}
async function restoreDraft(draft: EditorDraft) {
  await runDecision(async () => { await session.restoreDraft(draft); selection.value = { start: 0, end: 0, text: '' }; selectionRect.value = null })
}
async function discardDraft(draft: EditorDraft) { await runDecision(() => session.discardDraft(draft)) }
function showCandidate(id: string) {
  showDesk('candidate')
  void nextTick(() => {
    document.querySelectorAll<HTMLElement>('[data-candidate]').forEach(element => {
      if (element.dataset.candidate === id) element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  })
}
function onMarkClick(id: string) {
  const recordId = id.slice(2)
  let anchor: Anchor | null | undefined
  if (id.startsWith('f:')) {
    const finding = session.findings.value.find(item => item.id === recordId)
    if (!finding) return
    selectedFindingId.value = finding.id
    showDesk('review')
    anchor = anyFindingAnchor(finding)
    scrollFindingCard(finding.id)
  } else if (id.startsWith('c:')) {
    const candidate = session.candidates.value.find(item => item.id === recordId)
    if (candidate) anchor = candidateAnchor(session.content.value, candidate)
    showCandidate(id)
  } else if (id.startsWith('r:')) {
    const item = revisionMap.value[recordId]
    if (item?.current) anchor = item
    showCandidate(id)
  }
  if (anchor) editor.value?.revealRange(anchor.start, anchor.end, { focus: false })
  selectionRect.value = null
}
function findingTagClass(severity: ReviewFinding['severity']) {
  return severity === 'blocker' ? 'zhu' : severity === 'warning' ? 'jin' : 'dai'
}
function findingEvidence(finding: ReviewFinding) {
  return finding.quotedText || finding.evidence.find(item => item.quote)?.quote || ''
}
function previewCandidate(candidate: CandidateChange) {
  const novel = session.novel.value
  return candidatePreview(candidate, novel?.characters || [], novel?.eventLog || [])
}
async function runDecision(action: () => Promise<unknown>) {
  if (decisionBusy.value) return
  decisionBusy.value = true
  try { await action() } catch (cause) { ai.error.value = errorText(cause, String(cause)) }
  finally { decisionBusy.value = false }
}
async function resolveFinding(finding: ReviewFinding, status: 'accepted' | 'intentional' | 'deferred') { await runDecision(() => ai.resolveFinding(finding, status)) }
async function acceptCandidate(candidate: CandidateChange) { await runDecision(async () => { await ai.acceptCandidate(candidate); activeTab.value = pendingCandidates.value.length ? 'candidate' : 'memory' }) }
function editCandidate(candidate: CandidateChange) {
  editingCandidate.value = JSON.parse(JSON.stringify(candidate)); editingDecisionVersion.value = session.reviewSourceVersion.value
}
async function confirmEditedCandidate(candidate: CandidateChange, value: string, note: string, memory?: CharacterMemoryAuthorDecision) {
  await runDecision(async () => {
    await ai.acceptCandidate(candidate, value, note, memory, editingDecisionVersion.value)
    editingCandidate.value = undefined
    activeTab.value = pendingCandidates.value.length ? 'candidate' : 'memory'
  })
}
async function openCausality(candidate: CandidateChange) { if (await session.saveNow()) causalityCandidateId.value = candidate.id }
async function rejectCandidate(candidate: CandidateChange) { await runDecision(() => ai.rejectCandidate(candidate)) }
async function deferCandidate(candidate: CandidateChange) { await runDecision(() => ai.deferCandidate(candidate)) }
async function acceptRevision(id: string) {
  if (!revisionMap.value[id]?.current || locked.value) return
  await runDecision(async () => {
    if (!session.saved.value && !await session.saveNow()) return
    if (await session.acceptRevision(id)) {
      selection.value = { start: 0, end: 0, text: '' }; selectionRect.value = null
      revisionInstructions.delete(id)
      ai.statusText.value = '修订已采纳。改动处的批注待重审，其余批注仍在原处。'
    }
  })
}
async function rejectRevision(id: string) {
  await runDecision(async () => { await session.rejectRevision(id); revisionInstructions.delete(id) })
}
function clearErrors() { session.saveError.value = ''; ai.error.value = '' }

async function saveAdvisorSuggestion(action: 'plan' | 'note', suggestion: WritingAdviceSuggestion) {
  if (advisorSaving.value) return
  advisorSaveError.value = ''
  try {
    if (!session.saved.value) await session.saveNow()
    const sourceVersion = advisor.getSuggestionSourceVersion(suggestion)
    if (!sourceVersion) throw new Error('这份写作建议已过期，请重新分析后保存。')
    const n = session.novel.value, c = session.chapter.value
    if (!n || !c) throw new Error('作品或章节不存在。')
    advisorSaving.value = true
    await workspace.commitWritingSuggestion(n.id, {
      action,
      chapterId: c.id,
      sourceVersion,
      suggestion: JSON.parse(JSON.stringify(suggestion)),
    })
    session.markChanged()
    message.success(action === 'note' ? '已记入本章笔记，可在「记忆」页查看' : '已存为下一章计划')
  } catch (cause) {
    advisorSaveError.value = errorText(cause, String(cause))
  } finally {
    advisorSaving.value = false
  }
}

async function copyAdvisorSuggestion(suggestion: WritingAdviceSuggestion) {
  const text = `${suggestion.title}\n${suggestion.approach}${suggestion.nextBeat ? `\n下一拍：${suggestion.nextBeat}` : ''}`
  try {
    await copyText(text)
    message.success('已复制方向思路')
  }
  catch { advisorSaveError.value = '复制失败，请手动选择文本。' }
}
watch([marginItems, showMargins, sideOpen, deskOpen, focused, versionOpen], () => { void nextTick(scheduleMargins) }, { flush: 'post' })
watch([paper, editorHost], (elements, previous) => {
  previous?.forEach(element => { if (element) layoutObserver?.unobserve(element) })
  elements.forEach(element => { if (element) layoutObserver?.observe(element) })
  scheduleMargins()
}, { flush: 'post' })
function onWindowResize() {
  if (window.innerWidth <= 1120 && deskOpen.value) sideOpen.value = false
  selectionRect.value = null; scheduleMargins()
}
function onKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (!busy.value && !locked.value) void save()
  }
  if (event.key === 'Escape' && !completionOpen.value) { selectionRect.value = null; modeInfoOpen.value = false; focused.value = false }
}
onMounted(() => {
  layoutObserver = new ResizeObserver(scheduleMargins)
  ;[paper.value, editorHost.value, ...marginElements.values()].forEach(element => { if (element) layoutObserver?.observe(element) })
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('keydown', onKey)
  document.fonts?.addEventListener('loadingdone', scheduleMargins)
  void document.fonts?.ready.then(scheduleMargins)
  scheduleMargins()
})
onBeforeUnmount(() => {
  layoutObserver?.disconnect()
  cancelAnimationFrame(marginFrame)
  if (sealTimer) clearTimeout(sealTimer)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('keydown', onKey)
  document.fonts?.removeEventListener('loadingdone', scheduleMargins)
})

// 伏笔提醒：超期或久未推进的伏笔数量显示在状态栏，点开规划页查看
const foreshadowAlerts = computed(() => {
  const current = session.novel.value
  return current ? foreshadowReminders(current.eventLog || [], lastWrittenChapterIndex(current.chapters)) : []
})
const currentPendingCanon = computed(() => {
  const current = session.novel.value
  const ch = session.chapter.value
  return current && ch ? deriveChapterPendingCanon(current.id, ch, workspace.getCandidates(current.id), '本章') : null
})
const previousPendingCanon = computed(() => {
  const current = session.novel.value
  const ch = session.chapter.value
  return current && ch ? derivePreviousChapterPendingCanon(current, ch.id, workspace.getCandidates(current.id)) : null
})
</script>

<style scoped>
.foreshadow-chip { color: var(--zhu); text-decoration: none; font-weight: 600; }
.foreshadow-chip:hover { text-decoration: underline; }
.canon-reminder-banner { border-color: color-mix(in srgb, var(--jin) 45%, var(--line)); background: var(--jin-soft); }
.canon-reminder-banner .m-btn { margin-left: auto; flex-shrink: 0; }
.gate-canon-note { margin: 6px 0 10px; padding: 7px 10px; border-radius: 6px; background: var(--jin-soft); color: var(--ink-2); font-size: 13px; line-height: 1.5; }
.lifecycle { display: flex; align-items: center; gap: 5px; color: var(--ink-4); font-size: 12px; }.lc-step { display: inline-flex; align-items: center; gap: 5px; }.lc-step i { width: 8px; height: 8px; border: 1px solid var(--line-2); border-radius: 50%; }.lc-step > span { display: none; }.lc-step.done i { background: var(--ink-3); border-color: var(--ink-3); }.lc-step.cur { color: var(--zhu); font-weight: 600; }.lc-step.cur i { background: var(--zhu-solid); border-color: var(--zhu); box-shadow: 0 0 0 4px var(--zhu-soft); }.lc-step.cur > span { display: inline; }.lc-bar { width: 12px; height: 1px; background: var(--line-2); }
.mode-wrap { display: flex; align-items: center; position: relative; gap: 4px; }.mode-wrap .m-seg button { padding: 0 8px; }.mode-info { width: 22px; height: 26px; color: var(--ink-4); }
.mode-pop { display: none; position: absolute; z-index: 100; right: 0; top: calc(100% + 8px); width: 350px; padding: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); box-shadow: var(--shadow-3); white-space: normal; font-size: 12px; }
.mode-pop.open, .mode-wrap:has(.mode-info:hover) .mode-pop, .mode-wrap:has(.mode-info:focus-visible) .mode-pop { display: block; }.mode-pop > strong { color: var(--ink-2); font-size: 12px; }.mode-pop > div { display: grid; grid-template-columns: 35px 1fr; gap: 10px; margin-top: 12px; }.mode-pop b { font-size: 13px; }.mode-pop p { margin: 0; color: var(--ink-3); line-height: 1.65; }.mode-pop small { display: flex; gap: 6px; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--ink-3); }
.top-save { display: flex; align-items: center; gap: 6px; color: var(--ink-3); font-size: 12px; }.top-save i { width: 6px; height: 6px; border-radius: 50%; background: var(--qing); }.top-save i.warn { background: var(--jin); }.view-on { color: var(--ink-2); }.status-note { max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
.top-sep { width: 1px; height: 14px; background: var(--line-2); flex: none; }
.top-gate-status { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink-2); font-size: 12px; white-space: nowrap; transition: background .12s, border-color .12s, color .12s; }
.top-gate-status:hover:not(:disabled) { border-color: var(--line-2); color: var(--ink); background: var(--panel-2); }
.top-gate-status i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.top-gate-status i.ok { background: var(--qing); }
.top-gate-status i.warn { background: var(--zhu-solid); }
.top-gate-status i.todo { background: var(--jin); }
.top-gate-btn { height: 28px; padding: 0 10px; font-size: 12px; border-radius: 6px; gap: 5px; white-space: nowrap; }
.write-type-control { position: relative; flex: none; }
.write-type-trigger { height: 22px; padding: 0 8px; border: 1px solid var(--line-2); border-radius: 5px; background: var(--paper); color: var(--ink-2); cursor: pointer; transition: background .12s, border-color .12s, color .12s; }
.write-type-trigger:hover, .write-type-trigger[aria-expanded="true"] { border-color: color-mix(in srgb, var(--zhu) 45%, var(--line-2)); background: var(--panel-2); color: var(--ink); }
.write-type-pop { position: absolute; z-index: 120; left: 0; bottom: calc(100% + 8px); width: min(320px, calc(100vw - 86px)); max-height: calc(100vh - 64px); overflow: auto; box-sizing: border-box; padding: 12px 14px; border: 1px solid var(--line-2); border-radius: 7px; background: var(--paper); color: var(--ink); box-shadow: var(--shadow-3); white-space: normal; }
.write-type-pop > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.write-type-pop > header strong { font-size: 13px; }
.write-type-field { display: grid; grid-template-columns: 1fr auto; gap: 7px 12px; padding: 8px 0; color: var(--ink-2); font-size: 12px; }
.write-type-field output { color: var(--ink-3); font: 12px var(--f-num); }
.write-type-field input { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: var(--zhu); }
.selection-tools { position: fixed; z-index: 60; display: flex; flex-wrap: wrap; width: max-content; box-sizing: border-box; align-items: center; justify-content: center; gap: 3px; padding: 5px 8px; border-radius: 8px; background: var(--rail); color: var(--rail-hi); box-shadow: var(--shadow-3); font: 12px/1.5 var(--f-ui); }
.selection-tools > span { color: var(--rail-ink); font: 11px var(--f-num); padding: 0 6px; }.selection-tools button { padding: 6px 7px; border-radius: 4px; white-space: nowrap; }.selection-tools button:hover { background: #ffffff18; }.selection-tools button:disabled { opacity: .4; cursor: not-allowed; }.selection-tools i { height: 16px; border-left: 1px solid #ffffff30; margin: 0 3px; }
.focus-hint { position: fixed; left: 50%; bottom: 44px; transform: translateX(-50%); font-size: 13px; color: var(--ink-3); background: var(--paper); padding: 6px 12px; border-radius: 20px; box-shadow: var(--shadow-1); z-index: 30; }.is-focused .paper-margins { opacity: .4; transition: opacity .2s; }.is-focused .paper-margins:hover { opacity: 1; }
.candidate-section-title { font-size: 12px; color: var(--ink-3); margin: 18px 0 10px; }.revision-diff { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.8 var(--f-serif); max-height: 440px; overflow: auto; margin: 10px 0; }.revision-diff del { padding: 7px; background: var(--zhu-soft); margin-bottom: 8px; }.revision-diff ins { padding: 7px; }.revision-stale { color: var(--zhu) !important; font-size: 12px; line-height: 1.6; }
.context-note { margin: 0 0 18px; font-size: 13px; color: var(--ink-3); line-height: 1.7; }.context-section { margin-bottom: 20px; }.context-section h4 { font: 600 12px var(--f-ui); color: var(--ink-3); margin: 0 0 10px; letter-spacing: .06em; }.memory-person { display: flex; gap: 10px; align-items: flex-start; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); margin-bottom: 6px; }.memory-person > div { min-width: 0; }.memory-person strong { font-size: 13px; }.memory-person small { display: block; font-size: 13px; color: var(--ink-3); }.knowledge-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 5px; }.knowledge-chips span { padding: 2px 6px; font-size: 11px; background: var(--panel-2); color: var(--ink-3); border-radius: 4px; overflow-wrap: anywhere; }.knowledge-chips .knows { background: var(--qing-soft); color: var(--qing); }.knowledge-chips .suspects { background: var(--jin-soft); color: var(--jin); }.knowledge-chips .false_belief { background: var(--zi-soft); color: var(--zi); }.context-warning { font-size: 13px; color: var(--zi); }.memory-promise { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }.memory-promise i { background: var(--qing); }.memory-promise small { margin-left: auto; white-space: nowrap; color: var(--ink-4); font-size: 11px; }.memory-beat { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; margin: 8px 0; color: var(--ink-2); }.memory-beat .icon { color: var(--ink-4); margin-top: 3px; }.memory-scene { padding: 10px; margin-bottom: 6px; border: 1px solid var(--line); border-radius: 6px; font-size: 13px; background: var(--paper); }.memory-scene.on { border-color: var(--zhu); }.memory-scene p { margin: 5px 0; color: var(--ink-2); }.memory-scene small { color: var(--ink-3); }.context-isolation { display: flex; gap: 8px; padding: 10px; border: 1px dashed var(--line-2); border-radius: 8px; font-size: 13px; color: var(--ink-3); line-height: 1.65; }.memory-panel :deep(.time-box) { margin: 0 0 18px; }.m-link { color: var(--dai); text-decoration: none; font-size: 13px; }.panel-title .m-link { display: inline-flex; align-items: center; }
.completion-overlay .gate-list { padding: 0; }.completion-overlay .gate-row { grid-template-columns: 9px 110px 1fr; }.completion-changes { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 18px; }.completion-changes h4 { margin: 0 0 8px; font: 600 14px var(--f-serif); }.completion-changes p { display: flex; align-items: flex-start; gap: 7px; font-size: 12px; line-height: 1.65; }.completion-changes .m-tag { flex: none; margin-top: 1px; }.completion-note { padding: 10px; background: var(--panel); color: var(--ink-3); font-size: 12px; line-height: 1.7; }
.seal-overlay { position: fixed; inset: 0; z-index: 910; pointer-events: none; display: grid; place-content: center; justify-items: center; gap: 30px; background: color-mix(in srgb, var(--paper) 60%, transparent); }.chapter-seal { width: 172px; height: 172px; display: grid; place-items: center; border: 6px solid var(--zhu); color: var(--zhu); font: 700 54px/1 var(--f-kai); letter-spacing: .08em; writing-mode: vertical-rl; border-radius: 8px; transform: rotate(-8deg); box-shadow: inset 0 0 0 3px var(--paper), inset 0 0 0 5px var(--zhu); animation: chapter-stamp .7s var(--ease); }.seal-overlay > span { font-size: 12px; color: var(--ink-2); }@keyframes chapter-stamp { 0% { opacity: 0; transform: rotate(-18deg) scale(2.4); }65% { opacity: 1; transform: rotate(-8deg) scale(.94); }100% { transform: rotate(-8deg) scale(1); } }
.write-page { --side-w: 220px; --desk-w: 368px; position: absolute; inset: 0; display: grid; grid-template-columns: var(--side-w) minmax(0, 1fr) var(--desk-w); min-height: 0; background: var(--desk); }
.write-page.no-side { --side-w: 0px; }.write-page.no-desk { --desk-w: 0px; }
.write-main { grid-column: 2; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; padding: 28px; position: relative; }
.write-main > .editor-recovery, .write-main > .write-banner { flex: none; }
.write-main > .editor-recovery { max-height: 22%; overflow: auto; }
.write-side { min-width: 0; background: var(--panel); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.tree-side { grid-column: 1; grid-row: 1; border-right: 1px solid var(--line); }.desk-side { grid-column: 3; grid-row: 1; border-left: 1px solid var(--line); }
.side-head, .panel-title { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 14px 14px 8px 16px; }
.side-head strong { font: 600 13px var(--f-ui); color: var(--ink-2); }.panel-title strong { font: 600 14px var(--f-serif); }
.chapter-tree { flex: 1; overflow: auto; padding: 0 8px 12px; }.tree-volume { margin-top: 8px; }
.volume-head { display: flex; gap: 6px; align-items: center; width: 100%; padding: 6px 8px; color: var(--ink-3); font-size: 12px; text-align: left; border-radius: 6px; }
.volume-head span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.volume-head small { margin-left: auto; font: 11px var(--f-num); color: var(--ink-3); }.volume-head:hover { background: var(--hover); }
.tree-item { width: 100%; display: flex; align-items: center; gap: 8px; padding: 5px 8px 5px 12px; border-radius: 6px; text-align: left; color: var(--ink-2); font-size: 13px; }
.tree-item:hover { background: var(--hover); }.tree-item.on { background: var(--paper); color: var(--ink); box-shadow: var(--shadow-1); font-weight: 600; }
.tree-dot { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--line-2); }.tree-dot.empty { background: transparent; border: 1px solid var(--ink-4); }
.tree-dot.done { background: var(--qing); }.tree-dot.ok { background: var(--qing); box-shadow: inset 0 0 0 1px var(--paper); border: 1px solid var(--qing); }.tree-dot.work { background: var(--dai); }.tree-dot.lock { background: var(--ink-2); }.tree-dot.revision { background: var(--zhu-solid); }.tree-dot.stale { background: var(--zi); }
.tree-number { width: 22px; flex: none; font: 11px var(--f-num); color: var(--ink-3); }.tree-label { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.tree-item small { color: var(--ink-3); font-size: 12px; font-weight: 400; }
.tree-scenes { margin: 2px 0 6px 38px; padding-left: 10px; border-left: 1px solid var(--line-2); }.tree-scenes button { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 12px; color: var(--ink-3); text-align: left; }.tree-scenes button.on { color: var(--zhu); }.tree-empty { padding: 0 20px; color: var(--ink-4); font-size: 12px; }
.tree-foot { padding: 12px 16px; border-top: 1px solid var(--line); display: grid; gap: 7px; color: var(--ink-3); font-size: 12px; }.tree-progress { display: flex; justify-content: space-between; gap: 8px; }.tree-progress .m-num { white-space: nowrap; }.tree-legend { display: flex; gap: 7px 10px; flex-wrap: wrap; font-size: 12px; }.tree-legend span { display: flex; align-items: center; gap: 5px; }.tree-foot a { display: flex; align-items: center; font-size: 12px; }
.write-banner { max-width: 840px; margin: 0 auto 14px; display: flex; gap: 10px; align-items: flex-start; padding: 9px 14px; border-radius: 8px; background: var(--dai-soft); color: var(--dai); font-size: 12px; }.write-banner .icon { margin-top: 3px; }.finalized-banner { background: var(--qing-soft); color: var(--qing); }
.paper { --paper-inset: 48px; --margin-w: 198px; flex: 1 1 0; min-height: 0; width: 100%; max-width: 840px; margin: 0 auto; display: flex; flex-direction: column; background: var(--paper); border-radius: 4px; box-shadow: var(--shadow-2); padding: 56px var(--margin-w) 64px var(--paper-inset); position: relative; transition: max-width .18s ease, padding .18s ease, border-radius .18s ease; }
.paper.mobile-preview { --paper-inset: 20px; --margin-w: 0px; max-width: 430px; padding: 28px 20px 48px; border-radius: 22px; }
.paper.mobile-preview::after { inset: 7px; border-radius: 16px; }
.paper.mobile-preview .chapter-title { font-size: 22px; }
.mobile-preview-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 16px; padding: 6px 10px; border: 1px dashed var(--line-2); border-radius: 8px; background: var(--panel); color: var(--ink-3); font-size: 12px; }
.write-type-toggle { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 12px; color: var(--ink-2); cursor: pointer; }
.write-type-trigger.on { border-color: var(--zhu); color: var(--zhu); background: var(--zhu-soft); }
.paper:not(.with-margins) { padding-right: var(--paper-inset); }
.paper:not(.with-margins) :deep(.pte-doc) { padding-right: 0; }
.paper.with-margins::before { content: ''; position: absolute; top: 150px; bottom: 40px; right: var(--margin-w); border-left: 1px dashed var(--line-2); }
.paper::after { content: ''; position: absolute; inset: 10px; border: 1px solid var(--line); border-radius: 2px; pointer-events: none; opacity: .55; }
.paper-head { position: relative; flex: none; margin-bottom: 32px; }.paper-kicker { color: var(--zhu); font: 500 13px/1 var(--f-serif); letter-spacing: .35em; margin-bottom: 12px; }
.chapter-title { width: 100%; border: 0; outline: 0; background: transparent; color: var(--ink); font: 600 30px/1.3 var(--f-serif); letter-spacing: .06em; padding: 0; }
.paper-meta { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--ink-3); font-size: 13px; margin-top: 14px; }.paper-meta span { display: flex; align-items: center; gap: 5px; }.paper-meta .m-link { font-size: 13px; }
.paper-mnote { position: absolute; left: calc(100% + 16px); bottom: 4px; width: calc(var(--margin-w) - 32px); font: 14px/1.4 var(--f-kai); color: var(--ink-3); text-align: left; background: none; border: 0; padding: 0; cursor: pointer; }.paper-mnote:hover { color: var(--zhu); }.paper-mnote-go { color: var(--zhu); }
.margin-edge { position: absolute; left: 16px; right: 12px; z-index: 2; pointer-events: auto; font: 13px/1.4 var(--f-ui); color: var(--zhu); background: var(--paper); border: 1px dashed var(--line-2); border-radius: 12px; padding: 3px 10px; text-align: center; cursor: pointer; }.margin-edge:hover { background: var(--hover); }.margin-edge.top { top: 4px; }.margin-edge.bottom { bottom: 4px; }
.paper-margins { position: absolute; right: 0; width: var(--margin-w); overflow: hidden; pointer-events: none; }.margin-item { position: absolute; width: 100%; padding: 4px 16px 0; pointer-events: auto; }
.margin-note { display: block; font: 15px/1.55 var(--f-kai); color: var(--zhu); text-align: left; position: relative; overflow-wrap: anywhere; }
.margin-note::before { content: ''; position: absolute; left: -16px; top: 10px; width: 12px; height: 1px; background: currentColor; opacity: .5; }.margin-note b { display: inline-grid; place-items: center; width: 16px; height: 16px; font: 600 10px/1 var(--f-num); border: 1px solid currentColor; border-radius: 50%; margin-right: 5px; vertical-align: 2px; }.margin-note span { display: block; font: 12px/1.4 var(--f-ui); color: var(--ink-3); margin-top: 3px; }
.margin-note.warning { color: var(--jin); }.margin-note.suggestion { color: var(--dai); }.margin-note.foreshadowing { color: var(--qing); }.margin-note.done { color: var(--ink-4); }.margin-note.done > b { opacity: .6; }.margin-note:hover { transform: translateX(2px); }
.margin-slip { background: var(--slip); border: 1px solid var(--slip-line); border-radius: 3px; padding: 11px 10px 9px; box-shadow: 0 6px 16px #3a2a0a1c; transform: rotate(-.6deg); position: relative; }
.margin-slip::before { content: ''; position: absolute; top: -5px; left: 50%; width: 10px; height: 10px; border-radius: 50%; background: var(--zhu-solid); box-shadow: 0 2px 3px #0003; }
.slip-head { display: flex; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--ink-3); margin-bottom: 6px; }.slip-head span:last-child { color: var(--jin); white-space: nowrap; }
.slip-body { max-height: 220px; overflow: auto; font: 14px/1.75 var(--f-serif); white-space: pre-wrap; overflow-wrap: anywhere; }.slip-body del, .revision-diff del { display: block; color: var(--zhu); opacity: .8; }.slip-body ins, .revision-diff ins { display: block; text-decoration: none; background: var(--qing-soft); color: var(--qing); }
.slip-story { font: 14px/1.6 var(--f-serif); margin: 0 0 5px; }.slip-detail { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 140px; overflow: auto; font-size: 12px; color: var(--ink-2); margin: 0 0 8px; }.slip-acts { display: flex; gap: 4px; margin-top: 9px; flex-wrap: wrap; }.slip-acts .m-btn { height: 24px; padding: 0 6px; font-size: 12px; }
.version-panel { flex: none; margin: -8px 24px 20px 0; padding: 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel-2); }.version-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.version-panel p { margin: 5px 0 10px; }.version-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }.version-select { min-width: 0; width: 100%; padding: 6px 8px; border: 1px solid var(--line-2); border-radius: 5px; background: var(--paper); color: var(--ink); }
.editor-host { flex: 1 1 0; min-height: 0; overflow: hidden; }
.gate-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }.gate-stats > div { padding: 10px 8px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); }.gate-stats b { display: block; font: 600 20px/1.2 var(--f-num); }.gate-stats span { font-size: 12px; color: var(--ink-3); }.gate-stats .bad b { color: var(--zhu); }.gate-detail { margin: 0 0 10px; font-size: 12px; line-height: 1.6; color: var(--ink-3); }
.desk-tabs { display: flex; border-bottom: 1px solid var(--line); overflow-x: auto; }.desk-tabs button { flex: 1; min-width: 54px; padding: 14px 6px 11px; font-size: 12px; color: var(--ink-3); border-bottom: 2px solid transparent; white-space: nowrap; }.desk-tabs button.on { color: var(--zhu); border-bottom-color: var(--zhu); }.desk-tabs b { margin-left: 3px; font-size: 11px; }
.desk-panel { flex: 1; overflow: auto; }.desk-empty { padding: 20px 16px; line-height: 1.7; }.finding, .candidate { padding: 14px 16px; border-bottom: 1px solid var(--line); cursor: pointer; }.finding:hover, .candidate:hover { background: var(--panel-2); }.finding-head { display: flex; align-items: flex-start; gap: 7px; font-size: 12.5px; line-height: 1.5; }.finding p, .candidate p { margin: 8px 0 0; font-size: 12px; line-height: 1.65; color: var(--ink-3); }.finding.accepted, .finding.intentional { opacity: .6; }.finding-actions { display: flex; gap: 5px; margin-top: 9px; flex-wrap: wrap; }.quote { padding-left: 9px; border-left: 2px solid var(--zhu-mid); color: var(--ink-2) !important; }.review-report { margin: 12px 16px; padding: 10px; background: var(--panel-2); white-space: pre-wrap; font-size: 12px; line-height: 1.6; max-height: 260px; overflow: auto; }
.desk-panel.chat-panel { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
.chat-host { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.memory-plan-links { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.memory-note-body { white-space: pre-wrap; word-break: break-word; }
.zhu-soft-btn { border-color: color-mix(in srgb, var(--zhu) 45%, var(--line)); background: var(--zhu-soft); color: var(--zhu); font-weight: 600; }
.coverage { position: relative; margin: 12px 16px; height: 7px; border-radius: 5px; background: var(--panel-2); overflow: hidden; }.coverage span { display: block; height: 100%; background: var(--zhu-solid); }.coverage small { display: block; margin-top: 7px; color: var(--ink-4); font-size: 11px; }
.background-checks, .banned-report { margin: 12px 16px; padding: 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel-2); font-size: 12px; }
.background-checks > strong, .banned-report > strong { display: block; margin-bottom: 7px; }
.background-task { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; padding: 5px 0; border-top: 1px solid var(--line); }
.background-task small { grid-column: 1 / -1; color: var(--zhu); line-height: 1.5; }
.banned-report pre { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; line-height: 1.6; }
.gate-list { padding: 8px 16px; }.gate-row { display: grid; grid-template-columns: 9px 1fr auto; gap: 7px; align-items: baseline; padding: 9px 0; border-bottom: 1px dashed var(--line); font-size: 12px; }.gate-row i { width: 8px; height: 8px; border-radius: 50%; background: var(--line-2); }.gate-row i.ok { background: var(--qing); }.gate-row i.block { background: var(--zhu-solid); }.gate-row i.todo { background: var(--jin); }.gate-row small { color: var(--ink-4); text-align: right; }.time-box { margin: 10px 16px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 12px; }.time-box p { margin: 7px 0; color: var(--ink-3); line-height: 1.6; }.time-form { display: flex; gap: 7px; }.time-form input { width: 90px; border: 1px solid var(--line-2); border-radius: 5px; padding: 5px 7px; background: var(--paper); color: var(--ink); }.revision-note { margin: 10px 16px; padding: 10px; background: var(--zhu-soft); color: var(--ink-2); font-size: 12px; line-height: 1.6; }
.desk-tabs { gap: 2px; padding: 10px 12px 0; background: var(--panel); }
.desk-tabs button { height: 34px; padding: 0 10px; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-bottom-width: 2px; margin-bottom: -1px; }
.desk-tabs button.on { font-weight: 600; }
.desk-tabs b { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--zhu-solid); color: #fff; font: 600 10px/16px var(--f-num); }
.desk-panel { padding: 14px; }
.desk-panel > .panel-title { margin: -14px -14px 14px; padding: 12px 14px; }
.review-summary { padding: 14px; margin-bottom: 12px; border-radius: var(--r-m); background: var(--paper); border: 1px solid var(--line); }
.review-summary-head, .review-summary-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.review-summary-head strong { font: 600 14px var(--f-serif); letter-spacing: .03em; }
.review-summary-meta { margin-top: 6px; font-size: 13px; }
.coverage-bars { display: flex; gap: 3px; margin: 9px 0 7px; }
.coverage-bars i { flex: 1; height: 6px; border-radius: 2px; background: var(--qing); }
.coverage-bars i.off { background: var(--line-2); }
.review-summary-foot { font-size: 13px; line-height: 1.45; }
.review-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.review-filters .m-chip { height: 26px; }
.finding, .candidate { padding: 12px 13px; margin-bottom: 10px; border: 1px solid var(--line); border-left: 3px solid var(--line-2); border-radius: 8px; background: var(--paper); box-shadow: none; }
.finding.blocker { border-left-color: var(--zhu); }.finding.warning { border-left-color: var(--jin); }.finding.suggestion { border-left-color: var(--dai); }
.finding.foreshadowing { border-left-color: var(--qing); }.finding.foreshadowing .finding-type { color: var(--qing); font-weight: 600; }
.finding:hover, .candidate:hover { background: var(--paper); box-shadow: var(--shadow-1); }
.finding.on { box-shadow: 0 0 0 2px var(--zhu-mid), var(--shadow-1); }
.finding:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
.finding.previous { border-left-style: dashed; }.finding.previous .finding-title, .finding.previous .finding-quote { opacity: .72; }
.finding-stale { display: block; margin: -2px 0 4px; color: var(--zi); font-size: 12px; }
.finding-hint { align-self: center; color: var(--ink-4); font-size: 13px; }
.margin-note.stale { opacity: .55; }.margin-note.stale:hover, .margin-note.stale.on { opacity: 1; }.margin-note.on > b { background: currentColor; color: var(--paper); }
.finding-head { align-items: center; font-size: 12px; color: var(--ink-3); }
.finding-type { white-space: nowrap; }.finding-loc { margin-left: auto; color: var(--ink-4); font-size: 11px; }
.finding-title { display: block; margin: 7px 0 6px; font-size: 13.5px; line-height: 1.5; }
.finding-quote { margin: 6px 0 8px !important; padding: 6px 10px; border-left: 2px solid var(--zhu-mid); background: var(--panel); border-radius: 0 4px 4px 0; color: var(--ink-2) !important; font: 13px/1.7 var(--f-serif) !important; }
.finding-detail p { margin: 6px 0 8px; font-size: 13px; line-height: 1.6; }
.finding-suggestion { margin: 8px 0; padding: 8px 10px; border-radius: 6px; background: var(--dai-soft); color: var(--ink-2); font-size: 12px; line-height: 1.55; }
.finding-actions { gap: 6px; margin-top: 9px; }
.review-report { margin: 12px 0 0; }
.desk-empty { padding: 28px 8px; }
.candidate { border-left-color: var(--jin); }
.candidate-preview { white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink-2); font: 12px/1.65 var(--f-ui); }
.candidate .finding-title { font-size: 13px; }
.candidate .quote { margin: 6px 0 8px !important; padding: 6px 10px; background: var(--panel); border-left-color: var(--zhu-mid); border-radius: 0 4px 4px 0; font: 13px/1.7 var(--f-serif); }
.write-loading, .write-error { padding: 60px; color: var(--ink-2); }.write-error { color: var(--zhu); }.write-toast { position: fixed; right: 24px; bottom: 52px; z-index: 30; display: flex; align-items: center; gap: 10px; max-width: 520px; padding: 10px 14px; background: var(--rail); color: var(--rail-hi); border-radius: 8px; box-shadow: var(--shadow-3); font-size: 12.5px; }
@media (min-width: 1600px) { .write-page { --side-w: 248px; --desk-w: 410px; }.write-page.no-side { --side-w: 0px; }.write-page.no-desk { --desk-w: 0px; }.paper { --paper-inset: 64px; --margin-w: 214px; padding-left: 64px; } }
@media (max-width: 1120px) { .write-page { --desk-w: 340px; }.write-page.no-desk { --desk-w: 0px; }.top-save { font-size: 0; gap: 0; }.top-save i { margin: 0; }.top-gate-status { display: none; }.crumb-volume { display: none; } }
@media (min-width: 801px) and (max-width: 1000px) { .write-page:not(.no-desk) .paper { --margin-w: 0px; }.write-page:not(.no-desk) .paper::before, .write-page:not(.no-desk) .paper-mnote, .write-page:not(.no-desk) .paper-margins { display: none; }.write-page:not(.no-desk) .paper :deep(.pte-doc) { padding-right: 0; } }
@media (max-width: 800px) { .write-page { --side-w: 0px; --desk-w: 0px; }.desk-side { grid-area: auto; position: absolute; z-index: 25; right: 0; top: 0; bottom: 0; width: min(390px, 88%); box-shadow: var(--shadow-3); }.tree-side { grid-area: auto; position: absolute; z-index: 26; left: 0; top: 0; bottom: 0; width: 235px; box-shadow: var(--shadow-3); }.write-main { padding: 18px 16px 24px; }.paper { --paper-inset: 32px; --margin-w: 170px; padding-left: 32px; padding-top: 40px; }.paper-meta { gap: 5px 8px; }.chapter-title { font-size: 26px; }.gate-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }.lifecycle { gap: 3px; }.lc-bar { width: 6px; } }
@media (max-width: 600px) { .paper { --paper-inset: 24px; --margin-w: 0px; padding: 30px 24px 40px; min-height: 0 !important; }.paper::before, .paper-mnote, .paper-margins { display: none; }.write-main { padding: 12px 10px 20px; }.paper :deep(.pte-doc) { padding-right: 0; }.top-save { display: none; }.top-sep, .top-review-btn { display: none; }.mode-info { display: none; }.selection-tools { flex-wrap: wrap; height: auto; padding: 6px; }.selection-tools span { display: none; }.completion-overlay .m-modal-f { flex-wrap: wrap; }.completion-overlay .m-modal-f .l { width: 100%; } }
@media (prefers-reduced-motion: reduce) { .chapter-seal { animation: none; }.margin-note:hover { transform: none; } }
</style>
