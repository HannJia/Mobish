export interface BreakdownEvidenceLink {
  label: string
  path: string
  query: Record<string, string>
}

export interface BreakdownMessageParts {
  text: string
  links: BreakdownEvidenceLink[]
}

const marker = /[ \t]*〔拆书记录 breakdown-[^〕\r\n]+〕/g
const evidenceLink = /(?:[ \t]+\/[ \t]+|^\/[ \t]+)?\[回看出处\]\(((?:[^()]|\([^()]*\))*)\)/g
const evidenceTarget = /^#(\/breakdown\/[A-Za-z0-9_-]+)(?:\?([^#\\\s]*))?$/

export function extractBreakdownMessageParts(raw: string): BreakdownMessageParts {
  const links: BreakdownEvidenceLink[] = []
  const lines: string[] = []
  let changed = false
  let removedLine = false
  for (const original of raw.split(/\r?\n/)) {
    const line = original.replace(marker, '')
    let previousLinkEnd = 0
    const text = line.replace(evidenceLink, (match: string, target: string, offset: number) => {
      const location = line.slice(previousLinkEnd, offset).replace(/^[ \t]*\/[ \t]+/, '')
        .trim().replace(/[ \t]+\/[ \t]+/g, ' · ')
      previousLinkEnd = offset + match.length
      const route = evidenceTarget.exec(target)
      if (route) {
        const query = Object.fromEntries([...new URLSearchParams(route[2])]
          .filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)))
        links.push({ label: location || '回看出处', path: route[1]!, query })
      }
      return ''
    })
    if (text !== original) {
      changed = true
      if (!text.trim()) {
        removedLine = true
        continue
      }
    }
    if (removedLine && !text.trim() && lines[lines.length - 1]?.trim() === '') continue
    removedLine = false
    lines.push(text === original ? original : text.trimEnd())
  }
  if (!changed) return { text: raw, links }
  const text = lines.join(raw.includes('\r\n') ? '\r\n' : '\n').replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, '')
  return { text, links }
}
