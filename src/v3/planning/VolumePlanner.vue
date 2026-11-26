<template>
  <div class="volume-page fade-in" id="volume-outline-page">
    <!-- 页头：左侧标题副标题，右侧三枚资料抽屉入口（与原型 1:1） -->
    <header class="page-head">
      <div>
        <h2 class="page-title">分卷大纲</h2>
        <p class="page-sub">{{ pageSubtitle }}</p>
      </div>
      <div class="head-links" v-if="novel">
        <button type="button" class="pbtn sm ghost" @click="openDrawer('contract')">
          <V3Icon name="file" size="s" />
          <span>作品契约</span>
          <span class="ptag" :class="contractApproved ? 'qing' : 'line'">{{ contractApproved ? '已确认' : '待确认' }}</span>
        </button>
        <button type="button" class="pbtn sm ghost" @click="openDrawer('direction')">
          <V3Icon name="flag" size="s" />
          <span>正式方向</span>
          <span class="ptag official">{{ officialDirection.seal }}</span>
        </button>
        <button type="button" class="pbtn sm ghost" @click="openDrawer('records')">
          <V3Icon name="history" size="s" />
          <span>版本<span class="lbl-long">与生成</span>记录</span>
          <span class="pbadge">{{ recordEntries.length }}</span>
        </button>
        <button v-if="!props.compact && volumes.length" type="button" class="pbtn sm pri"
          :disabled="busy || props.chapterPlanConfirmed || hasDrafts" @click="emit('confirmed')">
          {{ props.chapterPlanConfirmed ? '已确认并生成章节计划' : '确认分卷并生成章节计划' }}
        </button>
      </div>
    </header>

    <!-- 顶部全书结构条：按契约篇幅定标的真实比例尺 + 契约绿区 + 已落卷节点行 + 刻度尺 -->
    <section v-if="displayedVolumes.length" class="overview" aria-label="全书结构">
      <div class="ov-head">
        <b>全书结构</b>
        <span>{{ generating ? '已规划 ' : '' }}{{ doneVolumeCount }} 卷 · {{ formatCount(displayedTotalChapters) }} 章 · 约 {{ formatWan(displayedTotalWords) }} 万字</span>
        <span v-if="lengthRangeBadge" class="len-chip" :class="{ warn: lengthRangeBadge.warn }">
          <V3Icon :name="lengthRangeBadge.warn ? 'alert' : 'check'" size="s" />
          {{ lengthRangeBadge.text }}
        </span>
        <template v-if="!generating && unassignedBeats.length">
          <button v-if="unassignedBeats.length > 2" type="button" class="miss-chip" :disabled="busy"
            :title="`未落卷：${unassignedBeats.map(b => b.title).join('、')}。点一下，选中最合适的一卷去放这个节点`"
            @click="focusSuggestedVolumeForBeat(unassignedBeats[0].id)">
            <V3Icon name="alert" size="s" />
            <span>{{ unassignedBeats.length }} 个骨架节点未落卷</span>
          </button>
          <template v-else>
            <button v-for="beat in unassignedBeats" :key="beat.id" type="button" class="miss-chip" :disabled="busy"
              title="点一下，选中最合适的一卷去放这个节点" @click="focusSuggestedVolumeForBeat(beat.id)">
              <span class="pnum" :style="{ background: beatKindInfo(beat.kind).color }">{{ beatOrdinal(beat.id) }}</span>
              <span>未落卷：{{ beat.title }}</span>
            </button>
          </template>
        </template>
        <span class="sp"></span>
        <span class="hint">宽度按每卷字数</span>
        <button v-if="!generating && novel?.outline" type="button" class="pbtn sm"
          :disabled="busy || hasDrafts" @click="generateVolumes">
          <V3Icon name="spark" size="s" />AI 重新规划全部
        </button>
      </div>

      <div class="ov-body">
        <div v-if="contractRange" class="ov-zone"
          :style="{ left: pctOfScale(contractRange[0]), width: pctOfScale(Math.max(1, contractRange[1] - contractRange[0])) }">
          <span>契约 {{ formatWan(contractRange[0]) }}–{{ formatWan(contractRange[1]) }} 万字</span>
        </div>

        <div class="ov-bar" :style="{ width: pctOfScale(barTotalWan) }" role="group" aria-label="分卷字数比例">
          <button v-for="(vol, idx) in displayedVolumes" :key="vol.id" type="button" class="ov-seg"
            :class="{ sel: displayedSelectedId === vol.id, editing: !generating && editingId === vol.id, pending: vol._pending }"
            :style="{ flexGrow: segGrow(vol) }"
            :disabled="vol._pending && !vol.title"
            :aria-pressed="displayedSelectedId === vol.id"
            :title="segTooltip(vol, idx)"
            @click="selectDisplayedVolume(vol, idx)">
            <span class="seal sm">{{ cnNum(idx + 1) }}</span>
            <span class="nm">
              <span v-if="vol._pending && !vol.title" class="ph" style="width: 68px; margin: 0"></span>
              <template v-else>
                <b>{{ displayVolumeName(vol) }}</b>
                <small>{{ vol._pending ? '规划中…' : `${vol.estimatedChapters || 0} 章 · ${formatWan(vol.estimatedWordCount || 0)} 万` }}</small>
              </template>
            </span>
            <span v-if="!generating && volumeCoverageRatio(vol) > 0" class="cov"
              :style="{ width: `${Math.min(100, Math.round(volumeCoverageRatio(vol) * 100))}%` }"
              :title="`章纲已排 ${Math.round(volumeCoverageRatio(vol) * 100)}%`"></span>
          </button>
        </div>

        <div v-if="skeletonBeats.length" class="ov-beats" :style="{ width: pctOfScale(barTotalWan) }">
          <div v-for="(vol, idx) in displayedVolumes" :key="vol.id" :style="{ flexGrow: segGrow(vol) }">
            <button v-for="beat in beatsInVolume(vol)" :key="beat.id" type="button" class="ov-beat"
              :title="`${beatKindInfo(beat.kind).label}：${beat.description || beat.title}`"
              @click="selectDisplayedVolume(vol, idx)">
              <span class="pnum" :style="{ background: beatKindInfo(beat.kind).color }">{{ beatOrdinal(beat.id) }}</span>
              <span>{{ beat.title }}</span>
            </button>
          </div>
        </div>

        <div class="ov-ruler" aria-hidden="true">
          <span v-for="(tick, tIdx) in rulerTicks" :key="tick" :style="{ left: pctOfScale(tick) }">
            {{ tick }}{{ tIdx === rulerTicks.length - 1 ? ' 万字' : '' }}
          </span>
          <i v-if="contractRange" :style="{ left: pctOfScale(contractRange[0]), width: pctOfScale(Math.max(1, contractRange[1] - contractRange[0])) }"
            title="契约篇幅范围"></i>
        </div>
      </div>
    </section>

    <!-- 主内容舞台 -->
    <div class="stage">
      <!-- 无总大纲 -->
      <div v-if="novel && !novel.outline" class="start">
        <div class="start-inner">
          <img class="m-art empty-art" :src="outlineArt" alt="">
          <h3>请先生成总大纲</h3>
          <p>分卷规划需要基于总大纲生成。</p>
          <button type="button" class="pbtn zhu" @click="$router.push(`/outline/${novelId}`)">前往大纲页</button>
        </div>
      </div>

      <!-- 空白起步三选一（与原型 1:1） -->
      <div v-else-if="!displayedVolumes.length && !generating" class="start">
        <div class="start-inner">
          <h3>还没有分卷规划</h3>
          <p>大纲已经确认。选一种方式把全书分成几卷，之后都能在这里调整。</p>
          <div class="choices3">
            <button type="button" class="choice recommended" :disabled="busy" @click="generateVolumes">
              <strong><V3Icon name="spark" size="s" />AI 按大纲规划分卷</strong>
              <span>按大纲和契约篇幅<template v-if="contractRange">（{{ formatWan(contractRange[0]) }}–{{ formatWan(contractRange[1]) }} 万字）</template>规划每卷的目标、冲突、转折和章数。</span>
              <span class="ptag zhu">推荐</span>
            </button>
            <button type="button" class="choice" :disabled="busy || !outlineVolumeSuggestions.length" @click="importOutlineVolumes">
              <strong><V3Icon name="file" size="s" />用大纲里的分卷建议</strong>
              <span>{{ outlineVolumeSuggestions.length ? `直接导入大纲「分卷建议」里的 ${outlineVolumeSuggestions.length} 卷，不调用模型。` : '当前大纲中未识别到现成的「分卷建议」条目。' }}</span>
            </button>
            <button type="button" class="choice" :disabled="busy" @click="addManualVolume">
              <strong><V3Icon name="plus" size="s" />手动新增一卷</strong>
              <span>自己一卷一卷地写，不需要模型。</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 主区：可选顶部卷号错位横幅 + 左分卷列表面板 + 右本卷详情面板 -->
      <div v-else class="sgrid">
        <div v-if="!generating && ordinalMismatches.length" class="banner" role="alert">
          <span class="mark">!</span>
          <p>
            <b>卷名里的序号和实际顺序对不上。</b>
            排第 {{ ordinalMismatches[0].expectedVolumeNumber }} 的卷，卷名写着「第{{ cnNum(ordinalMismatches[0].sourceVolumeNumber) }}卷」<template v-if="ordinalMismatches.length > 1">，一共 {{ ordinalMismatches.length }} 卷对不上</template>。<template v-if="ordinalMismatches[0].expectedVolumeNumber === 1 && ordinalMismatches[0].sourceVolumeNumber === 2">可能漏掉了第一卷。</template>卷号现在按实际顺序显示。
          </p>
          <button v-if="ordinalMismatches[0].expectedVolumeNumber === 1 && ordinalMismatches[0].sourceVolumeNumber === 2"
            type="button" class="pbtn sm zhu-line" :disabled="busy" @click="prependMissingVolume">
            <V3Icon name="plus" size="s" />在最前面补一卷
          </button>
          <button type="button" class="pbtn sm" :disabled="busy" @click="stripVolumeOrdinals">去掉卷名里的序号</button>
        </div>

        <!-- 左栏：独立白底分卷列表面板 -->
        <section class="panel vlist" aria-label="分卷列表">
          <div class="vlist-head">
            <h3>分卷</h3>
            <span class="ptag line">{{ displayedVolumes.length }} 卷</span>
            <span class="sp"></span>
            <small>点一卷看详情</small>
          </div>
          <div class="vlist-body">
            <button
              v-for="(vol, idx) in displayedVolumes"
              :key="vol.id"
              type="button"
              class="vrow volc"
              :class="{ sel: displayedSelectedId === vol.id, cur: displayedSelectedId === vol.id, editing: !generating && editingId === vol.id, pending: vol._pending }"
              :aria-pressed="displayedSelectedId === vol.id"
              :aria-label="`选择第${idx + 1}卷 ${displayVolumeName(vol)}`"
              :disabled="saving || !!regeneratingId || (vol._pending && !vol.title)"
              @click="selectDisplayedVolume(vol, idx)"
            >
              <span class="seal">{{ cnNum(idx + 1) }}</span>
              <template v-if="vol._pending && !vol.title">
                <div class="vrow-ph">
                  <div class="ph" style="width: 60%"></div>
                  <div class="ph" style="width: 90%"></div>
                </div>
              </template>
              <template v-else>
                <span class="t">
                  <b>{{ displayVolumeName(vol) }}</b>
                  <small>{{ vol._pending ? '…' : `${vol.estimatedChapters || 0} 章` }}</small>
                </span>
                <span class="g">{{ volumeGoalBrief(vol) }}</span>
                <span class="chips">
                  <span v-if="vol._pending" class="ptag jin">规划中</span>
                  <span v-else-if="idx === 0" class="ptag zhu">当前卷</span>
                  <span v-else-if="plansForVolume(vol).length" class="ptag dai">已展开章纲</span>
                  <span v-else class="ptag line">轮廓</span>
                  <span v-for="beat in beatsInVolume(vol)" :key="beat.id" class="bk" :title="beat.title">
                    <i :style="{ background: beatKindInfo(beat.kind).color }"></i>{{ beatKindInfo(beat.kind).label }}
                  </span>
                  <span v-if="!generating && plansForVolume(vol).length" class="ptag line">章纲 {{ plansForVolume(vol).length }}</span>
                  <span v-if="!generating && suggestionsForVolume(vol.id).length" class="ptag sug">待确认 {{ suggestionsForVolume(vol.id).length }}</span>
                  <span v-if="!generating && hasAnyChapters && chapterNumbers(vol).length" class="ptag line">正文 {{ chapterNumbers(vol).length }} 章</span>
                  <span v-if="!generating && vol.sourceVolumeNumber && vol.sourceVolumeNumber !== idx + 1" class="ptag bad">卷名写着第{{ cnNum(vol.sourceVolumeNumber) }}卷</span>
                  <span v-if="!generating && (editingId === vol.id || volumeDrafts.has(vol.id))" class="ptag jin vol-unsaved">未保存</span>
                </span>
              </template>
            </button>
          </div>
          <div class="vlist-foot">
            <button type="button" class="pbtn sm" :disabled="busy" @click="addManualVolume">
              <V3Icon name="plus" size="s" />新增一卷
            </button>
          </div>
        </section>

        <!-- 右栏：本卷详情面板 -->
        <section class="panel vdetail volume-detail-panel"
          :class="{ editing: !generating && !!editingId && editingId === displayedSelectedVolume?.id }"
          aria-label="本卷详情">
          <div v-if="!displayedSelectedVolume" class="vd-empty">
            {{ generating ? 'AI 正在规划第一卷…' : '选左边的一卷查看详情' }}
          </div>

          <!-- 局部重写加载态 -->
          <template v-else-if="!generating && regeneratingId === displayedSelectedVolume.id">
            <header class="vd-head">
              <span class="seal big">{{ cnNum(displayedSelectedIndex + 1) }}</span>
              <div class="vd-title">
                <h3>第 {{ displayedSelectedIndex + 1 }} 卷 · 《{{ displayVolumeName(displayedSelectedVolume) }}》</h3>
                <div class="vd-meta">
                  <span class="cursor">▌</span>
                  <span>AI 正在重写本卷，旧版本会保留</span>
                </div>
              </div>
            </header>
            <div class="vd-body">
              <div class="ph" style="width: 92%"></div>
              <div class="ph" style="width: 74%"></div>
              <div class="ph" style="width: 56%"></div>
              <div class="ph" style="width: 84%"></div>
            </div>
          </template>

          <template v-else>
            <!-- 详情头部：大号方印 + 卷名/元信息 + 右上角操作区 -->
            <header class="vd-head">
              <span class="seal big">{{ cnNum(displayedSelectedIndex + 1) }}</span>
              <div class="vd-title">
                <div v-if="isEditingSelected" class="name-row">
                  <span>第 {{ displayedSelectedIndex + 1 }} 卷 ·</span>
                  <input v-model="editForm.title" placeholder="卷名" aria-label="卷名" :disabled="saving" />
                </div>
                <div v-else-if="displayedSelectedVolume._pending && !displayedSelectedVolume.title"
                  class="ph" style="width: 220px; height: 20px; margin: 2px 0 4px"></div>
                <h3 v-else>第 {{ displayedSelectedIndex + 1 }} 卷 · 《{{ displayVolumeName(displayedSelectedVolume) }}》</h3>

                <div v-if="displayedSelectedVolume._pending" class="vd-meta streaming-meta">
                  <span class="cursor">▌</span>
                  <span>正在规划本卷…</span>
                </div>
                <div v-else class="vd-meta">
                  <span v-if="selectedDisplayRange">第 {{ selectedDisplayRange.start }}–{{ selectedDisplayRange.end }} 章</span>
                  <template v-if="isEditingSelected">
                    <label>章数 <input v-model.number="editForm.estimatedChapters" class="num-in" type="number" min="1" step="1" aria-label="预估章节数" :disabled="saving" /></label>
                    <label>字数 <input v-model.number="editForm.estimatedWordCount" class="num-in" type="number" min="0.1" step="0.5" aria-label="预估字数" :disabled="saving" /> 万</label>
                    <label>主题 <input v-model="editForm.theme" class="theme-in" placeholder="一句话主题" aria-label="主题" :disabled="saving" /></label>
                  </template>
                  <template v-else>
                    <span>{{ displayedSelectedVolume.estimatedChapters || 0 }} 章 · {{ formatWan(displayedSelectedVolume.estimatedWordCount || 0) }} 万字</span>
                    <span v-if="selectedAvgWords" :class="{ warn: selectedAvgWarn }">
                      平均每章 {{ formatCount(selectedAvgWords) }} 字<template v-if="selectedAvgWarn">，和设定的每章 {{ formatCount(chapterTargetWords) }} 字差得多</template>
                    </span>
                    <span v-if="displayedSelectedVolume.theme" class="ptag line">主题：{{ displayedSelectedVolume.theme }}</span>
                    <span v-if="displayedSelectedIndex === 0" class="ptag zhu">当前卷 · 先写这一卷</span>
                  </template>
                </div>
              </div>

              <!-- 右上角操作区 -->
              <div v-if="!displayedSelectedVolume._pending && !generating" class="vd-acts">
                <template v-if="isEditingSelected">
                  <button type="button" class="pbtn sm ghost" :disabled="busy" @click="cancelEdit">取消修改</button>
                  <button type="button" class="pbtn sm pri" :aria-busy="saving" :disabled="busy" @click="saveEdit(displayedSelectedVolume.id)">
                    <V3Icon name="check" size="s" />保存本卷
                  </button>
                </template>
                <template v-else>
                  <button type="button" class="pbtn sm" :disabled="busy" @click="startEdit(displayedSelectedVolume)">
                    <V3Icon name="edit" size="s" />编辑本卷
                  </button>
                  <button type="button" class="pbtn sm" :aria-busy="regeneratingId === displayedSelectedVolume.id"
                    :disabled="busy || hasDrafts" @click="regenerateVolume(displayedSelectedVolume)">
                    <V3Icon name="spark" size="s" />AI 重写本卷
                  </button>
                  <button v-if="displayedSelectedVolume.versions?.length" type="button" class="pbtn sm" :disabled="busy"
                    @click="openVolumeVersionsDrawer(displayedSelectedVolume)">
                    <V3Icon name="history" size="s" />版本 {{ displayedSelectedVolume.versions.length }}
                  </button>
                  <button type="button" class="pib" aria-label="更多操作" :aria-expanded="menuOpen"
                    :disabled="busy" @click.stop="menuOpen = !menuOpen">
                    <V3Icon name="more" size="s" />
                  </button>
                  <div v-if="menuOpen" class="vmenu" role="menu" @click.stop>
                    <button type="button" role="menuitem" :disabled="displayedSelectedIndex === 0 || busy"
                      @click="moveVolume(displayedSelectedIndex, -1)">
                      <V3Icon name="chevD" size="s" class="rot180" />上移一卷
                    </button>
                    <button type="button" role="menuitem" :disabled="displayedSelectedIndex >= volumes.length - 1 || busy"
                      @click="moveVolume(displayedSelectedIndex, 1)">
                      <V3Icon name="chevD" size="s" />下移一卷
                    </button>
                    <button v-if="hasEstimateConflict(displayedSelectedVolume)" type="button" role="menuitem"
                      :disabled="busy" @click="menuOpen = false; syncEstimates(displayedSelectedVolume)">
                      <V3Icon name="refresh" size="s" />从概要同步预估
                    </button>
                    <button type="button" role="menuitem" class="danger" :disabled="busy"
                      @click="menuOpen = false; askRemoveVolume(displayedSelectedVolume)">
                      <V3Icon name="trash" size="s" />删除本卷
                    </button>
                  </div>
                </template>
              </div>
            </header>

            <!-- 详情滚动主体 -->
            <div ref="detailBodyRef" class="vd-body" :class="{ 'edit-form': isEditingSelected }">
              <!-- 1. 本卷走向（目标 → 冲突 → 转折 → 收束，带彩色数字圆标） -->
              <section class="sec">
                <h4>本卷走向<small>目标 → 冲突 → 转折 → 收束</small></h4>
                <div class="flow4 volume-flow-grid" aria-label="本卷走向">
                  <article class="fcard flow-cell">
                    <div class="lb"><i style="background: var(--dai)">1</i>目标</div>
                    <textarea v-if="isEditingSelected" v-model="editForm.goal" class="edit-area" rows="3"
                      placeholder="填写本卷目标" aria-label="本卷目标" :disabled="saving"></textarea>
                    <div v-else-if="displayedSelectedVolume._pending && volumeCardField(displayedSelectedVolume, 'target') === '未填写'" class="ph-stack">
                      <div class="ph" style="width: 92%"></div><div class="ph" style="width: 74%"></div><div class="ph" style="width: 56%"></div>
                    </div>
                    <p v-else :class="{ muted: volumeCardField(displayedSelectedVolume, 'target') === '未填写' }">
                      {{ volumeCardField(displayedSelectedVolume, 'target') }}
                    </p>
                  </article>

                  <article class="fcard flow-cell">
                    <div class="lb"><i style="background: var(--zhu)">2</i>冲突</div>
                    <textarea v-if="isEditingSelected" v-model="editForm.conflict" class="edit-area" rows="3"
                      placeholder="填写本卷冲突" aria-label="本卷冲突" :disabled="saving"></textarea>
                    <div v-else-if="displayedSelectedVolume._pending && volumeCardField(displayedSelectedVolume, 'conflict') === '未填写'" class="ph-stack">
                      <div class="ph" style="width: 90%"></div><div class="ph" style="width: 72%"></div><div class="ph" style="width: 52%"></div>
                    </div>
                    <p v-else :class="{ muted: volumeCardField(displayedSelectedVolume, 'conflict') === '未填写' }">
                      {{ volumeCardField(displayedSelectedVolume, 'conflict') }}
                    </p>
                  </article>

                  <article class="fcard flow-cell">
                    <div class="lb"><i style="background: var(--jin)">3</i>转折</div>
                    <textarea v-if="isEditingSelected" v-model="editForm.turnsText" class="edit-area" rows="3"
                      placeholder="一行写一个转折" aria-label="本卷转折" :disabled="saving"></textarea>
                    <div v-else-if="displayedSelectedVolume._pending && !turningPointLines(displayedSelectedVolume).length" class="ph-stack">
                      <div class="ph" style="width: 88%"></div><div class="ph" style="width: 70%"></div><div class="ph" style="width: 50%"></div>
                    </div>
                    <ul v-else-if="turningPointLines(displayedSelectedVolume).length">
                      <li v-for="(line, lIdx) in turningPointLines(displayedSelectedVolume)" :key="lIdx">{{ line }}</li>
                    </ul>
                    <p v-else class="muted">未填写</p>
                  </article>

                  <article class="fcard flow-cell">
                    <div class="lb"><i style="background: var(--qing)">4</i>收束</div>
                    <textarea v-if="isEditingSelected" v-model="editForm.closure" class="edit-area" rows="3"
                      placeholder="填写本卷收束" aria-label="本卷收束" :disabled="saving"></textarea>
                    <div v-else-if="displayedSelectedVolume._pending && volumeCardField(displayedSelectedVolume, 'closure') === '未填写'" class="ph-stack">
                      <div class="ph" style="width: 92%"></div><div class="ph" style="width: 74%"></div><div class="ph" style="width: 56%"></div>
                    </div>
                    <p v-else :class="{ muted: volumeCardField(displayedSelectedVolume, 'closure') === '未填写' }">
                      {{ volumeCardField(displayedSelectedVolume, 'closure') }}
                    </p>
                  </article>
                </div>
              </section>

              <!-- 2. 内嵌章纲：章节尺 + AI 生成本卷章纲 + 手写一条 + AI 建议勾选确认条 + 行内编辑 -->
              <section v-if="!generating && !displayedSelectedVolume._pending" class="sec" aria-label="本卷章纲">
                <h4>
                  <span>章纲</span>
                  <small v-if="selectedDisplayRange">第 {{ selectedDisplayRange.start }}–{{ selectedDisplayRange.end }} 章</small>
                  <span class="hz-legend">
                    <span><i style="background: var(--zhu)"></i>下一步</span>
                    <span><i style="background: var(--dai)"></i>近期</span>
                    <span><i style="background: color-mix(in srgb, var(--ink-3) 80%, var(--paper))"></i>远期</span>
                  </span>
                  <span class="sp"></span>
                  <button type="button" class="pbtn sm" :class="{ 'zhu-line': needsFirstVolumePlan }"
                    :aria-busy="suggestingVolumeId === displayedSelectedVolume.id"
                    :disabled="busy || !!suggestingVolumeId || selectedSuggestions.length > 0 || !novel?.outline"
                    @click="suggestPlansForSelectedVolume">
                    <V3Icon name="spark" size="s" />{{ aiPlanButtonLabel }}
                  </button>
                  <button type="button" class="pbtn sm" :disabled="busy || !!planEdit" @click="startNewPlan">
                    <V3Icon name="plus" size="s" />手写一条
                  </button>
                </h4>

                <!-- 章节覆盖进度尺 -->
                <div class="ruler" role="img"
                  :aria-label="selectedDisplayRange ? `第 ${selectedDisplayRange.start}–${selectedDisplayRange.end} 章的章纲覆盖情况` : '章纲覆盖情况'">
                  <span v-for="blk in selectedRulerBlocks" :key="blk.id" class="blk"
                    :class="[blk.cls, { hot: hoveredPlanId === blk.id }]"
                    :style="{ left: `${blk.left.toFixed(2)}%`, width: `${blk.width.toFixed(2)}%` }"
                    :title="blk.tooltip"
                    @mouseenter="hoveredPlanId = blk.id"
                    @mouseleave="hoveredPlanId = ''"
                    @click="focusPlanRow(blk.id)">
                    {{ blk.width > 7 ? blk.title : '' }}
                  </span>
                </div>
                <div class="ruler-scale">
                  <span>第 {{ selectedDisplayRange?.start ?? 1 }} 章</span>
                  <b>{{ selectedRulerSummary }}</b>
                  <span>第 {{ selectedDisplayRange?.end ?? 1 }} 章</span>
                </div>

                <!-- AI 建议确认条 -->
                <div v-if="selectedSuggestions.length" class="sug-bar" aria-label="待确认章节计划建议">
                  <V3Icon name="spark" size="s" />
                  <span>AI 建议了 {{ selectedSuggestions.length }} 条章纲，勾选后确认才会加入</span>
                  <span class="sp"></span>
                  <button type="button" class="pbtn sm ghost" :disabled="planSaving" @click="dropAllSelectedSuggestions">全部忽略</button>
                  <button type="button" class="pbtn sm zhu" :aria-busy="planSaving"
                    :disabled="planSaving || !checkedSuggestionCount" @click="acceptSelectedSuggestions">
                    {{ planSaving ? '保存中…' : `确认选中的 ${checkedSuggestionCount} 条` }}
                  </button>
                </div>

                <!-- 章纲列表（新建编辑器 + 加载占位 + 已有章纲 + 待确认建议） -->
                <div class="plans">
                  <!-- 行内新建表单 -->
                  <div v-if="planEdit && planEdit.isNew && planEdit.volumeId === displayedSelectedVolume.id" class="plan editing">
                    <span></span>
                    <span class="rg">
                      <input v-model.number="planEdit.start" class="num-in sm" type="number" min="1" aria-label="起始章" />–<input v-model.number="planEdit.end" class="num-in sm" type="number" min="1" aria-label="结束章" />
                    </span>
                    <div class="pc">
                      <input ref="planTitleInputRef" v-model="planEdit.title" class="pe-title" placeholder="章纲标题，例如：第一条渔船" aria-label="章纲标题" />
                      <textarea v-model="planEdit.objective" class="edit-area" rows="2" placeholder="这几章要推进什么" aria-label="这几章的目标"></textarea>
                    </div>
                    <span class="pm">
                      <select v-model="planEdit.horizon" aria-label="远近">
                        <option value="next">下一步</option>
                        <option value="near">近期</option>
                        <option value="far">远期</option>
                      </select>
                    </span>
                    <span class="pa vis">
                      <button type="button" class="pbtn sm" :disabled="planSaving" @click="planEdit = null">取消</button>
                      <button type="button" class="pbtn sm pri" :aria-busy="planSaving" :disabled="planSaving" @click="savePlanEdit">保存</button>
                    </span>
                  </div>

                  <!-- AI 生成章纲加载骨架 -->
                  <template v-if="suggestingVolumeId === displayedSelectedVolume.id">
                    <div v-for="n in 3" :key="n" class="plan ph-row">
                      <div class="ph" style="width: 40%"></div>
                      <div class="ph" style="width: 85%"></div>
                    </div>
                  </template>

                  <!-- 合并行：已保存章纲 & 待确认 AI 建议 -->
                  <template v-for="row in selectedCombinedPlanRows" :key="row.id">
                    <!-- 行内编辑态 -->
                    <div v-if="planEdit && !planEdit.isNew && planEdit.id === row.id" class="plan editing">
                      <span></span>
                      <span class="rg">
                        <input v-model.number="planEdit.start" class="num-in sm" type="number" min="1" aria-label="起始章" />–<input v-model.number="planEdit.end" class="num-in sm" type="number" min="1" aria-label="结束章" />
                      </span>
                      <div class="pc">
                        <input ref="planTitleInputRef" v-model="planEdit.title" class="pe-title" placeholder="章纲标题" aria-label="章纲标题" />
                        <textarea v-model="planEdit.objective" class="edit-area" rows="2" placeholder="这几章要推进什么" aria-label="这几章的目标"></textarea>
                      </div>
                      <span class="pm">
                        <select v-model="planEdit.horizon" aria-label="远近">
                          <option value="next">下一步</option>
                          <option value="near">近期</option>
                          <option value="far">远期</option>
                        </select>
                      </span>
                      <span class="pa vis">
                        <button type="button" class="pbtn sm" :disabled="planSaving" @click="planEdit = null">取消</button>
                        <button type="button" class="pbtn sm pri" :aria-busy="planSaving" :disabled="planSaving" @click="savePlanEdit">保存</button>
                      </span>
                    </div>

                    <!-- 展示态 -->
                    <div v-else class="plan" :class="{ sug: row.sug, hot: hoveredPlanId === row.id || focusedPlanId === row.id }"
                      :data-plan="row.id"
                      @mouseenter="hoveredPlanId = row.id"
                      @mouseleave="hoveredPlanId = ''">
                      <label v-if="row.sug" class="ck">
                        <input type="checkbox" :checked="row.checked" :aria-label="`选中建议：${row.title}`"
                          @change="toggleSuggestionChecked(row.id, ($event.target as HTMLInputElement).checked)" />
                      </label>
                      <span v-else class="hz" :class="horizonClass(row.horizon)" :title="horizonLabel(row.horizon)"></span>
                      <span class="rg">{{ formatChapterRange(row.start, row.end) }}</span>
                      <div class="pc">
                        <b>{{ row.title }}</b>
                        <p v-if="row.objective">{{ row.objective }}</p>
                      </div>
                      <span class="pm">
                        <span v-if="row.sug" class="ptag sug">AI 建议</span>
                        <template v-else>
                          <span class="ptag line">{{ horizonLabel(row.horizon) }}</span>
                          <span class="ptag line">{{ row.source === 'ai' ? 'AI' : '手写' }}</span>
                        </template>
                      </span>
                      <span class="pa">
                        <button type="button" class="pib" :aria-label="`编辑：${row.title}`" :disabled="planSaving"
                          @click="startEditPlanRow(row)"><V3Icon name="edit" size="s" /></button>
                        <button type="button" class="pib" :aria-label="`${row.sug ? '忽略' : '删除'}：${row.title}`" :disabled="planSaving"
                          @click="row.sug ? dropSuggestion(row.id) : deleteSavedPlan(row.id)">
                          <V3Icon :name="row.sug ? 'x' : 'trash'" size="s" />
                        </button>
                      </span>
                    </div>
                  </template>
                </div>

                <!-- 空章纲提示框 -->
                <div v-if="!selectedCombinedPlanRows.length && suggestingVolumeId !== displayedSelectedVolume.id && !(planEdit && planEdit.isNew)"
                  class="outline-only" :class="{ need: needsFirstVolumePlan }">
                  {{ needsFirstVolumePlan
                    ? '确认分卷前，第 1 卷至少要有一条章纲。可以让 AI 生成，也可以手写一条。'
                    : '这一卷先保持轮廓，写到这里之前再展开章纲。需要的话现在也可以展开。' }}
                </div>
              </section>

              <!-- 3. 承担的骨架节点 -->
              <section v-if="!generating && !displayedSelectedVolume._pending && skeletonBeats.length" class="sec">
                <h4>
                  承担的骨架节点
                  <small>点节点放到这一卷，再点一次取消；来自正式方向「{{ officialDirection.seal }} {{ officialDirection.title }}」</small>
                </h4>
                <div class="bchips">
                  <button v-for="(beat, bIdx) in skeletonBeats" :key="beat.id" type="button" class="bchip"
                    :class="{
                      on: beatOwnerIndex(beat.id) === displayedSelectedIndex,
                      free: beatOwnerIndex(beat.id) < 0,
                      hot: hotBeatId === beat.id,
                    }"
                    :data-beat="beat.id"
                    :aria-pressed="beatOwnerIndex(beat.id) === displayedSelectedIndex"
                    :disabled="busy"
                    :title="`${beatKindInfo(beat.kind).label}：${beat.description || beat.title}`"
                    @click="toggleVolumeBeat(displayedSelectedVolume, beat.id)">
                    <span class="pnum" :style="{ background: beatKindInfo(beat.kind).color }">{{ bIdx + 1 }}</span>
                    <span>{{ beat.title }}</span>
                    <small>{{ beatOwnerLabel(beat.id, displayedSelectedIndex) }}</small>
                  </button>
                </div>
              </section>

              <!-- 4. 双列：角色变化 + 卷级伏笔 -->
              <section v-if="!displayedSelectedVolume._pending" class="sec two">
                <div>
                  <h4>角色变化</h4>
                  <textarea v-if="isEditingSelected" v-model="editForm.characterChanges" class="edit-area" rows="3"
                    placeholder="一行一个人物，例如：林岸：想卖铺子 → 决定留下" aria-label="角色变化" :disabled="saving"></textarea>
                  <ul v-else-if="parsedPeople(displayedSelectedVolume).length" class="lst">
                    <li v-for="(row, pIdx) in parsedPeople(displayedSelectedVolume)" :key="pIdx">
                      <b v-if="row.name">{{ row.name }}</b>
                      <span>{{ row.before }}<template v-if="row.after"><span class="arrow">→</span>{{ row.after }}</template></span>
                    </li>
                  </ul>
                  <p v-else class="muted">未填写</p>
                </div>

                <div>
                  <h4>卷级伏笔</h4>
                  <textarea v-if="isEditingSelected" v-model="editForm.seedsText" class="edit-area" rows="3"
                    placeholder="一行一条，例如：本卷：旧灯一直没亮过 / 跨卷：旧账本第 4 卷揭开" aria-label="卷级伏笔" :disabled="saving"></textarea>
                  <ul v-else-if="parsedSeeds(displayedSelectedVolume).length" class="lst">
                    <li v-for="(seed, sIdx) in parsedSeeds(displayedSelectedVolume)" :key="sIdx">
                      <span class="ptag" :class="seed.scope === '跨卷' ? 'dai' : 'line'">
                        {{ seed.scope === '跨卷' ? '跨卷铺垫' : '本卷伏笔' }}
                      </span>
                      <span>{{ seed.text }}</span>
                    </li>
                  </ul>
                  <p v-else class="muted">未填写</p>
                </div>
              </section>

              <!-- 仅当概要里有结构字段之外的额外手写文字时才展示补充说明，避免重复倾倒四格内容 -->
              <section v-if="!isEditingSelected && !displayedSelectedVolume._pending && extraNarrativeSummary(displayedSelectedVolume)" class="sec">
                <h4>补充概要</h4>
                <div class="volume-summary" v-html="renderMd(extraNarrativeSummary(displayedSelectedVolume))"></div>
              </section>

              <!-- 已创建的正文章节（写作后才出现） -->
              <section v-if="!generating && !displayedSelectedVolume._pending && selectedVolumeChapters.length" class="sec">
                <h4>已创建章节<small>{{ selectedVolumeChapters.length }} 章</small></h4>
                <ol class="written-list">
                  <li v-for="chapter in selectedVolumeChapters" :key="chapter.id">
                    <span>第 {{ chapter.chapterIndex + 1 }} 章</span>
                    <strong>{{ chapterTitleForDisplay(chapter.title, chapter.chapterIndex) }}</strong>
                    <p v-if="chapter.summary">{{ chapter.summary }}</p>
                    <small v-if="chapter.summary && getChapterSummaryStatus(chapter) !== 'current'">总结待核对，暂不用于 AI 写作和审校。</small>
                  </li>
                </ol>
              </section>
            </div>
          </template>
        </section>
      </div>
    </div>

    <!-- 右侧滑出资料与版本抽屉（与原型 1:1） -->
    <div v-if="drawerOpen" class="drawer-layer" @keydown.esc="closeDrawer">
      <div class="scrim" @click="closeDrawer"></div>
      <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="vol-drawer-title">
        <div class="drawer-head">
          <h3 id="vol-drawer-title">{{ drawerTitle }}</h3>
          <button type="button" class="pbtn sm ghost" @click="closeDrawer"><V3Icon name="x" size="s" />关闭</button>
        </div>

        <div v-if="drawerTab !== 'vol-versions'" class="seg" role="tablist">
          <button type="button" role="tab" :aria-pressed="drawerTab === 'contract'" :aria-selected="drawerTab === 'contract'" @click="drawerTab = 'contract'">作品契约</button>
          <button type="button" role="tab" :aria-pressed="drawerTab === 'direction'" :aria-selected="drawerTab === 'direction'" @click="drawerTab = 'direction'">正式方向</button>
          <button type="button" role="tab" :aria-pressed="drawerTab === 'records'" :aria-selected="drawerTab === 'records'" @click="drawerTab = 'records'">版本与生成记录</button>
        </div>

        <div class="drawer-body">
          <!-- 作品契约 -->
          <template v-if="drawerTab === 'contract'">
            <p class="note-box">
              作品契约{{ contractApproved ? '已确认' : '待确认' }}。<template v-if="contractRange">分卷的篇幅按「篇幅与节奏」对照：{{ formatWan(contractRange[0]) }}–{{ formatWan(contractRange[1]) }} 万字。</template>
            </p>
            <div v-for="row in contractRows" :key="row.label" class="kv">
              <b>{{ row.label }}</b>
              <span :class="{ undecided: row.value === '暂不确定' || row.value === '未填写' }">{{ row.value }}</span>
            </div>
          </template>

          <!-- 正式方向 -->
          <template v-else-if="drawerTab === 'direction'">
            <div class="dir-card">
              <div class="c-title">
                <span class="seal official">{{ officialDirection.seal }}</span>
                <span>{{ officialDirection.title }}</span>
                <span class="ptag official">✓ 正式方向</span>
              </div>
              <p>{{ officialDirection.logline || '暂无一句话主线说明。' }}</p>
            </div>
            <ol v-if="skeletonBeats.length" class="beat-list">
              <li v-for="(beat, bIdx) in skeletonBeats" :key="beat.id">
                <span class="pnum" :style="{ background: beatKindInfo(beat.kind).color }">{{ bIdx + 1 }}</span>
                <span>{{ beatKindInfo(beat.kind).label }} · {{ beat.title }}</span>
                <small :class="{ miss: beatOwnerIndex(beat.id) < 0 }">
                  {{ beatOwnerIndex(beat.id) < 0 ? '未落卷' : `第 ${beatOwnerIndex(beat.id) + 1} 卷` }}
                </small>
              </li>
            </ol>
            <p class="note-box">要换方向，请回到故事骨架；改了正式方向后，分卷要重新核对。</p>
          </template>

          <!-- 版本与生成记录 -->
          <template v-else-if="drawerTab === 'records'">
            <div v-for="rec in recordEntries" :key="rec.id" class="rec" :class="rec.tone">
              <div class="rec-top">
                <strong>{{ rec.title }}</strong>
                <time>{{ rec.time }}</time>
              </div>
              <p>{{ rec.text }}</p>
            </div>
            <p v-if="!recordEntries.length" class="note-box">还没有记录。</p>
          </template>

          <!-- 本卷版本对比与恢复 -->
          <template v-else-if="drawerTab === 'vol-versions' && versionVolume">
            <div v-for="entry in volumeVersionCards" :key="entry.id" class="rec" :class="entry.same ? 'ok' : 'author'">
              <div class="rec-top">
                <strong>{{ entry.label }}</strong>
                <time>{{ entry.time }}</time>
                <span v-if="entry.same" class="ptag qing">就是现在的内容</span>
              </div>
              <template v-if="!entry.same">
                <div class="diff">
                  <template v-for="item in entry.diffs" :key="item.field">
                    <b>{{ item.field }}</b>
                    <span>{{ item.before }}<small>现在：{{ item.after }}</small></span>
                  </template>
                </div>
                <div class="acts">
                  <button type="button" class="pbtn sm" :aria-busy="saving" :disabled="busy"
                    @click="restoreVersionById(entry.id)">{{ saving ? '正在恢复…' : '恢复这个版本' }}</button>
                </div>
              </template>
            </div>
            <p class="note-box">每个版本只列出和现在不一样的地方。恢复时，现在的内容会先存成一个版本；同样的内容只存一份，来回切换不会越存越多。</p>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import { ref, computed, reactive, watch, nextTick, onMounted, onDeactivated, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { useDialog, useMessage } from '@/v3/feedback'
import V3Icon from '@/v3/components/V3Icon.vue'
import { useNovelStore } from '@/stores/novel'
import { chapterTitleForDisplay } from '@/v3/write/chapterNumber'
import { useConfigStore } from '@/stores/config'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useReconstructionWorkspaceStore } from '@/stores/reconstructionWorkspace'
import { callAI } from '@/services/ai'
import { buildVolumePlanningPrompt } from '@/services/prompts'
import { renderMd } from '@/utils/markdown'
import type { ChapterPlan, ChapterPlanHorizon, Volume } from '@/types/novel'
import { parseAiJsonObject } from '@/utils/aiJson'
import { comparePlanningVersions } from '@/services/planningVersions'
import { normalizeVolumeTitle, normalizeVolumeTurningPoints, parseVolumeEstimates, parseVolumesFromText, volumeChapterRanges, volumeForChapterPlan, volumeOrdinalMismatches } from '@/services/volumeParsing'
import { buildBoundKnowledgeContext } from '@/services/knowledgeContext'
import { getChapterSummaryStatus } from '@/services/derivedSources'
import { resolveChapterLengthPolicy } from '@/services/chapterLength'
import { generateChapterPlanDrafts, type ChapterPlanDraft } from '@/services/storyPlanning'
import { chapterPlanningSourceVersion } from '@/services/storyPlanTransactions'
import outlineArt from '@/assets/v3/empty/outline.webp'

