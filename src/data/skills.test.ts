import { describe, expect, it } from 'vitest'
import { createBuiltInSkills, upgradeSavedBuiltInSkill } from './skills'

const oldScene = {
  id: 'builtin-scene-causality', name: '场景因果链', task: 'writing' as const, builtIn: true,
  description: '确保每个场景由目标、阻力、行动和结果组成。',
  instructions: '组织场景时明确角色当下目标，让阻力迫使角色采取行动，并让行动产生可追踪的结果。禁止用偶然事件替代关键因果。',
  enabled: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
}

describe('built-in writing skills', () => {
  it('replaces unmodified old default text and keeps the user switch', () => {
    const current = createBuiltInSkills().find(skill => skill.id === oldScene.id)!
    const upgraded = upgradeSavedBuiltInSkill(oldScene)
    expect(upgraded).toMatchObject({ instructions: current.instructions, description: current.description, enabled: false, updatedAt: oldScene.updatedAt })
  })

  it('keeps text the user has edited', () => {
    const edited = { ...oldScene, instructions: '我自己的规则' }
    expect(upgradeSavedBuiltInSkill(edited).instructions).toBe('我自己的规则')
    const custom = { ...oldScene, id: 'custom-1', builtIn: false }
    expect(upgradeSavedBuiltInSkill(custom)).toBe(custom)
  })

  it('keeps each instruction short enough for the injected skill block', () => {
    for (const skill of createBuiltInSkills()) expect(skill.instructions.length).toBeLessThan(300)
  })
})
