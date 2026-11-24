import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { callAI } from '@/services/ai'
import {
  accumulateBreakdownUsage, BREAKDOWN_OUTPUT_TOKENS, breakdownPartMessages, breakdownReportInput, breakdownRequestEstimate,
  breakdownUsage, EMPTY_BREAKDOWN_USAGE, parseBreakdownCards, parseBreakdownPart, relocateBreakdownCards,
  type BreakdownCard, type BreakdownJob, type BreakdownScope,
} from '@/services/bookBreakdownAnalysis'
import { loadBreakdownJobs, loadBreakdownSource, saveBreakdownJob } from '@/services/bookBreakdownDb'
import { breakdownParts, knowledgeBreakdownSource, manuscriptBreakdownSource, openingSections,
  type BreakdownBlock, type BreakdownSource } from '@/services/bookBreakdownSource'
import { entrySourceVersion } from '@/services/knowledgeSources'
import { canUseKnowledgeEntry } from '@/services/knowledgeVisibility'
import { useConfigStore, type ModelConfig } from './config'
import { useKnowledgeStore } from './knowledge'
import { useNovelStore } from './novel'

const modelSignature = (model: ModelConfig) => JSON.stringify([model.baseUrl, model.modelName, model.temperature, model.topP, model.contextWindow, model.apiProtocol])
const partLimit = (model: ModelConfig) => Math.max(1200, Math.min(3800, (model.contextWindow || 8192) - 2400))
const options = (model: ModelConfig) => ({ id: model.id, label: model.name, signature: modelSignature(model) })
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

