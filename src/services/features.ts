// 功能开关。
// 开发版重开现有邀请制同步，供作者跨电脑验收。
export const CLOUD_SYNC_AVAILABLE = true

/**
 * 运行时可调的功能开关（测试里可以临时打开）。
 * knowledgeAiSummary：知识库“AI 整理摘要”。1.1.2 起暂停：模型普遍不遵守字数要求，分层摘要常失败；
 * 知识库改用按标题分段检索（src/services/knowledgeSections.ts）。摘要栏保留为可手写的简介，代码保留。
 */
export const featureFlags = { knowledgeAiSummary: false }