export interface VolumePlannerCheckItem {
  key: 'vols' | 'plans' | 'length' | 'beats' | 'order' | 'sug'
  ok: boolean
  block: boolean
  text: string
}

export interface VolumePlannerSummaryState {
  generating: boolean
  streamingCompleted: number
  hasVolumes: boolean
  hasDrafts: boolean
  draftVolumeIndex: number
  draftVolumeId: string
  viewingDraftVolume: boolean
  pendingSuggestionsCount: number
  checks: VolumePlannerCheckItem[]
}

const props = withDefaults(defineProps<{
  compact?: boolean
  chapterPlanConfirmed?: boolean
}>(), { chapterPlanConfirmed: false })
const emit = defineEmits<{
  confirmed: []
  'state-change': [state: VolumePlannerSummaryState]
}>()

const route = useRoute()
const novelStore = useNovelStore()
const configStore = useConfigStore()
const knowledgeStore = useKnowledgeStore()
const workspace = useReconstructionWorkspaceStore()
const msg = useMessage()
const dialog = useDialog()

const novelId = computed(() => route.params.novelId as string)
const novel = computed(() => novelStore.getNovel(novelId.value))
const volumes = computed(() => novel.value?.volumes || [])
const creationDraft = computed(() => workspace.getCreationDraft(novelId.value))

