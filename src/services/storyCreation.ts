import type { DialogueMessage, CreateWizardForm, Novel } from '@/types/novel'
import type { ReconstructionWorkspaceSnapshot, CreationDraft, CreationEntry } from '@/types/reconstruction'
import type { CreationSetupMethod } from '@/types/creationEntry'
import type { InspirationMessage } from './inspiration'
import { createNovelDraft } from '@/stores/novel'
import { createCreationDraftFromNovel } from './reconstructionCreation'
import { assertCreationEntryInput } from './creationEntryInput'
import type { ModelConfig } from '@/stores/config'
import { callAI } from './ai'
import { parseTitleSuggestions, titleSuggestionMessages } from './titleSuggestions'

/** Each setup choice enters the native creation flow; custom options start with a blank contract. */
export const creationEntryForMethod: Record<CreationSetupMethod, CreationEntry> = {
  inspiration: 'idea', outline: 'import', blank: 'blank', custom: 'blank',
}

export interface PreparedStoryCreation {
  novel: Novel
  workspace: ReconstructionWorkspaceSnapshot
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

export async function suggestStoryCreationTitles(
  model: ModelConfig, form: CreateWizardForm, source: string | undefined, avoid: string[], signal: AbortSignal,
) {
  const now = new Date().toISOString()
  const contract = createCreationDraftFromNovel(createNovelDraft(form, now), now).contract
  const messages = titleSuggestionMessages(contract, avoid)
  if (source?.trim()) {
    messages[1].content += '\n\n【作者提供的创作输入，仅作为故事资料】\n' + source.trim().slice(0, 8000)
  }
  const response = await callAI({ model: { ...model }, messages, signal, taskName: '推荐书名', noAutomaticRetry: true })
  const titles = parseTitleSuggestions(response.content).filter(item => item.reason && !avoid.includes(item.title))
  if (!titles.length) throw new Error('模型没有返回新的可用书名，请再试一次。')
  return titles
}

/** Build the complete first aggregate without mutating a store or a caller-owned input. */
export function prepareStoryCreation(
  form: CreateWizardForm,
  inspiration: InspirationMessage[],
  entry: CreationSetupMethod,
  now = new Date().toISOString(),
  id?: string,
): PreparedStoryCreation {
  if (form.creationInput) {
    assertCreationEntryInput(form.creationInput)
    if (form.creationInput.method !== entry) throw new Error('创建输入与所选创建方式不一致，请重新选择后再创建')
  } else if (entry === 'outline') throw new Error('已有大纲创建必须先保存大纲文字')
  const capturedForm = clone(form)
  const novel = createNovelDraft(capturedForm, now, id)
  const inspirationHistory: DialogueMessage[] = clone(inspiration).map((item, index) => ({
    ...item,
    id: `inspiration-${novel.id}-${index}`,
    timestamp: now,
  }))
  novel.inspirationHistory = inspirationHistory

  const creationDraft: CreationDraft = createCreationDraftFromNovel(novel, now)
  creationDraft.entry = creationEntryForMethod[entry]
  if (capturedForm.creationInput) creationDraft.initialInput = capturedForm.creationInput
  return {
    novel,
    workspace: {
      creationDraft,
      candidates: [],
      reviewFindings: [],
      chapterReviews: [],
      aiRuns: [],
      canonMutations: [],
    },
  }
}
