<template>
  <Teleport defer to="#v3-crumb"><router-link class="crumb-link" to="/">书架</router-link><span class="crumb-sep">/</span><span class="crumb-b">设置</span></Teleport>
  <div class="page-container fade-in settings-v3" id="settings-page">


    <div class="settings-layout">
    <nav class="settings-nav" role="tablist" @keydown="handleSettingsNavKeydown" aria-label="设置导航">
    <div class="settings-header">
      <button class="back-btn" @click="returnToPreviousPage">
        <V3Icon name="chevR" class="back-icon" />
        <span>{{ returnPath ? '返回上页' : '返回书架' }}</span>
      </button>
      <h1 class="page-title">设置</h1>
    </div>
      <button
        v-for="item in visibleNavItems"
        :key="item.key"
        type="button"
        role="tab"
        class="settings-nav-item"
        :aria-selected="selectedNavKey === item.key"
        :tabindex="selectedNavKey === item.key ? 0 : -1"
        @click="selectNav(item.key)"
      ><V3Icon :name="item.icon" /><span>{{ item.label }}</span></button>
    </nav>
    <div ref="contentEl" class="settings-content">
      <p v-if="hasUnsavedChanges" class="settings-draft-note" role="status">有未保存的模型或技能草稿。切换条目或分区会暂存，离开设置前请保存。</p>
      <section v-show="activeTab === 'cloud'" class="settings-section cloud-settings-section">
        <CloudSyncPanel v-if="CLOUD_SYNC_AVAILABLE" />
        <ProjectHistoryPanel />
      </section>
      <!-- 模型配置 -->
      <section v-show="activeTab === 'models'" class="settings-section paper-panel">
        <div class="section-header">
          <div><h2 class="section-title">模型配置</h2><p class="section-desc">连接信息统一在这里管理；{{ keyStorageNote }}</p></div>
        </div>

        <div class="model-workbench">
          <div class="model-catalogue">
        <!-- 模型列表 -->
        <div v-if="configStore.models.length === 0" class="empty-models">
          <p>还没有配置任何 AI 模型</p>
          <p class="hint">添加一个模型来开始使用 AI 功能</p>
        </div>
        <div class="model-list">
          <div
            v-for="model in configStore.models"
            :key="model.id"
            class="model-card"
            :class="{ 'model-card--selected': editingModel === model.id && showAddModel }"
          >
            <div class="model-info">
              <div class="model-head">
                <button type="button" class="model-name model-select" :aria-label="`编辑模型 ${model.modelName}`" @click="editModel(model)">{{ model.modelName }}</button>
                <span v-if="dirtyModelKeys.has(model.id)" class="draft-badge">未保存</span>
                <!-- 只显示与当前本机环境和连接配置指纹匹配的实际测试结果。 -->
                <div v-if="testState[model.id]" class="model-test-result" title="与当前配置匹配的连接测试结果">
                  <span class="model-status" :class="testState[model.id]">
                    {{ testState[model.id] === 'ok' ? '连接正常' : testState[model.id] === 'fail' ? '测试失败' : configStore.isModelConnectionTestActive(model.id) ? '测试中...' : '上次测试未完成' }}
                  </span>
                  <time v-if="model.connectionTest?.testedAt" class="model-tested-at" :datetime="model.connectionTest.testedAt">{{ formatTestedAt(model.connectionTest.testedAt) }}</time>
                </div>
              </div>
              <div v-if="model.name && model.name !== model.modelName" class="model-detail">备注：{{ model.name }}</div>
              <div class="model-detail model-key">{{ maskKey(model.apiKey) }}</div>
              <!-- 类型只作文字说明；标签只列实际会用到这个模型的任务（含未分配时的默认和对话跟随大纲）。 -->
              <div class="model-badges">
                <span class="model-kind-text">{{ model.kind === 'embedding' ? '向量模型' : '写作／对话模型' }} ·</span>
                <template v-if="modelTasks(model).length">
                  <span v-for="task in modelTasks(model)" :key="task.key" class="badge" :class="task.className" :title="task.title">{{ task.label }}</span>
                </template>
                <span v-else class="model-kind-text">未分配任务</span>
              </div>
            </div>
            <div class="model-actions">
              <button v-if="model.kind === 'embedding'" type="button" class="m-btn xs ghost" :aria-busy="testingId === model.id" @click="testModel(model)">
                {{ testingId === model.id ? '测试中...' : '测试' }}
              </button>
              <ModelSearchTest v-else :model="model" compact :connection="testModelForCombined" />
              <button type="button" class="m-btn xs ghost" @click="editModel(model)">编辑</button>
              <button type="button" class="m-btn xs ghost danger-text" @click="handleDeleteModel(model.id)">删除</button>
            </div>
          </div>
          <button type="button" id="add-model-btn" class="model-add-card" @click="openAddModel"><V3Icon name="plus" />添加模型<span v-if="dirtyModelKeys.has(null)" class="draft-badge">未保存</span></button>
        </div>
          </div>
    <section v-if="showAddModel" class="model-editor" aria-label="编辑模型配置">
      <div class="section-header">
        <h3>{{ editingModel ? '编辑配置' : '添加模型' }}</h3>
        <button type="button" class="m-btn sm ghost" @click="closeModelModal">收起</button>
      </div>
      <div class="model-form">
        <div class="model-kind-field">
          <div class="model-kind-switch" role="radiogroup" aria-label="模型类型">
            <button v-for="option in modelKindOptions" :key="option.value" type="button" role="radio" class="model-kind-option"
              :class="{ on: modelForm.kind === option.value }" :aria-checked="modelForm.kind === option.value"
              :disabled="Boolean(editingModel) && modelForm.kind !== option.value" @click="modelForm.kind = option.value">
              <V3Icon :name="option.icon" size="s" /><span>{{ option.label }}</span>
            </button>
          </div>
          <p class="model-discovery-hint">{{ modelKindOptions.find(option => option.value === modelForm.kind)?.note }}{{ editingModel ? '已添加的模型不能更改类型。' : '' }}</p>
        </div>
        <V3Field label="配置备注（选填）">
          <V3Input v-model:value="modelForm.name" placeholder="如：主用接口 / 备用接口；留空使用模型 ID" />
          <p class="model-discovery-hint">仅用于区分配置，不改变实际模型。批量添加按各模型原始 ID 命名，不继承此备注。</p>
        </V3Field>
        <V3Field v-if="!editingModel && modelForm.kind === 'embedding'" label="常用服务商（选填）">
          <div class="provider-presets" role="group" aria-label="常用向量服务商">
            <button v-for="preset in EMBEDDING_PROVIDER_PRESETS" :key="preset.id" type="button" class="m-btn xs" :class="{ pri: activeEmbeddingProvider?.id === preset.id }"
              :aria-pressed="activeEmbeddingProvider?.id === preset.id" @click="applyEmbeddingPreset(preset)">{{ preset.label }}</button>
          </div>
          <p class="model-discovery-hint">选择后自动填写官方接口地址。需要接口兼容 OpenAI 的 /embeddings；使用中转站或本地服务（如 Ollama）时直接填写接口地址。
            <a v-if="activeEmbeddingProvider" :href="activeEmbeddingProvider.consoleUrl" target="_blank" rel="noopener noreferrer">获取 API 密钥</a></p>
          <p v-if="activeEmbeddingProvider?.signupUrl" class="model-discovery-hint">还没有账号？<a :href="activeEmbeddingProvider.signupUrl" target="_blank" rel="noopener noreferrer">注册{{ activeEmbeddingProvider.label.replace(/（.*$/, '') }}</a>。{{ activeEmbeddingProvider.signupNote }}</p>
        </V3Field>
        <V3Field v-if="!editingModel && modelForm.kind !== 'embedding'" label="常用服务商（选填）">
          <div class="provider-presets" role="group" aria-label="常用服务商">
            <div v-for="group in providerPresetGroups" :key="group.label" class="provider-row">
              <span class="provider-group">{{ group.label }}</span>
              <button v-for="preset in group.items" :key="preset.id" type="button" class="m-btn xs" :class="{ pri: activeProvider?.id === preset.id }"
                :aria-pressed="activeProvider?.id === preset.id" @click="applyProviderPreset(preset)">{{ preset.label }}</button>
            </div>
          </div>
          <p class="model-discovery-hint">选择后自动填写官方接口地址，再填 API 密钥并获取模型列表。使用中转站时直接填写接口地址即可。</p>
        </V3Field>
        <V3Field label="接口地址">
          <V3Input
            v-model:value="modelForm.baseUrl"
            :placeholder="modelForm.kind === 'embedding' ? '如：https://api.siliconflow.cn/v1；本地服务如 http://127.0.0.1:11434/v1' : '如：https://api.deepseek.com'"
            @update:value="handleModelSourceChange"
          />
        </V3Field>
        <p v-if="activeProvider" class="model-discovery-hint provider-note">
          {{ activeProvider.label }}：{{ activeProvider.searchNote }}
          <a :href="activeProvider.consoleUrl" target="_blank" rel="noopener noreferrer">申请 API 密钥</a>
        </p>
        <V3Field label="API 密钥">
          <V3Input
            v-model:value="modelForm.apiKey"
            type="password"
            autocomplete="off"
            :placeholder="editingModel ? '留空则保留当前 API 密钥' : '填写服务商提供的 API 密钥'"
            @update:value="handleModelSourceChange"
          />
          <p v-if="editingModel" class="model-discovery-hint">编辑模型时留空不会清除当前 API 密钥；只有输入新密钥才会替换。</p>
        </V3Field>
        <V3Field label="模型名称（原始 ID）">
          <V3Input
            v-model:value="modelForm.modelName"
            :placeholder="modelForm.kind === 'embedding' ? (activeEmbeddingProvider?.modelHint || '如：text-embedding-v4 / bge-m3') : activeProvider ? activeProvider.modelHint : '如：deepseek-chat / gpt-4o / qwen-max'"
            @update:value="handleManualModelNameChange"
          />
          <div class="model-discovery-row">
            <button
              type="button"
              class="m-btn sm"
              :aria-busy="modelDiscoveryLoading"
              :disabled="modelDiscoveryLoading || !modelForm.baseUrl.trim() || (!modelForm.apiKey.trim() && !isLocalModelUrl(modelForm.baseUrl))"
              @click="fetchAvailableModels"
            >
              {{ modelDiscoveryLoading ? '获取中...' : '获取模型' }}
            </button>
            <span v-if="availableModels.length" class="model-discovery-success">已获取 {{ availableModels.length }} 个模型{{ modelForm.kind === 'embedding' && !showAllModels ? `，其中向量模型 ${availableModelOptions.length} 个` : '' }}，可多选</span>
            <label v-if="availableModels.length && modelForm.kind === 'embedding'" class="m-check model-show-all"><input v-model="showAllModels" type="checkbox">显示全部模型</label>
            <span v-else class="model-discovery-hint">从兼容 OpenAI 的 /models 接口读取</span>
            <button
              v-if="availableModels.length > 1"
              type="button"
              class="m-btn sm ghost"
              @click="selectAllAvailableModels"
            >全选</button>
          </div>
          <V3Select
            v-if="availableModelOptions.length"
            class="model-choices"
            aria-label="已获取的模型"
            :value="selectedModelNames"
            :options="availableModelOptions"
            clearable
            multiple
            @update:value="handleSelectedModelNamesChange"
          />
          <p v-if="selectedModelNames.length > 1" class="model-discovery-hint">
            <template v-if="!editingModel">
              已选择 {{ selectedModelNames.length }} 个模型，可使用底部“批量添加”创建配置。
            </template>
            <template v-else>
              可点击“保存”更新当前配置，或使用“批量添加”创建选中的模型配置。
            </template>
          </p>
          <p v-if="modelDiscoveryError" class="model-discovery-error">{{ modelDiscoveryError }}</p>
        </V3Field>
        <details v-if="modelForm.kind !== 'embedding'" class="model-advanced">
          <summary>高级参数与联网测试</summary>
          <V3Field label="对话接口格式">
            <V3Select v-model:value="modelForm.apiProtocol" :options="aiProtocolOptions" aria-label="对话接口格式" />
            <p class="model-discovery-hint">选择「自动识别」后保存模型，再点「测试对话」识别并记住接口格式。</p>
          </V3Field>
          <V3Field label="对话联网方式">
          <V3Select v-model:value="modelForm.chatSearchProtocol" :options="chatSearchModeOptions" aria-label="对话联网方式" />
          <p class="model-discovery-hint">在灵感对话或写作台的书内对话开启“联网”时使用。“自动”会按官方接口地址选择；中转站需要支持所选方式。选“独立搜索服务”时使用“联网搜索”页的设置。</p>
          <ModelSearchTest v-if="showAddModel" :model="searchTestModel" />
        </V3Field>
        <div class="form-row">
          <V3Field label="随机程度">
            <V3Number v-model:value="modelForm.temperature" :min="0" :max="2" :step="0.1" />
          </V3Field>
          <V3Field label="采样范围">
            <V3Number v-model:value="modelForm.topP" :min="0" :max="1" :step="0.1" />
          </V3Field>
          <V3Field label="最大输出 Token 数">
            <V3Number v-model:value="modelForm.maxTokens" :min="256" :max="128000" :step="256" />
          </V3Field>
          <V3Field label="上下文窗口（选填）">
            <V3Number v-model:value="modelForm.contextWindow" :min="1000" :max="10000000" :step="1000" placeholder="如 64000" aria-label="上下文窗口" />
            <p class="model-discovery-hint">模型一次能读的 Token 数，见服务商的模型说明。不填时，整理长资料摘要按 32K 保守规划。</p>
          </V3Field>
        </div>
        </details>
      </div>
      <div class="model-editor-actions">
        <button type="button" class="m-btn" @click="closeModelModal">取消</button>
        <button
          v-if="selectedModelNames.length > 1"
          type="button"
          :class="['m-btn', editingModel ? '' : 'pri']"
          :disabled="!isBatchFormValid"
          @click="handleBatchSaveModels"
        >批量添加（{{ selectedModelNames.length }}）</button>
        <button
          v-if="editingModel || selectedModelNames.length <= 1"
          type="button"
          class="m-btn pri"
          :disabled="!isFormValid"
          @click="handleSaveModel"
        >{{ editingModel ? '保存' : '添加' }}</button>
      </div>
    </section>

          <div v-else class="model-editor-empty"><h3>统一管理模型</h3><p>选择一个模型编辑配置，或添加新的写作、对话与向量模型。</p><button type="button" class="m-btn" @click="openAddModel"><V3Icon name="plus" size="s" />添加模型</button></div>
        </div>
      </section>

      <!-- 模型用途分配 -->
      <section v-show="activeTab === 'models' && configStore.models.length > 0" id="model-task-assignments" tabindex="-1" class="settings-section paper-panel">
        <h3 class="subsection-title">任务分配</h3>
        <p class="section-desc">为不同 AI 任务指定使用的模型</p>
        <div class="assignment-grid">
          <V3Field class="assignment-item" label="大纲生成">
            <V3Select
              :value="configStore.assignments.outline"
              :options="modelOptions"
              @update:value="(v: string) => configStore.setAssignment('outline', v)"
              placeholder="选择模型"
            />
            <p class="assignment-recommend">推荐：推理能力强、上下文长的旗舰模型，规划要前后一致，速度慢些没关系。例如 Claude Opus、GPT 旗舰版、Gemini Pro、DeepSeek 推理模式、通义千问 Max。</p>
          </V3Field>
          <V3Field class="assignment-item" label="正文写作">
            <V3Select
              :value="configStore.assignments.writing"
              :options="modelOptions"
              @update:value="(v: string) => configStore.setAssignment('writing', v)"
              placeholder="选择模型"
            />
            <p class="assignment-recommend">推荐：中文文笔好、单次输出长的模型。调用次数最多，兼顾价格和速度。例如 Claude Sonnet、DeepSeek、Kimi、通义千问 Plus、豆包。</p>
          </V3Field>
          <V3Field class="assignment-item" label="章节审查">
            <V3Select
              :value="configStore.assignments.review"
              :options="modelOptions"
              @update:value="(v: string) => configStore.setAssignment('review', v)"
              placeholder="选择模型"
            />
            <p class="assignment-recommend">推荐：上下文长、细致的模型，最好和正文写作用不同的模型，更容易发现问题。例如 Gemini Pro、GPT 旗舰版、GLM 旗舰版、通义千问 Max。</p>
          </V3Field>
          <V3Field class="assignment-item chat-assignment" label="对话 / 联网模型">
            <V3Select
              :value="configStore.assignments.chat"
              :options="chatModelOptions"
              @update:value="(v: string) => configStore.setAssignment('chat', v)"
              aria-label="对话 / 联网模型"
              placeholder="默认跟随大纲模型"
            />
            <p class="assignment-recommend">推荐：响应快、价格低的模型。例如 DeepSeek、Gemini Flash、通义千问 Flash、GLM Flash、豆包。</p>
            <p class="assignment-hint">用于灵感对话和写作台的书内对话。联网开关只控制是否搜索；大纲生成、设定整理仍使用大纲模型。模型没有内置搜索时，改用“联网搜索”页的搜索服务。</p>
          </V3Field>
          <V3Field class="assignment-item embedding-assignment" label="语义检索">
            <V3Select :value="configStore.assignments.embedding || ''" :options="embeddingModelOptions" aria-label="语义检索模型" placeholder="选择向量模型" @update:value="(v: string) => configStore.setAssignment('embedding', v)" />
            <p class="assignment-recommend">推荐：支持中文的向量模型。例如 bge-m3、通义 text-embedding-v4、OpenAI text-embedding-3 系列。</p>
            <p class="assignment-hint">使用支持 Embedding 的向量模型。</p>
          </V3Field>
        </div>
      </section>
      <WebSearchServicePanel v-show="activeTab === 'websearch'" />

      <section v-show="activeTab === 'look'" class="settings-section paper-panel look-section">
        <h2 class="section-title">外观</h2>
        <p class="section-desc">主题只影响界面显示，偏好保存在本机。</p>
        <div class="theme-cards" role="radiogroup" aria-label="界面主题">
          <button v-for="item in themeCards" :key="item.name" type="button" role="radio" class="theme-card" :class="{ on: theme.currentTheme === item.name }" :aria-checked="theme.currentTheme === item.name" @click="chooseTheme(item.name)">
            <span class="theme-swatch" aria-hidden="true"><i :style="{ background: item.colors[0] }" /><i :style="{ background: item.colors[1] }"><b :style="{ background: item.colors[2] }" /></i></span>
            <span class="theme-name">{{ item.label }}</span>
          </button>
        </div>
      </section>

      <section v-show="activeTab === 'workflow'" class="settings-section paper-panel">
        <h2 class="section-title">AI 工作流</h2>
        <p class="section-desc">控制生成后的自动检查次数与后台 AI 调用量。章节结尾完整性检查在所有模式下都会保留。</p>
        <div class="workflow-cards">
          <button
            v-for="mode in workflowModes"
            :key="mode.value"
            type="button"
            class="workflow-card"
            :class="{ 'workflow-card--active': configStore.aiWorkflowMode === mode.value }"
            @click="configStore.setAiWorkflowMode(mode.value)"
          >
            <span class="workflow-symbol"><V3Icon :name="mode.value === 'fast' ? 'bolt' : mode.value === 'strict' ? 'shield' : 'sliders'" size="l" /></span>
            <h4>{{ mode.title }}</h4>
            <p>{{ mode.description }}</p>
          </button>
        </div>
        <section class="workflow-preview paper-panel"><h3>{{ workflowModes.find(mode => mode.value === configStore.aiWorkflowMode)?.title }}模式的流程</h3><p>根据当前模式执行正文生成与检查，结果仍由你查看。</p><div class="workflow-steps"><article v-for="(step, index) in workflowSteps" :key="step.title"><span class="workflow-step-number">{{ index + 1 }}</span><div><h4>{{ step.title }}</h4><p>{{ step.description }}</p></div></article></div><small aria-live="polite">结尾复核最多补写 <strong class="workflow-rounds-value">{{ workflowPolicy.endingContinuationAttempts }} 轮</strong>；内容审查最多处理 <strong class="workflow-rounds-value">{{ workflowPolicy.reviewRewriteCycles }} 轮</strong>。</small></section>
        <div class="setting-inline-toggle">
          <div>
            <strong>PDF 视觉识别</strong>
            <p class="section-desc">默认关闭。开启后，PDF 没有文字层的页面可以调用视觉模型，可能消耗额度；关闭时请使用本地 OCR。</p>
          </div>
          <V3Switch :value="configStore.pdfVisionEnabled" aria-label="允许 PDF 视觉识别" @update:value="configStore.setPdfVisionEnabled" />
        </div>
      </section>

      <div v-show="activeTab === 'models'" class="security-section model-security-status" :class="`security-${configStore.securityStatus.storage}`">
        <p v-if="configStore.securityStatus.storage === 'encrypted'" class="security-status">
          API 密钥已由操作系统安全存储加密后写入本机配置文件。
        </p>
        <p v-else-if="configStore.securityStatus.storage === 'local-development'" class="security-status">
          API 密钥保存在当前浏览器的本地配置中；桌面版使用操作系统加密保存。{{ CLOUD_SYNC_AVAILABLE ? '如需跨设备同步，可在"云端配置"中单独开启。' : '' }}
        </p>
        <p v-else class="security-status">
          当前环境无法加密保存 API 密钥，关闭应用或浏览器标签后需要重新填写。
        </p>
      </div>

      <!-- 语义检索复用任务分配，不重复保存连接信息 -->
      <section v-show="activeTab === 'retrieval'" class="settings-section paper-panel">
        <div class="section-header">
          <div>
            <h2 class="section-title">语义检索增强 <span class="optional-label">可选</span></h2>
            <p class="section-desc">按含义查找相关资料，为写作提供上下文。</p>
          </div>
          <V3Switch :value="configStore.embedding.enabled" :disabled="!assignedEmbeddingModel" aria-label="启用语义检索增强" @update:value="handleEmbeddingEnabledChange" />
        </div>
        <div class="retrieval-model-status">
          <div>
            <span class="setting-label">当前向量模型</span>
            <strong>{{ assignedEmbeddingModel?.name || assignedEmbeddingModel?.modelName || '尚未分配' }}</strong>
            <p class="section-desc">{{ assignedEmbeddingModel?.modelName || '在模型配置的任务分配中选择向量模型，接口与密钥自动复用。' }}</p>
          </div>
          <button type="button" class="m-btn" @click="openTaskAssignments">前往任务分配</button>
        </div>
        <section class="retrieval-howto"><h3>使用方式</h3><div><article><strong>1 · 整理资料</strong><p>将设定与参考资料整理到知识库，并挂载到作品。</p></article><article><strong>2 · 建立索引</strong><p>在项目记忆中同步索引，按需生成资料向量。</p></article><article><strong>3 · 按需检索</strong><p>写作与检索时，根据问题寻找相关资料。</p></article></div></section>
        <details class="retrieval-advanced">
          <summary>高级设置</summary>
          <V3Field label="批量大小" class="batch-field">
            <V3Number v-model:value="embeddingForm.batchSize" :min="1" :max="64" aria-label="向量批量大小" />
          </V3Field>
          <p class="section-desc">每次处理的资料分段数。切换向量服务或模型后，资料索引会在下次使用时更新。</p>
          <div class="section-actions">
            <button type="button" class="m-btn" :aria-busy="testingEmbedding" :disabled="testingEmbedding || !assignedEmbeddingModel" @click="handleTestEmbedding">{{ testingEmbedding ? '测试中...' : '测试连接' }}</button>
            <button type="button" class="m-btn pri" @click="saveEmbedding">保存设置</button>
          </div>
        </details>
        <p v-if="!configStore.embedding.enabled" class="disabled-hint">当前使用本地检索，故事记忆和故事时钟可以正常使用。</p>
      </section>

      <!-- 写作 Skill -->
      <section v-show="activeTab === 'skills'" class="settings-section paper-panel">
        <div class="section-header">
          <div>
            <h2 class="section-title">写作技能</h2>
            <p class="section-desc section-desc-inline">按任务自动注入的可复用写作规则</p>
          </div>
          <button type="button" class="m-btn pri" @click="openSkillModal()"><V3Icon name="plus" size="s" />添加技能<span v-if="dirtySkillKeys.has(null)" class="draft-badge">（未保存）</span></button>
        </div>
        <div class="skill-workbench">
        <div class="skill-list">
          <div v-for="skill in configStore.skills" :key="skill.id" class="skill-row" :class="{ selected: showSkillModal && editingSkill === skill.id }" @click="openSkillModal(skill)">
            <V3Switch :value="skill.enabled" :aria-label="`启用${skill.name}`" @click.stop @update:value="value => configStore.updateSkill(skill.id, { enabled: value })" />
            <div class="skill-info">
              <div class="skill-name">
                <button type="button" class="skill-select" :aria-pressed="showSkillModal && editingSkill === skill.id" @click.stop="openSkillModal(skill)">{{ skill.name }}</button>
                <span v-if="dirtySkillKeys.has(skill.id)" class="draft-badge">未保存</span>
                <span class="m-tag" :class="skill.builtIn ? 'dai' : 'line'">{{ skill.builtIn ? '内置' : '自定义' }}</span>
                <span class="m-tag">{{ skillTaskLabel(skill.task) }}</span>
              </div>
              <p>{{ skill.description }}</p>
            </div>
            <div class="model-actions" @click.stop>
              <button type="button" class="m-ibtn" :title="`查看和编辑${skill.name}`" :aria-label="`查看和编辑${skill.name}`" @click="openSkillModal(skill)"><V3Icon name="edit" size="s" /></button>
              <button v-if="!skill.builtIn" type="button" class="m-btn xs ghost danger-text" @click="handleDeleteSkill(skill.id)">删除</button>
            </div>
          </div>
        </div>
          <section v-if="showSkillModal" class="skill-editor paper-panel" aria-label="编辑技能"><h3>{{ editingSkill ? '编辑技能' : '添加技能' }}</h3>
      <div class="model-form">
        <V3Field label="名称">
          <V3Input v-model:value="skillForm.name" aria-label="技能名称" :maxlength="80" placeholder="例如：悬疑线索控制" />
        </V3Field>
        <V3Field label="适用任务">
          <V3Select v-model:value="skillForm.task" :options="skillTaskOptions" />
        </V3Field>
        <V3Field label="简要说明">
          <V3Input v-model:value="skillForm.description" placeholder="说明这个技能解决什么问题" />
        </V3Field>
        <V3Field label="执行规则">
          <V3Input v-model:value="skillForm.instructions" aria-label="技能执行规则" type="textarea" :rows="8" :maxlength="1500" show-count />
        </V3Field>
      </div>

        <div class="section-actions">
          <button v-if="configStore.skills.find(item => item.id === editingSkill)?.builtIn" type="button" class="m-btn ghost restore-skill" @click="restoreSkill">恢复内置规则</button>
          <button type="button" class="m-btn" @click="closeSkillModal">取消</button>
          <button type="button" class="m-btn pri" :disabled="!skillForm.name.trim() || !skillForm.instructions.trim()" @click="saveSkill">保存</button>
        </div>

          </section>
          <div v-else class="skill-editor-empty">选择一项技能查看和编辑规则，或添加新的写作技能。</div>
        </div>
      </section>

      <!-- 关于 -->
      <section v-show="activeTab === 'about'" class="settings-section paper-panel about-section">
        <h2 class="section-title">关于墨笔生花</h2>
        <div class="about-brand"><span class="seal">墨</span><div><h3>墨笔生花</h3><p class="about-version">版本 v{{ appVersion }}</p></div></div>
        <p class="about-desc">本地优先的 AI 长篇小说写作工具。创作内容保存在本机{{ CLOUD_SYNC_AVAILABLE ? '，可按需开启云同步' : '' }}。</p>
        <div class="about-features"><article><span><V3Icon name="pen" size="l" /></span><div><h4>作者主笔</h4><p>尊重创作意图，随时编辑故事与正文。</p></div></article><article><span><V3Icon name="spark" size="l" /></span><div><h4>AI 辅助</h4><p>为构思、写作与审查提供支持。</p></div></article><article><span><V3Icon name="book" size="l" /></span><div><h4>知识库与剧情记忆</h4><p>整理人物、世界观和情节，让长篇创作更连贯。</p></div></article></div>
        <section class="about-update" aria-labelledby="about-update-title"><h3 id="about-update-title" class="about-help-title">软件更新</h3><AppUpdatePanel /></section>
        <details class="font-licenses">
          <summary>内置字体与许可</summary>
          <p class="font-license-note">HarmonyOS Sans SC 未随应用分发，界面使用 Noto Sans SC 替代；不分发微软系统字体。</p>
          <p class="font-license-note">以下许可原文随应用内置，可离线展开查看。</p>
          <details v-for="font in bundledFonts" :key="font.name" class="font-license-item">
            <summary>{{ font.name }} <span>{{ font.license }}</span></summary>
            <p class="font-license-package">{{ font.package }}</p>
            <div v-for="document in font.documents" :key="document.name">
              <h4 class="font-license-heading">{{ document.name }}</h4>
              <pre class="font-license-text" tabindex="0" role="region" :aria-label="`${font.name} · ${document.name}`">{{ document.text }}</pre>
            </div>
          </details>
        </details>
        <h3 class="about-help-title">信息与帮助</h3>
        <nav class="about-links" aria-label="信息与帮助">
          <a class="about-star" :href="GITHUB_REPO_URL" target="_blank" rel="noopener noreferrer"><strong>在 GitHub 点 Star</strong><small>觉得好用的话，点个 Star 支持一下，也让更多写作者看到墨笔生花。{{ starCount !== null ? `目前 ${starCount} 人点过 Star。` : '' }}</small><span aria-hidden="true">★</span></a>
          <a href="https://github.com/HannJia/mobish" target="_blank" rel="noopener noreferrer"><strong>项目主页</strong><small>了解墨笔生花的更新动态与相关资源。</small><span aria-hidden="true">↗</span></a>
          <a href="https://github.com/HannJia/mobish#readme" target="_blank" rel="noopener noreferrer"><strong>使用说明</strong><small>查看功能介绍与使用方法。</small><span aria-hidden="true">↗</span></a>
          <a href="https://github.com/HannJia/mobish/issues" target="_blank" rel="noopener noreferrer"><strong>问题反馈</strong><small>提交使用中遇到的问题与建议。</small><span aria-hidden="true">↗</span></a>
        </nav>
        <div class="about-diagnostics">
          <div><strong>反馈问题时附上诊断信息</strong><small>包含版本、系统、作品和知识库数量、模型配置概况；不含作品内容、知识库内容、文件路径、API 密钥和接口地址。</small></div>
          <div class="about-diagnostics-actions">
            <button type="button" class="m-btn sm" data-copy-diagnostics @click="copyDiagnostics">复制诊断信息</button>
            <button type="button" class="m-btn sm ghost" @click="saveDiagnostics">保存诊断包（.json）</button>
          </div>
        </div>
        <p class="about-backup-note">项目备份可在书架导出。</p>
      </section>
    </div>
    </div>


  </div>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