/* ========== 基础格式化工具 ========== */
const CN_DIGITS = '零一二三四五六七八九'
function cnNum(n: number): string {
  if (n <= 0) return '零'
  if (n <= 10) return n === 10 ? '十' : CN_DIGITS[n]
  if (n < 20) return '十' + CN_DIGITS[n - 10]
  if (n < 100) return CN_DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGITS[n % 10] : '')
  return String(n)
}
const SLOTS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']
const slotSeal = (idx: number) => SLOTS[idx] || String(idx + 1)
const formatCount = (n: number) => Math.round(n || 0).toLocaleString('zh-CN')
const formatWan = (n: number) => String(Number((Math.round((n || 0) * 100) / 100).toFixed(2)))
const formatChapterRange = (start: number, end: number) => end > start ? `第 ${start}–${end} 章` : `第 ${start} 章`

const BEAT_KINDS: Record<string, { label: string; color: string }> = {
  opening: { label: '开端', color: 'var(--ink-3)' },
  inciting: { label: '引发事件', color: 'var(--dai)' },
  turning_point: { label: '转折', color: 'var(--jin)' },
  midpoint: { label: '中点', color: 'var(--zi)' },
  low_point: { label: '低谷', color: 'var(--ink)' },
  climax: { label: '高潮', color: 'var(--zhu)' },
  resolution: { label: '结局', color: 'var(--qing)' },
  custom: { label: '其他', color: 'var(--ink-4)' },
}
const beatKindInfo = (kind: string) => BEAT_KINDS[kind] || BEAT_KINDS.custom
const horizonLabel = (horizon: ChapterPlanHorizon) => horizon === 'next' ? '下一步' : horizon === 'near' ? '近期' : '远期'
const horizonClass = (horizon: ChapterPlanHorizon) => horizon === 'next' ? 'next' : horizon === 'near' ? 'near' : 'far'

/* ========== 流式逐卷生成状态 ========== */
type DisplayVolume = Volume & { _pending?: boolean }
const generating = ref(false)
const streamContent = ref('')
const streamingBeatIds = ref<string[] | undefined>(undefined)
const userStoppedGeneration = ref(false)
const streamingFollowLatest = ref(true)
const streamingSelectedIdx = ref(0)
const selectedVolumeId = ref('')
const menuOpen = ref(false)
const hotBeatId = ref('')
const hoveredPlanId = ref('')
const focusedPlanId = ref('')
const detailBodyRef = ref<HTMLElement | null>(null)
const planTitleInputRef = ref<HTMLInputElement | null>(null)

const selectedVolume = computed(() => volumes.value.find(vol => vol.id === selectedVolumeId.value))
const streamingVolumes = computed<DisplayVolume[]>(() => {
  if (!generating.value) return []
  const parsed = parseVolumesFromText(streamContent.value, streamingBeatIds.value)
  if (!parsed.length) {
    return [{
      id: '__streaming-0',
      volumeIndex: 0,
      title: '',
      theme: '',
      summary: '',
      keyTurningPoints: '',
      characterChanges: '',
      estimatedChapters: 0,
      estimatedWordCount: 0,
      _pending: true,
    }]
  }
  return parsed.map((vol, idx) => ({
    ...vol,
    id: `__streaming-${idx}`,
    _pending: idx === parsed.length - 1,
  }))
})
const doneVolumeCount = computed(() => generating.value ? streamingVolumes.value.filter(v => !v._pending).length : volumes.value.length)
watch(() => streamingVolumes.value.length, len => {
  if (generating.value && streamingFollowLatest.value && len > 0) streamingSelectedIdx.value = len - 1
})

const displayedVolumes = computed<DisplayVolume[]>(() => generating.value ? streamingVolumes.value : volumes.value)
const displayedSelectedVolume = computed<DisplayVolume | undefined>(() => {
  if (generating.value) return streamingVolumes.value[streamingSelectedIdx.value] || streamingVolumes.value[streamingVolumes.value.length - 1]
  return selectedVolume.value
})
const displayedSelectedIndex = computed(() => {
  if (!displayedSelectedVolume.value) return -1
  return displayedVolumes.value.findIndex(item => item.id === displayedSelectedVolume.value!.id)
})
const displayedSelectedId = computed(() => displayedSelectedVolume.value?.id || '')

const pageSubtitle = computed(() => {
  if (generating.value) return 'AI 正在按大纲和契约篇幅规划分卷，规划好的卷会直接出现在下面。'
  if (!volumes.value.length) return '大纲已确认，先把全书分成几卷。'
  return '按正式方向把全书分卷。第 1 卷先排好章纲，其余卷保持轮廓，写到前再展开。'
})

