import type { ModelConfig, ModelConnectionTestEnvironment, ModelConnectionTestRecord } from '@/stores/config'
import type { Chapter, Novel } from '@/types/novel'
import { resumeTarget, shelfBookPath } from '@/v3/selectors/shelf'

export const ONBOARDING_STORAGE_KEY = 'mojian-v3-onboarding'
export const LEGACY_GUIDE_SEEN_KEY = 'mojian-v3-guide-seen'
export const FIRST_USE_AT_KEY = 'mobish.firstUseAt'
export const LAST_BACKUP_KEY = 'mojian-last-backup'

const audiences = ['new', 'existing', 'unknown'] as const
const paths = ['undecided', 'manual', 'ai'] as const
const checklistModes = ['expanded', 'collapsed', 'dismissed'] as const
const milestones = ['first_book_created', 'first_chapter_saved', 'first_review_completed', 'first_backup_exported'] as const

export type OnboardingAudience = typeof audiences[number]
export type OnboardingPath = typeof paths[number]
export type OnboardingChecklistMode = typeof checklistModes[number]
export type OnboardingMilestone = typeof milestones[number]
export interface OnboardingStateV1 {
  schema: 1
  audience: OnboardingAudience
  enabled: boolean
  checklist: OnboardingChecklistMode
  path: OnboardingPath
  seen: string[]
  skipped: string[]
  achieved: OnboardingMilestone[]
}

export type GuideSceneId =
  | 'shelf' | 'settings_models' | 'settings_assign' | 'create_picker' | 'create_flow' | 'write_first'
  | 'write_deep' | 'plan' | 'codex' | 'knowledge' | 'breakdown'
export interface GuideStepDef {
  id: string
  scene: GuideSceneId
  anchor: string
  fallbackAnchor?: string
  title: string
  body: string
  routePrefix: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
}

export interface GuideBeaconDef {
  id: string
  scene: GuideSceneId
  anchor: string
  label: string
  title: string
  body: string
}

function guideSteps(scene: GuideSceneId, routePrefix: string, steps: Array<Omit<GuideStepDef, 'scene' | 'routePrefix' | 'anchor'>>): GuideStepDef[] {
  return steps.map(step => ({ ...step, scene, routePrefix, anchor: step.id }))
}

export const GUIDE_SCENES: Record<GuideSceneId, GuideStepDef[]> = {
  shelf: guideSteps('shelf', '/', [
    { id: 'shelf.start', title: '从书架启程', body: '可以先自己写，直接新建作品，也可以先配置 AI，再让它参与创作。' },
    { id: 'shelf.backup', title: '导出项目备份', body: '在书架点「备份项目」，导出一份 JSON 文件，换电脑时可以从这份文件恢复项目。' },
  ]),
  settings_models: guideSteps('settings_models', '/settings', [
    { id: 'settings.add', title: '添加写作或对话模型', body: '在模型配置中填写服务地址、API 密钥和模型名称，然后保存。' },
    { id: 'settings.test', title: '测试模型连接', body: '先测试对话连接。需要联网搜索时，再测试联网连接。' },
  ]),
  settings_assign: guideSteps('settings_assign', '/settings', [
    { id: 'settings.assign', title: '查看任务分配', body: '核对大纲、正文、审校和对话分别使用哪个模型，按需调整。' },
  ]),
  create_picker: guideSteps('create_picker', '/create', [
    { id: 'create.mode', title: '选择创作方式', body: '选「主笔」自己写正文，或选「协作」和 AI 一起构思、起草。' },
    { id: 'create.origin', title: '选择作品起点', body: '可以从灵感、已有大纲、空白作品或自选起点开始。' },
    { id: 'create.save', title: '保存作品与起点', body: '确认当前选择，保存作品和你的起点。' },
  ]),
  create_flow: guideSteps('create_flow', '/generate/', [
    { id: 'create.contract', fallbackAnchor: 'create.contract.toggle', title: '核对作品契约', body: '打开作品契约，核对九张卡片，确认哪些设定要用于后续创作。' },
    { id: 'create.direction', title: '确认故事方向', body: '核对故事骨架的方向和大纲，确认后再排分卷与章纲。' },
    { id: 'create.firstChapter', title: '开始写第一章', body: '核对分卷和章纲，然后进入写作台写第一章。' },
  ]),
  write_first: guideSteps('write_first', '/write/', [
    { id: 'write.mode', title: '了解三种写作模式', body: '主笔由你写正文，协作可请 AI 起草，自动模式可按章推进并在检查点等待你确认。' },
    { id: 'write.type', title: '调整排版和手机预览', body: '在「正文排版」调整稿纸样式，也可以切换到 390px 手机阅读宽度预览。' },
    { id: 'write.save', title: '保存第一段正文', body: '写下首段正文，点击保存。' },
  ]),
  write_deep: guideSteps('write_deep', '/write/', [
    { id: 'write.selection', title: '选区局部改写', body: '选中正文后点「改写」等工具，先在候选里预览，点「采纳」才会替换原段。' },
    { id: 'write.review', title: '发起全章审校', body: '写完一段或整章后点「全章审校」，检查设定、时间线与人物认知是否一致。' },
    { id: 'write.margin', fallbackAnchor: 'write.margin.desk', title: '查看页边朱批', body: '点页边朱批核对原句与修改建议，也可以在案头「审校」逐条处理。' },
    { id: 'write.candidate', fallbackAnchor: 'write.candidate.desk', title: '处理修订候选', body: 'AI 生成的改写先放在候选里，可对比后选择采纳、换一版或暂存。' },
    { id: 'write.finalize', title: '定稿核对与入典', body: '点「核对」先检查篇幅、审校和待确认变化；「采纳入正文」改稿，「采纳入典」确认故事事实。' },
  ]),
  plan: guideSteps('plan', '/plan/', [
    { id: 'plan.chapters', title: '编辑分卷与章纲', body: '从「规划工作台」进入，可以调整章纲、目标与故事推进节奏。' },
    { id: 'plan.arcs', title: '查看故事弧线', body: '情节线上虚线表示计划，实心节点表示已有正文来源的实际发生事件。' },
  ]),
  codex: guideSteps('codex', '/codex/', [
    { id: 'codex.chapter', title: '按章节回看认知', body: '切换章节后，典籍只展示写到该章时已确认的人物知情状态与事实。' },
    { id: 'codex.source', title: '点格子核对来源', body: '点击人物与命题的交叉格，可以查看认知变化记录和正文出处。' },
  ]),
  knowledge: guideSteps('knowledge', '/knowledge', [
    { id: 'kb.create', title: '新建参考资料库', body: '先建一个全局资料库，后续可以反复挂载给多部作品共用。' },
    { id: 'kb.import', title: '导入原文资料', body: '支持导入 TXT、Markdown、DOCX、EPUB、HTML 与 PDF，写作和对话时按小节检索原文。' },
    { id: 'kb.bind', title: '绑定到当前作品', body: '勾选「绑定小说」后，本书的写作台、审校和书内对话就会参考这份资料库。' },
  ]),
  breakdown: guideSteps('breakdown', '/breakdown', [
    { id: 'breakdown.source', title: '选择拆书原文', body: '可以导入本地文件，或直接选用已有知识库资料和自己的章节来分析写法。' },
    { id: 'breakdown.budget', title: '先看预算与范围', body: '建议先从选段或开篇三章起步，提前确认预计调用次数与上限。' },
    { id: 'breakdown.quote', title: '一键核对原文出处', body: '点击成果卡里的短引，可以直接高亮定位到参考书中的对应原句。' },
  ]),
}

