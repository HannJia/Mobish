import type { ChapterPlan, Volume } from '@/types/novel'

function plain(text: string, keepBrackets = false): string {
  const unformatted = text.replace(/\*\*|__|`/g, '')
  return (keepBrackets ? unformatted : unformatted.replace(/[【】]/g, '')).trim()
}

export function parseVolumeEstimates(text: string): { estimatedChapters?: number; estimatedWordCount?: number } {
  const clean = plain(text)
  const chapter = clean.match(/(?:预估|预计|计划)?章(?:节数|数|节)[^\n：:]{0,8}[：:]\s*(?:约|共|大约)?\s*(\d+)\s*(?:章|个章节)?/)
    || clean.match(/(?:约|共|大约)?\s*(\d+)\s*(?:章|个章节)(?!节)/)
  const words = clean.match(/(?:预估|预计|计划)?字数[：:]\s*(?:约|共|大约)?\s*([\d.]+)\s*(万)?字/)
    || clean.match(/([\d.]+)\s*(万)字/)
  const chapters = chapter ? Number(chapter[1]) : 0
  const wordCount = words ? Number(words[1]) / (words[2] ? 1 : 10000) : 0
  return {
    estimatedChapters: chapters > 0 && Number.isFinite(chapters) ? chapters : undefined,
    estimatedWordCount: wordCount > 0 && Number.isFinite(wordCount) ? Math.round(wordCount * 1000) / 1000 : undefined,
  }
}

/** Both the onboarding outline and the planning workspace use this parser. */
const ordinalDigits = '一二三四五六七八九十百千零〇两0-9'
const ordinal = new RegExp(`^(?:第\\s*([${ordinalDigits}]+)\\s*卷|卷\\s*([${ordinalDigits}]+))(?=$|[\\s：:—–·、.《(（【\\[-])`)
const wrappedHeading = /^【\s*(.*?)\s*】$/
const volumeSection = /^分卷(?:大纲|规划|建议|设计)(?:[：:]\s*|$)/
const volumeFieldHeading = /^(?:核心主题|本卷主题|主题|(?:主要)?剧情(?:概要|概述)?|关键转折点?|核心转折|重要转折|(?:本卷)?角色变化|(?:预估|预计)(?:章节数和字数|章节数|章数|字数))\s*(?:[：:]|$)/

function volumeNumber(raw: string): number | undefined {
  if (/^\d+$/.test(raw)) {
    const value = Number(raw)
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  const digits = '零一二三四五六七八九'
  const multipliers: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  let sum = 0
  let digit = 0
  let previousUnit = 10000
  for (const char of raw.replace(/〇/g, '零').replace(/两/g, '二')) {
    const unit = multipliers[char]
    if (unit) {
      if (unit >= previousUnit) return undefined
      sum += (digit || 1) * unit
      digit = 0
      previousUnit = unit
    } else {
      if (!digits.includes(char) || digit) return undefined
      digit = digits.indexOf(char)
    }
  }
  return sum + digit || undefined
}

export function normalizeVolumeTitle(raw: string): { title: string; sourceVolumeNumber?: number } {
  let title = plain(raw, true).replace(wrappedHeading, '$1')
  let sourceVolumeNumber: number | undefined
  while (true) {
    const match = title.match(ordinal)
    if (!match) break
    sourceVolumeNumber = volumeNumber(match[1] || match[2]) ?? sourceVolumeNumber
    title = title.slice(match[0].length).replace(/^[\s：:—–·、.-]+/, '')
  }
  return { title: plain(title).replace(/^《(.*)》$/, '$1'), ...(sourceVolumeNumber === undefined ? {} : { sourceVolumeNumber }) }
}

export function volumeOrdinalMismatches(volumes: readonly Volume[]) {
  return volumes.flatMap(volume => {
    const sourceVolumeNumber = volume.sourceVolumeNumber ?? normalizeVolumeTitle(volume.title).sourceVolumeNumber
    const expectedVolumeNumber = volume.volumeIndex + 1
    return sourceVolumeNumber !== undefined && sourceVolumeNumber !== expectedVolumeNumber
      ? [{ volumeId: volume.id, sourceVolumeNumber, expectedVolumeNumber }] : []
  })
}

export function parseVolumesFromText(raw: string, allowedBeatIds?: readonly string[]): Volume[] {
  const lines = raw.replace(/```(?:markdown|md)?/gi, '').split(/\r?\n/)
  const blocks: Array<{ header: string; lines: string[]; level: number }> = []
  let current: typeof blocks[number] | undefined
  let outsideVolumeLevel = 0
  for (const line of lines) {
    const heading = plain(line, true).match(/^(?:(#{1,6})\s*)?(?:(?:[-+*]|\d+[.、)])\s+)?(?:>\s*)?(.*)$/)!
    const level = heading[1]?.length || 0
    // Entries and subheadings belong to the outline section that closed the last volume.
    if (outsideVolumeLevel && (!level || level > outsideVolumeLevel)) continue

    const headingText = heading[2].replace(wrappedHeading, '$1')
    // Some outlines put the first volume on the same line as the section title.
    const clean = headingText.replace(volumeSection, '').replace(wrappedHeading, '$1')
    const start = ordinal.test(clean) || /^卷名\s*[：:]/.test(clean)
    const previousLevel = current?.level || 0
    const endsMarkdownVolume = level > 0 && previousLevel > 0
      && (level < previousLevel || (level === previousLevel && !volumeFieldHeading.test(clean)))
    if (start) {
      // A list can continue volumes introduced by a Markdown heading.
      current = { header: clean.replace(/^卷名\s*[：:]\s*/, ''), lines: [], level: level || previousLevel }
      blocks.push(current)
      outsideVolumeLevel = 0
    } else if (endsMarkdownVolume || outsideVolumeLevel) {
      current = undefined
      outsideVolumeLevel = volumeSection.test(headingText) ? 0 : level
    } else if (current && level && !current.level && /全书|总字数|主要角色表|核心冲突/.test(clean)) {
      current = undefined
    } else {
      current?.lines.push(line)
    }
  }
  return blocks.map((block, index) => {
    const body = block.lines.join('\n').trim()
    const clean = plain(body)
    const { title, sourceVolumeNumber } = normalizeVolumeTitle(block.header)
    const estimates = parseVolumeEstimates(`${block.header}\n${body}`)
    const field = (labels: string) => {
      const lines = clean.split('\n')
      const pattern = new RegExp('^\\s*(?:#{1,6}\\s*|[-*+]\\s+)?(?:' + labels + ')(?:[：:]|$)\\s*(.*)$')
      const start = lines.findIndex(line => pattern.test(line))
      if (start < 0) return ''
      const values = [lines[start].match(pattern)![1]]
      for (const line of lines.slice(start + 1)) {
        if (!/^\s*[-*+]\s+/.test(line) || /^\s*[-*+]\s+[^：:]{1,12}[：:]/.test(line)
          && /主题|剧情|目标|冲突|收束|转折|角色变化|预估|预计|骨架节点|伏笔/.test(line.split(/[：:]/)[0])) break
        values.push(line)
      }
      return normalizeVolumeTurningPoints(values.join('\n'))
    }
    const theme = field('核心主题|主题')
    const summary = body.replace(/^\s*(?:\*\*|__)?(?:预估|预计)?(?:章节数|章数|字数|章节数和字数).*$/gm, '').trim()
    const beatText = field('承担的骨架节点|骨架节点')
    const skeletonBeatIds = [...new Set(beatText.split(/[\n、，,；;\s]+/).filter(beat => allowedBeatIds?.includes(beat)))]
    return {
      id: `vol-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      volumeIndex: index, title: title || '未命名分卷', theme, summary,
      ...(sourceVolumeNumber === undefined ? {} : { sourceVolumeNumber }),
      ...(skeletonBeatIds.length ? { skeletonBeatIds } : {}),
      keyTurningPoints: field('关键转折点?|核心转折|重要转折'),
      characterChanges: field('本卷角色变化|角色变化|人物变化|角色发展'),
      estimatedChapters: estimates.estimatedChapters || (estimates.estimatedWordCount ? Math.round(estimates.estimatedWordCount / 0.225) : 0),
      estimatedWordCount: estimates.estimatedWordCount || (estimates.estimatedChapters ? Math.round(estimates.estimatedChapters * 0.225 * 10) / 10 : 0),
    }
  })
}

export function normalizeVolumeTurningPoints(value: string): string {
  return value.split(/\r?\n/).map(line => line.trim().replace(/^[-*+]\s+/, '')).filter(Boolean).join('\n')
}

export function volumeChapterRanges(volumes: readonly Volume[]) {
  let offset = 0
  return [...volumes].sort((left, right) => left.volumeIndex - right.volumeIndex).map(volume => {
    const start = offset
    offset += Number.isSafeInteger(volume.estimatedChapters) ? Math.max(0, volume.estimatedChapters) : 0
    return { volumeId: volume.id, start, endExclusive: offset }
  })
}

export function volumeForChapterPlan(ranges: ReturnType<typeof volumeChapterRanges>, plan: Pick<ChapterPlan, 'targetChapterStart'>) {
  return ranges.find(range => range.start <= plan.targetChapterStart && plan.targetChapterStart < range.endExclusive)?.volumeId
}