export const useBookBreakdownStore = defineStore('bookBreakdown', () => {
  const jobs = shallowRef<BreakdownJob[]>([])
  const runningId = ref('')
  const busy = ref(false)
  const runnerError = ref('')
  const config = useConfigStore()
  const knowledge = useKnowledgeStore()
  const novels = useNovelStore()
  let initial: Promise<void> | undefined
  let controller: AbortController | undefined

  const model = computed(() => config.getModelForTask('outline'))
  function initialize() {
    initial ||= loadBreakdownJobs().then(items => {
      jobs.value = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }).catch(error => { initial = undefined; throw error })
    return initial
  }

  async function save(job: BreakdownJob, source?: BreakdownSource) {
    const next = await saveBreakdownJob(job, source)
    jobs.value = [next, ...jobs.value.filter(item => item.id !== job.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return next
  }

  function authorize(job: BreakdownJob) {
    const origin = job.source.origin
    if (origin.kind !== 'knowledge') return
    const entry = knowledge.knowledgeBases.find(base => base.id === origin.baseId)?.entries.find(item => item.id === origin.entryId)
    if (!entry || !canUseKnowledgeEntry(entry)) throw new Error('此知识条目已删除或当前保密设置禁止用于独立拆书。')
    return entry
  }

  function currentSource(job: BreakdownJob) {
    const origin = job.source.origin
    if (origin.kind === 'knowledge') return knowledgeBreakdownSource(origin.baseId, authorize(job)!)
    if (origin.kind === 'manuscript') {
      const novel = novels.getNovel(origin.novelId)
      if (!novel || novel.status === 'trash') throw new Error('找不到拆书所用的作品。')
      return manuscriptBreakdownSource(novel)
    }
  }

  function assertSourceVersion(job: BreakdownJob) {
    const origin = job.source.origin
    if (origin.kind === 'knowledge' && entrySourceVersion(origin.baseId, authorize(job)!) !== job.source.version) {
      throw new Error('知识库原文已变化，请更新拆书来源。')
    }
  }

  async function create(source: BreakdownSource, scope: BreakdownScope, selected: string[], singleBlock: BreakdownBlock | null,
    topic: string, calls: number, tokens: number) {
    await initialize()
    const selectedModel = model.value
    if (!selectedModel) throw new Error('请先在设置中配置分析或默认对话模型。')
    const limit = partLimit(selectedModel)
    const units = breakdownParts(source, selected, singleBlock, limit).map(part => ({ part }))
    const job: BreakdownJob = {
      id: crypto.randomUUID(), revision: 0, createdAt: new Date().toISOString(),
      source: { title: source.title, version: source.version, origin: source.origin }, title: source.title,
      scope, selected: [...new Set(units.map(unit => unit.part.sectionKey))], singleBlock, topic, model: options(selectedModel), partLimit: limit,
      calls, tokens, attempts: 0, usage: { ...EMPTY_BREAKDOWN_USAGE }, status: 'ready', units, archive: [], handoffs: [],
    }
    if (!units.length) throw new Error('请选择包含正文的范围。')
    assertSourceVersion(job)
    // Retain the same run only when the complete source and analysis settings match.
    const existing = jobs.value.find(item => JSON.stringify([item.source, item.selected, item.singleBlock, item.scope, item.topic, item.model.signature, item.model.id])
      === JSON.stringify([job.source, job.selected, job.singleBlock, job.scope, job.topic, job.model.signature, job.model.id]))
    return existing || save(job, source)
  }

  async function refreshSource(job: BreakdownJob, replacement?: BreakdownSource) {
    if (runningId.value === job.id) throw new Error('请暂停后更新原文。')
    const source = replacement || currentSource(job)
    if (!source || source.version === job.source.version) throw new Error('原文版本没有变化。')
    if (job.singleBlock) throw new Error('原文段落的位置已变化，请从新版本重新选择该段。')
    let selected = job.selected
    if (job.scope === 'volume') {
      const previous = await loadBreakdownSource(job.id, job.source.version)
      const volume = previous?.sections.find(section => section.key === job.selected[0])?.volume
      selected = source.sections.filter(section => section.volume === volume).map(section => section.key)
    }
    if (job.scope === 'book') selected = source.sections.map(section => section.key)
    if (job.scope === 'opening') selected = openingSections(source)
    const parts = breakdownParts(source, selected, null, job.partLimit)
    if (!parts.length) throw new Error('新版原文中找不到原先选定的范围。')
    selected = [...new Set(parts.map(part => part.sectionKey))]
    const oldUnits = new Map(job.units.map(unit => [unit.part.key, unit]))
    const kept = new Set<string>()
    const units = parts.map(part => {
      const old = oldUnits.get(part.key)
      if (!old || old.part.fingerprint !== part.fingerprint || !old.cards) return { part }
      kept.add(part.key)
      return { ...old, part, cards: relocateBreakdownCards(old.cards, old.part, part) }
    })
    const linked = (card: BreakdownCard) => job.handoffs.some(handoff => handoff.sourceVersion === job.source.version
      && handoff.links.some(link => link.cardId === card.id))
    const replacedCards = job.units.flatMap(unit => (unit.cards || []).filter(card => linked(card) || (!kept.has(unit.part.key) && card.edited)))
      .concat((job.report?.cards || []).filter(card => card.edited || linked(card)))
    return save({ ...job, selected, units, status: 'ready', error: undefined, report: undefined,
      archive: [...job.archive, ...replacedCards.map(card => ({ card, version: job.source.version }))],
      source: { ...job.source, version: source.version, title: source.title }, title: source.title }, source)
  }

  async function editCard(job: BreakdownJob, card: BreakdownCard) {
    if (runningId.value === job.id || busy.value) throw new Error('请暂停后编辑。')
    authorize(job)
    const replace = (cards?: BreakdownCard[]) => cards?.map(old => old.id === card.id ? { ...card, edited: true } : old)
    return save({ ...job, units: job.units.map(unit => ({ ...unit, cards: replace(unit.cards) })),
      report: job.report && { ...job.report, cards: replace(job.report.cards)! },
      archive: job.archive })
  }

  async function resume(initialJob: BreakdownJob, calls: number, tokens: number, summarize = false) {
    if (runningId.value || busy.value) throw new Error('已有拆书任务正在处理。')
    let job = initialJob
    const selectedModel = config.models.find(item => item.id === job.model.id)
    if (!selectedModel || modelSignature(selectedModel) !== job.model.signature) throw new Error('原分析模型的配置已变化，请恢复配置或新建拆书。')
    runningId.value = job.id
    runnerError.value = ''
    controller = new AbortController()
    const { signal } = controller
    try {
      assertSourceVersion(job)
      if (job.source.origin.kind === 'manuscript' && currentSource(job)?.version !== job.source.version) throw new Error('作品原文已变化，请更新拆书来源。')
      const source = await loadBreakdownSource(job.id, job.source.version)
      if (!source) throw new Error('当前版本的原文尚不可用。')
      job = await save({ ...job, calls, tokens, status: 'running', error: undefined })
      const selectedModelSnapshot = { ...selectedModel }
      const runRequest = async (messages: ReturnType<typeof breakdownPartMessages>,
        record: (job: BreakdownJob, result: Awaited<ReturnType<typeof callAI>>, usage: BreakdownJob['usage']) => BreakdownJob) => {
        const estimate = breakdownRequestEstimate(messages)
        if (estimate.charged > (selectedModelSnapshot.contextWindow || 8192)) throw new Error('本单元超过模型上下文容量。')
        if (job.attempts >= job.calls || estimate.charged + job.usage.charged > job.tokens) {
          job = await save({ ...job, status: 'budget' })
          return false
        }
        // A durable reservation covers an interrupted or unreported request.
        assertSourceVersion(job)
        signal.throwIfAborted()
        const previousUsage = job.usage
        job = await save({ ...job, attempts: job.attempts + 1, usage: accumulateBreakdownUsage(job.usage, estimate) })
        assertSourceVersion(job)
        signal.throwIfAborted()
        const result = await callAI({ model: selectedModelSnapshot, messages, signal, maxTokens: BREAKDOWN_OUTPUT_TOKENS,
          taskName: '拆书 · ' + job.title, noAutomaticRetry: true, disableThinking: true })
        const usage = breakdownUsage(result, estimate)
        const settled = { ...job, usage: accumulateBreakdownUsage(previousUsage, usage) }
        try {
          job = await save(record(settled, result, usage))
        } catch (error) {
          job = await save({ ...settled, status: 'failed', error: errorMessage(error) })
          return false
        }
        return true
      }
      for (let index = 0; index < job.units.length; index++) {
        signal.throwIfAborted()
        const unit = job.units[index]
        if (unit.cards) continue
        if (!await runRequest(breakdownPartMessages(source, unit.part, job.topic), (settled, result, usage) => {
          const cards = parseBreakdownPart(result, source, unit.part)
          const units = [...settled.units]
          units[index] = { ...unit, cards, usage }
          return { ...settled, units }
        })) return
      }
      if (summarize && !job.report) {
        signal.throwIfAborted()
        const input = breakdownReportInput(job, source, selectedModelSnapshot.contextWindow || 8192)
        if (input.coveredUnits < 1) throw new Error('当前没有可核验的原文依据可用于汇总。')
        if (!await runRequest(input.messages, (settled, result, usage) => ({
          ...settled, report: { cards: parseBreakdownCards(result.content, input.resolve), usage, coveredUnits: input.coveredUnits },
        }))) return
      }
      job = await save({ ...job, status: 'complete' })
    } catch (error) {
      const note = signal.aborted ? undefined : errorMessage(error)
      runnerError.value = note || ''
      try { await save({ ...job, status: signal.aborted ? 'paused' : 'failed', error: note }) }
      catch (saveError) { runnerError.value = errorMessage(saveError) }
    } finally {
      runningId.value = ''
      controller = undefined
    }
  }

  function pause() { controller?.abort() }

  function estimate(source: BreakdownSource, selected: string[], singleBlock: BreakdownBlock | null, topic: string) {
    const limit = model.value ? partLimit(model.value) : 3800
    const parts = breakdownParts(source, selected, singleBlock, limit)
    return { calls: parts.length, characters: parts.reduce((sum, part) => sum + part.blocks.reduce((total, block) => total + block.end - block.start, 0), 0),
      tokens: parts.reduce((sum, part) => sum + breakdownRequestEstimate(breakdownPartMessages(source, part, topic)).charged, 0) }
  }

  return { jobs, model, runningId, busy, runnerError, initialize, save, authorize, assertSourceVersion, currentSource, create, refreshSource,
    editCard, resume, pause, estimate }
})