function beacon(step: GuideStepDef, label: string): GuideBeaconDef {
  const { id, scene, anchor, title, body } = step
  return { id, scene, anchor, label, title, body }
}

export const GUIDE_BEACONS = {
  'write.mode': beacon(GUIDE_SCENES.write_first[0], '模式说明'),
  'write.type': beacon(GUIDE_SCENES.write_first[1], '排版与手机预览'),
  'shelf.backup': beacon(GUIDE_SCENES.shelf[1], '记得备份'),
  'write.selection': beacon(GUIDE_SCENES.write_deep[0], '可改写'),
  'write.margin': beacon(GUIDE_SCENES.write_deep[2], '看朱批'),
  'write.candidate': beacon(GUIDE_SCENES.write_deep[3], '看候选'),
  'write.finalize': beacon(GUIDE_SCENES.write_deep[4], '定稿核对'),
  'plan.chapters': beacon(GUIDE_SCENES.plan[0], '改章纲'),
  'plan.arcs': beacon(GUIDE_SCENES.plan[1], '看弧线'),
  'codex.chapter': beacon(GUIDE_SCENES.codex[0], '按章回看'),
  'codex.source': beacon(GUIDE_SCENES.codex[1], '查来源'),
  'kb.create': beacon(GUIDE_SCENES.knowledge[0], '新建资料库'),
  'kb.import': beacon(GUIDE_SCENES.knowledge[1], '导入原文'),
  'kb.bind': beacon(GUIDE_SCENES.knowledge[2], '绑定本书'),
  'breakdown.source': beacon(GUIDE_SCENES.breakdown[0], '选原文'),
  'breakdown.budget': beacon(GUIDE_SCENES.breakdown[1], '设预算'),
  'breakdown.quote': beacon(GUIDE_SCENES.breakdown[2], '核对原句'),
}

export type GuideBeaconId = keyof typeof GUIDE_BEACONS

export function selectVisibleBeacons(candidateIds: readonly GuideBeaconId[], shouldShow: (id: GuideBeaconId) => boolean, limit = 2): GuideBeaconId[] {
  const cappedLimit = Math.max(0, Math.min(limit, 2))
  return candidateIds.filter(shouldShow).slice(0, cappedLimit)
}

export function defaultOnboardingState(audience: OnboardingAudience = 'unknown'): OnboardingStateV1 {
  return { schema: 1, audience, enabled: audience === 'new', checklist: audience === 'new' ? 'expanded' : 'dismissed',
    path: 'undecided', seen: [], skipped: [], achieved: [] }
}

