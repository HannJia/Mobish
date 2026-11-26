// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount, RouterLinkStub } from '@vue/test-utils'
import CharacterDeskPanel from './CharacterDeskPanel.vue'
import { characterStateFixture, knowledgeCandidate, stateTestTime as now } from '@/test/characterStateFixture'
import { acceptCandidateChange } from '@/services/reconstructionReview'
import { applyCandidateChangeToCanon } from '@/services/reconstructionCanon'
import type { DataPanelItem } from '@/types/novel'

beforeEach(() => setActivePinia(createPinia()))

describe('CharacterDeskPanel', () => {
  it('renders bound metrics, equipment, relations, knowledge with quote toggle, and future filter', async () => {
    const { novel } = characterStateFixture()
    const [lead, partner] = novel.characters
    Object.assign(lead, {
      identity: '修船铺掌柜', faction: '老街修船铺', powerLevel: '手艺精通',
      relationships: [{ targetId: partner.id, targetName: partner.name, relation: '师徒般的老搭档', dimension: 'trust' }],
    })
    novel.characters.push({
      id: 'c-future', name: '许清', aliases: [], identity: '港务局技术员', personality: '',
      powerLevel: '', faction: '', status: '活跃', firstAppearChapter: 5, description: '',
      relationships: [], events: [], avatarColor: '',
    })
    const panel: DataPanelItem = {
      id: 'p-lin', category: '角色', name: '林澈资产', characterId: lead.id,
      fields: [{ id: 'f-cash', name: '现金', value: '3200', unit: '元', note: '' }],
      relatedKeywords: [], createdAt: now, updatedAt: now,
    }
    const equip: DataPanelItem = {
      id: 'p-lamp', category: '道具', name: '旧防风灯', ownerItemId: 'p-lin', equipmentState: 'equipped',
      fields: [{ id: 'f-cond', name: '状态', value: '待修', unit: '', note: '' }],
      relatedKeywords: [], createdAt: now, updatedAt: now,
    }
    novel.dataPanels = [panel, equip]

    const { record } = applyCandidateChangeToCanon(novel, acceptCandidateChange(knowledgeCandidate(novel, 0), now), now)

    const wrapper = mount(CharacterDeskPanel, {
      props: {
        novel, chapter: novel.chapters[1], draftContent: '林澈推开铺门，看见苏禾在码头。',
        planText: '', canonMutations: record ? [record] : [],
      },
      global: { stubs: { RouterLink: RouterLinkStub, CharacterAvatar: true, V3Icon: true } },
    })

    const expectedReturnTo = `/write/${novel.id}/${novel.chapters[1].id}?tab=character`
    const links = wrapper.findAllComponents(RouterLinkStub)
    expect(links.length).toBeGreaterThanOrEqual(4)
    for (const link of links) {
      expect(link.props('to')).toMatchObject({ query: { returnTo: expectedReturnTo } })
    }

    expect(wrapper.text()).toContain('林澈')
    expect(wrapper.text()).toContain('正文提及')
    expect(wrapper.text()).toContain('林澈资产')
    expect(wrapper.text()).toContain('3200')
    expect(wrapper.text()).toContain('旧防风灯')
    expect(wrapper.text()).toContain('已装备')
    expect(wrapper.text()).toContain('苏禾')
    expect(wrapper.text()).toContain('误信：城主已经死了')
    expect(wrapper.text()).not.toContain('许清')
    expect(wrapper.text()).toContain('含后续人物 (+1)')

    await wrapper.get('.char-src-toggle').trigger('click')
    expect(wrapper.text()).toContain('林澈以为城主已经死了。')

    await wrapper.get('.char-future-chip').trigger('click')
    expect(wrapper.text()).toContain('许清')

    await wrapper.get('[aria-label="搜索角色"]').setValue('许清')
    expect(wrapper.findAll('.char-card')).toHaveLength(1)
    expect(wrapper.text()).toContain('许清')
  })
})
