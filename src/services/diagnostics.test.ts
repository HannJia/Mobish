import { describe, expect, it } from 'vitest'
import { collectDiagnostics, formatDiagnostics } from './diagnostics'
import type { ModelConfig } from '@/stores/config'

describe('diagnostics', () => {
  it('summarizes counts and models without leaking keys, addresses or text', () => {
    const models = [
      { id: 'a', name: 'a', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-secret-1', modelName: 'deepseek-chat', temperature: 1, topP: 1, maxTokens: 8000 },
      { id: 'b', name: 'b', baseUrl: 'https://relay.private.example/v1?token=abc', apiKey: '', modelName: 'gpt-x', temperature: 1, topP: 1, maxTokens: 4000 },
    ] as ModelConfig[]
    const data = collectDiagnostics({
      novels: [{ chapters: [{ content: '秘密正文' }, { content: '' }] }],
      knowledgeBases: [{ entries: [1, 2, 3] }], models, assignments: { writing: 'a', chat: 'a' }, theme: 'dark',
    }, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/39.0.0', language: 'zh-CN', now: new Date('2026-11-23T00:00:00Z') })
    const text = formatDiagnostics(data) + JSON.stringify(data)
    expect(text).toContain('作品 1 部，章节 2 章（有正文 1 章），知识库 1 个 / 条目 3 条')
    expect(text).toContain('DeepSeek')
    expect(text).toContain('自定义地址')
    expect(text).toContain('用于 writing、chat')
    expect(text).toContain('桌面版（Electron 39.0.0）')
    for (const secret of ['sk-secret-1', 'relay.private.example', 'token=abc', '秘密正文']) expect(text).not.toContain(secret)
  })
})