defineOptions({ name: 'V3SettingsView' })
import CloudSyncPanel from '@/components/CloudSyncPanel.vue'
import ProjectHistoryPanel from '@/components/ProjectHistoryPanel.vue'
import AppUpdatePanel from '@/components/AppUpdatePanel.vue'
import ModelSearchTest from '@/components/ModelSearchTest.vue'
import V3Icon from '@/v3/components/V3Icon.vue'
import type { IconName } from '@/v3/icons'
import { THEME_LABEL } from '@/v3/shell'
import { ref, computed, reactive, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useMessage, useDialog } from '@/v3/feedback'
import V3Field from '@/v3/components/form/V3Field.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Number from '@/v3/components/form/V3Number.vue'
import V3Select from '@/v3/components/form/V3Select.vue'
import V3Switch from '@/v3/components/form/V3Switch.vue'
import { getAiWorkflowPolicy } from '@/services/aiWorkflow'
import { createBuiltInSkills } from '@/data/skills'
import { useThemeStore, type ThemeName } from '@/stores/theme'
import { useConfigStore, type ModelConfig, type ModelConnectionTestRecord, type ModelConnectionTestStatus } from '@/stores/config'
import { listAvailableModels, openAiV1BaseUrl, testConnection, type AvailableModel } from '@/services/ai'
import { AI_PROTOCOL_LABELS, type AiProtocol } from '@/services/aiProtocols'
import { testEmbeddingConnection } from '@/services/embeddings'
import { modelConnectionFingerprint } from '@/services/modelConnectionTest'
import { chatSearchModeOptions, splitSearchMode } from '@/services/chatSearch'
import { detectModelProvider, EMBEDDING_PROVIDER_PRESETS, isEmbeddingModelName, isLocalModelUrl, MODEL_PROVIDER_PRESETS, RECOMMENDED_EMBEDDING_MODELS, type ChatSearchAdapter, type EmbeddingProviderPreset, type ModelProviderPreset } from '@/services/modelProviders'
import { fetchStarCount, GITHUB_REPO_URL } from '@/services/githubStar'
import { useNovelStore } from '@/stores/novel'
import { useKnowledgeStore } from '@/stores/knowledge'
import { collectDiagnostics, formatDiagnostics } from '@/services/diagnostics'
import WebSearchServicePanel from '@/components/WebSearchServicePanel.vue'
import { CLOUD_SYNC_AVAILABLE } from '@/services/features'
import type { ChatSearchProtocol } from '@/types/chat'
import type { WritingSkill, WritingSkillTask } from '@/types/skill'
import { version as appVersion } from '../../../package.json'
import notoSerifLicense from '@fontsource-variable/noto-serif-sc/LICENSE?raw'
import notoSansLicense from '@fontsource-variable/noto-sans-sc/LICENSE?raw'
import jetbrainsMonoLicense from '@fontsource-variable/jetbrains-mono/LICENSE?raw'
import lxgwWenkaiFontLicense from 'lxgw-wenkai-webfont/OFL.txt?raw'
import lxgwWenkaiPackageLicense from 'lxgw-wenkai-webfont/LICENSE?raw'

