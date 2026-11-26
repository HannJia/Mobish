import type { ModelConfig } from '@/stores/config'
import type { ContractExploration, StoryContract } from '@/types/reconstruction'
import { retrieveInspirationKnowledge } from './inspiration'
import { contractExplorationMessages } from './storyContract'

export async function prepareContractExploration(
  model: ModelConfig, contract: StoryContract, exploration: ContractExploration,
  knowledgeIds: string[], signal: AbortSignal,
) {
  const messages = contractExplorationMessages(contract, exploration)
  signal.throwIfAborted()
  const latest = exploration.messages.filter(item => item.role === 'user').slice(-1)[0]
  if (!knowledgeIds.length || !latest?.content.trim()) return messages
  const { prompt } = await retrieveInspirationKnowledge(model, latest.content, signal, knowledgeIds)
  return prompt ? contractExplorationMessages(contract, exploration, prompt) : messages
}
