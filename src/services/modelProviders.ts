// 添加模型时可选的常用官方服务商。只预填官方接口地址和联网方式；
// 模型名称随服务商更新较快，由“获取模型列表”或用户自己填写，不在这里写死。
export type ChatSearchAdapter = 'qwen' | 'zhipu' | 'gemini' | 'search-service'

export interface ModelProviderPreset {
  id: string
  label: string
  region: 'domestic' | 'overseas' | 'local'
  baseUrl: string
  /** 填写模型名时的参考示例，仅作提示。 */
  modelHint: string
  /** 这个服务商的联网方式说明。 */
  searchNote: string
  /** 官方没有可用的内置联网搜索，需要配置独立搜索服务。 */
  needsSearchService?: boolean
  consoleUrl: string
  signupUrl?: string
  signupNote?: string
}

export interface EmbeddingProviderPreset {
  id: string
  label: string
  baseUrl: string
  modelHint: string
  consoleUrl: string
  /** 推荐的向量模型；选中预设时自动填入。 */
  defaultModel?: string
  /** 注册链接（如作者的邀请链接）及说明。 */
  signupUrl?: string
  signupNote?: string
}

/** 推荐的向量模型（获取模型列表时高亮）。 */
export const RECOMMENDED_EMBEDDING_MODELS = ['BAAI/bge-m3', 'text-embedding-v4', 'embedding-3', 'text-embedding-3-small']

/** 按名称判断是否为向量模型；重排序（reranker）不算。 */
export function isEmbeddingModelName(id: string): boolean {
  const name = id.toLowerCase()
  if (/rerank/.test(name)) return false
  return /embed|bge-|bge_|\bbce-|gte-|\bm3e|\be5-|jina-emb|nomic-embed/.test(name)
}

const siliconflowSignup = {
  signupUrl: 'https://cloud.siliconflow.cn/i/KSMskNN6',
  signupNote: '这是作者的邀请链接，通过它注册双方可能获得赠送额度，以硅基流动活动规则为准；也可以直接到官网 https://cloud.siliconflow.cn/ 注册。',
}

/** 提供 OpenAI 兼容 /embeddings 接口的常用服务商；只填接口地址，模型名由“获取模型”或用户填写。 */
export const EMBEDDING_PROVIDER_PRESETS: EmbeddingProviderPreset[] = [
  { id: 'siliconflow', label: '硅基流动（bge-m3 目前免费）', baseUrl: 'https://api.siliconflow.cn/v1', modelHint: '如：BAAI/bge-m3', consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    defaultModel: 'BAAI/bge-m3', ...siliconflowSignup },
  { id: 'qwen', label: '通义（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelHint: '如：text-embedding-v4', consoleUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'zhipu', label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelHint: '如：embedding-3', consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', modelHint: '如：text-embedding-3-small', consoleUrl: 'https://platform.openai.com/api-keys' },
]

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', region: 'domestic', baseUrl: 'https://api.deepseek.com',
    modelHint: '例如 deepseek-chat', searchNote: '官方接口没有内置联网搜索，联网时使用你配置的搜索服务。', needsSearchService: true,
    consoleUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'qwen', label: '通义千问（阿里云百炼）', region: 'domestic', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelHint: '例如 qwen-plus', searchNote: '使用百炼的联网搜索（enable_search）。',
    consoleUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'kimi', label: 'Kimi（月之暗面）', region: 'domestic', baseUrl: 'https://api.moonshot.cn/v1',
    modelHint: '点击“获取模型列表”选择', searchNote: '联网时使用你配置的搜索服务。', needsSearchService: true,
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu', label: '智谱 GLM', region: 'domestic', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelHint: '点击“获取模型列表”选择', searchNote: '使用智谱的网络搜索工具（web_search）。',
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'doubao', label: '豆包（火山方舟）', region: 'domestic', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelHint: '填写模型 ID 或推理接入点 ID', searchNote: '使用方舟 Responses 接口的联网搜索工具，需要在方舟控制台开通。',
    consoleUrl: 'https://console.volcengine.com/ark' },
  { id: 'openai', label: 'OpenAI', region: 'overseas', baseUrl: 'https://api.openai.com/v1',
    modelHint: '点击“获取模型列表”选择', searchNote: '使用 Responses 接口的网页搜索工具。',
    consoleUrl: 'https://platform.openai.com/api-keys' },
  { id: 'claude', label: 'Claude（Anthropic）', region: 'overseas', baseUrl: 'https://api.anthropic.com/v1',
    modelHint: '点击“获取模型列表”选择', searchNote: '使用 Messages 接口的网页搜索工具。',
    consoleUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Gemini（Google）', region: 'overseas', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelHint: '点击“获取模型列表”选择', searchNote: '使用 Google 搜索增强（google_search）。',
    consoleUrl: 'https://aistudio.google.com/apikey' },
  { id: 'siliconflow', label: '硅基流动', region: 'domestic', baseUrl: 'https://api.siliconflow.cn/v1',
    modelHint: '例如 deepseek-ai/DeepSeek-V3', searchNote: '聚合多家开源模型；没有内置联网搜索，联网时使用你配置的搜索服务。', needsSearchService: true,
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak', ...siliconflowSignup },
  { id: 'minimax', label: 'MiniMax', region: 'domestic', baseUrl: 'https://api.minimaxi.com/v1',
    modelHint: '可点“获取模型”选择', searchNote: '联网时使用你配置的搜索服务。', needsSearchService: true,
    consoleUrl: 'https://platform.minimaxi.com/' },
  { id: 'hunyuan', label: '腾讯混元', region: 'domestic', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    modelHint: '例如 hunyuan-turbos-latest', searchNote: '联网时使用你配置的搜索服务。', needsSearchService: true,
    consoleUrl: 'https://console.cloud.tencent.com/hunyuan/api-key' },
  { id: 'openrouter', label: 'OpenRouter', region: 'overseas', baseUrl: 'https://openrouter.ai/api/v1',
    modelHint: '例如 deepseek/deepseek-chat', searchNote: '聚合多家模型，联网使用 OpenRouter 的网页搜索插件（另行计费）。',
    consoleUrl: 'https://openrouter.ai/keys' },
  { id: 'ollama', label: 'Ollama（本机）', region: 'local', baseUrl: 'http://127.0.0.1:11434/v1',
    modelHint: '先在 Ollama 下载模型，再点“获取模型”', searchNote: '本机运行，不需要 API 密钥，密钥可以留空；联网时使用你配置的搜索服务。', needsSearchService: true,
    consoleUrl: 'https://ollama.com/download' },
  { id: 'lmstudio', label: 'LM Studio（本机）', region: 'local', baseUrl: 'http://127.0.0.1:1234/v1',
    modelHint: '先在 LM Studio 启动本地服务，再点“获取模型”', searchNote: '本机运行，不需要 API 密钥，密钥可以留空；联网时使用你配置的搜索服务。', needsSearchService: true,
    consoleUrl: 'https://lmstudio.ai/' },
]