const bundledFonts = [
  {
    name: 'Noto Serif SC（思源宋体，可变字体）',
    package: '@fontsource-variable/noto-serif-sc 5.3.1',
    license: 'OFL 1.1',
    documents: [{ name: '字体许可 · LICENSE', text: notoSerifLicense }],
  },
  {
    name: 'Noto Sans SC（思源黑体，可变字体）',
    package: '@fontsource-variable/noto-sans-sc 5.3.1',
    license: 'OFL 1.1',
    documents: [{ name: '字体许可 · LICENSE', text: notoSansLicense }],
  },
  {
    name: 'JetBrains Mono（可变字体）',
    package: '@fontsource-variable/jetbrains-mono 5.3.0',
    license: 'OFL 1.1',
    documents: [{ name: '字体许可 · LICENSE', text: jetbrainsMonoLicense }],
  },
  {
    name: 'LXGW WenKai（霞鹜文楷，Regular）',
    package: 'lxgw-wenkai-webfont 1.7.0',
    license: '字体 OFL 1.1 · 包 MIT',
    documents: [
      { name: '字体许可 · OFL.txt', text: lxgwWenkaiFontLicense },
      { name: 'Webfont 包许可 · LICENSE', text: lxgwWenkaiPackageLicense },
    ],
  },
]

const configStore = useConfigStore()
const message = useMessage()
const dialog = useDialog()
const route = useRoute()
const router = useRouter()
const theme = useThemeStore()

