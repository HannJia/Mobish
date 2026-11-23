// 问题反馈用的诊断信息：版本、系统、数据规模、模型配置概况。
// 绝不包含作品正文、知识库内容、文件路径、API 密钥和接口地址里的令牌。
import { version } from '../../package.json'
import type { ModelConfig } from '@/stores/config'
import { detectModelProvider, isLocalModelUrl } from './modelProviders'

export interface DiagnosticsInput {
  novels: Array<{ chapters: Array<{ content?: string }>; status?: string }>
  knowledgeBases: Array<{ entries: unknown[] }>
  models: ModelConfig[]
  assignments: Record<string, string | undefined>
  theme?: string
  storage?: string
}

/** 只保留接口地址的服务商类型：官方服务商、本机、或“自定义地址”，不暴露具体域名和路径。 */
function providerLabel(baseUrl: string): string {
  if (isLocalModelUrl(baseUrl)) return '本机'
  return detectModelProvider(baseUrl)?.label || '自定义地址（中转站或其他）'
}

export function collectDiagnostics(input: DiagnosticsInput, env: { userAgent?: string; language?: string; now?: Date } = {}) {
  const chapters = input.novels.reduce((sum, novel) => sum + novel.chapters.length, 0)
  const written = input.novels.reduce((sum, novel) => sum + novel.chapters.filter(chapter => chapter.content?.trim()).length, 0)
  const ua = env.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  const os = /Windows NT 10\.0/.test(ua) ? 'Windows 10/11' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '未知'
  const electron = /Electron\/([\d.]+)/.exec(ua)?.[1]
  return {
    app: '墨笔生花', version, generatedAt: (env.now ?? new Date()).toISOString(),
    runtime: { os, arch: /x64|Win64|WOW64|x86_64/.test(ua) ? 'x64' : /arm64|aarch64/i.test(ua) ? 'arm64' : '未知', shell: electron ? `桌面版（Electron ${electron}）` : '浏览器版',
      language: env.language ?? (typeof navigator !== 'undefined' ? navigator.language : ''), theme: input.theme || '', storage: input.storage || '' },
    data: { novels: input.novels.length, chapters, writtenChapters: written,
      knowledgeBases: input.knowledgeBases.length, knowledgeEntries: input.knowledgeBases.reduce((sum, kb) => sum + kb.entries.length, 0) },
    models: input.models.map(model => ({
      kind: model.kind === 'embedding' ? '向量模型' : '写作／对话', provider: providerLabel(model.baseUrl), model: model.modelName,
      hasKey: !!model.apiKey?.trim(), maxTokens: model.maxTokens,
      tasks: Object.entries(input.assignments).filter(([, id]) => id === model.id).map(([task]) => task),
    })),
  }
}

export function formatDiagnostics(data: ReturnType<typeof collectDiagnostics>): string {
  return [
    `墨笔生花 v${data.version} · ${data.runtime.shell} · ${data.runtime.os} ${data.runtime.arch}`,
    `语言 ${data.runtime.language || '未知'} · 主题 ${data.runtime.theme || '未知'}${data.runtime.storage ? ' · 密钥存储 ' + data.runtime.storage : ''}`,
    `数据：作品 ${data.data.novels} 部，章节 ${data.data.chapters} 章（有正文 ${data.data.writtenChapters} 章），知识库 ${data.data.knowledgeBases} 个 / 条目 ${data.data.knowledgeEntries} 条`,
    '模型：' + (data.models.length ? '' : '未配置'),
    ...data.models.map(model => `- ${model.kind} · ${model.provider} · ${model.model}${model.hasKey ? '' : ' · 未填密钥'}${model.tasks.length ? ' · 用于 ' + model.tasks.join('、') : ''}`),
    `生成时间 ${data.generatedAt}`,
    '（不含作品内容、知识库内容、文件路径、API 密钥和接口地址）',
  ].join('\n')
}
