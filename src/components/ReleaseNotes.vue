<template>
  <div class="release-notes">
    <template v-for="(block, index) in blocks" :key="index">
      <p v-if="block.kind === 'heading'" class="note-heading" :class="{ 'note-heading-top': block.level <= 1 }">
        <template v-for="(part, partIndex) in block.inlines" :key="partIndex"><code v-if="part.code">{{ part.text }}</code><strong v-else-if="part.strong">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template>
      </p>
      <p v-else-if="block.kind === 'paragraph'">
        <template v-for="(part, partIndex) in block.inlines" :key="partIndex"><code v-if="part.code">{{ part.text }}</code><strong v-else-if="part.strong">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template>
      </p>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else>
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(part, partIndex) in item" :key="partIndex"><code v-if="part.code">{{ part.text }}</code><strong v-else-if="part.strong">{{ part.text }}</strong><template v-else>{{ part.text }}</template></template>
        </li>
      </component>
    </template>
    <p v-if="!blocks.length">此版本未提供更新说明。</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { parseReleaseNotes } from '@/utils/releaseNotes'

const props = defineProps<{ notes: string }>()
const blocks = computed(() => parseReleaseNotes(props.notes))
</script>

<style scoped>
.release-notes { display: grid; gap: 8px; line-height: 1.7; overflow-wrap: anywhere; }
.release-notes p, .release-notes ul, .release-notes ol { margin: 0; }
.release-notes ul, .release-notes ol { padding-left: 1.4em; display: grid; gap: 4px; }
.note-heading { font-weight: 600; color: var(--ink); margin-top: 6px !important; }
.note-heading:first-child { margin-top: 0 !important; }
.note-heading-top { font-size: 1.08em; }
.release-notes code { font-family: var(--f-mono, ui-monospace, monospace); font-size: .92em; padding: 0 4px; border-radius: 4px; background: var(--panel-2); }
</style>
