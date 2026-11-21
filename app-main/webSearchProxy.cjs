// 主进程转发联网搜索请求：只放行已知搜索服务的固定接口，以及 SearXNG 的 /search JSON 查询。
// 渲染进程直接请求时可能被跨域限制拦截，所以桌面版经这里发送。
const PROVIDERS = {
  firecrawl: { hosts: ['api.firecrawl.dev'], method: 'POST', path: /^\/v2\/search$/ },
  tavily: { hosts: ['api.tavily.com'], method: 'POST', path: /^\/search$/ },
  bocha: { hosts: ['api.bochaai.com', 'api.bocha.cn'], method: 'POST', path: /^\/v1\/web-search$/ },
  zhipu: { hosts: ['open.bigmodel.cn', 'api.z.ai'], method: 'POST', path: /^\/api\/paas\/v4\/web_search$/ },
  searxng: { hosts: null, method: 'GET', path: /\/search$/ },
}
const ALLOWED_HEADERS = new Set(['authorization', 'content-type', 'accept'])
const MAX_BODY = 64 * 1024
const MAX_RESPONSE = 2 * 1024 * 1024

function validateWebSearchRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new TypeError('搜索请求格式无效')
  const rule = Object.prototype.hasOwnProperty.call(PROVIDERS, request.provider) ? PROVIDERS[request.provider] : null
  if (!rule) throw new TypeError('不支持的搜索服务')
  if (request.method !== rule.method) throw new TypeError('搜索请求方法无效')
  if (typeof request.url !== 'string' || request.url.length > 4096) throw new TypeError('搜索地址无效')
  const url = new URL(request.url)
  if (url.username || url.password || url.hash) throw new TypeError('搜索地址不能包含凭据或片段')
  if (rule.hosts) {
    if (url.protocol !== 'https:' || !rule.hosts.includes(url.hostname.toLowerCase()) || url.search || !rule.path.test(url.pathname)) {
      throw new TypeError('搜索地址不属于所选服务')
    }
  } else {
    if (!['http:', 'https:'].includes(url.protocol) || !rule.path.test(url.pathname) || url.searchParams.get('format') !== 'json') {
      throw new TypeError('SearXNG 地址无效')
    }
  }
  const headers = {}
  for (const [key, value] of Object.entries(request.headers || {})) {
    if (!ALLOWED_HEADERS.has(key.toLowerCase()) || typeof value !== 'string' || value.length > 4096) throw new TypeError('搜索请求头无效')
    headers[key] = value
  }
  let body
  if (rule.method === 'POST') {
    if (typeof request.body !== 'string' || request.body.length > MAX_BODY) throw new TypeError('搜索请求内容无效')
    body = request.body
  } else if (request.body !== undefined) throw new TypeError('GET 搜索请求不能带内容')
  return { url: url.href, method: rule.method, headers, body }
}

function createWebSearchProxy(fetchImpl, timeoutMs = 30_000) {
  return async function proxy(request) {
    const checked = validateWebSearchRequest(request)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(checked.url, { method: checked.method, headers: checked.headers, body: checked.body, signal: controller.signal })
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > MAX_RESPONSE) throw new Error('搜索服务返回的内容过大')
      return { ok: response.ok, status: response.status, text: buffer.toString('utf8') }
    } finally {
      clearTimeout(timer)
    }
  }
}

module.exports = { createWebSearchProxy, validateWebSearchRequest }
