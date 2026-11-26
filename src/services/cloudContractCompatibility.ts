import type { ContractExploration, StoryContract } from '@/types/reconstruction'
import type { CreationSurface } from '@/types/planningRecovery'
import type { ProjectWorkspaceSnapshot } from './projectBackup'
import { contractCardSignature, legacyConflictSignature } from './storyContract'

type Message = ContractExploration['messages'][number]
type WireMessage = Message & { suggestionAlternatives?: Message['suggestions'] }
type CardState = Pick<StoryContract, 'cardConfirmations' | 'cardHistory'>
type EditorCardState = { id: string; cards: CardState }
interface WireWorkspace extends ProjectWorkspaceSnapshot {
  creationRecovery?: { surface?: CreationSurface; contract?: CardState; editors?: EditorCardState[] }
}

function encodeContract(contract: StoryContract): { value: StoryContract; cards?: CardState } {
  const { cardHistory, ...value } = contract
  const confirmations = contract.cardConfirmations || []
  const conflict = confirmations.find(item => item.cardId === 'conflict' && item.signature === contractCardSignature(contract, 'conflict'))
  const ending = confirmations.find(item => item.cardId === 'ending' && item.signature === contractCardSignature(contract, 'ending'))
  const hasSplit = Boolean(conflict || confirmations.some(item => item.cardId === 'ending'))
  if (hasSplit) value.cardConfirmations = [
    ...confirmations.filter(item => item.cardId !== 'ending' && item.cardId !== 'conflict'),
    ...(conflict && ending ? [{ ...conflict, signature: legacyConflictSignature(contract) }] : []),
  ]
  return { value, ...(hasSplit || cardHistory ? { cards: {
    ...(hasSplit ? { cardConfirmations: confirmations.filter(item => item.cardId === 'conflict' || item.cardId === 'ending') } : {}),
    ...(cardHistory ? { cardHistory } : {}),
  } } : {}) }
}

function decodeContract(contract: StoryContract, cards?: CardState): StoryContract {
  if (!cards) return contract
  const { cardConfirmations, cardHistory } = cards
  if (cardConfirmations !== undefined && (!Array.isArray(cardConfirmations)
    || cardConfirmations.some(item => !item || !['conflict', 'ending'].includes(item.cardId)))) throw new Error('云端契约卡片确认格式无效。')
  return {
    ...contract,
    ...(cardHistory !== undefined ? { cardHistory } : {}),
    ...(cardConfirmations ? {
      cardConfirmations: [
        ...(contract.cardConfirmations || []).filter(item => item.cardId !== 'ending' && item.cardId !== 'conflict'),
        ...cardConfirmations,
      ],
    } : {}),
  }
}

function encodeMessage(message: WireMessage): WireMessage {
  if (!message.suggestions?.length) return message
  const ids = new Set<string>()
  const primary = message.suggestions.filter(item => {
    if (item.cardId === 'ending' || ids.has(item.cardId)) return false
    ids.add(item.cardId)
    return true
  })
  return primary.length === message.suggestions.length ? message
    : { ...message, suggestions: primary, suggestionAlternatives: message.suggestions }
}

function decodeMessage(message: WireMessage): Message {
  if (message.suggestionAlternatives === undefined) return message
  const { suggestionAlternatives, ...rest } = message
  return { ...rest, suggestions: suggestionAlternatives }
}

/** Keep recovery metadata outside the contract and draft signatures read by 1.1.0. */
export function encodeCloudCreation(workspace: ProjectWorkspaceSnapshot): WireWorkspace {
  if (!workspace.creationDraft) return workspace
  const { lastSurface, ...draft } = workspace.creationDraft
  const contract = encodeContract(draft.contract)
  const editors: EditorCardState[] = []
  const editorDrafts = draft.editorDrafts?.map(editor => {
    const editorContract = editor.contract && encodeContract(editor.contract)
    if (editorContract?.cards) editors.push({ id: editor.id, cards: editorContract.cards })
    return { ...editor,
      ...(editorContract ? { contract: editorContract.value } : {}),
      ...(editor.exploration ? { exploration: { ...editor.exploration, messages: editor.exploration.messages.map(encodeMessage) } } : {}),
    }
  })
  return {
    ...workspace,
    creationDraft: { ...draft, contract: contract.value, ...(editorDrafts ? { editorDrafts } : {}) },
    ...(lastSurface || contract.cards || editors.length ? { creationRecovery: {
      surface: lastSurface, contract: contract.cards, ...(editors.length ? { editors } : {}),
    } } : {}),
  }
}

export function decodeCloudCreation(wire: WireWorkspace): ProjectWorkspaceSnapshot {
  const { creationRecovery, ...workspace } = wire
  const draft = workspace.creationDraft
  if (!draft) return workspace
  const editors = new Map(creationRecovery?.editors?.map(item => [item.id, item.cards]))
  return {
    ...workspace,
    creationDraft: {
      ...draft,
      ...(creationRecovery?.surface !== undefined ? { lastSurface: creationRecovery.surface } : {}),
      contract: decodeContract(draft.contract, creationRecovery?.contract),
      ...(draft.editorDrafts ? { editorDrafts: draft.editorDrafts.map(editor => ({
        ...editor,
        ...(editor.contract ? { contract: decodeContract(editor.contract, editors.get(editor.id)) } : {}),
        ...(editor.exploration ? { exploration: { ...editor.exploration, messages: editor.exploration.messages.map(decodeMessage) } } : {}),
      })) } : {}),
    },
  }
}
