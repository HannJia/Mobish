export function createMarkdownFenceTracker() {
  let marker = ''
  return {
    get openMarker() { return marker },
    includes(line: string): boolean {
      const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      if (marker) {
        if (match && match[1][0] === marker[0] && match[1].length >= marker.length && !match[2].trim()) marker = ''
        return true
      }
      if (!match || (match[1][0] === '`' && match[2].includes('`'))) return false
      marker = match[1]
      return true
    },
  }
}

export function markdownTitleText(line: string): string {
  return line.trim()
    .replace(/^(?:(?:#{1,6}|[-+*]|\d+[.)])[ \t]+|>[ \t]*)+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/[ \t]+#+$/, '')
    .trim()
}