/* ========== 正式方向、契约与骨架节点 ========== */
const contractApproved = computed(() => creationDraft.value?.approval.contract === 'approved')
const officialDirection = computed(() => {
  const draft = creationDraft.value
  const list = draft?.skeletons || []
  const idx = list.findIndex(item => item.id === draft?.selectedSkeletonId)
  const item = idx >= 0 ? list[idx] : list[0]
  return {
    seal: idx >= 0 ? slotSeal(idx) : '甲',
    title: item?.title || '未命名方向',
    logline: item?.logline || item?.premise || '',
  }
})
const skeletonBeats = computed(() => {
  const draft = creationDraft.value
  const skeleton = draft?.skeletons.find(item => item.id === draft.selectedSkeletonId)
  return skeleton?.beats || []
})
const beatOrdinal = (beatId: string) => skeletonBeats.value.findIndex(item => item.id === beatId) + 1
const beatOwnerIndex = (beatId: string) => displayedVolumes.value.findIndex(vol => (vol.skeletonBeatIds || []).includes(beatId))
const beatOwnerLabel = (beatId: string, curIdx: number) => {
  const owner = beatOwnerIndex(beatId)
  if (owner === curIdx) return '本卷'
  if (owner >= 0) return `第 ${owner + 1} 卷`
  return '未落卷'
}
const beatsInVolume = (volume: Volume) => skeletonBeats.value.filter(beat => (volume.skeletonBeatIds || []).includes(beat.id))
const unassignedBeats = computed(() => {
  const assigned = new Set(volumes.value.flatMap(vol => vol.skeletonBeatIds || []))
  return skeletonBeats.value.filter(beat => !assigned.has(beat.id))
})

/* ========== 篇幅比例尺、刻度与章节区间 ========== */
const contractRange = computed<[number, number] | null>(() => {
  const c = creationDraft.value?.contract
  const minWan = c?.targetWordCountMin && c.targetWordCountMin > 0
    ? Math.round((c.targetWordCountMin / 10000) * 100) / 100
    : (novel.value?.targetWordCountMin && novel.value.targetWordCountMin > 0 ? novel.value.targetWordCountMin : 0)
  const maxWan = c?.targetWordCountMax && c.targetWordCountMax > 0
    ? Math.round((c.targetWordCountMax / 10000) * 100) / 100
    : (novel.value?.targetWordCountMax && novel.value.targetWordCountMax > 0 ? novel.value.targetWordCountMax : 0)
  if (minWan > 0 && maxWan > 0) return [minWan, Math.max(minWan, maxWan)]
  if (minWan > 0) return [minWan, minWan]
  if (maxWan > 0) return [0, maxWan]
  return null
})

function effectiveChapters(vol: DisplayVolume): number {
  if (!generating.value && editingId.value === vol.id) return Math.max(0, Math.round(Number(editForm.value.estimatedChapters) || 0))
  const draft = !generating.value ? volumeDrafts.get(vol.id) : undefined
  if (draft) return Math.max(0, Math.round(Number(draft.form.estimatedChapters) || 0))
  return Math.max(0, Math.round(Number(vol.estimatedChapters) || 0))
}
function effectiveWan(vol: DisplayVolume): number {
  if (!generating.value && editingId.value === vol.id) return Math.max(0, Number(editForm.value.estimatedWordCount) || 0)
  const draft = !generating.value ? volumeDrafts.get(vol.id) : undefined
  if (draft) return Math.max(0, Number(draft.form.estimatedWordCount) || 0)
  return Math.max(0, Number(vol.estimatedWordCount) || 0)
}
function displayVolumeName(vol: DisplayVolume): string {
  if (!generating.value && editingId.value === vol.id) return editForm.value.title.trim() || '未命名分卷'
  const draft = !generating.value ? volumeDrafts.get(vol.id) : undefined
  if (draft) return draft.form.title.trim() || '未命名分卷'
  return (vol.title || '').trim() || '未命名分卷'
}

const displayedTotalChapters = computed(() => displayedVolumes.value.reduce((sum, vol) => sum + (vol._pending ? 0 : effectiveChapters(vol)), 0))
const displayedTotalWords = computed(() => Math.round(displayedVolumes.value.reduce((sum, vol) => sum + (vol._pending ? 0 : effectiveWan(vol)), 0) * 100) / 100)
const segGrow = (vol: DisplayVolume) => vol._pending && !effectiveWan(vol) ? 10 : Math.max(effectiveWan(vol), 0.5)
const barTotalWan = computed(() => displayedVolumes.value.reduce((sum, vol) => sum + segGrow(vol), 0))
const rulerScale = computed(() => {
  const rangeMax = contractRange.value ? contractRange.value[1] : 0
  return Math.max(rangeMax, displayedTotalWords.value, barTotalWan.value, 10)
})
const pctOfScale = (value: number) => `${Math.min(100, Math.max(0, (value / rulerScale.value) * 100)).toFixed(2)}%`
const rulerTicks = computed(() => {
  const max = rulerScale.value
  const rawStep = max / 6
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]
  const step = candidates.find(s => s >= rawStep) || Math.ceil(rawStep / 100) * 100
  const ticks: number[] = []
  for (let x = 0; x <= max + 0.01; x += step) ticks.push(Math.round(x * 10) / 10)
  if (ticks[ticks.length - 1] < max - step * 0.35) ticks.push(Math.round(max * 10) / 10)
  return ticks
})

const lengthRangeBadge = computed<{ text: string; warn: boolean } | null>(() => {
  if (generating.value) return { text: '规划中…', warn: true }
  if (!contractRange.value) return null
  const [minW, maxW] = contractRange.value
  const total = displayedTotalWords.value
  if (total >= minW && total <= maxW) return { text: `在契约 ${formatWan(minW)}–${formatWan(maxW)} 万字范围内`, warn: false }
  if (total < minW) return { text: `比契约少 ${formatWan(minW - total)} 万字`, warn: true }
  return { text: `比契约多 ${formatWan(total - maxW)} 万字`, warn: true }
})

const displayChapterRanges = computed(() => {
  let start = 1
  return displayedVolumes.value.map(vol => {
    const count = effectiveChapters(vol)
    const item = { volumeId: vol.id, start, end: start + Math.max(count, 1) - 1, count }
    start += Math.max(count, 0)
    return item
  })
})
const selectedDisplayRange = computed(() => displayChapterRanges.value[displayedSelectedIndex.value])
const segTooltip = (vol: DisplayVolume, idx: number) => {
  if (vol._pending) return `第 ${idx + 1} 卷 正在规划中…`
  const r = displayChapterRanges.value[idx]
  return `第 ${idx + 1} 卷《${displayVolumeName(vol)}》 · 第 ${r?.start ?? 1}–${r?.end ?? 1} 章`
}

const chapterTargetWords = computed(() => resolveChapterLengthPolicy(novel.value?.chapterLengthPolicy).targetWords)
const selectedAvgWords = computed(() => {
  const vol = displayedSelectedVolume.value
  if (!vol || vol._pending) return 0
  const ch = effectiveChapters(vol)
  const w = effectiveWan(vol)
  return ch > 0 && w > 0 ? Math.round((w * 10000) / ch) : 0
})
const selectedAvgWarn = computed(() => {
  if (!selectedAvgWords.value || !chapterTargetWords.value) return false
  return Math.abs(selectedAvgWords.value - chapterTargetWords.value) / chapterTargetWords.value > 0.25
})

/* ========== 章纲（内嵌章节尺 + AI 建议 + 行内增删改） ========== */
const chapterRanges = computed(() => volumeChapterRanges(volumes.value))
const activePlans = computed(() => (novel.value?.chapterPlans || []).filter(plan => plan.status !== 'archived').sort((a, b) => a.targetChapterStart - b.targetChapterStart))
const hasAnyChapters = computed(() => Boolean(novel.value?.chapters?.length))
const selectedVolumeChapters = computed(() => selectedVolume.value
  ? (novel.value?.chapters || []).filter(chapter => chapter.volumeIndex === selectedVolume.value!.volumeIndex).sort((a, b) => a.chapterIndex - b.chapterIndex)
  : [])

interface PendingPlanSuggestion {
  id: string
  volumeId: string
  checked: boolean
  sourceVersion: string
  draft: ChapterPlanDraft
}
const pendingSuggestions = ref<PendingPlanSuggestion[]>([])
const suggestingVolumeId = ref('')
const planSaving = ref(false)
const planEdit = ref<{
  volumeId: string
  isNew: boolean
  id?: string
  sug?: boolean
  expectedPlan?: string
  start: number
  end: number
  title: string
  objective: string
  horizon: ChapterPlanHorizon
} | null>(null)

function plansForVolume(volume: Volume): ChapterPlan[] {
  return activePlans.value.filter(plan => {
    const owner = volumeForChapterPlan(chapterRanges.value, plan)
    if (owner) return owner === volume.id
    return volume.volumeIndex === volumes.value.length - 1
  })
}
function suggestionsForVolume(volumeId: string): PendingPlanSuggestion[] {
  return pendingSuggestions.value.filter(item => item.volumeId === volumeId)
}
const selectedSavedPlans = computed(() => displayedSelectedVolume.value && !generating.value ? plansForVolume(displayedSelectedVolume.value) : [])
const selectedSuggestions = computed(() => displayedSelectedVolume.value && !generating.value ? suggestionsForVolume(displayedSelectedVolume.value.id) : [])
const checkedSuggestionCount = computed(() => selectedSuggestions.value.filter(item => item.checked).length)

interface CombinedPlanRow {
  id: string
  sug: boolean
  checked: boolean
  start: number
  end: number
  horizon: ChapterPlanHorizon
  title: string
  objective: string
  source: 'ai' | 'user'
  saved?: ChapterPlan
  suggestion?: PendingPlanSuggestion
}
const selectedCombinedPlanRows = computed<CombinedPlanRow[]>(() => {
  const saved: CombinedPlanRow[] = selectedSavedPlans.value.map(plan => ({
    id: plan.id,
    sug: false,
    checked: false,
    start: plan.targetChapterStart + 1,
    end: (plan.targetChapterEnd ?? plan.targetChapterStart) + 1,
    horizon: plan.horizon,
    title: plan.title,
    objective: plan.objective,
    source: plan.source === 'ai' ? 'ai' : 'user',
    saved: plan,
  }))
  const sug: CombinedPlanRow[] = selectedSuggestions.value.map(item => ({
    id: item.id,
    sug: true,
    checked: item.checked,
    start: item.draft.targetChapterStart + 1,
    end: (item.draft.targetChapterEnd ?? item.draft.targetChapterStart) + 1,
    horizon: item.draft.horizon,
    title: item.draft.title,
    objective: item.draft.objective,
    source: 'ai',
    suggestion: item,
  }))
  return [...saved, ...sug].sort((a, b) => a.start - b.start)
})

function volumeCoverageRatio(volume: Volume): number {
  const range = chapterRanges.value.find(item => item.volumeId === volume.id)
  if (!range || range.endExclusive <= range.start) return 0
  const covered = new Set<number>()
  for (const plan of plansForVolume(volume)) {
    const s = Math.max(plan.targetChapterStart, range.start)
    const e = Math.min(plan.targetChapterEnd ?? plan.targetChapterStart, range.endExclusive - 1)
    for (let ch = s; ch <= e; ch += 1) covered.add(ch)
  }
  return covered.size / Math.max(1, range.endExclusive - range.start)
}

const selectedCoveredChapters = computed(() => {
  const range = selectedDisplayRange.value
  if (!range) return 0
  const covered = new Set<number>()
  for (const row of selectedSavedPlans.value) {
    const s = Math.max(row.targetChapterStart + 1, range.start)
    const e = Math.min((row.targetChapterEnd ?? row.targetChapterStart) + 1, range.end)
    for (let ch = s; ch <= e; ch += 1) covered.add(ch)
  }
  return covered.size
})

const selectedRulerBlocks = computed(() => {
  const range = selectedDisplayRange.value
  if (!range) return []
  const total = Math.max(1, range.end - range.start + 1)
  return selectedCombinedPlanRows.value.flatMap(row => {
    const s = Math.max(row.start, range.start)
    const e = Math.min(row.end, range.end)
    if (e < s) return []
    const left = ((s - range.start) / total) * 100
    const width = ((e - s + 1) / total) * 100
    return [{
      id: row.id,
      title: row.title,
      cls: row.sug ? 'sug' : horizonClass(row.horizon),
      left,
      width,
      tooltip: `${formatChapterRange(row.start, row.end)} · ${row.title}${row.sug ? '（待确认）' : ''}`,
    }]
  })
})

const selectedRulerSummary = computed(() => {
  const range = selectedDisplayRange.value
  if (!range) return '还没有章纲'
  const total = Math.max(1, range.count || (range.end - range.start + 1))
  if (selectedSavedPlans.value.length) {
    const cov = selectedCoveredChapters.value
    if (cov < total) return `已排 ${cov} / ${total} 章，第 ${range.start + cov}–${range.end} 章写到前再排`
    return `已排 ${cov} / ${total} 章`
  }
  if (selectedSuggestions.value.length) return 'AI 建议待确认'
  return '还没有章纲'
})

const needsFirstVolumePlan = computed(() => displayedSelectedIndex.value === 0
  && !selectedSavedPlans.value.length && !selectedSuggestions.value.length
  && suggestingVolumeId.value !== displayedSelectedVolume.value?.id)

const aiPlanButtonLabel = computed(() => {
  if (suggestingVolumeId.value === displayedSelectedVolume.value?.id) return '正在生成章纲…'
  if (selectedSavedPlans.value.length) return 'AI 接着排章纲'
  return displayedSelectedIndex.value === 0 ? 'AI 生成本卷章纲' : 'AI 展开本卷章纲'
})

function focusPlanRow(planId: string) {
  focusedPlanId.value = planId
  const el = detailBodyRef.value?.querySelector<HTMLElement>(`.plan[data-plan="${planId}"]`)
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  setTimeout(() => { if (focusedPlanId.value === planId) focusedPlanId.value = '' }, 1400)
}

