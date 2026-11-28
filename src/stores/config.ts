import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import type { WritingSkill, WritingSkillTask } from '@/types/skill'
import { createBuiltInSkills, upgradeSavedBuiltInSkill } from '@/data/skills'
import { normalizeAiWorkflowMode, type AiWorkflowMode } from '@/services/aiWorkflow'
import type { ChatSearchProtocol } from '@/types/chat'
import type { ChatSearchAdapter } from '@/services/modelProviders'
import type { AiProtocol } from '@/services/aiProtocols'
import { DEFAULT_WEB_SEARCH_SERVICE, WEB_SEARCH_PROVIDERS, type WebSearchServiceConfig } from '@/services/webSearchService'

// API 模型配置
export interface ModelConfig {
  id: string
  name: string         // 配置备注；无备注时使用模型 ID，不作为实际模型名称
  baseUrl: string      // API 基地址
  apiKey: string       // API Key
  modelName: string    // 模型名称
  maxTokens: number
  temperature: number
  topP: number
  contextWindow?: number // 模型上下文窗口大小（token 数），用于动态分配上下文
  chatSearchProtocol?: ChatSearchProtocol // 仅影响书内/灵感对话的联网请求
  /** 本机选择的联网方式（通义、智谱、Gemini 或独立搜索服务）；不参与云端配置同步，其他设备按接口地址自动识别。 */
  searchAdapter?: ChatSearchAdapter
  apiProtocol?: AiProtocol // 仅本机生效，自动模式不设置此字段
  kind?: 'chat' | 'embedding' // 模型用途类型；省略时默认为 chat
  connectionTest?: ModelConnectionTestRecord // 仅本机连接测试记录，不参与云端配置同步
}

export type ModelConnectionTestStatus = 'testing' | 'ok' | 'fail'
export type ModelConnectionTestEnvironment = 'browser' | 'electron'
export interface ModelConnectionTestRecord {
  status: ModelConnectionTestStatus
  testedAt: string
  fingerprint: string
  environment: ModelConnectionTestEnvironment
}

export interface ModelConnectionTestAttempt {
  modelId: string
  connectionVersion: number
  requestId: number
  environment: ModelConnectionTestEnvironment
}

// 模型用途映射
export interface ModelAssignments {
  outline: string    // 大纲生成模型 ID
  writing: string    // 写作模型 ID
  review: string     // 审查模型 ID
  chat: string       // 对话 / 联网模型 ID；空值动态跟随大纲模型
  embedding?: string // 未分配时禁用向量检索
}

export interface EmbeddingConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  modelName: string
  batchSize: number
}

export interface ConfigData {
  models: ModelConfig[]
  assignments: Partial<ModelAssignments>
  embedding?: Partial<EmbeddingConfig>
  skills?: WritingSkill[]
  aiWorkflowMode?: AiWorkflowMode
  pdfVisionEnabled?: boolean
  /** 独立联网搜索服务，只保存在本机，不参与云端配置同步。 */
  webSearchService?: WebSearchServiceConfig
}

interface SessionSecrets {
  models: Record<string, string>
  embedding: string
  webSearch?: string
}

export interface ConfigSecurityStatus {
  environment: 'electron' | 'browser'
  storage: 'encrypted' | 'session-only' | 'local-development'
  encryptionAvailable: boolean
}

const STORAGE_KEY = 'mojian-v3-config'
const SESSION_SECRET_KEY = 'mojian-v3-session-secrets'

function hasElectronConfig(): boolean {
  return !!window.electronAPI?.configRead && !!window.electronAPI?.configWrite
}

function hasSecureConfig(): boolean {
  return hasElectronConfig() && !!window.electronAPI?.configEncrypt && !!window.electronAPI?.configDecrypt
}

function isLocalDevelopment(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const hostname = window.location?.hostname
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

function emptySessionSecrets(): SessionSecrets {
  return { models: {}, embedding: '' }
}

function readSessionSecrets(): SessionSecrets {
  if (typeof sessionStorage === 'undefined') return emptySessionSecrets()
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_SECRET_KEY) || '{}') as Partial<SessionSecrets>
    return {
      models: parsed.models && typeof parsed.models === 'object' ? parsed.models : {},
      embedding: typeof parsed.embedding === 'string' ? parsed.embedding : '',
      webSearch: typeof parsed.webSearch === 'string' ? parsed.webSearch : '',
    }
  } catch {
    return emptySessionSecrets()
  }
}

