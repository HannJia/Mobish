export interface WindowCloseContext {
  dirty: boolean
  inspiration: boolean
}

const guards = new Set<() => Partial<WindowCloseContext>>()

export function registerWindowCloseGuard(read: () => Partial<WindowCloseContext>): () => void {
  guards.add(read)
  return () => { guards.delete(read) }
}

export function windowCloseContext(path: string): WindowCloseContext | undefined {
  if (path === '/') return undefined
  let dirty = false
  let inspiration = path.startsWith('/breakdown/discuss/')
  for (const read of guards) {
    const context = read()
    dirty ||= context.dirty === true
    inspiration ||= context.inspiration === true
  }
  return { dirty, inspiration }
}
