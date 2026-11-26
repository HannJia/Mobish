import { describe, expect, it } from 'vitest'
import { createEmptyCreationDraft } from '@/types/reconstruction'
import { contractCards, contractCardConfirmed, contractCardSignature, materializeContractConfirmations, toggleContractCard,
  parseContractExploration, adoptContractSuggestion, contractExplorationMessages, contractCardHistory,
  restoreContractCardVersion, legacyConflictSignature } from './storyContract'
import { confirmStoryContract, reviseStoryContract } from './reconstructionCreation'
import { creationDirectionSignature } from './creationTransactions'
import { getApprovedPlanning } from './reconstructionPlanning'
import { validateReconstructionCreationDraft } from './reconstructionBackupValidation'
import { applyCreationRecovery } from './creationDraft'

const now = '2026-11-10T00:00:00.000Z'
function fixture() {
  const draft = createEmptyCreationDraft({ id: 'test', now })
  Object.assign(draft.contract, { title: '渡口', genre: '悬疑', centralConflict: '追查旧信', endingDirection: '暂不确定' })
  return draft
}
function allConfirmed(contract = fixture().contract) {
  return contractCards.reduce((value, card) => toggleContractCard(value, card.id, now), contract)
}
describe('author contract cards and exploration', () => {
  it('requires nine author confirmations for contract approval', () => {
    const draft = fixture()
    expect(() => confirmStoryContract(draft, draft.contract, now)).toThrow('九张')
    expect(() => confirmStoryContract(draft, materializeContractConfirmations(draft.contract), now)).toThrow('九张')
    const confirmed = confirmStoryContract(draft, allConfirmed(draft.contract), now)
    expect(confirmed.stage).toBe('skeleton')
    expect(contractCards.every(card => contractCardConfirmed(confirmed.contract, card.id))).toBe(true)
  })
  it('drops changed-card confirmations and keeps other cards confirmed after list normalization', () => {
    const draft = fixture(), contract = allConfirmed({ ...draft.contract, worldRules: [' 代价 ', ''] })
    const revised = reviseStoryContract(draft, { ...contract, centralConflict: '寻找失踪的人' }, now)
    expect(contractCardConfirmed(revised.contract, 'conflict')).toBe(false)
    expect(contractCardConfirmed(revised.contract, 'rules')).toBe(true)
    expect(revised.contract.worldRules).toEqual(['代价'])
    expect(revised.contract.cardConfirmations).toHaveLength(8)
  })
  it('keeps confirmed plans and semantic signatures on reopening, and invalidates on withdrawal', () => {
    const draft = confirmStoryContract(fixture(), allConfirmed(fixture().contract), now)
    draft.approval.skeleton = 'approved'
    draft.skeletons = [{ id: 's', title: '渡口', premise: '旧信', logline: '查信', promise: '解谜', ending: '离开', beats: [], approval: 'approved', updatedAt: now }]
    draft.selectedSkeletonId = 's'
    const signature = creationDirectionSignature(draft), projection = getApprovedPlanning(draft, 0)
    const revised = reviseStoryContract(draft, materializeContractConfirmations(draft.contract), now)
    expect(creationDirectionSignature(revised)).toBe(signature)
    expect(getApprovedPlanning(revised, 0)).toEqual(projection)
    expect(revised.selectedSkeletonId).toBe('s')
    expect(revised.approval.skeleton).toBe('approved')
    const withdrawn = reviseStoryContract(revised, toggleContractCard(revised.contract, 'voice', now), now)
    expect(withdrawn.contract.approval).toBe('draft')
    expect(withdrawn.selectedSkeletonId).toBeUndefined()
    expect(withdrawn.skeletons[0].approval).toBe('draft')
  })
  it('never changes a card until adoption, then withdraws only that card and rejects stale suggestions', () => {
    const contract = allConfirmed()
    const { suggestions } = parseContractExploration(JSON.stringify({ reply: '可以改为第一人称。', suggestions: [{ cardId: 'voice', values: { pointOfView: '第一人称' } }] }), contract)
    expect(contract.pointOfView).toBeUndefined()
    expect(contractCardConfirmed(contract, 'voice')).toBe(true)
    const adopted = adoptContractSuggestion(contract, suggestions[0])
    expect(adopted.pointOfView).toBe('第一人称')
    expect(contractCardConfirmed(adopted, 'voice')).toBe(false)
    expect(contractCardConfirmed(adopted, 'theme')).toBe(true)
    expect(() => adoptContractSuggestion({ ...contract, pointOfView: '作者刚填的视角' }, suggestions[0])).toThrow('已有修改')
    expect(contractCardSignature(contract, 'voice')).toBe(suggestions[0].baseline)
  })
  it.each([{ approval: 'approved' }, { title: '别的卡片' }, { pointOfView: 3 }])('rejects model fields outside the card whitelist', values => {
    expect(() => parseContractExploration(JSON.stringify({ reply: '建议', suggestions: [{ cardId: 'voice', values }] }), fixture().contract)).toThrow()
  })
  it('round-trips contract recovery without advancing the formal direction or original baseline', () => {
    const draft = fixture(), formal = JSON.stringify(draft.contract)
    const recovery = { id: 'editor', surface: 'contract' as const, baseline: 'original-baseline', contract: allConfirmed(),
      exploration: { input: '尚未发送的想法', messages: [{ id: 'm', role: 'assistant' as const, status: 'interrupted' as const, content: '{"reply":"部分' }] },
      manualOutline: '', outlineText: '', updatedAt: now }
    const saved = applyCreationRecovery(draft, { kind: 'editor', value: recovery })
    expect(JSON.stringify(saved.contract)).toBe(formal)
    expect(() => validateReconstructionCreationDraft(JSON.parse(JSON.stringify(saved)))).not.toThrow()
    expect(saved.editorDrafts![0]).toEqual(recovery)
    saved.editorDrafts![0].contract!.id = 'another-contract'
    expect(() => validateReconstructionCreationDraft(saved)).toThrow('contract')
  })
  it('excludes partial model turns from future context and does not include confirmation metadata', () => {
    const messages = contractExplorationMessages(allConfirmed(), { input: '', messages: [
      { id: 'u', role: 'user', content: '主角是谁', status: 'completed' },
      { id: 'a', role: 'assistant', content: '残缺JSON', status: 'partial' },
      { id: 'b', role: 'assistant', content: '{"reply":"已解析"}', reply: '建议先确定身份', status: 'completed' },
    ] })
    expect(messages.map(message => message.content).join('\n')).not.toContain('残缺JSON')
    expect(messages[0].content).not.toContain('cardConfirmations')
    expect(messages[2].content).toBe('建议先确定身份')
  })

  it('keeps alternative explanations and adopts only the selected value', () => {
    const contract = allConfirmed()
    const result = parseContractExploration(JSON.stringify({ reply: '两种写法', suggestions: [
      { cardId: 'romance', explanation: '偏和缓', values: { romanceDirection: '慢热' } },
      { cardId: 'romance', explanation: '偏克制', values: { romanceDirection: '无感情线' } },
    ] }), contract)
    expect(result.reply).toBe('两种写法')
    expect(result.suggestions.map(item => item.explanation)).toEqual(['偏和缓', '偏克制'])
    const picked = adoptContractSuggestion(contract, result.suggestions[1], now)
    expect(picked.romanceDirection).toBe('无感情线')
    expect(() => adoptContractSuggestion(picked, result.suggestions[0], now)).toThrow('已有修改')
    expect(() => parseContractExploration('{"reply":"\\n","suggestions":[]}', contract)).toThrow()
    expect(parseContractExploration('{"reply":"继续聊","suggestions":[]}', contract).suggestions).toEqual([])
  })

  it.each([[undefined, '内层说明'], ['  ', '内层说明'], [' 外层说明 ', '外层说明']])('normalizes a nested explanation with outer explanation %j', (outer, expected) => {
    const { suggestions } = parseContractExploration(JSON.stringify({ reply: '可以选择开放式结局。', suggestions: [
      { cardId: 'ending', explanation: outer, values: { endingDirection: '开放式结局', explanation: ' 内层说明 ' } },
    ] }), fixture().contract)
    expect(suggestions[0]).toMatchObject({ cardId: 'ending', explanation: expected })
    expect(suggestions[0].values).toEqual({ endingDirection: '开放式结局' })
  })

  it.each([{ title: '别的卡片', explanation: '有效说明' }, { explanation: 42 }, { explanation: '字'.repeat(6001) }])('rejects other invalid fields alongside an otherwise usable card', invalid => {
    expect(() => parseContractExploration(JSON.stringify({ reply: '建议', suggestions: [
      { cardId: 'ending', values: { endingDirection: '开放式结局', ...invalid } },
    ] }), fixture().contract)).toThrow('建议包含不属于该卡片的字段')
  })

  it('migrates the old conflict card and confirms blank ending and romance in one operation', () => {
    const contract = { ...fixture().contract, endingDirection: '保留旧结局', romanceDirection: '   ' }
    const old = { ...contract, cardConfirmations: [{ cardId: 'conflict', signature: legacyConflictSignature(contract), confirmedAt: now }] }
    expect(contractCards[contractCards.length - 1]?.id).toBe('ending')
    expect(contractCardConfirmed(old, 'ending')).toBe(true)
    expect(materializeContractConfirmations(old).endingDirection).toBe('保留旧结局')
    const blank = toggleContractCard({ ...old, endingDirection: '  ' }, 'ending', now)
    const romance = toggleContractCard(blank, 'romance', now)
    expect(romance).toMatchObject({ endingDirection: '暂不确定', romanceDirection: '暂不确定' })
    expect(contractCardConfirmed(romance, 'ending')).toBe(true)
    expect(contractCardConfirmed(romance, 'romance')).toBe(true)
  })

  it('deduplicates earlier history at read time and preserves dates through five restores', () => {
    const draft = fixture()
    const changed = reviseStoryContract(draft, { ...draft.contract, centralConflict: '调查失踪案' }, now).contract
    const original = changed.cardHistory![0]
    const later = '2026-11-26T00:00:00.000Z'
    let contract = { ...changed, cardHistory: [{ ...original, savedAt: later }, original] }
    for (let index = 0; index < 5; index++) {
      const [version] = contractCardHistory(contract, 'conflict')
      contract = restoreContractCardVersion(contract, 'conflict', version.signature, later) as typeof contract
      expect(contract.cardHistory).toHaveLength(2)
      expect(contract.cardHistory.find(item => item.signature === original.signature)?.savedAt).toBe(now)
    }
    expect(contract.centralConflict).toBe(draft.contract.centralConflict)
    expect(contractCardConfirmed(contract, 'conflict')).toBe(false)
  })
})