function writeSessionSecrets(data: ConfigData) {
  if (typeof sessionStorage === 'undefined') return
  const secrets: SessionSecrets = {
    models: Object.fromEntries(data.models
      .filter(model => model.apiKey && !model.apiKey.startsWith('enc:'))
      .map(model => [model.id, model.apiKey])),
    embedding: data.embedding?.apiKey && !data.embedding.apiKey.startsWith('enc:') ? data.embedding.apiKey : '',
    webSearch: data.webSearchService?.apiKey && !data.webSearchService.apiKey.startsWith('enc:') ? data.webSearchService.apiKey : '',
  }
  sessionStorage.setItem(SESSION_SECRET_KEY, JSON.stringify(secrets))
}

function redactConfigSecrets(data: ConfigData): ConfigData {
  return {
    ...data,
    models: data.models.map(model => ({ ...model, apiKey: '' })),
    embedding: data.embedding ? { ...data.embedding, apiKey: '' } : undefined,
    webSearchService: data.webSearchService ? { ...data.webSearchService, apiKey: '' } : undefined,
  }
}

function mergeSessionSecrets(data: ConfigData): ConfigData {
  const secrets = readSessionSecrets()
  return {
    ...data,
    models: data.models.map(model => ({ ...model, apiKey: secrets.models[model.id] || model.apiKey || '' })),
    embedding: data.embedding ? { ...data.embedding, apiKey: secrets.embedding || data.embedding.apiKey || '' } : undefined,
    webSearchService: data.webSearchService ? { ...data.webSearchService, apiKey: secrets.webSearch || data.webSearchService.apiKey || '' } : undefined,
  }
}

function containsPersistedSecrets(data: ConfigData): boolean {
  return data.models.some(model => Boolean(model.apiKey)) || Boolean(data.embedding?.apiKey) || Boolean(data.webSearchService?.apiKey)
}

async function encryptConfig(data: ConfigData): Promise<ConfigData> {
  if (!hasSecureConfig()) return data
  return {
    ...data,
    models: await Promise.all(data.models.map(async model => ({
      ...model,
      apiKey: await window.electronAPI!.configEncrypt(model.apiKey),
    }))),
    embedding: data.embedding ? {
      ...data.embedding,
      apiKey: await window.electronAPI!.configEncrypt(data.embedding.apiKey || ''),
    } : undefined,
    webSearchService: data.webSearchService ? {
      ...data.webSearchService,
      apiKey: await window.electronAPI!.configEncrypt(data.webSearchService.apiKey || ''),
    } : undefined,
  }
}

async function decryptConfig(data: ConfigData | null): Promise<ConfigData | null> {
  if (!data || !hasSecureConfig()) return data
  return {
    ...data,
    models: await Promise.all(data.models.map(async model => ({
      ...model,
      apiKey: await window.electronAPI!.configDecrypt(model.apiKey),
    }))),
    embedding: data.embedding ? {
      ...data.embedding,
      apiKey: await window.electronAPI!.configDecrypt(data.embedding.apiKey || ''),
    } : undefined,
    webSearchService: data.webSearchService ? {
      ...data.webSearchService,
      apiKey: await window.electronAPI!.configDecrypt(data.webSearchService.apiKey || ''),
    } : undefined,
  }
}

const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  modelName: 'bge-m3',
  batchSize: 16,
}


function normalizeWebSearchService(value: Partial<WebSearchServiceConfig> | undefined): WebSearchServiceConfig {
  const provider = value?.provider && Object.prototype.hasOwnProperty.call(WEB_SEARCH_PROVIDERS, value.provider) ? value.provider : DEFAULT_WEB_SEARCH_SERVICE.provider
  const count = typeof value?.count === 'number' && Number.isFinite(value.count) ? Math.max(1, Math.min(10, Math.round(value.count))) : DEFAULT_WEB_SEARCH_SERVICE.count
  const freeFallback = typeof value?.freeFallback === 'boolean' ? value.freeFallback : DEFAULT_WEB_SEARCH_SERVICE.freeFallback
  return { provider, apiKey: typeof value?.apiKey === 'string' ? value.apiKey : '', baseUrl: typeof value?.baseUrl === 'string' ? value.baseUrl : '', count, freeFallback }
}

