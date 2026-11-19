import { describe, expect, it } from 'vitest'
import { describeError, diagnosticReport, errorText } from './userFacingError'

describe('user-facing error text', () => {
  it('translates internal validation errors and keeps the original as diagnostics', () => {
    const backup = describeError('备份数据不完整或无效：novels[0].chapters[2].summarySource')
    expect(backup.text).toBe('备份数据校验未通过，文件可能不完整或已损坏。')
    expect(backup.detail).toBe('备份数据不完整或无效：novels[0].chapters[2].summarySource')
    expect(describeError('Error: 编辑草稿无效：不得保存访问器').text).toBe('草稿数据异常，无法恢复或保存。')
    expect(describeError('AI 请求账本无效：usedTokens').text).toBe('AI 任务记录已损坏，无法继续这项任务。')
    expect(describeError('摘要请求账本无效：pending').text).toBe('AI 任务记录已损坏，无法继续这项任务。')
    expect(describeError('章节来源绑定要求非空章节 ID 和正文').text).toBe('内容为空，无法生成摘要。')
    expect(describeError('人物记忆数据无效：states[0]（投影字段不得持久化）').text).toBe('人物记忆数据不完整，已暂停显示。')
    expect(describeError('故事审校事务不能嵌套执行').text).toContain('保存失败，请重试')
  })

  it('leaves ordinary messages unchanged', () => {
    expect(describeError('请填写角色姓名。')).toEqual({ text: '请填写角色姓名。', detail: null })
    expect(errorText(new Error('[HTTP_403] 搜索权限被拒绝。'), '失败')).toBe('[HTTP_403] 搜索权限被拒绝。')
    expect(errorText(new Error('AI 请求账本无效：status'), '失败')).toBe('AI 任务记录已损坏，无法继续这项任务。')
    expect(errorText(undefined, '读取失败')).toBe('读取失败')
  })

  it('builds a copyable diagnostic report', () => {
    expect(diagnosticReport('AI 请求账本无效：status', '1.0.11', new Date('2026-11-19T00:00:00Z')))
      .toBe('墨笔生花 v1.0.11\n时间：2026-11-19T00:00:00.000Z\n原始错误：AI 请求账本无效：status')
  })
})
