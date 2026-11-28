<template>
  <div class="create-page">
    <div class="create-in">
      <ol class="create-steps" aria-label="作品创建进度">
        <li v-for="(step, index) in steps" :key="step" :class="{ current: index === 0 }"
          :aria-current="index === 0 ? 'step' : undefined">
          <i aria-hidden="true">{{ index + 1 }}</i><span>{{ step }}</span>
        </li>
      </ol>
      <div class="create-workspace">
        <header class="create-heading">
          <h1>怎样开始这部作品？</h1>
          <p>四种起点进入同一套创作流程：契约 → 骨架 → 分卷 → 章节 → 场景。正文由谁来写，另外选择。</p>
        </header>
        <CreateWizard shell-header />
        <section class="creation-principles" aria-label="创作流程说明">
          <div><b>聊天负责探索</b><span>对话用来提问、发散，不自动批准设定</span></div>
          <div><b>卡片负责确认</b><span>契约与规划可编辑，明确确认后生效</span></div>
          <div><b>结构负责记忆</b><span>卷、章、场景、人物与伏笔都有来源</span></div>
          <div><b>作者决定入典</b><span>故事变化逐条确认，整章通过门槛后定稿</span></div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import CreateWizard from '@/v3/create/CreationWizard.vue'

defineOptions({ name: 'V3CreateView' })
const steps = ['起点', '作品契约', '故事骨架', '分卷大纲', '开始写作']
</script>

<style scoped>
.create-page { position: absolute; inset: 0; overflow: auto; background: var(--desk); color: var(--ink); }
.create-in { display: grid; grid-template-columns: 114px minmax(0, 1fr); min-height: 100%; }
.create-workspace {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  padding: 18px clamp(12px, 2vw, 30px) 24px;
}
.create-page:has(.discussing-inspiration) { overflow: hidden; }
.create-page:has(.discussing-inspiration) .create-in { height: 100%; }
.create-steps {
  display: grid; align-content: start; gap: 8px; list-style: none; margin: 0;
  padding: 20px 8px; border-right: 1px solid var(--line);
}
.create-steps li {
  display: flex; align-items: center; gap: 7px; padding: 7px 5px;
  color: var(--ink-3); font-size: 12px; line-height: 1.4;
}
.create-steps i {
  width: 22px; height: 22px; flex: none; display: grid; place-items: center;
  border: 1px solid var(--line-2); border-radius: 50%; font: 600 12px var(--f-num);
}
.create-steps .current { border-radius: var(--r-m); background: var(--zhu-soft); color: var(--zhu); font-weight: 600; }
.create-steps .current i { background: var(--zhu-solid); border-color: var(--zhu); color: var(--on-accent); }
.create-heading { flex: none; margin-bottom: 14px; }
.create-heading h1 { font: 600 24px/1.35 var(--f-serif); margin: 0 0 4px; }
.create-heading p { margin: 0; color: var(--ink-3); font-size: 13px; line-height: 1.55; }
.creation-principles { display: none; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 26px; border: 1px solid var(--line); border-radius: var(--r-m); overflow: hidden; }
.create-in:has(.choosing-options) .creation-principles { display: grid; }
.creation-principles > div { padding: 14px 16px; background: var(--panel); color: var(--ink-3); font-size: 12px; border-right: 1px solid var(--line); }
.creation-principles > div:last-child { border: 0; }
.creation-principles b { display: block; color: var(--ink); font: 600 15px/1.5 var(--f-serif); margin-bottom: 2px; }
@media (max-width: 760px) {
  .create-in { grid-template-columns: 38px minmax(0, 1fr); }
  .create-steps { padding: 16px 4px; }
  .create-steps li { justify-content: center; padding-inline: 0; }
  .create-steps span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .create-heading h1 { font-size: 20px; }
  .creation-principles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