function mergeSkills(saved: WritingSkill[] | undefined): WritingSkill[] {
  const builtIns = createBuiltInSkills()
  const savedById = new Map((saved || []).map(skill => [skill.id, skill]))
  const mergedBuiltIns = builtIns.map(skill => {
    const stored = savedById.get(skill.id)
    return { ...skill, ...(stored ? upgradeSavedBuiltInSkill(stored) : {}), builtIn: true }
  })
  const custom = (saved || []).filter(skill => !skill.builtIn && !builtIns.some(item => item.id === skill.id))
  return [...mergedBuiltIns, ...custom]
}

export const useConfigStore = defineStore('config', () => {
  // 模型配置列表
  const models = ref<ModelConfig[]>([])

  // 模型用途分配
  const assignments = reactive<ModelAssignments>({
    outline: '',
    writing: '',
    review: '',
    chat: '',
    embedding: '',
  })
  const embedding = reactive<EmbeddingConfig>({ ...DEFAULT_EMBEDDING_CONFIG })
  const skills = ref<WritingSkill[]>(createBuiltInSkills())
  const aiWorkflowMode = ref<AiWorkflowMode>('balanced')
  const pdfVisionEnabled = ref(false)
  const webSearchService = reactive<WebSearchServiceConfig>({ ...DEFAULT_WEB_SEARCH_SERVICE })
  const securityStatus = reactive<ConfigSecurityStatus>({
    environment: 'browser',
    storage: isLocalDevelopment() ? 'local-development' : 'session-only',
    encryptionAvailable: false,
  })

  // 当前是否已配置
  const isConfigured = ref(false)
  const isInitialized = ref(false)
  let saveQueue: Promise<void> = Promise.resolve()
  let lastPersistedJson: string | undefined
  let modelConnectionRequestId = 0
  const modelConnectionVersions = new Map<string, number>()
  const latestModelConnectionRequests = new Map<string, number>()
  const activeModelConnectionRequests = reactive<Record<string, number>>({})

  function invalidateModelConnection(id: string) {
    modelConnectionVersions.set(id, (modelConnectionVersions.get(id) || 0) + 1)
    latestModelConnectionRequests.delete(id)
    delete activeModelConnectionRequests[id]
  }

  function invalidateAllModelConnections() {
    const ids = new Set([
      ...models.value.map(model => model.id),
      ...modelConnectionVersions.keys(),
      ...latestModelConnectionRequests.keys(),
    ])
    for (const id of ids) invalidateModelConnection(id)
  }

  function beginModelConnectionTest(id: string, environment: ModelConnectionTestEnvironment): ModelConnectionTestAttempt | null {
    const model = models.value.find(item => item.id === id)
    if (!model || securityStatus.environment !== environment) return null
    const requestId = ++modelConnectionRequestId
    latestModelConnectionRequests.set(id, requestId)
    activeModelConnectionRequests[id] = requestId
    return { modelId: id, connectionVersion: modelConnectionVersions.get(id) || 0, requestId, environment }
  }

  function isCurrentModelConnectionTest(attempt: ModelConnectionTestAttempt): boolean {
    return Boolean(
      models.value.some(model => model.id === attempt.modelId)
      && securityStatus.environment === attempt.environment
      && (modelConnectionVersions.get(attempt.modelId) || 0) === attempt.connectionVersion
      && latestModelConnectionRequests.get(attempt.modelId) === attempt.requestId,
    )
  }

  function isModelConnectionTestActive(id: string): boolean {
    return activeModelConnectionRequests[id] !== undefined
  }

  function finishModelConnectionTest(attempt: ModelConnectionTestAttempt) {
    if (activeModelConnectionRequests[attempt.modelId] === attempt.requestId) delete activeModelConnectionRequests[attempt.modelId]
  }

  function applyConfig(input: ConfigData | null) {
    invalidateAllModelConnections()
    const data = input
    models.value = data?.models || []
    Object.assign(assignments, { outline: '', writing: '', review: '', chat: '', embedding: '', ...(data?.assignments || {}) })
    for (const task of ['outline', 'writing', 'review', 'chat'] as const) {
      if (assignments[task] && !models.value.some(m => m.id === assignments[task] && m.kind !== 'embedding')) assignments[task] = ''
    }
    Object.assign(embedding, DEFAULT_EMBEDDING_CONFIG, data?.embedding || {})
    syncEmbeddingConnection()
    skills.value = mergeSkills(data?.skills)
    aiWorkflowMode.value = normalizeAiWorkflowMode(data?.aiWorkflowMode)
    pdfVisionEnabled.value = data?.pdfVisionEnabled === true
    Object.assign(webSearchService, normalizeWebSearchService(data?.webSearchService))
    isConfigured.value = models.value.some(m => m.kind !== 'embedding')
  }

  function syncEmbeddingConnection() {
    const model = models.value.find(m => m.id === assignments.embedding && m.kind === 'embedding')
    if (model) {
      Object.assign(embedding, { baseUrl: model.baseUrl, apiKey: model.apiKey, modelName: model.modelName })
    } else {
      assignments.embedding = ''
      Object.assign(embedding, { enabled: false, baseUrl: DEFAULT_EMBEDDING_CONFIG.baseUrl, apiKey: '', modelName: DEFAULT_EMBEDDING_CONFIG.modelName })
    }
  }

  function readLocalConfig(): ConfigData | null {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : null
  }

  async function loadConfig() {
    try {
      let data: ConfigData | null = null
      if (hasElectronConfig()) {
        const status = window.electronAPI?.configSecurityStatus
          ? await window.electronAPI.configSecurityStatus()
          : { encryptionAvailable: hasSecureConfig() }
        Object.assign(securityStatus, {
          environment: 'electron',
          storage: status.encryptionAvailable ? 'encrypted' : 'session-only',
          encryptionAvailable: status.encryptionAvailable,
        })
        const saved = await window.electronAPI!.configRead()
        const persisted = saved ? JSON.parse(saved) as ConfigData : null
        if (persisted && status.encryptionAvailable) {
          if (persisted.models.some(model => model.apiKey && !model.apiKey.startsWith('enc:'))
            || persisted.embedding?.apiKey && !persisted.embedding.apiKey.startsWith('enc:')
            || persisted.webSearchService?.apiKey && !persisted.webSearchService.apiKey.startsWith('enc:')) throw new Error('API 密钥必须加密保存。')
          data = await decryptConfig(persisted)
        } else if (persisted) {
          data = mergeSessionSecrets(redactConfigSecrets(persisted))
        }
      } else {
        const persisted = readLocalConfig()
        if (persisted) {
          if (!isLocalDevelopment() && containsPersistedSecrets(persisted)) throw new Error('网页版只能保存不含密钥的设置。')
          data = mergeSessionSecrets(persisted)
        }
        if (isLocalDevelopment()) securityStatus.storage = 'local-development'
      }
      applyConfig(data)
      lastPersistedJson = data ? JSON.stringify(exportConfig()) : undefined
      return true
    } catch {
      lastPersistedJson = undefined
      console.warn('配置加载失败，使用默认值')
      applyConfig(null)
      return false
    } finally {
      isInitialized.value = true
    }
  }

  function exportConfig(): ConfigData {
    return {
      models: JSON.parse(JSON.stringify(models.value)),
      assignments: { ...assignments },
      embedding: { ...embedding },
      skills: JSON.parse(JSON.stringify(skills.value)),
      aiWorkflowMode: aiWorkflowMode.value,
      pdfVisionEnabled: pdfVisionEnabled.value,
      webSearchService: { ...webSearchService },
    }
  }

  async function persistConfig(data: ConfigData) {
      // A failed write may have changed storage before reporting the failure.
      lastPersistedJson = undefined
      if (hasElectronConfig()) {
        if (securityStatus.encryptionAvailable) {
          await window.electronAPI!.configWrite(JSON.stringify(await encryptConfig(data)))
        } else {
          writeSessionSecrets(data)
          await window.electronAPI!.configWrite(JSON.stringify(redactConfigSecrets(data)))
        }
        localStorage.removeItem(STORAGE_KEY)
      } else if (isLocalDevelopment()) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } else {
        writeSessionSecrets(data)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(redactConfigSecrets(data)))
      }
  }

  async function saveConfig() {
    const data = exportConfig()
    const write = async () => {
      await persistConfig(data)
      lastPersistedJson = JSON.stringify(data)
    }
    const next = saveQueue.then(write, write)
    saveQueue = next.catch(() => undefined)
    await next
    isConfigured.value = models.value.some(model => model.kind !== 'embedding')
  }

  async function flushPendingSaves(): Promise<void> {
    while (true) {
      const pending = saveQueue
      await pending
      if (pending !== saveQueue) continue
      if (JSON.stringify(exportConfig()) === lastPersistedJson) return
      await saveConfig()
    }
  }

  // Persist before exposing restored settings to running UI/tasks. Existing save
  // operations and imports share one queue, so a pending save cannot undo import.
  async function importConfig(data: ConfigData, stillCurrent: () => boolean) {
    const candidate = JSON.parse(JSON.stringify(data)) as ConfigData
    // 云端配置不含独立搜索服务，恢复时保留本机设置。
    if (candidate.webSearchService === undefined) candidate.webSearchService = { ...webSearchService }
    for (const model of candidate.models) {
      const local = models.value.find(item => item.id === model.id && item.baseUrl === model.baseUrl && item.modelName === model.modelName)
      if (local?.apiProtocol && model.apiProtocol === undefined && model.kind !== 'embedding') model.apiProtocol = local.apiProtocol
    }
    const before = JSON.stringify(exportConfig())
    const write = async () => {
      if (!stillCurrent() || JSON.stringify(exportConfig()) !== before) throw new Error('本机配置已变化，请重新比较后恢复。')
      try { await persistConfig(candidate) }
      catch (cause) {
        // A write can fail after an OS-config write but before local publication
        // cleanup. Restore the current snapshot where storage still permits it.
        try { await persistConfig(exportConfig()) } catch { /* In-memory original remains available. */ }
        throw cause
      }
      if (!stillCurrent() || JSON.stringify(exportConfig()) !== before) {
        await persistConfig(exportConfig())
        throw new Error('恢复期间本机配置或账号已变化，已保留本机配置。')
      }
      applyConfig(candidate)
      lastPersistedJson = JSON.stringify(exportConfig())
    }
    const next = saveQueue.then(write, write)
    saveQueue = next.catch(() => undefined)
    await next
  }

  async function setWebSearchService(next: WebSearchServiceConfig) {
    Object.assign(webSearchService, normalizeWebSearchService(next))
    await saveConfig()
  }

  // 添加模型配置
  function addModel(config: Omit<ModelConfig, 'id'>): ModelConfig {
    const model: ModelConfig = {
      ...config,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
    }
    models.value.push(model)

    const kind = model.kind || 'chat'
    if (kind === 'chat') {
      const firstChat = models.value.filter(m => (m.kind || 'chat') === 'chat').length === 1
      if (firstChat) {
        assignments.outline = model.id
        assignments.writing = model.id
        assignments.review = model.id
      }
    } else if (kind === 'embedding') {
      const firstEmbedding = models.value.filter(m => m.kind === 'embedding').length === 1
      if (firstEmbedding && !assignments.embedding) {
        assignments.embedding = model.id
        embedding.baseUrl = model.baseUrl
        embedding.apiKey = model.apiKey
        embedding.modelName = model.modelName
      }
    }

    saveConfig()
    return model
  }

  // 更新模型配置
  function updateModel(id: string, updates: Partial<ModelConfig>) {
    const model = models.value.find(m => m.id === id)
    if (model) {
      const kindChanged = updates.kind !== undefined && (updates.kind || 'chat') !== (model.kind || 'chat')
      const connectionChanged = kindChanged
        || (Object.prototype.hasOwnProperty.call(updates, 'baseUrl') && updates.baseUrl !== model.baseUrl)
        || (Object.prototype.hasOwnProperty.call(updates, 'apiKey') && updates.apiKey !== model.apiKey)
        || (Object.prototype.hasOwnProperty.call(updates, 'modelName') && updates.modelName !== model.modelName)
        || (Object.prototype.hasOwnProperty.call(updates, 'apiProtocol') && updates.apiProtocol !== model.apiProtocol)
      if (connectionChanged) invalidateModelConnection(id)
      Object.assign(model, updates)
      if (connectionChanged) delete model.connectionTest
      if (kindChanged) {
        const newKind = model.kind || 'chat'
        if (newKind === 'chat' && assignments.embedding === id) {
          assignments.embedding = ''
          embedding.enabled = false
          embedding.baseUrl = DEFAULT_EMBEDDING_CONFIG.baseUrl
          embedding.apiKey = ''
          embedding.modelName = DEFAULT_EMBEDDING_CONFIG.modelName
        } else if (newKind === 'embedding') {
          if (assignments.outline === id) assignments.outline = models.value.find(m => m.id !== id && (m.kind || 'chat') === 'chat')?.id || ''
          if (assignments.writing === id) assignments.writing = models.value.find(m => m.id !== id && (m.kind || 'chat') === 'chat')?.id || ''
          if (assignments.review === id) assignments.review = models.value.find(m => m.id !== id && (m.kind || 'chat') === 'chat')?.id || ''
          if (assignments.chat === id) assignments.chat = ''
        }
      }
      if (assignments.embedding === id && (model.kind || 'chat') === 'embedding') {
        embedding.baseUrl = model.baseUrl
        embedding.apiKey = model.apiKey
        embedding.modelName = model.modelName
      }
      saveConfig()
    }
  }

  async function recordModelConnectionTest(attempt: ModelConnectionTestAttempt, record: ModelConnectionTestRecord, protocol?: AiProtocol): Promise<boolean> {
    if (record.environment !== attempt.environment || !isCurrentModelConnectionTest(attempt)) return false
    const model = models.value.find(item => item.id === attempt.modelId)
    if (!model) return false
    if (protocol && record.status === 'ok' && !model.apiProtocol && model.kind !== 'embedding') model.apiProtocol = protocol
    model.connectionTest = { ...record }
    if (!isCurrentModelConnectionTest(attempt)) return false
    await saveConfig()
    if (record.status !== 'testing' && isCurrentModelConnectionTest(attempt)) finishModelConnectionTest(attempt)
    return isCurrentModelConnectionTest(attempt)
  }

  // 删除模型配置
  function deleteModel(id: string) {
    invalidateModelConnection(id)
    const wasEmbedding = assignments.embedding === id
    models.value = models.value.filter(m => m.id !== id)
    const firstChat = models.value.find(m => (m.kind || 'chat') === 'chat')
    if (assignments.outline === id) assignments.outline = firstChat?.id || ''
    if (assignments.writing === id) assignments.writing = firstChat?.id || ''
    if (assignments.review === id) assignments.review = firstChat?.id || ''
    if (assignments.chat === id) assignments.chat = ''
    if (wasEmbedding) {
      assignments.embedding = ''
      embedding.enabled = false
      embedding.baseUrl = DEFAULT_EMBEDDING_CONFIG.baseUrl
      embedding.apiKey = ''
      embedding.modelName = DEFAULT_EMBEDDING_CONFIG.modelName
    }
    saveConfig()
  }

  // 获取指定用途的模型配置
  function getModelForTask(task: keyof ModelAssignments): ModelConfig | null {
    const modelId = assignments[task]
    if (task === 'chat') {
      return models.value.find(m => m.id === modelId && m.kind !== 'embedding') || getModelForTask('outline')
    }
    if (task === 'embedding') {
      const model = models.value.find(m => m.id === modelId)
      return model && model.kind === 'embedding' ? model : null
    }
    const candidate = models.value.find(m => m.id === modelId)
    if (candidate && candidate.kind !== 'embedding') return candidate
    return models.value.find(m => (m.kind || 'chat') === 'chat') || null
  }

  // 更新模型分配
  function setAssignment(task: keyof ModelAssignments, modelId: string) {
    const model = models.value.find(m => m.id === modelId)
    if (modelId && !model) return
    const kind = model?.kind || 'chat'
    if (task === 'embedding') {
      if (modelId && kind !== 'embedding') return
      assignments.embedding = modelId
      if (model && kind === 'embedding') {
        embedding.baseUrl = model.baseUrl
        embedding.apiKey = model.apiKey
        embedding.modelName = model.modelName
      } else {
        embedding.enabled = false
        embedding.baseUrl = DEFAULT_EMBEDDING_CONFIG.baseUrl
        embedding.apiKey = ''
        embedding.modelName = DEFAULT_EMBEDDING_CONFIG.modelName
      }
    } else {
      if (modelId && kind === 'embedding') return
      assignments[task] = modelId
    }
    saveConfig()
  }

  function updateEmbeddingConfig(updates: Partial<EmbeddingConfig>) {
    const selected = getModelForTask('embedding')
    const hasConnectionUpdate = ['baseUrl', 'modelName', 'apiKey'].some(key => Object.prototype.hasOwnProperty.call(updates, key))
    if (selected && hasConnectionUpdate) {
      const connectionChanged = selected.baseUrl !== (updates.baseUrl ?? embedding.baseUrl)
        || selected.apiKey !== (updates.apiKey ?? embedding.apiKey)
        || selected.modelName !== (updates.modelName ?? embedding.modelName)
      if (connectionChanged) {
        invalidateModelConnection(selected.id)
        delete selected.connectionTest
      }
      Object.assign(embedding, updates)
      Object.assign(selected, { baseUrl: embedding.baseUrl, apiKey: embedding.apiKey, modelName: embedding.modelName })
    } else if (!selected && hasConnectionUpdate) {
      Object.assign(embedding, updates)
      const data = exportConfig()
      delete data.assignments.embedding
      applyConfig(data)
    } else {
      Object.assign(embedding, updates)
    }
    syncEmbeddingConnection()
    void saveConfig()
  }

  function setAiWorkflowMode(mode: AiWorkflowMode) {
    aiWorkflowMode.value = normalizeAiWorkflowMode(mode)
    void saveConfig()
  }

  function setPdfVisionEnabled(enabled: boolean) {
    pdfVisionEnabled.value = enabled
    void saveConfig().catch(() => undefined)
  }

  function addSkill(data: Pick<WritingSkill, 'name' | 'description' | 'task' | 'instructions'>): WritingSkill {
    const now = new Date().toISOString()
    const skill: WritingSkill = {
      ...data,
      id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
      enabled: true,
      builtIn: false,
      createdAt: now,
      updatedAt: now,
    }
    skills.value.push(skill)
    void saveConfig().catch(() => undefined)
    return skill
  }

  function updateSkill(id: string, updates: Partial<Pick<WritingSkill, 'name' | 'description' | 'task' | 'instructions' | 'enabled'>>) {
    const skill = skills.value.find(item => item.id === id)
    if (!skill) return
    Object.assign(skill, updates)
    skill.updatedAt = new Date().toISOString()
    void saveConfig().catch(() => undefined)
  }

  function deleteSkill(id: string) {
    const skill = skills.value.find(item => item.id === id)
    if (!skill || skill.builtIn) return
    skills.value = skills.value.filter(item => item.id !== id)
    void saveConfig()
  }

  function getSkillPrompt(task: Exclude<WritingSkillTask, 'all'>): string {
    const active = skills.value
      .filter(skill => skill.enabled && (skill.task === task || skill.task === 'all'))
      .slice(0, 12)
    if (active.length === 0) return ''
    return active
      .map(skill => `【${skill.name.slice(0, 80)}】\n${skill.instructions.trim().slice(0, 1500)}`)
      .join('\n\n')
      .slice(0, 6000)
  }

  return {
    models,
    assignments,
    embedding,
    skills,
    aiWorkflowMode,
    pdfVisionEnabled,
    webSearchService,
    setWebSearchService,
    securityStatus,
    isConfigured,
    isInitialized,
    loadConfig,
    saveConfig,
    flushPendingSaves,
    exportConfig,
    importConfig,
    addModel,
    updateModel,
    beginModelConnectionTest,
    isCurrentModelConnectionTest,
    isModelConnectionTestActive,
    finishModelConnectionTest,
    recordModelConnectionTest,
    deleteModel,
    getModelForTask,
    setAssignment,
    updateEmbeddingConfig,
    setAiWorkflowMode,
    setPdfVisionEnabled,
    addSkill,
    updateSkill,
    deleteSkill,
    getSkillPrompt,
  }
})