function isEnum<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.some(candidate => candidate === value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function parseOnboardingState(raw: string | null): OnboardingStateV1 | null {
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const { schema, audience, enabled, checklist, path, seen, skipped, achieved } = value as Record<string, unknown>
    if (schema !== 1 || !isEnum(audience, audiences) || typeof enabled !== 'boolean'
      || !isEnum(checklist, checklistModes) || !isEnum(path, paths)
      || !isStringArray(seen) || !isStringArray(skipped)
      || !Array.isArray(achieved) || !achieved.every(item => isEnum(item, milestones))) return null
    return { schema, audience, enabled, checklist, path, seen, skipped, achieved }
  } catch {
    return null
  }
}

export interface OnboardingAudienceEvidence {
  hasLegacyGuideSeen?: boolean
  hasPreExistingFirstUseAt?: boolean
  hasBackupTimestamp?: boolean
  hadPreExistingSnapshot?: boolean | null
  novelCount?: number
  modelCount?: number
  knowledgeBaseCount?: number
  inspirationSessionCount?: number
  breakdownJobCount?: number
  configLoadFailed?: boolean
  storageUnavailable?: boolean
  breakdownCheckFailed?: boolean
}

export function classifyOnboardingAudience(evidence: OnboardingAudienceEvidence): OnboardingAudience {
  if (evidence.hasLegacyGuideSeen || evidence.hasPreExistingFirstUseAt || evidence.hasBackupTimestamp
    || evidence.hadPreExistingSnapshot === true
    || [evidence.novelCount, evidence.modelCount, evidence.knowledgeBaseCount, evidence.inspirationSessionCount,
      evidence.breakdownJobCount].some(count => (count ?? 0) > 0)) return 'existing'
  if (evidence.configLoadFailed || evidence.storageUnavailable || evidence.breakdownCheckFailed) return 'unknown'
  return 'new'
}

type GuideEnvironment = ModelConnectionTestEnvironment | 'desktop'
type GuideModel = Pick<ModelConfig, 'kind'> & {
  connectionTest?: Pick<ModelConnectionTestRecord, 'status' | 'fingerprint'> & { environment: GuideEnvironment }
}

export function isModelReadyForOnboarding(model: GuideModel, currentEnvironment: GuideEnvironment, currentFingerprint: string): boolean {
  return model.kind !== 'embedding' && model.connectionTest?.status === 'ok'
    && model.connectionTest.environment === currentEnvironment && model.connectionTest.fingerprint === currentFingerprint
}

interface ChecklistItem {
  id: OnboardingMilestone | 'model_ready'
  label: string
  done: boolean
}

interface ChecklistInput {
  state: OnboardingStateV1
  novels: readonly Novel[]
  models: readonly Pick<ModelConfig, 'id' | 'kind'>[]
  readyModelIds: Set<string>
  hasBackupTimestamp: boolean
  activeBookPath?: (novel: Novel) => string
  /** Store callers can distinguish an in-flight edit from the supplied durable project data. */
  isChapterPersisted?: (novel: Novel, chapter: Chapter) => boolean
}

export function deriveOnboardingChecklist({ state, novels, models, readyModelIds, hasBackupTimestamp,
  activeBookPath = shelfBookPath, isChapterPersisted = () => true }: ChecklistInput) {
  const { path, achieved } = state
  const relevantNovels = novels.filter(novel => novel.status !== 'trash')
  const activeNovel = resumeTarget(relevantNovels.filter(novel => novel.status !== 'archived'))?.novel
  const chatModels = models.filter(model => model.kind !== 'embedding')
  const firstBook = achieved.includes('first_book_created') || relevantNovels.length > 0
  const chapterAchievement = achieved.includes('first_chapter_saved')
  const firstChapter = relevantNovels.some(novel => novel.chapters.some(chapter =>
    chapter.content.trim().length > 0 && (chapterAchievement || isChapterPersisted(novel, chapter))))
  const coreItems: ChecklistItem[] = [
    { id: 'first_book_created', label: '创建第一部作品', done: firstBook },
    { id: 'first_chapter_saved', label: '保存第一章正文', done: firstChapter },
  ]
  if (path !== 'manual') coreItems.unshift({ id: 'model_ready', label: '测试模型连接', done: chatModels.some(model => readyModelIds.has(model.id)) })
  const optionalItems: ChecklistItem[] = [
    { id: 'first_review_completed', label: '体验一次 AI 审校', done: achieved.includes('first_review_completed') },
  ]
  if (firstChapter) optionalItems.push({ id: 'first_backup_exported', label: '导出一份项目备份',
    done: hasBackupTimestamp || achieved.includes('first_backup_exported') })
  const completedCore = coreItems.filter(item => item.done).length
  const totalCore = coreItems.length
  return { path, coreItems, optionalItems, completedCore, totalCore, allCoreDone: completedCore === totalCore,
    hasOnlyEmbeddingModels: models.length > 0 && chatModels.length === 0,
    activeNovelId: activeNovel?.id ?? null, activeNovelTitle: activeNovel?.title ?? null,
    activeNovelPath: activeNovel ? activeBookPath(activeNovel) : null }
}
