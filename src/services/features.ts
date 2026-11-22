// 功能开关。
// 云同步暂不对外开放：等官网备案、账号与服务条款准备好后，再作为功能更新开放（见 docs/official-site-and-paid-sync-plan.md）。
// 关闭时隐藏所有云同步入口，启动时不初始化同步；同步代码和本地的项目历史保留不动。
export const CLOUD_SYNC_AVAILABLE = false

/**
 * 运行时可调的功能开关（测试里可以临时打开）。
 * knowledgeAiSummary：知识库“AI 整理摘要”。1.1.2 起暂停：模型普遍不遵守字数要求，分层摘要常失败；
 * 知识库改用按标题分段检索（src/services/knowledgeSections.ts）。摘要栏保留为可手写的简介，代码保留。
 */
export const featureFlags = { knowledgeAiSummary: false }
