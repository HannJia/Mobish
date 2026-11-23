<template>
  <V3Modal :show="show" title="支持作者" size="wide" @update:show="value => emit('update:show', value)">
    <div class="donate">
      <p class="donate-motto">你的支持是我持续更新和维护项目的最大动力！</p>
      <p class="donate-lead">墨笔生花免费、开源，不打赏也不影响任何功能。如果它帮到了你，欢迎扫码请作者喝杯茶，支持继续更新。</p>
      <div class="donate-codes">
        <figure><img :src="wechat" alt="微信收款码" width="540" height="722"></figure>
        <figure><img :src="alipay" alt="支付宝收款码" width="540" height="810"></figure>
      </div>
      <p class="donate-note">想出现在致谢名单里的话，付款时在备注写上希望显示的称呼；没有备注的会显示为“匿名”。</p>
      <p class="donate-star">不方便打赏？到 <a :href="GITHUB_REPO_URL" target="_blank" rel="noopener noreferrer">GitHub 点个 Star</a> 也是很大的支持。</p>
    </div>
  </V3Modal>
</template>

<script setup lang="ts">
import V3Modal from './V3Modal.vue'
import wechat from '@/assets/v3/donate/wechat.webp'
import alipay from '@/assets/v3/donate/alipay.webp'
import { GITHUB_REPO_URL } from '@/services/githubStar'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()
</script>

<style scoped>
.donate { display: grid; gap: 14px; }
.donate-motto { margin: 0; color: var(--ink); font-size: 14px; font-weight: 600; }
.donate-lead, .donate-note, .donate-star { margin: 0; color: var(--ink-2); font-size: 13px; line-height: 1.7; }
.donate-note, .donate-star { color: var(--ink-3); font-size: 12px; }
.donate-star a { color: var(--zhu); }
.donate-codes { display: flex; justify-content: center; align-items: flex-start; gap: 24px; flex-wrap: wrap; }
.donate-codes figure { margin: 0; display: grid; justify-items: center; gap: 6px; }
.donate-codes img { height: 330px; width: auto; max-width: 100%; border-radius: 10px; border: 1px solid var(--line); background: #fff; }
</style>
