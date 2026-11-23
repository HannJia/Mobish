import { describe, expect, it } from 'vitest'
import { explainAiError } from './aiErrorExplain'

describe('explainAiError', () => {
  it('explains a relay group 403 and keeps the raw text', () => {
    const raw = 'API 请求失败 (403): {"error":{"message":"API Key 所属专属分组不再允许当前用户使用","type":"upstream_error"}}'
    const result = explainAiError(raw)
    expect(result.hint).toContain('（403）')
    expect(result.hint).toContain('分组')
    expect(result.detail).toContain('专属分组')
  })

  it('maps common statuses and network errors', () => {
    expect(explainAiError('API 请求失败 (401): invalid api key').hint).toContain('密钥无效')
    expect(explainAiError('API 请求失败 (404): model not found').hint).toContain('（404）')
    expect(explainAiError('API 请求失败 (429): insufficient_quota').hint).toContain('额度不足')
    expect(explainAiError('API 请求失败 (429): rate limit').hint).toContain('太频繁')
    expect(explainAiError('API 请求失败 (400): bad').hint).toContain('参数')
    expect(explainAiError('API 请求失败 (502): bad gateway').hint).toContain('（502）')
    expect(explainAiError('TypeError: Failed to fetch').hint).toContain('连不上')
    expect(explainAiError('请求超时（120秒）').hint).toContain('超时')
  })

  it('never echoes a bearer token', () => {
    expect(explainAiError('API 请求失败 (401): Authorization: Bearer sk-secret').detail).not.toContain('sk-secret')
  })
})
