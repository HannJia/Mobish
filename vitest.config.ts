import { defineConfig } from 'vitest/config'
import path from 'path'
import { availableParallelism } from 'node:os'
import vue from '@vitejs/plugin-vue'

// 带墙钟耗时预算的测试文件。并行运行时其他测试会抢占 CPU 和磁盘，测出的时间不可信，
// 所以普通运行不包含它们，改由 vitest.performance.config.ts 在单个进程里逐个运行。
// `npm test` 会先跑普通测试、再跑这些文件；只跑性能测试用 `npm run test:performance`。
// 新增耗时断言请写进这里列出的文件，或把新文件加到列表里。
export const PERFORMANCE_TESTS = [
  'src/services/db/novels.performance.test.ts',
  'src/services/semanticIndex.test.ts',
  'src/services/semanticIndex.incremental.test.ts',
]
export const BASE_EXCLUDE = ['.compare/**', '.local-recovery/**', 'node_modules/**', 'scripts/model-team/*.test.cjs']

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    // Real fsync/child-process tests share the host with Vue transforms. On
    // Windows, CPU-count fan-out caused disk tests to miss unchanged deadlines.
    // Keep parallel files and the explicit multi-process/CAS cases; the CLI can
    // override this resource cap for stress diagnostics.
    maxWorkers: process.platform === 'win32' ? Math.min(4, availableParallelism()) : undefined,
    // Node 25+ enables a global Web Storage that shadows happy-dom's
    // localStorage/sessionStorage (they read as undefined in tests).
    execArgv: Number(process.versions.node.split('.')[0]) >= 25 ? ['--no-experimental-webstorage'] : [],
    exclude: [...BASE_EXCLUDE, ...PERFORMANCE_TESTS],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