type SettingsTab = 'models' | 'websearch' | 'workflow' | 'look' | 'retrieval' | 'skills' | 'cloud' | 'about'
// 任务分配在模型配置页内，不单列导航；保留 section=assign，供“前往任务分配”等入口定位到该区域。
// 软件更新统一放在“关于”页。
const navItems: Array<{ key: string; label: string; icon: IconName; tab: SettingsTab; anchor?: string; hidden?: boolean }> = [
  { key: 'models', label: '模型配置', icon: 'grid', tab: 'models' },
  { key: 'assign', label: '任务分配', icon: 'target', tab: 'models', anchor: '#model-task-assignments', hidden: true },
  { key: 'websearch', label: '联网搜索', icon: 'globe', tab: 'websearch' },
  { key: 'workflow', label: 'AI 工作流', icon: 'bolt', tab: 'workflow' },
  { key: 'look', label: '外观', icon: 'sun', tab: 'look' },
  { key: 'retrieval', label: '语义检索', icon: 'search', tab: 'retrieval' },
  { key: 'skills', label: '写作技能', icon: 'pen', tab: 'skills' },
  // 云同步未开放时，这一页只剩本地的项目历史；section=cloud 的链接保持可用。
  CLOUD_SYNC_AVAILABLE ? { key: 'cloud', label: '云同步与历史', icon: 'cloud', tab: 'cloud' } : { key: 'cloud', label: '项目历史', icon: 'clock', tab: 'cloud' },
  { key: 'about', label: '关于', icon: 'info', tab: 'about' },
]
const activeNav = computed(() => navItems.some(item => item.key === route.query.section) ? String(route.query.section) : 'models')
const activeNavItem = computed(() => navItems.find(item => item.key === activeNav.value)!)
const activeTab = computed(() => activeNavItem.value.tab)
const visibleNavItems = navItems.filter(item => !item.hidden)
// 隐藏条目（任务分配）选中时，高亮它所在页面的导航项。
const selectedNavKey = computed(() => activeNavItem.value.hidden
  ? visibleNavItems.find(item => item.tab === activeNavItem.value.tab)?.key ?? 'models'
  : activeNav.value)
const contentEl = ref<HTMLElement | null>(null)
watch(activeNav, scrollToActiveSection, { immediate: true })
async function selectNav(key: string) {
  if (!navItems.some(item => item.key === key)) return
  if (route.query.section === key) return scrollToActiveSection()
  await router.push({ query: { ...route.query, section: key }, hash: route.hash })
}
async function scrollToActiveSection() {
  await nextTick()
  const item = activeNavItem.value
  const target = item.anchor ? contentEl.value?.querySelector<HTMLElement>(item.anchor) : null
  if (target) {
    target.scrollIntoView?.({ block: 'start', behavior: 'auto' })
    target.focus({ preventScroll: true })
  } else if (contentEl.value) contentEl.value.scrollTop = 0
}

const themeCards: Array<{ name: ThemeName; label: string; colors: [string, string, string] }> = [
  { name: 'fanqie', label: THEME_LABEL.fanqie, colors: ['#1B1A17', '#FCFAF5', '#B8321F'] },
  { name: 'dark', label: THEME_LABEL.dark, colors: ['#0E0D0C', '#1F1D1A', '#E0634B'] },
  { name: 'eyecare', label: THEME_LABEL.eyecare, colors: ['#1C2A24', '#F8FAF7', '#B23A2A'] },
]
function chooseTheme(name: ThemeName) {
  try { theme.switchTheme(name) } catch { message.error('主题偏好无法保存，本次未切换。') }
}
const keyStorageNote = computed(() => configStore.securityStatus.storage === 'encrypted' ? 'API 密钥由系统安全存储加密。'
  : configStore.securityStatus.storage === 'local-development' ? 'API 密钥保存在当前浏览器的本地配置中。' : '当前环境无法加密保存 API 密钥，关闭后需要重新填写。')
const testState = reactive<Record<string, ModelConnectionTestStatus>>({})
let testStateSyncGeneration = 0

function modelConnectionStateKey(model: ModelConfig) {
  const record = model.connectionTest
  return [
    model.id,
    model.baseUrl,
    model.modelName,
    model.apiKey,
    model.kind || 'chat',
    record?.status || '',
    record?.testedAt || '',
    record?.fingerprint || '',
    record?.environment || '',
  ].join('\u0000')
}

async function syncPersistedTestState() {
  const generation = ++testStateSyncGeneration
  const environment = configStore.securityStatus.environment
  const states = await Promise.all(configStore.models.map(async model => {
    const record = model.connectionTest
    if (!record || record.environment !== environment) {
      return [model.id, undefined] as const
    }
    const fingerprint = await modelConnectionFingerprint(model)
    return [model.id, fingerprint === record.fingerprint ? record.status : undefined] as const
  }))
  if (generation !== testStateSyncGeneration) return
  for (const id of Object.keys(testState)) delete testState[id]
  for (const [id, state] of states) if (state) testState[id] = state
}

function formatTestedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
}

watch([
  () => configStore.securityStatus.environment,
  () => configStore.models.map(modelConnectionStateKey),
], () => { void syncPersistedTestState() }, { immediate: true })

