import { defineConfig } from 'vitest/config'
import base, { BASE_EXCLUDE, PERFORMANCE_TESTS } from './vitest.config'

// 只运行带耗时预算的测试，单个进程、逐个文件，不和其他测试抢资源。
// 这里用对象展开而不是 mergeConfig：mergeConfig 会把 exclude 数组拼接起来，
// 结果会把要运行的性能测试也排除掉。
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: PERFORMANCE_TESTS,
    exclude: BASE_EXCLUDE,
    fileParallelism: false,
    maxWorkers: 1,
  },
})
