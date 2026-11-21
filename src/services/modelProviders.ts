// 添加模型时可选的常用官方服务商。只预填官方接口地址和联网方式；
// 模型名称随服务商更新较快，由“获取模型列表”或用户自己填写，不在这里写死。
export type ChatSearchAdapter = 'qwen' | 'zhipu' | 'gemini' | 'search-service'

export interface ModelProviderPreset {
  id: string
  label: string
  region: 'domestic' | 'overseas'
  baseUrl: string
  /** 填写模型名时的参考示例，仅作提示。 */
  modelHint: string
  /** 这个服务商的联网方式说明。 */
  searchNote: string
  /** 官方没有可用的内置联网搜索，需要配置独立搜索服务。 */
  needsSearchService?: boolean
  consoleUrl: string
}

export interface EmbeddingProviderPreset {
  id: string
  label: string
  baseUrl: string
  modelHint: string
  consoleUrl: string
}

/** 提供 OpenAI 兼容 /embeddings 接口的常用服务商；只填接口地址，模型名由“获取模型”或用户填写。 */
export const EMBEDDING_PROVIDER_PRESETS: EmbeddingProviderPreset[] = [
  { id: 'qwen', label: '通义（阿里云百炼）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelHint: '如：text-embedding-v4', consoleUrl: 'https://bailian.console.aliyun.com/' },
  { id: 'zhipu', label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelHint: '如：embedding-3', consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'siliconflow', label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', modelHint: '如：BAAI/bge-m3', consoleUrl: 'https://cloud.siliconflow.cn/account/ak' },
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
    ['generativelanguage.googleapis.com', 'gemini'],
  ]
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