function handleSettingsNavKeydown(event: KeyboardEvent) {
  const buttons = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.settings-nav-item'))
  const index = buttons.indexOf(event.target as HTMLButtonElement)
  if (index < 0 || !['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.click()
  buttons[next]?.focus()
}

async function openTaskAssignments() {
  await selectNav('assign')
}

const returnPath = computed(() => {
  const candidate = String(route?.query?.returnTo || '')
  return candidate.startsWith('/') && candidate !== '/settings' ? candidate : ''
})

function returnToPreviousPage() {
  if (!router) return
  void router.push(returnPath.value || '/')
}

const showAddModel = ref(false)
const editingModel = ref<string | null>(null)
const testingId = ref<string | null>(null)
let modelTestUiGeneration = 0
const availableModels = ref<AvailableModel[]>([])
const selectedModelNames = ref<string[]>([])
const modelDiscoveryLoading = ref(false)
const modelDiscoveryError = ref('')
let modelDiscoveryController: AbortController | null = null
const testingEmbedding = ref(false)
let embeddingTestUiGeneration = 0
const showSkillModal = ref(false)
const editingSkill = ref<string | null>(null)

const embeddingForm = reactive({ batchSize: configStore.embedding.batchSize })
const assignedEmbeddingModel = computed(() => configStore.getModelForTask('embedding'))
watch(() => configStore.embedding.batchSize, value => { embeddingForm.batchSize = value })
const modelKindOptions: Array<{ label: string; value: 'chat' | 'embedding'; icon: IconName; note: string }> = [
  { label: '写作／对话', value: 'chat', icon: 'pen', note: '用于大纲、正文、审查和对话。' },
  { label: '向量模型（Embedding）', value: 'embedding', icon: 'layers', note: '只用于语义检索，按含义查找资料，不能用来写作或对话。' },
]
const embeddingModelOptions = computed(() => [
  { label: '暂不分配', value: '' },
  ...configStore.models.filter(model => model.kind === 'embedding').map(model => ({ label: model.name || model.modelName, value: model.id })),
])
const skillTaskOptions = [
  { label: '全部 AI 任务', value: 'all' },
  { label: '大纲与规划', value: 'planning' },
  { label: '正文写作', value: 'writing' },
  { label: '章节审查', value: 'review' },
  { label: '故事分析', value: 'analysis' },
]
const workflowModes = [
  { value: 'fast' as const, title: '精简', description: '减少计划、自检和后台调用，更快完成写作任务' },
  { value: 'balanced' as const, title: '均衡', description: '完整生成、自检与结尾复核，平衡质量与效率' },
  { value: 'strict' as const, title: '严谨', description: '增加结尾补写与审查轮次，加强完整性检查' },
]
const workflowPolicy = computed(() => getAiWorkflowPolicy(configStore.aiWorkflowMode))
const workflowSteps = computed(() => [
  ...(workflowPolicy.value.createWritingPlan ? [{ title: '拟定计划', description: '结合设定与前文安排本章推进。' }] : []),
  { title: '生成正文', description: '依据任务与上下文生成初稿。' },
  ...(workflowPolicy.value.selfCheckDraft ? [{ title: '自检', description: '检查明显问题并校正正文。' }] : []),
  { title: '结尾复核', description: '检查章尾完整性，再进入后续审查。' },
])
const skillForm = reactive({ name: '', description: '', task: 'writing' as WritingSkillTask, instructions: '' })

// 模型表单
const aiProtocolOptions = [{ value: 'auto', label: '自动识别' }, ...Object.entries(AI_PROTOCOL_LABELS).map(([value, label]) => ({ value, label }))]
const modelForm = reactive({
  kind: 'chat' as 'chat' | 'embedding',
  name: '',
  baseUrl: '',
  apiKey: '',
  modelName: '',
  temperature: 0.7,
  topP: 0.9,
  maxTokens: 4096,
  /** 上下文窗口（Token）；不填时整理摘要按保守值规划。 */
  contextWindow: null as number | null,
  chatSearchProtocol: 'auto' as ChatSearchProtocol | ChatSearchAdapter,
  apiProtocol: 'auto' as AiProtocol | 'auto',
})
const providerPresetGroups = [
  { label: '国内', items: MODEL_PROVIDER_PRESETS.filter(item => item.region === 'domestic') },
  { label: '海外', items: MODEL_PROVIDER_PRESETS.filter(item => item.region === 'overseas') },
  { label: '本机', items: MODEL_PROVIDER_PRESETS.filter(item => item.region === 'local') },
]
const activeProvider = computed(() => modelForm.kind === 'embedding' ? null : detectModelProvider(modelForm.baseUrl))
const activeEmbeddingProvider = computed(() => {
  if (modelForm.kind !== 'embedding') return null
  const base = modelForm.baseUrl.trim().replace(/\/+$/, '').toLowerCase()
  return EMBEDDING_PROVIDER_PRESETS.find(preset => preset.baseUrl.toLowerCase() === base) ?? null
})
function applyEmbeddingPreset(preset: EmbeddingProviderPreset) {
  modelForm.baseUrl = preset.baseUrl
  handleModelSourceChange()
  // 推荐模型直接填好，用户只需填自己的密钥
  if (preset.defaultModel && !modelForm.modelName.trim()) {
    modelForm.modelName = preset.defaultModel
    selectedModelNames.value = [preset.defaultModel]
  }
}
function applyProviderPreset(preset: ModelProviderPreset) {
  modelForm.baseUrl = preset.baseUrl
  modelForm.chatSearchProtocol = 'auto'
  modelForm.apiProtocol = 'auto'
  handleModelSourceChange()
}
type ModelDraft = {
  form: typeof modelForm
  baseline: string
  availableModels: AvailableModel[]
  selectedModelNames: string[]
  discoveryError: string
}
type SkillDraft = { form: typeof skillForm; baseline: string }
// 草稿仅随当前设置页保留在内存中，包含密钥的表单不写入持久化存储。
const modelDrafts = reactive(new Map<string | null, ModelDraft>())
const skillDrafts = reactive(new Map<string | null, SkillDraft>())
const modelBaseline = ref('')
const skillBaseline = ref('')
const modelDirty = computed(() => showAddModel.value && modelFormSignature() !== modelBaseline.value)
const skillDirty = computed(() => showSkillModal.value && JSON.stringify(skillForm) !== skillBaseline.value)
const dirtyModelKeys = computed(() => new Set([
  ...modelDrafts.keys(),
  ...(modelDirty.value ? [editingModel.value] : []),
]))
const dirtySkillKeys = computed(() => new Set([
  ...skillDrafts.keys(),
  ...(skillDirty.value ? [editingSkill.value] : []),
]))
const hasUnsavedChanges = computed(() => dirtyModelKeys.value.size > 0 || dirtySkillKeys.value.size > 0)

function modelFormSignature() {
  return JSON.stringify([modelForm, selectedModelNames.value])
}

function confirmDiscardChanges(content: string) {
  return new Promise<boolean>(resolve => {
    let settled = false
    function finish(discard: boolean) {
      if (settled) return
      settled = true
      resolve(discard)
    }
    dialog.warning({
      title: '放弃未保存的修改？', content,
      positiveText: '放弃修改', negativeText: '继续编辑',
      onPositiveClick: () => finish(true),
      onNegativeClick: () => finish(false),
      onClose: () => finish(false),
      onMaskClick: () => finish(false),
    })
  })
}

onBeforeRouteLeave(() => hasUnsavedChanges.value
  ? confirmDiscardChanges('离开设置将丢弃本页所有未保存的模型和技能草稿，确定离开吗？')
  : true)

function protectSettingsDrafts(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', protectSettingsDrafts))
onBeforeUnmount(() => {
  stopModelDiscovery()
  window.removeEventListener('beforeunload', protectSettingsDrafts)
})

const searchTestModel = computed<ModelConfig>(() => ({
  ...modelForm,
  apiProtocol: modelForm.apiProtocol === 'auto' ? undefined : modelForm.apiProtocol,
  contextWindow: modelForm.contextWindow ?? undefined,
  ...splitSearchMode(modelForm.chatSearchProtocol),
  id: editingModel.value || 'search-test',
  apiKey: modelForm.apiKey.trim() || configStore.models.find(model => model.id === editingModel.value)?.apiKey || '',
}))

// 模型选项
const modelOptions = computed(() => {
  const counts = new Map<string, number>()
  for (const model of configStore.models) counts.set(model.modelName, (counts.get(model.modelName) || 0) + 1)
  return configStore.models.filter(model => model.kind !== 'embedding').map(model => ({
    label: counts.get(model.modelName)! > 1 && model.name && model.name !== model.modelName
      ? `${model.modelName}（备注：${model.name}）`
      : model.modelName,
    value: model.id,
  }))
})
const chatModelOptions = computed(() => [
  { label: '默认跟随大纲模型', value: '' },
  ...modelOptions.value,
])

// 向量模型模式下只列出向量模型（可切换显示全部），推荐的排前面并高亮
const showAllModels = ref(false)
const availableModelOptions = computed(() => {
  const embeddingOnly = modelForm.kind === 'embedding' && !showAllModels.value
  const recommended = (id: string) => RECOMMENDED_EMBEDDING_MODELS.includes(id)
  return availableModels.value
    .filter(model => !embeddingOnly || isEmbeddingModelName(model.id))
    .sort((a, b) => modelForm.kind === 'embedding' ? Number(recommended(b.id)) - Number(recommended(a.id)) : 0)
    .map(model => ({
      label: model.ownedBy ? `${model.id} · ${model.ownedBy}` : model.id,
      value: model.id,
      ...(modelForm.kind === 'embedding' && recommended(model.id) ? { highlight: true, tag: '推荐' } : {}),
      ...(modelForm.kind === 'embedding' && /^pro\//i.test(model.id) ? { tag: '付费' } : {}),
    }))
})

// 表单是否有效
const isFormValid = computed(() =>
  Boolean(
    modelForm.baseUrl.trim()
    && modelForm.modelName.trim()
    && (modelForm.kind === 'embedding' || modelForm.apiKey.trim() || isLocalModelUrl(modelForm.baseUrl) || (editingModel.value && configStore.models.some(model => model.id === editingModel.value && model.apiKey))),
  )
)
const isBatchFormValid = computed(() =>
  Boolean(modelForm.baseUrl.trim() && (modelForm.apiKey.trim() || isLocalModelUrl(modelForm.baseUrl)) && selectedModelNames.value.length > 1)
)

// 遮蔽 API Key
function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.substring(0, 4) + '****' + key.substring(key.length - 4)
}

// 编辑模型
function editModel(model?: ModelConfig) {
  void selectNav('models')
  const id = model?.id ?? null
  if (showAddModel.value && editingModel.value === id) return
  rememberModelDraft()
  resetForm()
  editingModel.value = id
  const draft = modelDrafts.get(id)
  if (draft) Object.assign(modelForm, draft.form)
  else if (model) Object.assign(modelForm, {
    kind: model.kind || 'chat',
    name: model.name,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    modelName: model.modelName,
    temperature: model.temperature,
    topP: model.topP,
    maxTokens: model.maxTokens,
    contextWindow: model.contextWindow ?? null,
    chatSearchProtocol: model.searchAdapter || model.chatSearchProtocol || 'auto',
    apiProtocol: model.apiProtocol || 'auto',
  })
  availableModels.value = draft?.availableModels || []
  selectedModelNames.value = draft?.selectedModelNames || (model ? [model.modelName] : [])
  modelDiscoveryError.value = draft?.discoveryError || ''
  modelBaseline.value = draft?.baseline || modelFormSignature()
  modelDrafts.delete(id)
  showAddModel.value = true
}

function openAddModel() {
  editModel()
}

function rememberModelDraft() {
  stopModelDiscovery()
  if (!modelDirty.value) return
  modelDrafts.set(editingModel.value, {
    form: { ...modelForm }, baseline: modelBaseline.value,
    availableModels: [...availableModels.value], selectedModelNames: [...selectedModelNames.value],
    discoveryError: modelDiscoveryError.value,
  })
}

function stopModelDiscovery() {
  modelDiscoveryController?.abort()
  modelDiscoveryController = null
  modelDiscoveryLoading.value = false
}

function handleModelSourceChange() {
  stopModelDiscovery()
  availableModels.value = []
  selectedModelNames.value = []
  modelDiscoveryError.value = ''
}

async function fetchAvailableModels() {
  modelDiscoveryController?.abort()
  const controller = new AbortController()
  modelDiscoveryController = controller
  modelDiscoveryLoading.value = true
  modelDiscoveryError.value = ''
  try {
    const models = await listAvailableModels({
      baseUrl: modelForm.baseUrl,
      apiKey: modelForm.apiKey,
      apiProtocol: modelForm.kind === 'chat' && modelForm.apiProtocol !== 'auto' ? modelForm.apiProtocol : undefined,
      kind: modelForm.kind,
    }, controller.signal)
    if (controller.signal.aborted || modelDiscoveryController !== controller) return
    availableModels.value = models
    if (models.length === 0) {
      modelDiscoveryError.value = '接口返回了空模型列表，请确认地址和密钥对应的服务。'
      return
    }
    const currentModelName = modelForm.modelName.trim()
    const initialModelName = models.some(model => model.id === currentModelName) ? currentModelName : models[0].id
    selectedModelNames.value = [initialModelName]
    modelForm.modelName = initialModelName
    message.success(`已获取 ${models.length} 个可用模型，请选择模型名称`)
  } catch (error: unknown) {
    if (controller.signal.aborted || modelDiscoveryController !== controller) return
    modelDiscoveryError.value = errorText(error, '获取模型失败，请检查接口地址和 API 密钥')
  } finally {
    if (modelDiscoveryController === controller) {
      modelDiscoveryController = null
      modelDiscoveryLoading.value = false
    }
  }
}

function handleSelectedModelNamesChange(value: string[]) {
  stopModelDiscovery()
  selectedModelNames.value = value
  modelForm.modelName = value[0] || ''
}

function handleManualModelNameChange(value: string) {
  stopModelDiscovery()
  modelForm.modelName = value
  const trimmed = value.trim()
  if (!trimmed || selectedModelNames.value.some(modelName => modelName !== trimmed)) {
    selectedModelNames.value = trimmed ? [trimmed] : []
  }
}

function selectAllAvailableModels() {
  stopModelDiscovery()
  selectedModelNames.value = availableModels.value.map(model => model.id)
  modelForm.modelName = selectedModelNames.value[0] || ''
}

// 保存模型
function handleSaveModel() {
  if (!isFormValid.value) return
  const modelName = modelForm.modelName.trim()
  const existingModel = editingModel.value
    ? configStore.models.find(model => model.id === editingModel.value)
    : null
  const apiKey = modelForm.apiKey.trim() || existingModel?.apiKey || ''
  if (!apiKey && modelForm.kind !== 'embedding' && !isLocalModelUrl(modelForm.baseUrl)) return
  const config = { ...modelForm, ...splitSearchMode(modelForm.chatSearchProtocol), apiKey, name: modelForm.name.trim() || modelName, modelName,
    apiProtocol: modelForm.kind === 'chat' && modelForm.apiProtocol !== 'auto' ? modelForm.apiProtocol : undefined,
    contextWindow: modelForm.contextWindow && modelForm.contextWindow > 0 ? Math.round(modelForm.contextWindow) : undefined }
  if (editingModel.value) {
    configStore.updateModel(editingModel.value, config)
    message.success('模型配置已更新')
  } else {
    configStore.addModel(config)
    message.success('模型已添加')
  }
  clearModelEditor()
}

function modelConfigKey(baseUrl: string, modelName: string, apiKey: string) {
  return `${openAiV1BaseUrl(baseUrl).toLowerCase()}::${modelName.trim()}::${apiKey.trim()}`
}

function handleBatchSaveModels() {
  if (!isBatchFormValid.value) return
  const selected = availableModels.value.filter(model => selectedModelNames.value.includes(model.id))
  if (selected.length < 2) {
    message.warning('请至少选择两个模型后再批量添加')
    return
  }

  const baseUrl = modelForm.baseUrl.trim()
  const apiKey = modelForm.apiKey.trim()
  const existing = new Set(configStore.models.map(model => modelConfigKey(model.baseUrl, model.modelName, model.apiKey)))
  let added = 0
  let skipped = 0

  for (const model of selected) {
    const key = modelConfigKey(baseUrl, model.id, apiKey)
    if (existing.has(key)) {
      skipped += 1
      continue
    }
    configStore.addModel({
      kind: modelForm.kind,
      name: model.id,
      baseUrl,
      apiKey,
      modelName: model.id,
      temperature: modelForm.temperature,
      topP: modelForm.topP,
      maxTokens: modelForm.maxTokens,
      apiProtocol: modelForm.kind === 'chat' && modelForm.apiProtocol !== 'auto' ? modelForm.apiProtocol : undefined,
      ...(modelForm.contextWindow && modelForm.contextWindow > 0 ? { contextWindow: Math.round(modelForm.contextWindow) } : {}),
      ...splitSearchMode(modelForm.chatSearchProtocol),
    })
    existing.add(key)
    added += 1
  }

  if (added) {
    message.success(`已添加 ${added} 个模型${skipped ? `，跳过 ${skipped} 个重复配置` : ''}`)
  } else {
    message.info('所选模型都已存在，未新增配置')
  }
  // 批量添加不保存当前已有模型的修改，继续保留这份草稿。
  if (editingModel.value) {
    selectedModelNames.value = modelForm.modelName ? [modelForm.modelName] : []
    rememberModelDraft()
  }
  clearModelEditor(Boolean(editingModel.value))
}

async function closeModelModal() {
  const id = editingModel.value
  if (modelDirty.value && !await confirmDiscardChanges('当前模型的修改和批量选择尚未保存，确定放弃吗？')) return
  if (editingModel.value === id) clearModelEditor()
}

function clearModelEditor(keepDraft = false) {
  if (!keepDraft) modelDrafts.delete(editingModel.value)
  stopModelDiscovery()
  showAddModel.value = false
  availableModels.value = []
  modelDiscoveryError.value = ''
  resetForm()
}

// 删除模型
function handleDeleteModel(id: string) {
  dialog.warning({
    title: '确认删除',
    content: dirtyModelKeys.value.has(id) ? '确定要删除这个模型配置及其未保存的草稿吗？' : '确定要删除这个模型配置吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      configStore.deleteModel(id)
      modelDrafts.delete(id)
      if (editingModel.value === id) clearModelEditor()
      message.success('模型已删除')
    },
  })
}

// 测试连接
function connectionTestRecord(status: ModelConnectionTestRecord['status'], fingerprint: string, environment: ModelConnectionTestRecord['environment']): ModelConnectionTestRecord {
  return { status, testedAt: new Date().toISOString(), fingerprint, environment }
}

async function runModelConnectionTest(model: ModelConfig, quiet = false): Promise<{ ok: boolean; message: string } | null> {
  const snapshot = { ...model }
  const environment = configStore.securityStatus.environment
  const attempt = configStore.beginModelConnectionTest(model.id, environment)
  if (!attempt) return null
  try {
    let fingerprint = await modelConnectionFingerprint(snapshot)
    if (!configStore.isCurrentModelConnectionTest(attempt)) return null
    const started = await configStore.recordModelConnectionTest(attempt, connectionTestRecord('testing', fingerprint, environment))
    if (!started || !configStore.isCurrentModelConnectionTest(attempt)) return null

    let status: 'ok' | 'fail'
    let successMessage = ''
    let failureMessage = '连接测试失败'
    let failureDetail = ''
    let detectedProtocol: AiProtocol | undefined
    try {
      if (snapshot.kind === 'embedding') {
        const result = await testEmbeddingConnection({ enabled: true, baseUrl: snapshot.baseUrl, apiKey: snapshot.apiKey, modelName: snapshot.modelName, batchSize: 1 })
        status = 'ok'
        successMessage = `连接成功：${result.dimensions} 维，${result.latency} ms`
      } else {
        const result = await testConnection(snapshot)
        status = result.ok ? 'ok' : 'fail'
        successMessage = result.message
        failureMessage = result.message
        failureDetail = result.detail || ''
        detectedProtocol = result.detectedProtocol
        if (detectedProtocol) fingerprint = await modelConnectionFingerprint({ ...snapshot, apiProtocol: detectedProtocol })
      }
    } catch (error) {
      status = 'fail'
      failureMessage = errorText(error, '连接测试失败')
    }

    const published = await configStore.recordModelConnectionTest(attempt, connectionTestRecord(status, fingerprint, environment), detectedProtocol)
    if (!published) return null
    testState[model.id] = status
    if (!quiet) {
      if (status === 'ok') message.success(successMessage)
      else message.error(failureMessage)
    }
    return { ok: status === 'ok', message: status === 'ok' ? successMessage || '连接正常' : failureMessage, ...(status === 'ok' ? {} : { detail: failureDetail }) }
  } finally {
    configStore.finishModelConnectionTest(attempt)
  }
}

/** 合并测试的第一步：测对话连接，结果交给测试组件显示。 */
async function testModelForCombined(model: ModelConfig) {
  const generation = ++modelTestUiGeneration
  testingId.value = model.id
  try {
    return await runModelConnectionTest(model, true)
      ?? { ok: false, message: '这个模型的另一项测试还在进行，请稍后重试。' }
  } catch (error) {
    return { ok: false, message: errorText(error, '连接测试失败') }
  } finally {
    if (generation === modelTestUiGeneration) testingId.value = null
  }
}

const TASK_BADGES = [
  { key: 'outline', label: '大纲', className: 'badge-outline' },
  { key: 'writing', label: '写作', className: 'badge-writing' },
  { key: 'review', label: '审查', className: 'badge-review' },
  { key: 'chat', label: '对话', className: 'badge-outline' },
  { key: 'embedding', label: '语义检索', className: 'badge-vector' },
] as const
/** 实际会用到这个模型的任务：按任务分配解析，包括未分配时的默认模型和对话跟随大纲。 */
function modelTasks(model: ModelConfig) {
  return TASK_BADGES.filter(task => configStore.getModelForTask(task.key)?.id === model.id).map(task => ({
    ...task,
    title: task.key === 'chat' && !configStore.models.some(item => item.id === configStore.assignments.chat && item.kind !== 'embedding') ? '对话跟随大纲模型' : '',
  }))
}

async function testModel(model: ModelConfig) {
  const generation = ++modelTestUiGeneration
  testingId.value = model.id
  try {
    await runModelConnectionTest(model)
  } catch (error) {
    message.error(errorText(error, '连接测试失败'))
  } finally {
    if (generation === modelTestUiGeneration) testingId.value = null
  }
}

// 重置表单
function resetForm() {
  editingModel.value = null
  selectedModelNames.value = []
  Object.assign(modelForm, {
    kind: 'chat',
    name: '',
    baseUrl: '',
    apiKey: '',
    modelName: '',
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 4096,
    contextWindow: null,
    chatSearchProtocol: 'auto',
    apiProtocol: 'auto',
  })
}

function saveEmbedding() {
  configStore.updateEmbeddingConfig({
    batchSize: Math.min(64, Math.max(1, Math.round(embeddingForm.batchSize || 16))),
  })
  message.success('向量记忆配置已保存')
}

function handleEmbeddingEnabledChange(enabled: boolean) {
  configStore.updateEmbeddingConfig({ enabled })
}

async function handleTestEmbedding() {
  if (!assignedEmbeddingModel.value) {
    message.warning('请先在任务分配中选择向量模型')
    return
  }
  const generation = ++embeddingTestUiGeneration
  testingEmbedding.value = true
  try {
    await runModelConnectionTest(assignedEmbeddingModel.value)
  } catch (error) {
    message.error(errorText(error, '向量服务连接失败'))
  } finally {
    if (generation === embeddingTestUiGeneration) testingEmbedding.value = false
  }
}

function skillTaskLabel(task: WritingSkillTask) {
  return skillTaskOptions.find(option => option.value === task)?.label || task
}

function openSkillModal(skill?: WritingSkill) {
  const id = skill?.id ?? null
  if (showSkillModal.value && editingSkill.value === id) return
  if (skillDirty.value) skillDrafts.set(editingSkill.value, { form: { ...skillForm }, baseline: skillBaseline.value })
  editingSkill.value = id
  const draft = skillDrafts.get(id)
  Object.assign(skillForm, draft?.form || (skill ? {
    name: skill.name,
    description: skill.description,
    task: skill.task,
    instructions: skill.instructions,
  } : { name: '', description: '', task: 'writing', instructions: '' }))
  skillBaseline.value = draft?.baseline || JSON.stringify(skillForm)
  skillDrafts.delete(id)
  showSkillModal.value = true
}
const starCount = ref<number | null>(null)
// 问题反馈的诊断信息（不含作品内容和密钥）
function diagnosticsData() {
  const novelStore = useNovelStore(), knowledgeStore = useKnowledgeStore()
  return collectDiagnostics({ novels: novelStore.novels, knowledgeBases: knowledgeStore.knowledgeBases, models: configStore.models,
    assignments: { ...configStore.assignments }, theme: theme.currentTheme, storage: configStore.securityStatus.storage })
}
async function copyDiagnostics() {
  try { await navigator.clipboard.writeText(formatDiagnostics(diagnosticsData())); message.success('诊断信息已复制，可以粘贴到问题反馈里') }
  catch { message.error('复制失败，请改用“保存诊断包”') }
}
function saveDiagnostics() {
  const blob = new Blob([JSON.stringify(diagnosticsData(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `mobish-diagnostics-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
watch(activeTab, tab => {
  if (tab === 'skills' && !showSkillModal.value && configStore.skills.length) openSkillModal(configStore.skills[0])
  // 只在打开关于页时取 Star 数（缓存一天，失败不提示）
  if (tab === 'about' && starCount.value === null) void fetchStarCount().then(count => { starCount.value = count })
}, { immediate: true })

async function closeSkillModal() {
  const id = editingSkill.value
  if (skillDirty.value && !await confirmDiscardChanges('当前技能的修改尚未保存，确定放弃吗？')) return
  if (editingSkill.value === id) clearSkillEditor()
}

function clearSkillEditor() {
  skillDrafts.delete(editingSkill.value)
  showSkillModal.value = false
  editingSkill.value = null
  Object.assign(skillForm, { name: '', description: '', task: 'writing', instructions: '' })
}

async function saveSkill() {
  const signature = JSON.stringify(skillForm)
  const data = {
    name: skillForm.name.trim(),
    description: skillForm.description.trim(),
    task: skillForm.task,
    instructions: skillForm.instructions.trim(),
  }
  if (editingSkill.value) configStore.updateSkill(editingSkill.value, data)
  else editingSkill.value = configStore.addSkill(data).id
  const id = editingSkill.value
  try {
    await configStore.saveConfig()
    if (showSkillModal.value && editingSkill.value === id) {
      skillBaseline.value = signature
      if (!skillDirty.value) clearSkillEditor()
    } else {
      const draft = skillDrafts.get(id)
      if (draft) {
        draft.baseline = signature
        if (JSON.stringify(draft.form) === signature) skillDrafts.delete(id)
      }
    }
    message.success('技能已保存')
  } catch { message.error('技能保存失败，请重试保存。') }
}
function restoreSkill() {
  const original = createBuiltInSkills().find(item => item.id === editingSkill.value)
  if (!original) return
  dialog.warning({ title: '恢复内置规则？', content: '替换当前编辑框中的规则，点击保存后生效。', positiveText: '恢复', negativeText: '取消',
    onPositiveClick: () => Object.assign(skillForm, { name: original.name, description: original.description, task: original.task, instructions: original.instructions }) })
}

function handleDeleteSkill(id: string) {
  dialog.warning({
    title: '删除技能',
    content: dirtySkillKeys.value.has(id) ? '确定删除这个自定义技能及其未保存的草稿？' : '确定删除这个自定义技能？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => {
      configStore.deleteSkill(id)
      skillDrafts.delete(id)
      if (editingSkill.value === id) clearSkillEditor()
      message.success('技能已删除')
    },
  })
}
</script>

<style scoped>
.settings-draft-note { padding: 10px 12px; border-left: 3px solid var(--zhu); background: var(--zhu-soft); color: var(--ink-2); font-size: 13px; }
.draft-badge { color: var(--zhu); font-size: 12px; }
.settings-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: var(--space-xl);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--r-s);
  background: transparent;
  color: var(--ink-2);
  font-size: 14px;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.back-btn:hover {
  color: var(--ink);
  background: var(--hover);
}

.settings-layout {
  display: flex;
  align-items: flex-start;
  gap: 32px;
  width: 100%;
  max-width: 1440px;
}

.settings-nav {
  position: sticky;
  top: 0;
  flex: 0 0 176px;
  flex-direction: column;
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--desk);
  border-radius: var(--r-m);
  border: 1px solid var(--line);
  width: 176px;
}

.settings-nav-item {
  padding: 13px 16px;
  text-align: left;
  border: none;
  border-radius: var(--r-s);
  background: none;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  color: var(--ink-2);
  cursor: pointer;
  transition: all var(--motion-fast);
  white-space: nowrap;
}

.settings-nav-item:hover {
  color: var(--ink);
  background: var(--hover);
}

.settings-nav-item[aria-selected="true"] {
  color: var(--zhu);
  background: var(--paper);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.settings-nav-item:focus-visible {
  outline: 2px solid var(--zhu);
  outline-offset: 2px;
}

@media (max-width: 760px) {
  .settings-layout { flex-direction: column; gap: 18px; }
  .settings-nav {
    position: static;
    flex: none;
    flex-direction: row;
    max-width: 100%;
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .settings-nav::-webkit-scrollbar {
    height: 4px;
  }
}

.settings-content {
  flex: 1;
  min-width: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
  max-width: none;
}

.settings-section {
  padding: var(--space-lg);
}
.cloud-settings-section { padding: 0; }
.about-brand { display: flex; align-items: center; gap: 16px; margin: 20px 0; }
.about-brand > .seal { width: 52px; height: 56px; font-size: 32px; }
.about-brand h3 { font-size: 30px; }
.about-features { display: grid; gap: 12px; margin: 24px 0; color: var(--ink-2); }
.about-links { display: grid; margin-top: 24px; }
.about-links a { display: flex; justify-content: space-between; padding: 16px 0; border-top: 1px solid var(--line); }

.section-title {
  font-family: var(--f-serif);
  font-size: 28px;
  font-weight: 600;
  margin-bottom: var(--space-lg);
  color: var(--ink);
}

.subsection-title {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: var(--space-md);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-md);
}

.section-header h3 {
  margin-bottom: 0;
}

.section-desc {
  font-size: 13px;
  color: var(--ink-3);
  margin-top: -8px;
  margin-bottom: var(--space-md);
}

.section-desc-inline { margin: 4px 0 0; }
.embedding-form { display: flex; flex-direction: column; gap: 12px; }
.span-2 { grid-column: span 2; }
.privacy-note, .disabled-hint { color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.section-actions { display: flex; justify-content: flex-end; gap: 8px; }
.setting-inline-toggle { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:16px; padding-top:16px; border-top:1px solid var(--line); }
.setting-inline-toggle strong { font-size:13px; }
.setting-inline-toggle .section-desc { margin:4px 0 0; }
@media (max-width:600px) { .setting-inline-toggle { align-items:flex-start; } }
.skill-list { display: flex; flex-direction: column; }
.skill-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; min-height: 66px; border-top: 1px solid var(--line); }
.skill-info { min-width: 0; }
.skill-name { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.skill-name strong { color: var(--ink); font-size: 14px; }
.skill-info p { margin-top: 4px; color: var(--ink-3); font-size: 12px; }

.empty-models {
  text-align: center;
  padding: var(--space-xl) 0;
  color: var(--ink-3);
}

.empty-models .hint {
  font-size: 13px;
  margin-top: 4px;
}

/* 模型列表 */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.model-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: var(--r-m);
  background: var(--desk);
  border: 1px solid var(--line);
  transition: border-color var(--motion-fast);
  gap: 12px;
}

.model-card:hover {
  border-color: var(--ink-3);
}

.model-info {
  min-width: 0;
  overflow-wrap: anywhere;
}

.model-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}

.model-detail {
  font-size: 12px;
  color: var(--ink-3);
  margin-top: 2px;
}

.model-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.badge {
  padding: 1px 8px;
  border-radius: 100px;
  font-size: 11px;
  font-weight: 600;
}

.badge-outline {
  background: var(--dai-soft);
  color: var(--dai);
}

.badge-writing {
  background: rgba(24, 160, 88, 0.1);
  color: var(--qing);
}

.badge-review {
  background: rgba(240, 160, 32, 0.1);
  color: var(--jin);
}

.model-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* 用途分配 */
.assignment-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--space-md);
}

.assignment-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.chat-assignment { grid-column: auto; }
.assignment-hint { margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.6; }

.assignment-item label {
  font-size: 13px;
  color: var(--ink-2);
  font-weight: 500;
}

/* 弹窗表单 */
.model-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  padding-top: var(--space-sm);
}

.model-form .m-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-form label {
  font-size: 13px;
  color: var(--ink-2);
  font-weight: 500;
}

.model-discovery-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.model-discovery-hint,
.model-discovery-success,
.model-discovery-error {
  font-size: 11px;
  line-height: 1.5;
}

.model-discovery-hint { color: var(--ink-3); }
.provider-presets { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
/* 国内、海外各占一行，分组名不会落到上一行末尾。 */
.provider-presets:has(.provider-row) { display: grid; gap: 8px; }
.provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.provider-row .provider-group { flex: 0 0 2.5em; }
/* 设置页表单的字段标题比全局默认的 12px 大一号，颜色更深。 */
.settings-v3 :deep(.m-field-l) { color: var(--ink); font-size: 13px; }
.model-kind-field { grid-column: 1 / -1; display: grid; gap: 6px; margin-bottom: 14px; }
.model-kind-switch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; max-width: 460px; }
.model-kind-option { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--ink-2); font: inherit; font-size: 14px; cursor: pointer; white-space: nowrap; }
.model-kind-option:hover:not(:disabled) { border-color: var(--line-2); color: var(--ink); }
.model-kind-option.on { border-color: var(--zhu); color: var(--ink); font-weight: 600; box-shadow: 0 0 0 3px var(--zhu-soft); }
.model-kind-option:disabled { cursor: not-allowed; opacity: .45; }
.model-kind-option:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
.provider-group { font-size: 12px; color: var(--ink-3); margin-right: 2px; }
.provider-note { margin: -6px 0 10px; }
.provider-note a { color: var(--zhu); margin-left: 4px; }
.model-discovery-success { color: var(--qing); }
.model-discovery-error { margin: 0; color: var(--zhu); }

.form-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-md);
}

.about-version {
  font-family: var(--f-num);
  font-size: 15px;
  color: var(--ink-2);
  margin: 8px 0;
}

.about-desc {
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink-2);
  margin-top: 16px;
}

.workflow-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.workflow-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border: 2px solid var(--line);
  border-radius: var(--r-m);
  background: var(--desk);
  text-align: left;
  cursor: pointer;
  transition: all var(--motion-fast);
}

.workflow-card:hover {
  border-color: var(--ink-3);
  background: var(--hover);
}

.workflow-card--active {
  border-color: var(--zhu);
  background: var(--zhu-soft);
}

.workflow-card h4 {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  margin: 0;
}

.workflow-card p {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-2);
  margin: 0;
}

.workflow-card:focus-visible {
  outline: 2px solid var(--zhu);
  outline-offset: 2px;
}

.security-status {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ink-3);
  padding: 12px;
  background: var(--paper);
  border-radius: var(--r-s);
  margin: 0;
}

@media (max-width: 680px) {
  .workflow-cards {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 680px) {
  .model-card { flex-direction: column; align-items: stretch; }
  .model-actions { flex-wrap: wrap; }
  .embedding-grid, .form-row, .assignment-grid { grid-template-columns: 1fr; }
  .span-2 { grid-column: auto; }
  .skill-row { grid-template-columns: auto minmax(0, 1fr); padding: 10px 0; }
  .skill-row .model-actions { grid-column: 2; }
}
.model-workbench { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: 24px; align-items: start; }
.model-catalogue { min-width: 0; }
.model-catalogue .model-card { flex-direction: column; align-items: stretch; padding: 16px; }
.model-catalogue .model-actions { flex-wrap: wrap; }
.model-card--selected { border-color: var(--zhu); background: var(--zhu-soft); }
.model-select { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
.model-editor { min-width: 0; padding: 20px; background: var(--paper); border: 1px solid var(--line); border-radius: var(--r-l); }
.model-editor .model-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.model-editor .model-form > .m-field:nth-child(n+3), .model-advanced { grid-column: 1 / -1; }
.model-form .m-field { margin-bottom: 0; }
.model-choices { max-height: 200px; overflow: auto; padding: 2px; }
.back-icon { transform: rotate(180deg); }
.danger-text { color: var(--zhu); }
.restore-skill { margin-right: auto; }
.model-advanced summary { cursor: pointer; color: var(--ink); font-weight: 600; padding: 8px 0; }
.model-advanced .form-row { margin-top: 14px; }
.section-header .section-title { margin-bottom: 0; }
.model-editor h3 { font-size: 21px; }
.model-editor-empty { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 16px; min-height: 300px; padding: 28px; border: 1px dashed var(--line-2); border-radius: var(--r-l); }
.model-editor-empty p { color: var(--ink-2); }
.model-editor-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 24px; }
.model-security-status { margin-top: -12px; }
.model-security-status .security-status { background: none; padding: 0 4px; }
.badge-vector { color: var(--dai); background: var(--dai-soft); }
.model-kind-text { color: var(--ink-3); font-size: 12px; }
.optional-label { font: 12px var(--f-ui); color: var(--ink-2); padding: 3px 8px; border: 1px solid var(--line-2); border-radius: var(--r-s); vertical-align: middle; }
.retrieval-model-status { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 24px 0; }
.retrieval-model-status strong { display: block; margin-top: 8px; overflow-wrap: anywhere; }
.setting-label { font-size: 13px; color: var(--ink-2); }
.retrieval-advanced { border-top: 1px solid var(--line); padding-top: 16px; }
.retrieval-advanced summary { cursor: pointer; color: var(--ink); font-weight: 600; }
.retrieval-advanced .batch-field { max-width: 240px; margin: 20px 0 12px; }
.workflow-card { font-family: var(--f-ui); }
.workflow-card h4 { font-family: var(--f-serif); font-size: 20px; }
@media (max-width: 1100px) {
  .model-workbench { grid-template-columns: 1fr; }
  .model-editor-empty { min-height: 150px; }
  .assignment-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  .retrieval-model-status { align-items: flex-start; flex-direction: column; gap: 12px; }
  .model-editor { padding: 16px; }
  .model-editor .model-form { grid-template-columns: 1fr; }
  .assignment-grid { grid-template-columns: 1fr; }
}

.settings-nav-item { display: flex; align-items: center; gap: 14px; }
.settings-nav-item[aria-selected="true"] { border-left: 3px solid var(--zhu); background: var(--zhu-soft); }
.skill-workbench { display: grid; grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.3fr); gap: 24px; align-items: start; }
.skill-list { gap: 12px; }
.skill-row { position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; padding: 18px; border: 1px solid var(--line-2); border-radius: 9px; background: var(--paper); gap: 12px; cursor: pointer; }
.skill-row:hover, .skill-row:focus-within { border-color: var(--zhu); }
.skill-row.selected { border-color: var(--zhu); background: var(--zhu-soft); }
.skill-info { flex: 1; min-width: 100px; }
.skill-select { font: 600 20px var(--f-serif); color: var(--ink); border: 0; background: transparent; padding: 0; text-align: left; cursor: pointer; }
.skill-row .model-actions { flex-basis: 100%; justify-content: flex-end; }
.skill-editor { padding: 24px; min-width: 0; }
.skill-editor h3 { font-size: 20px; margin-bottom: 20px; }
.skill-editor .section-actions { margin-top: 20px; }
.skill-editor-empty { padding: 32px; color: var(--ink-2); border: 1px dashed var(--line-2); border-radius: 9px; }
@media (max-width: 1000px) { .skill-workbench { grid-template-columns: 1fr; } .skill-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .skill-list { grid-template-columns: 1fr; } .settings-nav-item { gap: 8px; } }
.settings-header { display: flex; flex-direction: column-reverse; align-items: flex-start; gap: 8px; margin: 0 0 22px; padding: 8px 12px; }
.settings-header .page-title { font-size: 22px; }
.settings-header .back-btn { font-size: 12px; padding: 0; }
.settings-nav { border: 0; box-shadow: none; background: none; }
.skill-row { position: relative; align-items: flex-start; padding: 22px; }
.skill-row .m-switch { order: 2; margin-left: auto; }
.skill-info { min-width: 0; }
.skill-select { font-size: 22px; }
.skill-info p { margin-top: 10px; font-size: 14px; line-height: 1.7; }
.skill-row .model-actions { position: absolute; right: 16px; bottom: 12px; }
.skill-editor { padding: 24px; }
.skill-editor h3 { font-size: 20px; margin-bottom: 20px; }
@media (max-width: 760px) { .settings-header { display: none; } .skill-row { padding: 16px; } }
.workflow-card { position: relative; min-height: 180px; display: grid; grid-template-columns: 60px minmax(0, 1fr); gap: 8px 18px; padding: 24px; align-content: start; }
.workflow-symbol { grid-row: span 2; display: grid; place-items: center; width: 60px; height: 60px; border-radius: 50%; background: var(--dai-soft); color: var(--dai); }
.workflow-card--active .workflow-symbol { color: var(--zhu); background: var(--zhu-soft); }
.workflow-card h4 { font-size: 22px; }
.workflow-card p { line-height: 1.8; font-size: 14px; }
.workflow-preview { margin-top: 20px; padding: 24px; }
.workflow-preview h3, .retrieval-howto h3 { font-size: 23px; margin-bottom: 10px; }
.workflow-preview > p, .workflow-preview > small, .retrieval-howto p { font-size: 14px; line-height: 1.8; color: var(--ink-2); }
.workflow-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 16px; margin: 22px 0; }
.workflow-steps article { display: flex; align-items: flex-start; gap: 12px; padding: 18px; border: 1px solid var(--line); border-radius: var(--r-m); }
.workflow-step-number { flex: 0 0 30px; display: grid; place-items: center; height: 30px; border-radius: 50%; background: var(--dai-soft); color: var(--dai); }
.workflow-steps h4 { font-size: 16px; margin-bottom: 6px; }
.workflow-steps p { font-size: 13px; color: var(--ink-2); }
.retrieval-howto { padding: 24px 0; margin-top: 20px; border-top: 1px solid var(--line); }
.retrieval-howto > div { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.retrieval-howto article { padding: 12px 0; }
.retrieval-howto strong { font-size: 16px; }
@media (max-width: 900px) { .workflow-card { min-height: 140px; grid-template-columns: 48px minmax(0, 1fr); padding: 18px; } .workflow-symbol { width: 48px; height: 48px; } .retrieval-howto > div { grid-template-columns: minmax(0, 1fr); gap: 12px; } }
.about-brand { padding: 4px 0; margin: 12px 0; }
.about-brand .seal { width: 56px; height: 64px; font-size: 38px; }
.about-brand h3 { font-size: 34px; }
.about-desc { font: 600 18px/1.7 var(--f-serif); max-width: none; }
.about-features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; padding: 18px 0; margin: 18px 0; border-top: 1px solid var(--line); }
.about-features article { display: flex; gap: 12px; align-items: flex-start; }
.about-features article > span { display: grid; place-items: center; flex: 0 0 40px; height: 40px; border-radius: 50%; background: var(--hover); }
.about-features h4 { font: 600 18px var(--f-serif); margin-bottom: 6px; }
.about-features p { font-size: 14px; margin: 0; }
.about-help-title { font-size: 20px; padding: 20px 0 10px; border-top: 1px solid var(--line); }
.about-links a { display: grid; grid-template-columns: 140px minmax(0, 1fr) 24px; align-items: center; color: var(--ink); }
.about-links small { color: var(--ink-2); font-size: 14px; }
.about-links a.about-star strong { color: var(--zhu); }
.about-links a.about-star > span { color: var(--zhu); }
.about-diagnostics { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 16px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; }
.about-diagnostics strong { display: block; font-size: 14px; }
.about-diagnostics small { color: var(--ink-3); font-size: 12px; line-height: 1.6; }
.about-diagnostics > div:first-child { flex: 1 1 320px; }
.about-diagnostics-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.about-backup-note { margin-top: 20px; font-size: 13px; color: var(--ink-2); }
@media (max-width: 650px) { .about-links a { grid-template-columns: minmax(0, 1fr) 24px; gap: 6px; } .about-links small { grid-column: 1; grid-row: 2; } .about-links a > span { grid-column: 2; grid-row: 1 / 3; } }
.workflow-rounds-value { color: var(--zhu); font-size: 17px; font-variant-numeric: tabular-nums; margin: 0 3px; }
.about-update { margin: 16px 0; padding: 16px 0 0; border-top: 1px solid var(--line); }
.about-update > .about-help-title { border: 0; padding: 0 0 12px; }
.font-licenses { margin: 16px 0; padding: 12px 0; border-top: 1px solid var(--line); font-size: 13px; }
.font-licenses summary { cursor: pointer; padding: 6px 0; color: var(--ink); }
.font-licenses > summary { font-weight: 600; }
.font-license-note, .font-license-package { margin: 8px 0; color: var(--ink-2); line-height: 1.6; overflow-wrap: anywhere; }
.font-license-item { padding: 4px 0; border-top: 1px solid var(--line); }
.font-license-item summary span { margin-left: 6px; color: var(--ink-2); font-size: 12px; }
.font-license-package { font-size: 12px; }
.font-license-heading { margin: 12px 0 6px; font-size: 12px; font-weight: 600; }
.font-license-text { max-height: 18rem; overflow: auto; margin: 0 0 12px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-s); background: var(--desk); color: var(--ink-2); font: 12px/1.6 var(--f-num); white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.font-licenses summary:focus-visible, .font-license-text:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
@media (max-width: 900px) { .about-features { grid-template-columns: 1fr; gap: 16px; } }

/* ---------- V3 外壳内的设置页：按原型的左导航 + 右内容两栏 ---------- */
.settings-v3.page-container { position: absolute; inset: 0; display: block; padding: 0; overflow: hidden; background: var(--desk); }
.settings-v3 .settings-layout { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 0; align-items: stretch; width: 100%; max-width: none; height: 100%; }
.settings-v3 .settings-nav { position: static; display: flex; flex-direction: column; gap: 2px; width: auto; padding: 22px 12px; overflow: auto; border: 0; border-right: 1px solid var(--line); border-radius: 0; background: var(--panel); box-shadow: none; }
.settings-v3 .settings-header { display: none; }
.settings-v3 .settings-nav-item { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: 0; border-radius: 7px; background: none; color: var(--ink-2); font: 500 13.5px var(--f-ui); text-align: left; }
.settings-v3 .settings-nav-item:hover { background: var(--hover); color: var(--ink); }
.settings-v3 .settings-nav-item[aria-selected="true"] { border-left: 0; background: var(--paper); box-shadow: var(--shadow-1); color: var(--ink); font-weight: 600; }
.settings-v3 .settings-nav-item:focus-visible { outline: 2px solid var(--zhu); outline-offset: -2px; }
.settings-v3 .settings-content { gap: 28px; max-width: none; padding: 28px 36px 60px; overflow: auto; }
.settings-v3 .settings-section.paper-panel { padding: 0; border: 0; border-radius: 0; background: none; box-shadow: none; }
.settings-v3 .section-title { margin: 0 0 4px; color: var(--ink); font: 600 24px var(--f-serif); }
.settings-v3 .section-desc { margin: 0 0 14px; color: var(--ink-3); font-size: 13px; }
.settings-v3 .subsection-title { margin: 0 0 4px; color: var(--ink); font: 600 20px var(--f-serif); }
.settings-v3 .section-header { align-items: flex-start; margin-bottom: 0; }
.settings-v3 :deep(.cloud-heading h2) { font: 600 24px var(--f-serif); }
.settings-v3 :deep(.cloud-page-subtitle) { font-size: 13px; }
.settings-v3 :deep(.history-panel h2) { margin: 0 0 8px; font: 600 20px var(--f-serif); }
.settings-v3 :deep(.history-panel h3) { font: 600 16px var(--f-serif); }
.settings-v3 :deep(.history-panel p) { color: var(--ink-3); font-size: 12px; line-height: 1.8; }
.settings-v3 :deep(.history-panel button) { min-height: 32px; max-width: 100%; padding: 6px 12px; border: 1px solid var(--line-2); border-radius: var(--r-s); background: var(--paper); color: var(--ink-2); font: 12px var(--f-ui); }
.settings-v3 :deep(.history-panel button:hover:not(:disabled)) { border-color: var(--ink-3); color: var(--ink); }
.settings-v3 :deep(.history-panel button:focus-visible) { outline: 2px solid var(--zhu); outline-offset: 2px; }

/* 模型卡片：三列网格，末尾是“添加模型”虚线卡 */
.settings-v3 .model-workbench { display: block; }
.settings-v3 .model-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0 24px; }
.settings-v3 .model-catalogue .model-card { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.settings-v3 .model-card:hover { border-color: var(--line-2); }
.settings-v3 .model-card--selected { border-color: var(--zhu); background: var(--paper); box-shadow: 0 0 0 3px var(--zhu-soft); }
.settings-v3 .model-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.settings-v3 .model-name { color: var(--ink); font: 600 14px var(--f-ui); }
.settings-v3 .model-detail { margin-top: 4px; color: var(--ink-3); font: 12px var(--f-num); }
.settings-v3 .model-key, .settings-v3 .model-tested-at { display: none; }
.settings-v3 .model-test-result { display: flex; flex: none; flex-direction: column; align-items: flex-end; gap: 2px; }
.settings-v3 .model-status { flex: none; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.settings-v3 .model-status.ok { background: var(--qing-soft); color: var(--qing); }
.settings-v3 .model-status.fail { background: var(--zhu-soft); color: var(--zhu); }
.settings-v3 .model-status.testing { background: var(--hover); color: var(--ink-3); }
.settings-v3 .model-tested-at { color: var(--ink-3); font: 11px var(--f-num); white-space: nowrap; }
.settings-v3 .model-badges { margin-top: 5px; }
.settings-v3 .badge { padding: 1px 7px; border: 1px solid var(--line-2); border-radius: 4px; background: none; color: var(--ink-3); font-size: 11px; font-weight: 500; }
.settings-v3 .model-actions { flex-wrap: wrap; align-items: center; gap: 2px 6px; margin: 3px -6px -2px; padding-top: 5px; border-top: 1px dashed var(--line); }
.settings-v3 .model-add-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 104px; border: 1px dashed var(--line-2); border-radius: var(--r-m); background: none; color: var(--ink-3); font-size: 13px; cursor: pointer; }
.settings-v3 .model-add-card:hover { border-color: var(--zhu); color: var(--zhu); }
.settings-v3 .model-add-card:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
.settings-v3 .empty-models { padding: 12px 0 0; text-align: left; }
.settings-v3 .model-editor { margin: 0 0 24px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.settings-v3 .model-editor-empty { display: none; }

/* 任务分配：左标签右下拉的表格式行 */
.settings-v3 #model-task-assignments { scroll-margin-top: 8px; outline: none; }
.settings-v3 .assignment-grid { display: block; overflow: hidden; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.settings-v3 .assignment-item { display: grid; grid-template-columns: 160px minmax(220px, 280px) minmax(0, 1fr); align-items: center; gap: 4px 16px; padding: 12px 16px; border-top: 1px solid var(--line); }
.settings-v3 .assignment-item:first-child { border-top: 0; }
.settings-v3 .assignment-item.m-field { margin-bottom: 0; }
.settings-v3 .assignment-item > :deep(label) { color: var(--ink); font-size: 15px; font-weight: 600; }
.settings-v3 .assignment-hint { grid-column: 3; grid-row: 1 / span 2; color: var(--ink-3); font-size: 12px; }
/* 推荐说明放在任务名称和下拉框下面一行；右侧的补充说明跨两行。模型例子只写系列名，避免版本号很快过时。 */
.settings-v3 .assignment-item > :deep(label) { grid-column: 1; grid-row: 1; }
.settings-v3 .assignment-item > :not(label):not(p) { grid-column: 2; grid-row: 1; }
.settings-v3 .assignment-recommend { grid-column: 1 / 3; grid-row: 2; margin: 0; color: var(--ink-3); font-size: 12px; line-height: 1.5; }

/* AI 工作流：三张选项卡 */
.settings-v3 .workflow-cards { gap: 12px; margin: 16px 0; }
.settings-v3 .workflow-card { display: block; min-height: 0; padding: 16px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.settings-v3 .workflow-card:hover { background: var(--paper); border-color: var(--line-2); }
.settings-v3 .workflow-card--active { border-color: var(--zhu); background: var(--paper); box-shadow: 0 0 0 3px var(--zhu-soft); }
.settings-v3 .workflow-symbol { display: none; }
.settings-v3 .workflow-card h4 { margin: 0; color: var(--ink); font: 600 16px var(--f-serif); }
.settings-v3 .workflow-card p { margin: 6px 0 0; color: var(--ink-3); font-size: 12.5px; line-height: 1.65; }
.settings-v3 .workflow-preview { padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--r-m); background: var(--paper); }
.settings-v3 .workflow-preview h3, .settings-v3 .retrieval-howto h3 { margin: 0 0 6px; font: 600 17px var(--f-serif); }

/* 外观：三张主题卡 */
.theme-cards { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 14px; }
.theme-card { width: 150px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); cursor: pointer; text-align: left; }
.theme-card.on { border-color: var(--zhu); box-shadow: 0 0 0 3px var(--zhu-soft); }
.theme-card:focus-visible { outline: 2px solid var(--zhu); outline-offset: 2px; }
.theme-swatch { display: grid; grid-template-columns: 14px 1fr; height: 64px; margin-bottom: 6px; overflow: hidden; border-radius: 6px; }
.theme-swatch i { position: relative; display: block; }
.theme-swatch b { position: absolute; top: 12px; left: 12px; width: 22px; height: 6px; border-radius: 3px; }
.theme-name { font-size: 12.5px; }

@media (max-width: 1100px) {
  .settings-v3 .model-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .settings-v3 .assignment-item { grid-template-columns: 140px minmax(0, 1fr); }
  .settings-v3 .assignment-hint { grid-column: 1 / -1; grid-row: auto; }
  .settings-v3 .assignment-recommend { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .settings-v3.page-container { overflow: auto; }
  .settings-v3 .settings-layout { display: flex; flex-direction: column; height: auto; }
  .settings-v3 .settings-nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); flex: none; gap: 4px; padding: 10px 12px; overflow: visible; border-right: 0; border-bottom: 1px solid var(--line); }
  .settings-v3 .settings-nav-item { width: auto; min-width: 0; padding: 8px 6px; gap: 6px; white-space: normal; font-size: 12px; }
  .settings-v3 .settings-nav-item span { min-width: 0; overflow-wrap: anywhere; }
  .settings-v3 .settings-content { padding: 20px 14px 40px; overflow: visible; }
  .settings-v3 .model-list { grid-template-columns: 1fr; }
  .settings-v3 .assignment-item { grid-template-columns: 1fr; }
  .settings-v3 .assignment-item > :deep(label), .settings-v3 .assignment-item > :not(label):not(p),
  .settings-v3 .assignment-recommend, .settings-v3 .assignment-hint { grid-column: 1; grid-row: auto; }
  .settings-v3 .workflow-cards { grid-template-columns: 1fr; }
}
@media (max-width: 420px) {
  .settings-v3 .settings-nav { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
