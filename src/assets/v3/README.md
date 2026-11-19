# V3 界面默认图片

2026-11-06 由桌面会话的生图模型生成（“朱批”水墨风格，图中不含文字），用无头 Chrome 的 canvas 压成 WebP。原稿与压缩脚本保存在被 Git 忽略的 `.local-recovery/ui-redesign-20261106/`。

| 目录 | 用途 |
| --- | --- |
| `covers/` | 作品默认封面，按作品大类自动匹配（`moon-1`、`moon-2` 仅供手动选择），420×630 |
| `empty/` | 空状态插画，640×480 |
| `onboarding/` | 首次使用引导三步，640×480 |
| `hero/` | 书架首屏，按时段切换：dawn 清晨、noon 白天、dusk 黄昏、night 夜晚，1440×960 |
| `headers/` | 新建、设置、审校中心页头，1200×800 |

这些图片只用于界面装饰，不写入作品数据或项目备份。“无搜索结果”一张生成失败（上游返回文字而非图片），界面暂用 `empty/codex` 代替。

2026-11-18 补充 `empty/` 下的 `shelf`（空书架）、`characters`（人物）、`outline`（大纲）、`volumes`（分卷）四张，用 `gpt-image-2.6-sunburst` 按同一风格生成 1536×1024 原图，再用 Electron 的 canvas 居中裁成 4:3、缩到 640×480 并以质量 0.72 导出 WebP（每张约 6 KB）。原图不入库。章节与知识库空状态改用已有的 `chapters`、`library`。浅色主题下插画以 multiply 混合融进纸色，夜墨主题由 `--art-filter` 反相，见 `v3.css` 的 `.m-art`。
