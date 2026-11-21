import type { WritingSkill } from '@/types/skill'

const CREATED_AT = '2026-01-01T00:00:00.000Z'

const builtInWritingSkills: WritingSkill[] = [
  {
    id: 'builtin-scene-causality',
    name: '场景因果链',
    description: '让每个场景有目标、阻力和结果，结束时局势有所变化。',
    task: 'writing',
    instructions: '写场景前先想清楚：视角人物此刻想要什么，什么在阻碍他，他为此做了什么，这一场结束后局势或人物关系有何不同。阻力来自人物、环境或代价；关键转折由人物的选择和行动推动，不用巧合或突然出现的外力解决主要矛盾。过渡场景可以短，但也要带出新的信息或压力。不要在正文里点明“目标”“阻力”这类结构，也不要在场景结尾总结意义。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-dialogue-subtext',
    name: '对话潜台词',
    description: '减少说明式对白，让人物通过立场、试探和回避传递信息。',
    task: 'writing',
    instructions: '对白符合人物身份、关系和当下处境，每个人说话都有自己的目的。不要让角色向对方复述双方都知道的信息，也不要让角色直接说出完整的心理分析；重要情绪通过措辞、停顿、动作、转移话题和没说出口的话体现。读者必须知道的信息仍要交代清楚，不为含蓄而含糊。少用“他愤怒地说”这类副词去解释对白。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-pacing',
    name: '节奏控制',
    description: '控制信息释放、冲突升级和章节收束。',
    task: 'planning',
    instructions: '规划时交替安排推进、反应和转折，不连续堆叠同一种冲突。每个关键节点都要改变人物的选择、处境或关系，冲突的代价逐步升高。信息分批释放，伏笔先埋后收，远期节点不提前用掉。章节结尾留下新的问题、选择或悬念，不在一章内把矛盾全部解决。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-continuity-review',
    name: '连续性审校',
    description: '审查时间、地点、角色状态和资源变化。',
    task: 'review',
    instructions: '重点核对时间顺序、人物所在位置、伤势和能力边界、物品与资源数量、称谓和关系，以及已经发生的事件。每指出一处冲突，都同时给出正文原句和与之矛盾的设定或前文。只报告有证据的冲突，文风和情节好坏不算连续性问题；没有发现冲突时不要为了凑数而报告。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  {
    id: 'builtin-evidence-analysis',
    name: '证据优先分析',
    description: '结构化提取时只记录正文明确支持的事实。',
    task: 'analysis',
    instructions: '只提取输入文本中明确出现的事实。推测、可能性和写作建议不能写成已发生的事件或角色状态；人物的谎言、猜测和传闻也不能当作已确认的事实。缺少证据时返回空结果，不用常识或类型套路补全。',
    enabled: true,
    builtIn: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
]

/** 内置技能的旧版默认文字。用户没有改过的旧文字在载入时换成当前版本；改过的保持不变。 */
const PREVIOUS_DEFAULTS: Record<string, Array<{ description: string; instructions: string }>> = {
  'builtin-scene-causality': [{
    description: '确保每个场景由目标、阻力、行动和结果组成。',
    instructions: '组织场景时明确角色当下目标，让阻力迫使角色采取行动，并让行动产生可追踪的结果。禁止用偶然事件替代关键因果。',
  }],
  'builtin-dialogue-subtext': [{
    description: '减少说明式对白，让人物通过立场和回避传递信息。',
    instructions: '对白必须符合人物身份和关系。避免角色直接复述双方都知道的信息；重要情绪优先通过措辞、停顿、动作和回避表达。',
  }],
  'builtin-pacing': [{
    description: '控制信息释放、冲突升级和章节收束。',
    instructions: '规划时交替安排推进、反应和转折，不连续堆叠同质冲突。每个关键节点必须改变人物选择或局势，远期节点不得被提前消费。',
  }],
  'builtin-continuity-review': [{
    description: '审查时间、地点、角色状态和资源变化。',
    instructions: '优先核对时间顺序、人物位置、能力边界、资源数量、称谓和已发生事件。指出冲突时必须给出正文证据与既有设定证据。',
  }],
  'builtin-evidence-analysis': [{
    description: '结构化提取时只记录正文明确支持的事实。',
    instructions: '只提取输入文本明确出现的事实；推测、可能性和写作建议不得写成已发生事件或角色状态。缺少证据时返回空结果。',
  }],
}

export function createBuiltInSkills(): WritingSkill[] {
  return builtInWritingSkills.map(skill => ({ ...skill }))
}

/** 已保存的内置技能：说明和规则仍是旧版默认文字时，返回当前版本的文字；用户改过的字段原样保留。 */
export function upgradeSavedBuiltInSkill(saved: WritingSkill): WritingSkill {
  const current = builtInWritingSkills.find(skill => skill.id === saved.id)
  const previous = PREVIOUS_DEFAULTS[saved.id]
  if (!current || !previous) return saved
  const upgraded = { ...saved }
  if (previous.some(item => item.instructions === saved.instructions)) upgraded.instructions = current.instructions
  if (previous.some(item => item.description === saved.description)) upgraded.description = current.description
  return upgraded
}