function hostname(baseUrl: string): string {
  try { return new URL(baseUrl).hostname.toLowerCase() } catch { return '' }
}
const onHost = (host: string, domain: string) => host === domain || host.endsWith('.' + domain)

/** 按官方接口地址识别服务商；中转地址返回 null。 */
export function detectModelProvider(baseUrl: string): ModelProviderPreset | null {
  const host = hostname(baseUrl)
  if (!host) return null
  const byHost: Array<[string, string]> = [
    ['api.deepseek.com', 'deepseek'], ['dashscope.aliyuncs.com', 'qwen'], ['dashscope-intl.aliyuncs.com', 'qwen'],
    ['moonshot.cn', 'kimi'], ['moonshot.ai', 'kimi'], ['bigmodel.cn', 'zhipu'], ['z.ai', 'zhipu'],
    ['volces.com', 'doubao'], ['api.openai.com', 'openai'], ['api.anthropic.com', 'claude'],
    ['generativelanguage.googleapis.com', 'gemini'], ['api.siliconflow.cn', 'siliconflow'], ['api.minimaxi.com', 'minimax'],
    ['api.hunyuan.cloud.tencent.com', 'hunyuan'], ['openrouter.ai', 'openrouter'],
  ]
  if (host === '127.0.0.1' || host === 'localhost') {
    const port = (() => { try { return new URL(baseUrl).port } catch { return '' } })()
    const local = port === '11434' ? 'ollama' : port === '1234' ? 'lmstudio' : ''
    return local ? MODEL_PROVIDER_PRESETS.find(preset => preset.id === local) || null : null
  }
  const match = byHost.find(([domain]) => onHost(host, domain))
  return match ? MODEL_PROVIDER_PRESETS.find(preset => preset.id === match[1]) || null : null
}

/** 官方接口在“自动”模式下使用的联网方式；null 表示沿用原有的自动推测。 */
export function autoSearchAdapter(baseUrl: string): ChatSearchAdapter | 'responses' | 'anthropic' | null {
  const provider = detectModelProvider(baseUrl)
  if (!provider) return null
  if (provider.needsSearchService) return 'search-service'
  const adapters: Record<string, ChatSearchAdapter | 'responses' | 'anthropic'> = {
    qwen: 'qwen', zhipu: 'zhipu', gemini: 'gemini', doubao: 'responses', openai: 'responses', claude: 'anthropic',
  }
  return adapters[provider.id] ?? null
}

/** 本机模型服务（Ollama、LM Studio 等）不需要 API 密钥。 */
export function isLocalModelUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.replace(/^\[|\]$/g, '')
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch { return false }
}