async function suggestPlansForSelectedVolume() {
  const vol = displayedSelectedVolume.value
  if (!novel.value || !vol || busy.value || suggestingVolumeId.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.warning('请先在设置中配置大纲模型'); return }
  suggestingVolumeId.value = vol.id
  const owner = novelId.value
  const range = selectedDisplayRange.value
  try {
    const memories = workspace.getStoryMemories(owner)
    const sourceVersion = chapterPlanningSourceVersion(novel.value, memories, knowledgeStore.knowledgeBases)
    const drafts = await generateChapterPlanDrafts(novel.value, model, memories)
    if (owner !== novelId.value) return
    const items: PendingPlanSuggestion[] = drafts.map((draft, idx) => {
      let start0 = draft.targetChapterStart
      let end0 = draft.targetChapterEnd
      if (range && range.start > 1 && start0 + 1 < range.start) {
        const span = Math.max(0, end0 - start0)
        start0 = range.start - 1 + idx * Math.max(1, span + 1)
        end0 = Math.min(range.end - 1, start0 + span)
      }
      return {
        id: `sug-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
        volumeId: vol.id,
        checked: true,
        sourceVersion,
        draft: { ...draft, targetChapterStart: start0, targetChapterEnd: Math.max(start0, end0) },
      }
    })
    pendingSuggestions.value = [...pendingSuggestions.value.filter(item => item.volumeId !== vol.id), ...items]
    if (!items.length) msg.info('模型未返回可用的章纲建议')
  } catch (error) {
    msg.error(errorText(error, '生成本卷章纲失败'))
  } finally {
    suggestingVolumeId.value = ''
  }
}

function toggleSuggestionChecked(id: string, checked: boolean) {
  pendingSuggestions.value = pendingSuggestions.value.map(item => item.id === id ? { ...item, checked } : item)
}
function dropSuggestion(id: string) {
  pendingSuggestions.value = pendingSuggestions.value.filter(item => item.id !== id)
}
function dropAllSelectedSuggestions() {
  const vol = displayedSelectedVolume.value
  if (!vol) return
  pendingSuggestions.value = pendingSuggestions.value.filter(item => item.volumeId !== vol.id)
  msg.info('已忽略 AI 建议的章纲')
}
function discardPendingSuggestions() {
  pendingSuggestions.value = []
}

async function acceptSelectedSuggestions() {
  const vol = displayedSelectedVolume.value
  if (!novel.value || !vol || planSaving.value) return
  const kept = selectedSuggestions.value.filter(item => item.checked)
  if (!kept.length) return
  planSaving.value = true
  try {
    const sourceVersion = kept[0].sourceVersion
    await novelStore.commitChapterPlanEdit(novelId.value, {
      action: 'create-batch',
      plans: kept.map(item => item.draft),
      planningSourceVersion: sourceVersion,
    })
    pendingSuggestions.value = pendingSuggestions.value.filter(item => item.volumeId !== vol.id)
    msg.success(`已加入 ${kept.length} 条章纲`)
  } catch (error) {
    msg.error(errorText(error, '保存章纲建议失败'))
  } finally {
    planSaving.value = false
  }
}

async function startNewPlan() {
  const vol = displayedSelectedVolume.value
  const range = selectedDisplayRange.value
  if (!vol || !range || busy.value) return
  const lastEnd = selectedSavedPlans.value.length
    ? Math.max(...selectedSavedPlans.value.map(p => (p.targetChapterEnd ?? p.targetChapterStart) + 1))
    : range.start - 1
  const s = Math.min(range.end, Math.max(range.start, lastEnd + 1))
  const e = Math.min(range.end, s === range.start ? s : s + 2)
  planEdit.value = {
    volumeId: vol.id,
    isNew: true,
    start: s,
    end: Math.max(s, e),
    title: '',
    objective: '',
    horizon: selectedSavedPlans.value.length ? 'near' : 'next',
  }
  await nextTick()
  planTitleInputRef.value?.focus()
}

async function startEditPlanRow(row: CombinedPlanRow) {
  const vol = displayedSelectedVolume.value
  if (!vol || planSaving.value) return
  planEdit.value = {
    volumeId: vol.id,
    isNew: false,
    id: row.id,
    sug: row.sug,
    expectedPlan: row.saved ? JSON.stringify(row.saved) : undefined,
    start: row.start,
    end: row.end,
    title: row.title,
    objective: row.objective,
    horizon: row.horizon,
  }
  await nextTick()
  planTitleInputRef.value?.focus()
}

async function savePlanEdit() {
  const pe = planEdit.value
  const range = selectedDisplayRange.value
  if (!pe || !novel.value || planSaving.value) return
  const title = pe.title.trim()
  const objective = pe.objective.trim()
  if (!title) { msg.warning('请填写章纲标题'); planTitleInputRef.value?.focus(); return }
  if (!objective) { msg.warning('请填写这几章的目标'); return }
  const s = Math.max(1, Math.round(Number(pe.start) || 1))
  const e = Math.max(s, Math.round(Number(pe.end) || s))
  if (range && (s < range.start || s > range.end)) {
    msg.warning(`起始章要在第 ${range.start}–${range.end} 章之间`)
    return
  }
  if (pe.sug && pe.id) {
    pendingSuggestions.value = pendingSuggestions.value.map(item => item.id === pe.id
      ? { ...item, draft: { ...item.draft, title, objective, horizon: pe.horizon, targetChapterStart: s - 1, targetChapterEnd: e - 1 } }
      : item)
    planEdit.value = null
    msg.success('已更新待确认建议')
    return
  }
  planSaving.value = true
  try {
    if (pe.isNew) {
      await novelStore.commitChapterPlanEdit(novelId.value, {
        action: 'create',
        data: {
          horizon: pe.horizon,
          title,
          objective,
          summary: objective,
          beats: [],
          targetChapterStart: s - 1,
          targetChapterEnd: e - 1,
          relatedArcIds: [],
          relatedEventIds: [],
          status: 'planned',
          source: 'user',
        },
      })
    } else if (pe.id) {
      await novelStore.commitChapterPlanEdit(novelId.value, {
        action: 'update',
        planId: pe.id,
        expectedPlan: pe.expectedPlan || '',
        updates: {
          horizon: pe.horizon,
          title,
          objective,
          targetChapterStart: s - 1,
          targetChapterEnd: e - 1,
        },
      })
    }
    planEdit.value = null
    msg.success('章纲已保存')
  } catch (error) {
    msg.error(errorText(error, '保存章纲失败'))
  } finally {
    planSaving.value = false
  }
}

async function deleteSavedPlan(planId: string) {
  if (!novel.value || planSaving.value) return
  const plan = activePlans.value.find(item => item.id === planId)
  if (!plan) return
  planSaving.value = true
  try {
    await novelStore.commitChapterPlanEdit(novelId.value, {
      action: 'delete',
      planId,
      expectedPlan: JSON.stringify(plan),
    })
    msg.success(`已删除章纲「${plan.title}」`)
  } catch (error) {
    msg.error(errorText(error, '删除章纲失败'))
  } finally {
    planSaving.value = false
  }
}

/* ========== 结构字段提取与双列解析 ========== */
const ordinalMismatches = computed(() => volumeOrdinalMismatches(volumes.value))
const outlineVolumeSuggestions = computed(() => novel.value?.outline ? parseVolumesFromText(novel.value.outline, skeletonBeats.value.map(b => b.id)) : [])

type VolumeCardField = 'target' | 'conflict' | 'turning' | 'closure'
function textOrUnfilled(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '未填写'
}
function summaryLabel(summary: string, label: '目标' | '冲突' | '转折' | '收束') {
  const line = summary.split(/\r?\n/)
    .map(item => item.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+)/, '').replace(/\*\*|__|`/g, '').trim())
    .find(item => item.startsWith(label + '：') || item.startsWith(label + ':'))
  return line ? textOrUnfilled(line.slice(label.length + 1)) : '未填写'
}
function volumeCardField(volume: Volume, field: VolumeCardField) {
  if (field === 'turning') {
    const turning = textOrUnfilled(volume.keyTurningPoints)
    return turning === '未填写' ? summaryLabel(volume.summary, '转折') : turning
  }
  if (field === 'target') return summaryLabel(volume.summary, '目标')
  if (field === 'conflict') return summaryLabel(volume.summary, '冲突')
  return summaryLabel(volume.summary, '收束')
}
function volumeGoalBrief(vol: DisplayVolume): string {
  const goal = volumeCardField(vol, 'target')
  if (goal !== '未填写') return goal
  if (vol._pending) return '正在规划…'
  const extra = extraNarrativeSummary(vol).split(/\r?\n/).find(line => line.trim())
  return extra?.trim() || '还没写本卷目标'
}
function turningPointLines(volume: Volume): string[] {
  const raw = volumeCardField(volume, 'turning')
  if (!raw || raw === '未填写') return []
  return normalizeVolumeTurningPoints(raw).split('\n').filter(Boolean)
}

function parsedPeople(volume: Volume): Array<{ name: string; before: string; after: string }> {
  const raw = (volume.characterChanges || '').trim()
  if (!raw) return []
  return raw.split(/\r?\n|(?<=[。；;])\s*(?=[\u4e00-\u9fa5]{1,6}[：:从])/)
    .map(line => line.replace(/^\s*[-*+•]\s*/, '').replace(/\*\*|__/g, '').trim())
    .filter(Boolean)
    .map(line => {
      const colonArrow = /^([^：:]{1,14})[：:]\s*(.+?)\s*(?:→|->|转为|变成|变为)\s*(.+)$/.exec(line)
      if (colonArrow) return { name: colonArrow[1].trim(), before: colonArrow[2].trim(), after: colonArrow[3].trim() }
      const colonOnly = /^([^：:]{1,14})[：:]\s*(.+)$/.exec(line)
      if (colonOnly) return { name: colonOnly[1].trim(), before: colonOnly[2].trim(), after: '' }
      const fromTo = /^([\u4e00-\u9fa5]{2,5})从(.+?)(?:转为|变为|变成|成长为)(.+)$/.exec(line)
      if (fromTo) return { name: fromTo[1].trim(), before: fromTo[2].trim(), after: fromTo[3].trim() }
      return { name: '', before: line, after: '' }
    })
}

function parsedSeeds(volume: Volume): Array<{ scope: '本卷' | '跨卷'; text: string }> {
  const lines = (volume.summary || '').split(/\r?\n/)
  const result: Array<{ scope: '本卷' | '跨卷'; text: string }> = []
  let inSeedBlock = false
  for (const rawLine of lines) {
    const clean = rawLine.replace(/\*\*|__|`/g, '').trim()
    if (!clean) continue
    if (/^(?:#{1,6}\s*|[-*+]\s*)?(?:卷级伏笔|伏笔)[：:]?$/.test(clean)) { inSeedBlock = true; continue }
    const direct = /^(?:[-*+]\s*)?(本卷伏笔|本卷|跨卷铺垫|跨卷)[：:]\s*(.+)$/.exec(clean)
    if (direct) {
      result.push({ scope: direct[1].startsWith('跨卷') ? '跨卷' : '本卷', text: direct[2].trim() })
      continue
    }
    if (inSeedBlock) {
      if (/^(?:#{1,6}\s*|\*\*|[^：:]{1,10}[：:])/.test(clean) && !/^[-*+]\s+/.test(rawLine)) {
        inSeedBlock = false
      } else {
        const text = clean.replace(/^[-*+]\s*/, '')
        if (text) result.push({ scope: /跨卷|后续|第\s*\d+\s*卷/.test(text) ? '跨卷' : '本卷', text })
      }
    }
  }
  return result
}

function extraNarrativeSummary(volume: Volume): string {
  const lines = (volume.summary || '').split(/\r?\n/)
  const kept: string[] = []
  let skipListSection = false
  for (const line of lines) {
    const clean = line.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+)/, '').replace(/\*\*|__|`/g, '').trim()
    if (!clean) continue
    if (/^(?:核心主题|主题|剧情概要|目标|冲突|收束|转折|关键转折点?|本卷角色变化|角色变化|人物变化|预估章节数和字数|预估章节数|预估字数|承担的骨架节点|骨架节点|卷级伏笔|本卷伏笔|跨卷铺垫)[：:]?/.test(clean)) {
      skipListSection = /^(?:关键转折点?|本卷角色变化|角色变化|人物变化|卷级伏笔)[：:]?\s*$/.test(clean)
      continue
    }
    if (skipListSection && /^\s*[-*+]\s+/.test(line)) continue
    skipListSection = false
    kept.push(line)
  }
  return kept.join('\n').trim()
}

function chapterNumbers(volume: Volume) {
  return (novel.value?.chapters || [])
    .filter(chapter => chapter.volumeIndex === volume.volumeIndex)
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map(chapter => chapter.chapterIndex + 1)
}

/* ========== 编辑、移动、版本、删除、生成 ========== */
const editingId = ref('')
const regeneratingId = ref('')
const saving = ref(false)
const busy = computed(() => saving.value || generating.value || !!regeneratingId.value)
const isEditingSelected = computed(() => !generating.value && !!displayedSelectedVolume.value && editingId.value === displayedSelectedVolume.value.id)

type PlanningBaseline = ReturnType<typeof novelStore.capturePlanningEditBaseline>
const editBaseline = ref<PlanningBaseline>()
const versionBaseline = ref<PlanningBaseline>()
const deleteBaselines = new Map<string, PlanningBaseline>()
let generationController: AbortController | undefined
const abortGeneration = () => generationController?.abort(new DOMException('已离开分卷规划', 'AbortError'))
onDeactivated(abortGeneration)
onBeforeUnmount(abortGeneration)

const editForm = ref({
  title: '',
  theme: '',
  goal: '',
  conflict: '',
  turnsText: '',
  closure: '',
  characterChanges: '',
  seedsText: '',
  extraSummary: '',
  estimatedChapters: 1,
  estimatedWordCount: 0.225,
})
const volumeDrafts = reactive(new Map<string, { form: typeof editForm.value; baseline: PlanningBaseline }>())
const hasDrafts = computed(() => !!editingId.value || volumeDrafts.size > 0)

function buildEditFormFromVolume(vol: Volume): typeof editForm.value {
  const target = volumeCardField(vol, 'target')
  const conflict = volumeCardField(vol, 'conflict')
  const closure = volumeCardField(vol, 'closure')
  const seeds = parsedSeeds(vol)
  return {
    title: vol.title,
    theme: vol.theme,
    goal: target === '未填写' ? '' : target,
    conflict: conflict === '未填写' ? '' : conflict,
    turnsText: turningPointLines(vol).join('\n'),
    closure: closure === '未填写' ? '' : closure,
    characterChanges: vol.characterChanges,
    seedsText: seeds.map(item => `${item.scope}：${item.text}`).join('\n'),
    extraSummary: extraNarrativeSummary(vol),
    estimatedChapters: vol.estimatedChapters || 1,
    estimatedWordCount: vol.estimatedWordCount || 0.225,
  }
}

function buildSummaryFromEditForm(form: typeof editForm.value): string {
  const parts: string[] = []
  if (form.extraSummary.trim()) parts.push(form.extraSummary.trim())
  if (form.goal.trim()) parts.push(`目标：${form.goal.trim()}`)
  if (form.conflict.trim()) parts.push(`冲突：${form.conflict.trim()}`)
  if (form.closure.trim()) parts.push(`收束：${form.closure.trim()}`)
  const seedLines = form.seedsText.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  if (seedLines.length) {
    parts.push('**卷级伏笔**：')
    for (const line of seedLines) {
      const m = /^(本卷|跨卷)[^：:]*[：:]\s*(.+)$/.exec(line)
      parts.push(m ? `- ${m[1] === '跨卷' ? '跨卷铺垫' : '本卷伏笔'}：${m[2].trim()}` : `- 本卷伏笔：${line}`)
    }
  }
  return parts.join('\n')
}

watch(novelId, () => {
  abortGeneration()
  volumeDrafts.clear(); deleteBaselines.clear()
  pendingSuggestions.value = []; planEdit.value = null
  editingId.value = ''; editBaseline.value = undefined; selectedVolumeId.value = ''
  menuOpen.value = false; drawerOpen.value = false; versionVolume.value = null; versionBaseline.value = undefined
})

function selectDisplayedVolume(vol: DisplayVolume, idx: number) {
  menuOpen.value = false
  if (generating.value) {
    if (vol._pending && !vol.title) return
    streamingSelectedIdx.value = idx
    streamingFollowLatest.value = idx === streamingVolumes.value.length - 1
    return
  }
  selectVolume(vol.id)
}

function selectVolume(id: string) {
  if (busy.value) return
  menuOpen.value = false
  if (planEdit.value && planEdit.value.volumeId !== id) planEdit.value = null
  if (id === selectedVolumeId.value) return
  if (editingId.value) {
    if (editBaseline.value) volumeDrafts.set(editingId.value, { form: { ...editForm.value }, baseline: editBaseline.value })
    editingId.value = ''
  }
  selectedVolumeId.value = id
  const draft = volumeDrafts.get(id)
  if (draft) {
    editForm.value = { ...draft.form }
    editBaseline.value = draft.baseline
    editingId.value = id
  }
}

function cancelEdit() {
  if (busy.value) return
  volumeDrafts.delete(editingId.value)
  editingId.value = ''
  editBaseline.value = undefined
}

function initializeSelection() {
  if (volumes.value.length && !selectedVolumeId.value) selectedVolumeId.value = volumes.value[0].id
}

function startEdit(vol: Volume) {
  if (busy.value || !vol) return
  selectVolume(vol.id)
  if (editingId.value === vol.id) return
  editingId.value = vol.id
  editBaseline.value = novelStore.capturePlanningEditBaseline(novelId.value, vol.id)
  editForm.value = buildEditFormFromVolume(vol)
}

async function saveEdit(volId: string) {
  if (busy.value || !editBaseline.value) return
  if (!(editForm.value.estimatedChapters > 0) || !(editForm.value.estimatedWordCount > 0)) {
    msg.warning('请填写有效的预估章节数和字数')
    return
  }
  if (!editForm.value.title.trim()) {
    msg.warning('请给这一卷起个名字')
    return
  }
  saving.value = true
  try {
    await novelStore.updateVolumeWithImpact(novelId.value, volId, {
      title: editForm.value.title.trim(),
      theme: editForm.value.theme.trim(),
      summary: buildSummaryFromEditForm(editForm.value),
      keyTurningPoints: normalizeVolumeTurningPoints(editForm.value.turnsText),
      characterChanges: editForm.value.characterChanges.trim(),
      estimatedChapters: Math.round(editForm.value.estimatedChapters),
      estimatedWordCount: Number(editForm.value.estimatedWordCount),
    }, editBaseline.value)
    volumeDrafts.delete(volId)
    editingId.value = ''
    msg.success('已保存')
  } catch (error) { msg.error(errorText(error, '分卷保存失败')) }
  finally { saving.value = false }
}

async function saveCurrentEdit() {
  if (editingId.value) await saveEdit(editingId.value)
}

async function addManualVolume() {
  if (!novel.value || busy.value) return
  if (hasDrafts.value) { msg.warning('先保存或取消正在编辑的卷'); return }
  const volume: Volume = {
    id: crypto.randomUUID(),
    volumeIndex: Math.max(-1, ...volumes.value.map(item => item.volumeIndex)) + 1,
    title: '新分卷',
    theme: '',
    summary: '',
    keyTurningPoints: '',
    characterChanges: '',
    estimatedChapters: 20,
    estimatedWordCount: 5,
  }
  saving.value = true
  try {
    await novelStore.setVolumesWithImpact(novelId.value, [...volumes.value, volume])
    saving.value = false
    startEdit(volumes.value.find(item => item.id === volume.id)!)
  } catch (error) { msg.error(errorText(error, '新增分卷失败')) }
  finally { saving.value = false }
}

async function importOutlineVolumes() {
  if (!novel.value || busy.value || !outlineVolumeSuggestions.value.length) return
  saving.value = true
  try {
    await novelStore.setVolumesWithImpact(novelId.value, outlineVolumeSuggestions.value)
    selectedVolumeId.value = volumes.value[0]?.id || ''
    msg.success(`已从大纲导入 ${volumes.value.length} 卷`)
  } catch (error) { msg.error(errorText(error, '导入分卷建议失败')) }
  finally { saving.value = false }
}

async function moveVolume(idx: number, dir: -1 | 1) {
  const target = idx + dir
  if (busy.value || target < 0 || target >= volumes.value.length) return
  menuOpen.value = false
  saving.value = true
  try {
    const next = [...volumes.value]
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved)
    const reindexed = next.map((vol, i) => ({ ...vol, volumeIndex: i }))
    await novelStore.setVolumesWithImpact(novelId.value, reindexed)
    selectedVolumeId.value = moved.id
    msg.success(`已移到第 ${target + 1} 卷`)
  } catch (error) { msg.error(errorText(error, '调整卷序失败')) }
  finally { saving.value = false }
}

function focusSuggestedVolumeForBeat(beatId: string) {
  if (!volumes.value.length) return
  const beatIdx = skeletonBeats.value.findIndex(item => item.id === beatId)
  const ratio = skeletonBeats.value.length > 1 ? Math.max(0, beatIdx) / (skeletonBeats.value.length - 1) : 0
  const targetIdx = Math.min(volumes.value.length - 1, Math.round(ratio * (volumes.value.length - 1)))
  selectVolume(volumes.value[targetIdx].id)
  hotBeatId.value = beatId
  void nextTick(() => {
    detailBodyRef.value?.querySelector<HTMLElement>(`.bchip[data-beat="${beatId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
  setTimeout(() => { if (hotBeatId.value === beatId) hotBeatId.value = '' }, 2200)
}

async function toggleVolumeBeat(volume: Volume, beatId: string) {
  if (busy.value) return
  const currentOwnerIdx = beatOwnerIndex(beatId)
  const targetIdx = volumes.value.findIndex(v => v.id === volume.id)
  if (targetIdx < 0) return
  saving.value = true
  try {
    if (currentOwnerIdx === targetIdx) {
      const next = (volume.skeletonBeatIds || []).filter(id => id !== beatId)
      await novelStore.updateVolumeWithImpact(novelId.value, volume.id, { skeletonBeatIds: next })
    } else if (currentOwnerIdx >= 0) {
      const updated = volumes.value.map((vol, i) => {
        if (i === currentOwnerIdx) return { ...vol, skeletonBeatIds: (vol.skeletonBeatIds || []).filter(id => id !== beatId) }
        if (i === targetIdx) return { ...vol, skeletonBeatIds: [...new Set([...(vol.skeletonBeatIds || []), beatId])] }
        return vol
      })
      await novelStore.setVolumesWithImpact(novelId.value, updated)
    } else {
      const next = [...new Set([...(volume.skeletonBeatIds || []), beatId])]
      await novelStore.updateVolumeWithImpact(novelId.value, volume.id, { skeletonBeatIds: next })
    }
  } catch (error) { msg.error(errorText(error, '更新骨架节点失败')) }
  finally { saving.value = false }
}

async function stripVolumeOrdinals() {
  if (busy.value || !volumes.value.length) return
  saving.value = true
  try {
    const cleaned = volumes.value.map(vol => ({ ...vol, title: normalizeVolumeTitle(vol.title).title || vol.title, sourceVolumeNumber: undefined }))
    await novelStore.setVolumesWithImpact(novelId.value, cleaned)
    msg.success('已去掉卷名里的序号，卷号按实际顺序')
  } catch (error) { msg.error(errorText(error, '更新卷名失败')) }
  finally { saving.value = false }
}

async function prependMissingVolume() {
  if (busy.value || !volumes.value.length) return
  saving.value = true
  try {
    const first: Volume = {
      id: crypto.randomUUID(), volumeIndex: 0, title: '补入第一卷', theme: '', summary: '',
      keyTurningPoints: '', characterChanges: '', estimatedChapters: 20, estimatedWordCount: 5,
    }
    const next = [first, ...volumes.value.map((vol, idx) => ({ ...vol, volumeIndex: idx + 1 }))]
    await novelStore.setVolumesWithImpact(novelId.value, next)
    saving.value = false
    startEdit(volumes.value[0])
  } catch (error) { msg.error(errorText(error, '补入首卷失败')) }
  finally { saving.value = false }
}

function stopAndKeepGeneratedVolumes() {
  if (!generating.value) return
  userStoppedGeneration.value = true
  generationController?.abort(new DOMException('用户停止分卷生成', 'AbortError'))
}

async function generateVolumes() {
  if (!novel.value || busy.value || hasDrafts.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.error('未配置 AI 模型'); return }

  generating.value = true
  userStoppedGeneration.value = false
  streamingFollowLatest.value = true
  streamingSelectedIdx.value = 0
  streamContent.value = ''
  menuOpen.value = false
  planEdit.value = null
  const owner = novelId.value, baseline = novelStore.capturePlanningEditBaseline(owner)
  const directionBaseline = workspace.captureCreationEditBaseline(owner)
  const controller = generationController = new AbortController()
  let fullContent = ''
  const direction = workspace.getCreationDraft(owner)
  const beatIds = direction?.skeletons.find(item => item.id === direction.selectedSkeletonId && item.approval === 'approved')?.beats.map(item => item.id)
  streamingBeatIds.value = beatIds

  try {
    const messages = buildVolumePlanningPrompt(novel.value, direction)
    const knowledgeContext = buildBoundKnowledgeContext(novel.value, `${novel.value.title}\n${novel.value.outline}`, 10, 900)
    const userMessage = messages.find(message => message.role === 'user')
    if (knowledgeContext && userMessage && typeof userMessage.content === 'string') {
      userMessage.content += `\n\n${knowledgeContext}\n\n请优先依据知识库中的事实、时间线和设定进行分卷规划。`
    }
    const result = await callAI({
      model,
      skillTask: 'planning',
      messages,
      stream: true,
      signal: controller.signal,
      noAutomaticRetry: true,
      onChunk: (chunk) => {
        fullContent += chunk
        streamContent.value = fullContent
      },
    })
    controller.signal.throwIfAborted()
    if (owner !== novelId.value) throw new Error('作品已切换，生成结果未保存。')
    if (directionBaseline !== workspace.captureCreationEditBaseline(owner)) throw new Error('作品契约或故事方向已经变化，分卷结果未保存，请重新核对。')
    if (result.finishReason && result.finishReason !== 'stop') throw new Error('分卷结果未完整结束，请重新生成。')
    fullContent ||= result.content
    if (!fullContent.trim()) throw new Error('AI 未返回分卷内容，原规划已保留。')

    const parsedVolumes = parseVolumesFromText(fullContent, beatIds)
    if (parsedVolumes.length > 0) {
      await novelStore.setVolumesWithImpact(owner, parsedVolumes, baseline)
      selectedVolumeId.value = volumes.value[0]?.id || parsedVolumes[0]?.id || ''
      msg.success(`已规划 ${parsedVolumes.length} 卷`)
    } else {
      const fallbackId = Date.now().toString(36)
      await novelStore.setVolumesWithImpact(owner, [{
        id: fallbackId, volumeIndex: 0, title: '全卷', theme: '', summary: fullContent,
        keyTurningPoints: '', characterChanges: '', estimatedChapters: 0, estimatedWordCount: 0,
      }], baseline)
      selectedVolumeId.value = volumes.value[0]?.id || fallbackId
      msg.info('已保存分卷内容（建议手动编辑分卷结构）')
    }
  } catch (err: any) {
    if (userStoppedGeneration.value) {
      if (owner === novelId.value && directionBaseline === workspace.captureCreationEditBaseline(owner)) {
        const kept = parseVolumesFromText(fullContent, beatIds)
          .filter(v => (v.title && v.title !== '未命名分卷') || v.summary.trim())
        if (kept.length > 0) {
          try {
            await novelStore.setVolumesWithImpact(owner, kept, baseline)
            selectedVolumeId.value = volumes.value[0]?.id || kept[0]?.id || ''
            msg.info(`已停止生成，保留已规划的 ${kept.length} 卷`)
          } catch (saveErr: any) {
            msg.error(saveErr?.message || '保存已完成分卷失败')
          }
        } else {
          msg.info('已停止生成，原分卷规划已保留')
        }
      }
      return
    }
    msg.error(err.message || '生成失败')
  } finally {
    generating.value = false
    userStoppedGeneration.value = false
    generationController = undefined
    streamContent.value = ''
    streamingBeatIds.value = undefined
    initializeSelection()
  }
}

function hasEstimateConflict(volume: Volume) {
  const values = parseVolumeEstimates(volume.summary)
  return (values.estimatedChapters !== undefined && values.estimatedChapters !== volume.estimatedChapters)
    || (values.estimatedWordCount !== undefined && values.estimatedWordCount !== volume.estimatedWordCount)
}
async function syncEstimates(volume: Volume) {
  if (busy.value) return
  saving.value = true
  const values = parseVolumeEstimates(volume.summary)
  try {
    await novelStore.updateVolumeWithImpact(novelId.value, volume.id, {
      estimatedChapters: values.estimatedChapters ?? volume.estimatedChapters,
      estimatedWordCount: values.estimatedWordCount ?? volume.estimatedWordCount,
    })
    msg.success('已同步概要中的预估，原数值已保留在历史版本')
  } catch (error) { msg.error(errorText(error, '分卷保存失败')) }
  finally { saving.value = false }
}

async function regenerateVolume(volume: Volume) {
  if (!novel.value || busy.value || hasDrafts.value) return
  const model = configStore.getModelForTask('outline')
  if (!model) { msg.warning('请先配置大纲模型'); return }
  regeneratingId.value = volume.id
  menuOpen.value = false
  const owner = novelId.value, baseline = novelStore.capturePlanningEditBaseline(owner, volume.id)
  const controller = generationController = new AbortController()
  try {
    const knowledgeContext = buildBoundKnowledgeContext(novel.value, `${novel.value.title}\n${novel.value.outline}\n${volume.title}\n${volume.summary}`, 10, 900)
    const result = await callAI({
      model,
      skillTask: 'planning',
      maxTokens: 1800,
      signal: controller.signal,
      noAutomaticRetry: true,
      messages: [{ role: 'system', content: `你是长篇小说分卷编辑。只重写指定分卷，不改动其他分卷，只输出严格 JSON。\n\n${knowledgeContext || '当前小说没有匹配的挂载知识库内容。'}` }, {
        role: 'user',
        content: `根据全书大纲和当前分卷内容，重新生成第 ${volume.volumeIndex + 1} 卷的局部规划。\n\n【全书大纲】\n${novel.value.outline.slice(0, 7000)}\n\n【当前分卷】\n${JSON.stringify(volume)}\n\n输出：{"title":"卷名","theme":"主题","summary":"目标：...\\n冲突：...\\n收束：...","keyTurningPoints":"关键转折","characterChanges":"角色变化","estimatedChapters":20,"estimatedWordCount":5}`,
      }],
    })
    controller.signal.throwIfAborted()
    if (owner !== novelId.value) throw new Error('作品已切换，生成结果未保存。')
    if (result.finishReason && result.finishReason !== 'stop') throw new Error('分卷结果未完整结束，请重新生成。')
    const parsed = parseAiJsonObject<Partial<Volume>>(result.content)
    if (!parsed?.title || !parsed.summary) throw new Error('模型没有返回完整的分卷规划')
    await novelStore.updateVolumeWithImpact(owner, volume.id, {
      title: String(parsed.title).trim(),
      theme: String(parsed.theme || '').trim(),
      summary: String(parsed.summary).trim(),
      keyTurningPoints: String(parsed.keyTurningPoints || '').trim(),
      characterChanges: String(parsed.characterChanges || '').trim(),
      estimatedChapters: Math.max(1, Math.round(Number(parsed.estimatedChapters) || volume.estimatedChapters || 1)),
      estimatedWordCount: Math.max(0.1, Number(parsed.estimatedWordCount) || volume.estimatedWordCount || 1),
    }, baseline)
    msg.success(`第 ${volume.volumeIndex + 1} 卷已重写，旧版本在「版本」里`)
  } catch (error) {
    msg.error(errorText(error, '分卷重写失败'))
  } finally {
    regeneratingId.value = ''
    generationController = undefined
  }
}

function captureDeleteBaseline(show: boolean, volId: string) {
  if (show) deleteBaselines.set(volId, novelStore.capturePlanningEditBaseline(novelId.value, volId))
}
function askRemoveVolume(volume: Volume) {
  if (busy.value) return
  captureDeleteBaseline(true, volume.id)
  dialog.warning({
    title: '删除分卷',
    content: `删除第 ${volume.volumeIndex + 1} 卷「${volume.title || '未命名分卷'}」的分卷规划？`,
    positiveText: '删除', negativeText: '取消',
    onPositiveClick: () => { void removeVolume(volume.id) },
  })
}
async function removeVolume(volId: string) {
  if (busy.value) return
  saving.value = true
  try {
    if (await novelStore.deleteVolumeWithImpact(novelId.value, volId, deleteBaselines.get(volId))) msg.success('已删除')
  } catch (error) { msg.error(errorText(error, '分卷删除失败')) }
  finally { saving.value = false }
}

/* ========== 右侧资料与版本抽屉 ========== */
type DrawerTab = 'contract' | 'direction' | 'records' | 'vol-versions'
const drawerOpen = ref(false)
const drawerTab = ref<DrawerTab>('records')
const versionVolume = ref<Volume | null>(null)

function openDrawer(tab: DrawerTab) {
  menuOpen.value = false
  drawerTab.value = tab
  drawerOpen.value = true
}
function openVolumeVersionsDrawer(volume: Volume) {
  if (busy.value) return
  versionVolume.value = JSON.parse(JSON.stringify(volume))
  versionBaseline.value = novelStore.capturePlanningEditBaseline(novelId.value, volume.id)
  openDrawer('vol-versions')
}
function closeDrawer() { drawerOpen.value = false }

const drawerTitle = computed(() => {
  if (drawerTab.value === 'vol-versions' && versionVolume.value) {
    return `第 ${versionVolume.value.volumeIndex + 1} 卷《${versionVolume.value.title || '未命名分卷'}》的版本`
  }
  return '资料与记录'
})

const contractRows = computed(() => {
  const c = creationDraft.value?.contract
  if (!c) return []
  const join = (...vals: Array<string | undefined>) => vals.map(v => (v || '').trim()).filter(Boolean).join(' · ') || '未填写'
  const fmtWords = (n?: number) => n && n > 0 ? `${formatWan(n / 10000)}万字` : ''
  const rangeStr = c.targetWordCountMin && c.targetWordCountMax
    ? `${fmtWords(c.targetWordCountMin)}至${fmtWords(c.targetWordCountMax)}`
    : fmtWords(c.targetWordCountMin) || fmtWords(c.targetWordCountMax)
  const formatLabel = c.format === 'serial' ? '连载' : c.format === 'complete' ? '完本' : '暂不确定'
  return [
    { label: '类型与读者', value: join(c.genre, c.subGenre, c.audience) },
    { label: '篇幅与节奏', value: join(formatLabel, rangeStr, c.pacingDirection) },
    { label: '视角与文风', value: join(c.pointOfView, c.tense, c.styleDirection) },
    { label: '主题与承诺', value: join(c.coreTheme, c.readerPromise) },
    { label: '主角', value: join(c.protagonistPremise, c.protagonistGoal, c.protagonistFear) },
    { label: '主线冲突', value: join(c.centralConflict) },
    { label: '感情线', value: join(c.romanceDirection) },
    { label: '世界规则与禁区', value: join(...(c.worldRules || []), ...(c.forbiddenTopics || [])) },
    { label: '结局方向', value: join(c.endingDirection) },
  ]
})

const FIELD_LABELS: Record<string, string> = {
  $exists: '新建/删除',
  chapterPlanConfirmed: '规划确认状态',
  skeletonBeatIds: '骨架节点落卷',
  title: '名称',
  theme: '主题',
  summary: '剧情概要',
  keyTurningPoints: '关键转折',
  characterChanges: '角色变化',
  estimatedChapters: '预估章数',
  estimatedWordCount: '预估字数',
  outline: '总大纲',
  volumes: '分卷结构',
  chapterPlans: '章纲',
  status: '状态',
  'creationDraft.contract': '作品契约',
  'creationDraft.skeletons': '故事骨架',
  'creationDraft.outlineCandidate': '大纲候选',
  creationDraft: '创作草稿',
}
const formatRecordField = (field: string) => FIELD_LABELS[field] || field

const recordEntries = computed(() => {
  const reports = workspace.getImpactReports(novelId.value) || []
  return [...reports].reverse().slice(0, 30).map(report => {
    const first = report.changes[0]
    const actionLabel = first?.action === 'create' ? '新建' : first?.action === 'delete' ? '删除' : first?.action === 'confirm' ? '确认' : '更新'
    const title = first ? `${actionLabel} · ${first.target.label || first.target.kind}` : '结构变更'
    const text = report.changes.map(c => `${c.target.label || c.target.kind}（${c.fields.map(formatRecordField).join('、')}）`).join('；') || '已保存变更记录。'
    const tone = first?.action === 'confirm' ? 'ok' : first?.action === 'delete' ? 'warn' : 'author'
    return {
      id: report.id,
      title,
      text,
      tone,
      time: new Date(report.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    }
  })
})

const volumeVersionCards = computed(() => {
  const vol = versionVolume.value
  if (!vol?.versions?.length) return []
  return [...vol.versions].reverse().map(ver => {
    const diffs = comparePlanningVersions(ver, vol)
    return {
      id: ver.id,
      label: ver.label,
      time: new Date(ver.savedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      same: diffs.length === 0,
      diffs,
    }
  })
})

async function restoreVersionById(versionId: string) {
  if (busy.value || !versionVolume.value || !versionBaseline.value) return
  const version = versionVolume.value.versions?.find(item => item.id === versionId)
  if (!version) return
  saving.value = true
  try {
    const snapshot = JSON.parse(version.snapshot) as Partial<Volume>
    await novelStore.updateVolumeWithImpact(novelId.value, versionVolume.value.id, {
      title: String(snapshot.title || versionVolume.value.title),
      theme: String(snapshot.theme || ''),
      summary: String(snapshot.summary || ''),
      keyTurningPoints: String(snapshot.keyTurningPoints || ''),
      characterChanges: String(snapshot.characterChanges || ''),
      estimatedChapters: snapshot.estimatedChapters ?? versionVolume.value.estimatedChapters,
      estimatedWordCount: snapshot.estimatedWordCount ?? versionVolume.value.estimatedWordCount,
      sourceVolumeNumber: snapshot.sourceVolumeNumber,
      skeletonBeatIds: snapshot.skeletonBeatIds ?? [],
    }, versionBaseline.value)
    const refreshed = volumes.value.find(vol => vol.id === versionVolume.value?.id)
    if (refreshed) {
      versionVolume.value = JSON.parse(JSON.stringify(refreshed))
      versionBaseline.value = novelStore.capturePlanningEditBaseline(novelId.value, refreshed.id)
    }
    msg.success('分卷规划已恢复')
  } catch (error) { msg.error(errorText(error, '分卷恢复失败')) }
  finally { saving.value = false }
}

/* ========== 底部 6 项检查清单同步给父组件 ========== */
const planningChecks = computed<VolumePlannerCheckItem[]>(() => {
  const totalWan = displayedTotalWords.value
  const range = contractRange.value
  const lengthOk = !range || (totalWan >= range[0] && totalWan <= range[1])
  const lengthText = !range ? ''
    : totalWan < range[0]
      ? `全书约 ${formatWan(totalWan)} 万字，比契约少 ${formatWan(range[0] - totalWan)} 万字`
      : `全书约 ${formatWan(totalWan)} 万字，比契约多 ${formatWan(totalWan - range[1])} 万字`
  const pendingCount = pendingSuggestions.value.length
  return [
    { key: 'vols', ok: volumes.value.length > 0, block: true, text: '至少一卷分卷规划' },
    { key: 'plans', ok: activePlans.value.length > 0, block: true, text: '至少一条章纲（选中第 1 卷，点「AI 生成本卷章纲」或「手写一条」）' },
    { key: 'length', ok: lengthOk, block: false, text: lengthText },
    { key: 'beats', ok: !unassignedBeats.value.length, block: false, text: `骨架节点「${unassignedBeats.value.map(b => b.title).join('」「')}」还没落到任何一卷` },
    { key: 'order', ok: !ordinalMismatches.value.length, block: false, text: '卷名里的序号和实际顺序对不上' },
    { key: 'sug', ok: !pendingCount, block: false, text: `有 ${pendingCount} 条 AI 建议的章纲没确认，确认分卷后会丢弃` },
  ]
})

const summaryState = computed<VolumePlannerSummaryState>(() => {
  const draftId = editingId.value || [...volumeDrafts.keys()][0] || ''
  const draftIdx = draftId ? volumes.value.findIndex(v => v.id === draftId) : -1
  return {
    generating: generating.value,
    streamingCompleted: doneVolumeCount.value,
    hasVolumes: volumes.value.length > 0,
    hasDrafts: hasDrafts.value,
    draftVolumeIndex: draftIdx,
    draftVolumeId: draftId,
    viewingDraftVolume: Boolean(draftId && draftId === selectedVolumeId.value),
    pendingSuggestionsCount: pendingSuggestions.value.length,
    checks: planningChecks.value,
  }
})
watch(summaryState, value => emit('state-change', value), { immediate: true, deep: true })

watch([volumes, generating], () => {
  if (generating.value) return
  initializeSelection()
  if (selectedVolumeId.value && !volumes.value.find(vol => vol.id === selectedVolumeId.value)) {
    selectedVolumeId.value = volumes.value[0]?.id || ''
  }
  for (const id of volumeDrafts.keys()) if (!volumes.value.some(volume => volume.id === id)) volumeDrafts.delete(id)
  if (editingId.value && !volumes.value.some(volume => volume.id === editingId.value)) editingId.value = ''
}, { immediate: true })

function closeMenuOnDocClick() { if (menuOpen.value) menuOpen.value = false }
function onDocKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (drawerOpen.value) closeDrawer()
  else if (menuOpen.value) menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('click', closeMenuOnDocClick)
  document.addEventListener('keydown', onDocKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', closeMenuOnDocClick)
  document.removeEventListener('keydown', onDocKeydown)
})

defineExpose({
  stopAndKeepGeneratedVolumes,
  saveCurrentEdit,
  cancelEdit,
  selectVolume,
  addManualVolume,
  generateVolumes,
  importOutlineVolumes,
  discardPendingSuggestions,
})
</script>

<style scoped>
.volume-page {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  position: relative;
}
.muted { color: var(--ink-4); }
.sp { flex: 1; }
.rot180 { transform: rotate(180deg); }

/* ========== 按钮、徽章、方印、编号（与原型 1:1） ========== */
.pbtn {
  height: 32px;
  padding: 0 12px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  border: 1px solid var(--line-2);
  background: var(--paper);
  color: var(--ink-2);
  white-space: nowrap;
  cursor: pointer;
  transition: border-color .15s, color .15s, background .15s, opacity .15s;
}
.pbtn:hover:not(:disabled) { border-color: var(--ink-3); color: var(--ink); }
.pbtn.pri { background: var(--ink); border-color: var(--ink); color: var(--paper); }
.pbtn.pri:hover:not(:disabled) { opacity: .88; color: var(--paper); }
.pbtn.zhu { background: var(--zhu); border-color: var(--zhu); color: #fff; }
.pbtn.zhu:hover:not(:disabled) { filter: brightness(1.07); color: #fff; }
.pbtn.ghost { border-color: transparent; background: transparent; }
.pbtn.ghost:hover:not(:disabled) { background: var(--hover); }
.pbtn.sm { height: 27px; padding: 0 9px; font-size: 12px; border-radius: 5px; }
.pbtn.zhu-line { border-color: var(--zhu); color: var(--zhu); background: var(--paper); font-weight: 600; }
.pbtn.zhu-line:hover:not(:disabled) { background: var(--zhu-soft); }
.pbtn:disabled { opacity: .42; cursor: not-allowed; }
.pbadge { min-width: 17px; height: 17px; padding: 0 5px; border-radius: 9px; background: var(--panel-2); color: var(--ink-3); font: 600 10.5px/17px var(--f-num); }
.pib { width: 26px; height: 26px; border: 0; border-radius: 6px; background: transparent; display: inline-grid; place-items: center; color: var(--ink-3); cursor: pointer; }
.pib:hover:not(:disabled) { background: var(--hover); color: var(--ink); }
.pib:disabled { opacity: .42; cursor: not-allowed; }

.ptag { display: inline-flex; align-items: center; gap: 4px; height: 19px; padding: 0 7px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--panel-2); color: var(--ink-2); white-space: nowrap; }
.ptag.zhu { background: var(--zhu-soft); color: var(--zhu); }
.ptag.qing { background: var(--qing-soft); color: var(--qing); }
.ptag.jin { background: var(--jin-soft); color: var(--jin); }
.ptag.dai { background: var(--dai-soft); color: var(--dai); }
.ptag.line { background: transparent; border: 1px solid var(--line-2); color: var(--ink-3); font-weight: 500; }
.ptag.official { background: var(--zhu); color: #fff; letter-spacing: .04em; }
.ptag.bad { background: transparent; border: 1px solid var(--zhu); color: var(--zhu); }
.ptag.sug { background: transparent; border: 1px dashed var(--zhu); color: var(--zhu); }

.seal { width: 30px; height: 30px; flex: none; border: 1px solid var(--line-2); border-radius: 7px; display: grid; place-items: center; background: var(--panel); color: var(--ink-2); font: 600 16px/1 var(--f-kai); }
.seal.sm { width: 24px; height: 24px; font-size: 13px; border-radius: 6px; }
.seal.big { width: 42px; height: 42px; font-size: 22px; border-radius: 9px; }
.seal.official { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.pnum { width: 17px; height: 17px; flex: none; border-radius: 50%; display: grid; place-items: center; color: #fff; font: 600 9.5px/1 var(--f-num); }
:global([data-theme="dark"]) .pnum { color: #141311; }

.ph { height: 12px; margin: 6px 0; border-radius: 6px; background: linear-gradient(90deg, var(--panel-2), var(--line), var(--panel-2)); background-size: 200% 100%; animation: vol-shimmer 1.4s infinite linear; }
.ph-stack { display: grid; }
@keyframes vol-shimmer { to { background-position: -200% 0; } }
.cursor { color: var(--zhu); animation: vol-pulse .8s infinite; }
@keyframes vol-pulse { 50% { opacity: .35; } }

/* ========== 页头 ========== */
.page-head { flex: none; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; min-width: 0; }
.page-head > div:first-child { flex: 1 1 auto; min-width: 0; }
.page-title { margin: 0; font: 600 22px/1.3 var(--f-serif); letter-spacing: .04em; color: var(--ink); }
.page-sub { margin: 3px 0 0; color: var(--ink-3); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head-links { display: flex; align-items: center; gap: 6px; flex: none; }

/* ========== 全书结构条 ========== */
.overview { flex: none; display: grid; gap: 5px; padding: 9px 14px 6px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow-1); min-width: 0; }
.ov-head { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 12px; color: var(--ink-3); white-space: nowrap; flex-wrap: wrap; }
.ov-head b { font: 600 13.5px/1.4 var(--f-serif); color: var(--ink); letter-spacing: .06em; }
.ov-head .hint { font-size: 11.5px; color: var(--ink-4); }
.len-chip { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; border-radius: 11px; font-size: 12px; font-weight: 600; background: var(--qing-soft); color: var(--qing); }
.len-chip.warn { background: var(--jin-soft); color: var(--jin); }
.miss-chip { display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 8px 0 4px; border: 1px dashed var(--zhu); border-radius: 11px; background: transparent; color: var(--zhu); font-size: 12px; font-weight: 600; cursor: pointer; }
.miss-chip .pnum { width: 16px; height: 16px; font-size: 9px; }

.ov-body { position: relative; }
.ov-zone {
  position: absolute; top: 0; height: 44px; border-left: 1.5px dashed var(--qing); border-radius: 0 9px 9px 0;
  background: repeating-linear-gradient(135deg, var(--qing-soft) 0 6px, transparent 6px 12px);
  display: flex; align-items: center; justify-content: flex-end; padding-right: 10px;
  color: var(--qing); font-size: 11.5px; font-weight: 600; pointer-events: none;
}
.ov-bar, .ov-beats { position: relative; z-index: 1; display: flex; gap: 3px; min-width: 0; }
.ov-bar { height: 44px; }
.ov-seg {
  position: relative; flex-basis: 0; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 0 8px;
  border: 1px solid var(--line-2); border-radius: 8px; background: var(--panel); color: var(--ink);
  overflow: hidden; text-align: left; cursor: pointer; transition: border-color .15s, background .15s;
}
.ov-seg:hover:not(:disabled) { border-color: var(--ink-3); }
.ov-seg .nm { min-width: 0; display: grid; line-height: 1.25; }
.ov-seg .nm b { font: 600 13px/1.3 var(--f-serif); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-seg .nm small { font-size: 11px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ov-seg .cov { position: absolute; left: 0; bottom: 0; height: 3px; background: var(--qing); border-radius: 0 2px 0 0; }
.ov-seg.sel { border-color: var(--zhu); background: color-mix(in srgb, var(--zhu) 7%, var(--paper)); box-shadow: inset 0 0 0 1px var(--zhu); }
.ov-seg.sel .seal { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.ov-seg.editing { border-style: dashed; border-color: var(--zhu); }
.ov-seg.pending { border-style: dashed; border-color: var(--jin); }
.ov-seg.pending .nm { flex: 1; }

.ov-beats { min-height: 22px; }
.ov-beats > div { flex-basis: 0; min-width: 0; display: flex; justify-content: center; gap: 3px; overflow: hidden; padding-top: 3px; }
.ov-beat {
  display: inline-flex; align-items: center; gap: 4px; min-width: 0; height: 19px; padding: 0 7px 0 2px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--paper); font-size: 11px; color: var(--ink-2);
  white-space: nowrap; cursor: pointer;
}
.ov-beat:hover { border-color: var(--ink-3); }
.ov-beat .pnum { width: 15px; height: 15px; font-size: 9px; }
.ov-beat span:last-child { overflow: hidden; text-overflow: ellipsis; }

.ov-ruler { position: relative; height: 15px; margin-top: 1px; border-top: 1px solid var(--line); }
.ov-ruler span { position: absolute; top: 1px; transform: translateX(-50%); font: 10px/1.3 var(--f-num); color: var(--ink-4); white-space: nowrap; }
.ov-ruler span:first-child { transform: none; }
.ov-ruler span:last-of-type { transform: translateX(-100%); }
.ov-ruler i { position: absolute; top: -2px; height: 3px; border-radius: 2px; background: var(--qing); }

/* ========== 主区：左分卷列表 + 右详情 ========== */
.stage { flex: 1; min-height: 0; min-width: 0; position: relative; display: flex; flex-direction: column; }
.sgrid { flex: 1; min-height: 0; display: grid; grid-template-columns: 272px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); gap: 10px 12px; }
.sgrid > .vlist, .sgrid > .vdetail { grid-row: 2; }
.sgrid > .banner { grid-column: 1 / -1; grid-row: 1; }

.panel { min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); box-shadow: var(--shadow-1); overflow: hidden; }
.vlist-head { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 12px; border-bottom: 1px solid var(--line); flex: none; }
.vlist-head h3 { margin: 0; font: 600 14.5px/1.3 var(--f-serif); letter-spacing: .04em; color: var(--ink); }
.vlist-head small { color: var(--ink-4); font-size: 11.5px; }
.vlist-body { flex: 1; min-height: 0; overflow: auto; padding: 8px; display: grid; align-content: start; gap: 6px; }
.vlist-foot { flex: none; padding: 8px; border-top: 1px solid var(--line); display: flex; }
.vlist-foot .pbtn { flex: 1; }

.vrow {
  position: relative; display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 1px 9px; width: 100%;
  padding: 8px 10px 9px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper);
  color: var(--ink); text-align: left; cursor: pointer; transition: border-color .15s, box-shadow .15s;
}
.vrow:hover:not(:disabled) { border-color: var(--ink-3); }
.vrow > .seal { grid-row: span 3; }
.vrow-ph { grid-column: 2; }
.vrow .t { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.vrow .t b { min-width: 0; font: 600 14.5px/1.4 var(--f-serif); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vrow .t small { margin-left: auto; flex: none; color: var(--ink-3); font-size: 11.5px; }
.vrow .g { font-size: 12px; color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vrow .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
.bk { display: inline-flex; align-items: center; gap: 4px; height: 19px; padding: 0 6px; border-radius: 4px; background: var(--panel-2); color: var(--ink-2); font-size: 11px; white-space: nowrap; }
.bk i { width: 7px; height: 7px; border-radius: 50%; }
.vrow.sel { border-color: var(--zhu); box-shadow: 0 0 0 1px var(--zhu), 0 0 0 4px var(--zhu-soft); background: color-mix(in srgb, var(--zhu) 5%, var(--paper)); }
.vrow.sel > .seal { border-color: var(--zhu); background: var(--zhu); color: #fff; }
.vrow.pending { border-style: dashed; border-color: var(--jin); cursor: default; }

/* ========== 右栏：本卷详情 ========== */
.vdetail.editing { border-color: var(--zhu); border-style: dashed; }
.vd-head { flex: none; display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px 11px 16px; border-bottom: 1px solid var(--line); }
.vd-title { min-width: 0; flex: 1; }
.vd-title h3 { margin: 0; font: 600 19px/1.35 var(--f-serif); letter-spacing: .03em; color: var(--ink); overflow-wrap: anywhere; }
.vd-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 4px; font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.vd-meta.streaming-meta { color: var(--zhu); }
.vd-meta .warn { color: var(--jin); font-weight: 600; }
.vd-meta label { display: inline-flex; align-items: center; gap: 5px; }
.vd-acts { position: relative; display: flex; align-items: center; gap: 6px; flex: none; }

.name-row { display: flex; align-items: center; gap: 8px; font: 600 17px var(--f-serif); color: var(--ink-3); }
.name-row input { flex: 1; min-width: 0; height: 32px; padding: 0 9px; border: 1px solid var(--line-2); border-radius: 7px; background: var(--paper); color: var(--ink); font: 600 17px var(--f-serif); outline: none; }
.num-in, .theme-in { height: 26px; padding: 0 7px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--paper); color: var(--ink); font: 12.5px var(--f-num); outline: none; }
.num-in { width: 66px; }
.num-in.sm { width: 52px; padding: 0 5px; }
.theme-in { width: 150px; font-family: var(--f-ui); }
.name-row input:focus, .num-in:focus, .theme-in:focus, .edit-area:focus, .pe-title:focus { border-color: var(--ink-3); }

.vmenu { position: absolute; right: 0; top: 32px; z-index: 20; display: grid; min-width: 146px; padding: 5px; border: 1px solid var(--line-2); border-radius: 10px; background: var(--paper); box-shadow: var(--shadow-2); }
.vmenu button { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; font-size: 12.5px; color: var(--ink-2); text-align: left; cursor: pointer; }
.vmenu button:hover:not(:disabled) { background: var(--panel); color: var(--ink); }
.vmenu button:disabled { opacity: .4; cursor: not-allowed; }
.vmenu button.danger { color: var(--zhu); }

.vd-body { flex: 1; min-height: 0; overflow: auto; padding: 14px 16px 20px; display: grid; align-content: start; gap: 18px; }
.vd-empty { flex: 1; display: grid; place-items: center; color: var(--ink-4); font-size: 13px; }
.sec h4 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font: 600 13px/1.4 var(--f-ui); color: var(--ink-2); letter-spacing: .06em; flex-wrap: wrap; }
.sec h4 small { font-weight: 400; letter-spacing: 0; color: var(--ink-4); font-size: 11.5px; }

/* 四格本卷走向 */
.flow4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
.fcard { position: relative; min-width: 0; padding: 9px 11px 11px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
.fcard + .fcard::before { content: '→'; position: absolute; left: -14px; top: 50%; transform: translateY(-50%); color: var(--ink-4); font-size: 12px; }
.fcard .lb { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font: 600 12px/1.4 var(--f-ui); color: var(--ink-2); }
.fcard .lb i { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; color: #fff; font: 600 10px/1 var(--f-num); font-style: normal; }
:global([data-theme="dark"]) .fcard .lb i { color: #141311; }
.fcard p, .fcard li { margin: 0; font: 13px/1.72 var(--f-serif); color: var(--ink); overflow-wrap: anywhere; }
.fcard ul { margin: 0; padding-left: 1.1em; list-style: disc; }
.fcard li + li { margin-top: 4px; }
.edit-area { display: block; width: 100%; min-height: 54px; padding: 6px 8px; border: 1px solid var(--line-2); border-radius: 7px; background: var(--paper); color: var(--ink); font: 13px/1.65 var(--f-serif); resize: vertical; outline: none; }

/* 章纲：章节尺 + 列表 */
.ruler {
  position: relative; height: 26px; border: 1px solid var(--line); border-radius: 7px; overflow: hidden;
  background: repeating-linear-gradient(135deg, var(--panel-2) 0 5px, var(--panel) 5px 10px);
}
.ruler .blk { position: absolute; top: 0; bottom: 0; display: grid; place-items: center; padding: 0 4px; border-right: 1px solid var(--paper); color: #fff; font-size: 11px; overflow: hidden; white-space: nowrap; cursor: pointer; }
:global([data-theme="dark"]) .ruler .blk { color: #141311; }
.ruler .blk.next { background: var(--zhu); }
.ruler .blk.near { background: var(--dai); }
.ruler .blk.far { background: color-mix(in srgb, var(--ink-3) 80%, var(--paper)); }
.ruler .blk.sug { background: color-mix(in srgb, var(--zhu) 10%, var(--paper)); border: 1px dashed var(--zhu); color: var(--zhu); }
.ruler .blk.hot { box-shadow: inset 0 0 0 2px var(--ink); }
.ruler-scale { display: flex; justify-content: space-between; margin-top: 3px; font: 10.5px/1.4 var(--f-num); color: var(--ink-4); }
.ruler-scale b { font: 600 11.5px var(--f-ui); color: var(--ink-3); }
.hz-legend { display: flex; gap: 10px; font-size: 11px; color: var(--ink-4); font-weight: 400; letter-spacing: 0; }
.hz-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }

.sug-bar { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding: 7px 8px 7px 10px; border: 1px solid var(--zhu); border-radius: 9px; background: color-mix(in srgb, var(--zhu) 7%, var(--paper)); color: var(--zhu); font-size: 12.5px; font-weight: 600; flex-wrap: wrap; }
.plans { display: grid; gap: 6px; margin-top: 10px; }
.plan { display: grid; grid-template-columns: 10px 82px minmax(0, 1fr) auto auto; align-items: start; gap: 2px 10px; padding: 8px 8px 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--paper); transition: border-color .15s, background .15s; }
.plan .hz { width: 6px; height: 30px; margin-top: 2px; border-radius: 3px; }
.hz.next { background: var(--zhu); }
.hz.near { background: var(--dai); }
.hz.far { background: color-mix(in srgb, var(--ink-3) 80%, var(--paper)); }
.plan .rg { padding-top: 2px; font: 600 12px/1.5 var(--f-num); color: var(--ink-2); white-space: nowrap; }
.plan .pc { min-width: 0; }
.plan .pc b { font: 600 14px/1.5 var(--f-serif); color: var(--ink); }
.plan .pc p { margin: 2px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--ink-2); overflow-wrap: anywhere; }
.plan .pm { display: flex; gap: 4px; padding-top: 2px; }
.plan .pa { display: flex; gap: 2px; opacity: .35; transition: opacity .15s; }
.plan:hover .pa, .plan:focus-within .pa, .plan .pa.vis { opacity: 1; }
.plan.hot { background: var(--panel); border-color: var(--ink-3); }
.plan.sug { border: 1px dashed var(--zhu); background: color-mix(in srgb, var(--zhu) 4%, var(--paper)); }
.plan .ck { padding-top: 4px; cursor: pointer; }
.plan .ck input { accent-color: var(--zhu); margin: 0; }
.plan.editing { border-color: var(--ink-3); background: var(--panel); grid-template-columns: 10px 124px minmax(0, 1fr) auto auto; }
.plan.editing .rg { display: flex; align-items: center; gap: 3px; }
.pe-title { width: 100%; height: 28px; margin-bottom: 5px; padding: 0 8px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--paper); color: var(--ink); font: 600 13.5px var(--f-serif); outline: none; }
.plan select { height: 26px; padding: 0 6px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--paper); color: var(--ink-2); font-size: 12px; }
.ph-row { display: block; border-style: dashed; }
.outline-only { margin-top: 10px; padding: 12px 14px; border: 1px dashed var(--line-2); border-radius: 9px; color: var(--ink-3); font-size: 12.5px; line-height: 1.7; }
.outline-only.need { border-color: var(--zhu); color: var(--zhu); background: color-mix(in srgb, var(--zhu) 4%, var(--paper)); font-weight: 600; }

/* 骨架节点 & 双列列表 */
.bchips { display: flex; flex-wrap: wrap; gap: 6px; }
.bchip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 5px; border: 1px solid var(--line-2); border-radius: 14px; background: var(--paper); font-size: 12.5px; color: var(--ink-3); cursor: pointer; }
.bchip .pnum { opacity: .5; }
.bchip small { color: var(--ink-4); font-size: 11px; }
.bchip:hover:not(:disabled) { border-color: var(--ink-3); color: var(--ink); }
.bchip.on { border-color: var(--zhu); background: color-mix(in srgb, var(--zhu) 7%, var(--paper)); color: var(--ink); font-weight: 600; }
.bchip.on .pnum { opacity: 1; }
.bchip.on small { color: var(--zhu); font-weight: 600; }
.bchip.free { border: 1px dashed var(--zhu); color: var(--ink-2); }
.bchip.free small { color: var(--zhu); }
.bchip.hot { box-shadow: 0 0 0 3px var(--zhu-mid); }

.two { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
.lst { margin: 0; padding: 0; list-style: none; }
.lst li { display: flex; align-items: baseline; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 13px; line-height: 1.65; color: var(--ink-2); }
.lst li:last-child { border-bottom: 0; }
.lst li b { flex: none; color: var(--ink); font-family: var(--f-serif); }
.lst .arrow { color: var(--ink-4); margin: 0 4px; }

.volume-summary { font-size: 13px; line-height: 1.75; color: var(--ink-2); }
.written-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.written-list li { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 2px 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); font-size: 12.5px; color: var(--ink-2); }
.written-list li p, .written-list li small { grid-column: 2; margin: 0; }

/* 卷号错位横幅 */
.banner { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; border: 1px solid var(--zhu); border-radius: 10px; background: color-mix(in srgb, var(--zhu) 7%, var(--paper)); font-size: 12.5px; color: var(--ink-2); flex-wrap: wrap; }
.banner p { flex: 1; min-width: 200px; margin: 0; line-height: 1.6; }
.banner b { color: var(--zhu); }
.mark { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--zhu); color: #fff; font: 700 13px/1 var(--f-serif); }

/* 空白起步 */
.start { flex: 1; display: grid; place-items: center; overflow: auto; }
.start-inner { width: min(780px, 100%); display: grid; gap: 14px; justify-items: center; text-align: center; padding: 10px; }
.start-inner h3 { margin: 0; font: 600 20px/1.4 var(--f-serif); color: var(--ink); }
.start-inner > p { margin: 0; color: var(--ink-3); font-size: 13px; }
.choices3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; width: 100%; }
.choice { display: grid; gap: 6px; justify-items: start; align-content: start; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); color: var(--ink); text-align: left; box-shadow: var(--shadow-1); cursor: pointer; }
.choice:hover:not(:disabled) { border-color: var(--ink-3); }
.choice:disabled { opacity: .48; cursor: not-allowed; }
.choice.recommended { border-color: var(--zhu); }
.choice strong { display: flex; align-items: center; gap: 6px; font: 600 15px/1.4 var(--f-serif); }
.choice span { color: var(--ink-3); font-size: 12.5px; line-height: 1.65; }

/* 右侧滑出抽屉 */
.drawer-layer { position: fixed; inset: 0; z-index: 620; }
.scrim { position: absolute; inset: 0; background: #0000002e; }
.drawer {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(460px, 92vw);
  display: grid; grid-template-rows: auto auto minmax(0, 1fr);
  background: var(--paper); border-left: 1px solid var(--line); box-shadow: var(--shadow-3);
}
.drawer-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; }
.drawer-head h3 { margin: 0; font: 600 17px/1.4 var(--f-serif); color: var(--ink); }
.seg { display: inline-flex; padding: 2px; margin: 0 16px 10px; justify-self: start; border-radius: 8px; background: var(--panel-2); border: 1px solid var(--line); }
.seg button { height: 25px; padding: 0 11px; border: 0; border-radius: 6px; background: transparent; font-size: 12px; color: var(--ink-3); white-space: nowrap; cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--paper); color: var(--ink); box-shadow: var(--shadow-1); font-weight: 600; }
.drawer-body { overflow: auto; padding: 4px 16px 20px; display: grid; align-content: start; gap: 8px; }
.kv { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.kv b { color: var(--ink-3); font-weight: 600; font-size: 12px; }
.kv span { color: var(--ink); line-height: 1.65; overflow-wrap: anywhere; }
.kv span.undecided { color: var(--ink-4); }
.note-box { margin: 0; padding: 10px 12px; border-radius: 9px; background: var(--panel); color: var(--ink-2); font-size: 12.5px; line-height: 1.7; }
.rec { position: relative; display: grid; gap: 6px; padding: 10px 12px 10px 30px; border: 1px solid var(--line); border-radius: 10px; }
.rec::before { content: ''; position: absolute; left: 12px; top: 15px; width: 9px; height: 9px; border-radius: 50%; background: var(--ink-4); }
.rec.ok::before { background: var(--qing); }
.rec.warn::before { background: var(--jin); }
.rec.author::before { background: var(--dai); }
.rec-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.rec-top strong { font-size: 13px; color: var(--ink); }
.rec-top time { color: var(--ink-3); font-size: 12px; }
.rec p { margin: 0; color: var(--ink-2); font-size: 12.5px; line-height: 1.6; }
.rec .acts { display: flex; flex-wrap: wrap; gap: 6px; }
.diff { display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 6px 8px; font-size: 12.5px; line-height: 1.6; }
.diff b { color: var(--ink-3); font-weight: 600; }
.diff span { color: var(--ink); overflow-wrap: anywhere; }
.diff small { display: block; margin-top: 2px; color: var(--ink-4); font-size: 12px; }
.dir-card { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--zhu); border-radius: 10px; box-shadow: 0 0 0 1px var(--zhu); }
.dir-card .c-title { display: flex; align-items: center; gap: 8px; font: 600 16px var(--f-serif); }
.dir-card p { margin: 0; font: 13.5px/1.75 var(--f-serif); color: var(--ink-2); }
.beat-list { margin: 0; padding: 0; list-style: none; }
.beat-list li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-size: 13px; }
.beat-list li small { margin-left: auto; color: var(--ink-3); }
.beat-list li small.miss { color: var(--zhu); font-weight: 600; }

/* 窄窗适配 */
@media (max-width: 1180px) {
  .sgrid { grid-template-columns: 236px minmax(0, 1fr); }
  .flow4 { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .fcard + .fcard::before { display: none; }
  .head-links .lbl-long, .ov-head .hint { display: none; }
}
@media (max-width: 820px) {
  .volume-page { overflow: visible; }
  .sgrid { grid-template-columns: minmax(0, 1fr); }
  .sgrid > .vlist, .sgrid > .vdetail { grid-row: auto; }
  .flow4, .two, .choices3 { grid-template-columns: minmax(0, 1fr); }
  .page-head { flex-direction: column; align-items: stretch; }
}
@media (max-height: 760px) {
  .ov-ruler { display: none; }
  .ov-bar, .ov-zone { height: 38px; }
}
</style>
