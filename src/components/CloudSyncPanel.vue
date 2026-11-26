<template>
  <section class="cloud-panel cloud-page" id="cloud-sync-panel">
    <div class="cloud-heading">
      <div>
        <div class="cloud-title">
          <h2>云同步</h2>
          <span class="m-tag zhu outlined" title="云同步暂未全面开放">暂未开发</span>
        </div>
        <p class="cloud-page-subtitle">在不同设备间继续创作。</p>
      </div>
      <span class="cloud-state" :class="{ problem: sync.error || sync.pendingConflicts.length }" role="status">{{ sync.statusText }}</span>
    </div>
    <p v-if="feedback" class="cloud-feedback" role="alert">{{ feedback }}</p>
    <p v-if="sync.error" class="cloud-feedback" role="alert">{{ sync.error }}</p>
    <template v-if="!sync.session">
      <div class="cloud-auth-card paper-panel">
      <div class="m-seg" role="radiogroup" aria-label="云同步账号操作">
        <button v-for="option in authModes" :key="option.value" type="button" role="radio" :class="{ on: mode === option.value }"
          :aria-checked="mode === option.value" @click="mode = option.value">{{ option.label }}</button>
      </div>
      <form class="cloud-form" @submit.prevent="submitAuth">
        <label>账号<V3Input v-model:value="username" aria-label="云同步账号" autocomplete="username" :maxlength="32" placeholder="3～32 位字母、数字、下划线或短横线" /></label>
        <label>{{ mode === 'recover' ? '新密码' : '密码' }}<V3Input v-model:value="password" aria-label="云同步密码" type="password" :maxlength="256" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :placeholder="mode === 'login' ? '密码' : '至少 6 个字符'" /></label>
        <label v-if="mode !== 'login'">确认密码<V3Input v-model:value="confirmPassword" aria-label="确认云同步密码" type="password" :maxlength="256" autocomplete="new-password" placeholder="再次输入密码" /></label>
        <p v-if="mode !== 'login' && confirmPassword && confirmPassword !== password" class="cloud-feedback" role="alert">两次输入的密码不一致。</p>
        <label v-if="mode === 'register'">邀请码<V3Input v-model:value="invite" aria-label="注册邀请码" autocomplete="off" /></label>
        <label v-if="mode === 'recover'">恢复码<V3Input v-model:value="recoveryInput" aria-label="账号恢复码" type="password" autocomplete="off" /></label>
        <button type="submit" class="m-btn pri" :aria-busy="working" :disabled="working || !username.trim() || !password || (mode !== 'login' && (password.length < 6 || password !== confirmPassword))">
          {{ working ? '正在处理…' : mode === 'login' ? '登录' : mode === 'register' ? '注册账号' : '重置密码' }}
        </button>
      </form>
      </div>
    </template>
    <template v-else>
      <section class="cloud-account-card paper-panel"><h3>个人账户</h3>
      <div class="cloud-account"><span class="cloud-account-avatar" aria-hidden="true">{{ sync.session.user.username.slice(0, 1).toUpperCase() }}</span>
        <div><strong>{{ sync.session.user.username }}</strong><span class="cloud-role">{{ sync.session.user.role === 'admin' ? '管理员' : '个人账户' }}</span></div>
        <div class="cloud-controls">
          <button type="button" class="m-btn sm" :disabled="sync.busy || working" @click="passwordDialog = true">修改密码</button>
          <button type="button" class="m-btn sm ghost" :disabled="sync.busy || working" @click="perform(() => sync.logout())">退出登录</button>
        </div>
      </div>
      <div class="cloud-quota-track" role="progressbar" aria-label="云端空间已用比例" :aria-valuenow="Math.round(Math.min(100, sync.session.user.usedBytes / Math.max(1, sync.session.user.quotaBytes) * 100))" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: Math.min(100, sync.session.user.usedBytes / Math.max(1, sync.session.user.quotaBytes) * 100) + '%' }"></span></div>
      <div class="cloud-details">
        <span>云端空间 {{ size(sync.session.user.usedBytes) }} / {{ size(sync.session.user.quotaBytes) }}</span>
        <span>上次同步：{{ sync.state.lastSync ? new Date(sync.state.lastSync).toLocaleString('zh-CN') : '尚未同步' }}</span>
      </div>
      </section>
      <section class="cloud-sync-settings paper-panel"><h3>同步设置</h3>
      <div class="cloud-controls">
        <label class="cloud-toggle">自动同步<V3Switch :value="sync.state.enabled" :disabled="working || sync.busy" aria-label="自动云同步" @update:value="value => perform(() => sync.setEnabled(value))" /></label>
        <button type="button" class="m-btn" :aria-busy="sync.busy" :disabled="!sync.state.enabled || working || sync.busy" @click="sync.syncNow()">
          <V3Icon name="refresh" size="s" :class="{ 'cloud-spin': sync.busy }" />{{ sync.busy ? '正在同步…' : '立即同步' }}
        </button>
      </div>
      <p class="cloud-note">首次开启先下载云端内容；本机独有作品可选择加入同步。同一内容在多台设备上均有改动时，将保留双方版本。</p>
      <p v-if="sync.pendingDownloads" class="cloud-note">有 {{ sync.pendingDownloads }} 项云端更新等待合并。</p>
      <CloudPreferencesPanel />
      </section>
      <div v-if="sync.pendingUploads?.length" class="cloud-invites cloud-pending paper-panel">
        <h4>待加入同步的内容</h4>
        <p class="cloud-note">只上传选中的内容。小说引用的本机知识库也需要一起选中。</p>
        <label v-for="item in sync.pendingUploads" :key="item.key" class="m-check cloud-consent">
          <input type="checkbox" :checked="selectedUploads.includes(item.key)" :disabled="working || sync.busy" @change="selectUpload(item.key, ($event.target as HTMLInputElement).checked)">{{ kindLabel(item.kind) }}：{{ item.title }}
        </label>
        <button type="button" class="m-btn sm pri" :disabled="!sync.state.enabled || !selectedUploads.length || working || sync.busy" @click="perform(async () => { await sync.approveUploads(selectedUploads); selectedUploads = [] })">将所选内容加入云同步</button>
      </div>

      <details class="cloud-explanation paper-panel">
        <summary>同步说明</summary>
        <p class="cloud-note">作品同步包含小说、正文版本、剧情规划、资料记忆、书内对话、灵感会话及草稿、知识库。模型配置与 API 密钥可在上方单独开启同步。</p>
        <p class="cloud-note">PDF、图片等原始文件和 OCR 识别缓存仅保存在本机。</p>
        <p class="cloud-note">作品同步不采用端到端加密，云同步服务管理方可访问云端内容。API 密钥在云端加密存储，加密密钥由同步服务管理。</p>
        <p class="cloud-note">请妥善保管账号和恢复码，避免与他人共享账号。</p>
        <p class="cloud-note">可定期导出项目备份，另存一份本机副本。</p>
      </details>
      <div v-if="sync.session.user.role === 'admin'" class="cloud-invites paper-panel">
        <h4>邀请注册</h4>
        <div class="cloud-controls">
          <label class="cloud-toggle">可用次数<V3Number v-model:value="inviteUses" class="cloud-invite-uses" :min="1" :max="20" aria-label="邀请码使用次数" /></label>
          <button type="button" class="m-btn" :aria-busy="working" :disabled="working" @click="makeInvite">创建邀请码</button>
        </div>
        <div v-if="createdInvite" class="cloud-secret">
          <code>{{ createdInvite }}</code>
          <button type="button" class="m-ibtn" title="复制邀请码" aria-label="复制邀请码" @click="copy(createdInvite, 'invite')"><V3Icon name="copy" /></button>
          <span>7 天内有效</span>
        </div>
        <p v-if="inviteFeedback" role="status" class="cloud-copy-feedback">{{ inviteFeedback }}</p>
      </div>
    </template>
    <div v-if="duplicateLibraries.length" class="cloud-duplicates paper-panel" aria-label="同名知识库合并">
      <h4>发现同名重复知识库</h4>
      <p class="cloud-note">同步合并保留了不同编号的同名知识库。确认合并会保留目标库编号、合并双方独有与有差异的资料，并迁移作品挂载及灵感历史引用。</p>
      <article v-for="item in duplicateLibraries" :key="`${item.targetId}:${item.duplicateId}`" class="cloud-duplicate-row">
        <div>
          <strong>《{{ item.name }}》</strong>
          <p class="cloud-note">相同 {{ item.identical.length }} 条 · 有差异 {{ item.different.length }} 条 · 目标独有 {{ item.targetOnly.length }} 条 · 副本独有 {{ item.duplicateOnly.length }} 条</p>
          <p class="cloud-note">将迁移 {{ item.affected.novels }} 部作品挂载 · {{ item.affected.sessionSelections }} 个灵感会话 · {{ item.affected.messageReferences }} 处历史引用</p>
        </div>
        <button type="button" class="m-btn sm pri" :disabled="sync.busy || working" @click="openDuplicateMerge(item)">对比并合并</button>
      </article>
    </div>
    <div v-if="sync.pendingConflicts.length" class="cloud-conflicts">
      <h4>选择要保留的版本</h4>
      <article v-for="conflict in sync.pendingConflicts" :key="conflict.id" class="cloud-conflict">
        <strong>{{ conflict.title }}</strong>
        <span class="cloud-note">{{ new Date(conflict.createdAt).toLocaleString('zh-CN') }}</span>
        <div class="cloud-versions">
          <div><b>本机版本</b><p>{{ describe(conflict.local) }}</p><button type="button" class="m-btn sm" @click="perform(() => sync.exportConflict(conflict.id, 'local'))">导出本机版本</button></div>
          <div><b>云端版本</b><p>{{ describe(conflict.remote) }}</p><button type="button" class="m-btn sm" @click="perform(() => sync.exportConflict(conflict.id, 'remote'))">导出云端版本</button></div>
        </div>
        <div class="cloud-controls">
          <button type="button" class="m-btn" :disabled="sync.busy || working || !sync.session" @click="resolve(conflict.id, 'local')">保留本机版本</button>
          <button type="button" class="m-btn" :disabled="sync.busy || working || !sync.session" @click="resolve(conflict.id, 'remote')">采用云端版本</button>
        </div>
      </article>
    </div>
    <details v-if="archives.length" class="cloud-archives"><summary>历史版本备份（{{ archives.length }}）</summary>
      <div v-for="conflict in archives" :key="conflict.id" class="cloud-archive">
        <span>{{ conflict.title }} · {{ conflict.resolution === 'superseded' ? '冲突已刷新' : conflict.resolution === 'local' ? '已保留本机版本' : '已采用云端版本' }} · {{ new Date(conflict.createdAt).toLocaleString('zh-CN') }}</span>
        <button type="button" class="m-btn xs ghost" @click="perform(() => sync.exportConflict(conflict.id, 'local'))">导出本机版本</button>
        <button type="button" class="m-btn xs ghost" @click="perform(() => sync.exportConflict(conflict.id, 'remote'))">导出云端版本</button>
      </div>
    </details>
    <V3Modal v-model:show="passwordDialog" title="修改云同步密码" size="small" :closable="!working" description="修改后所有设备需重新登录，小说和知识库不受影响，原账号恢复码仍有效。">
      <form class="cloud-password-form" @submit.prevent="submitPasswordChange">
        <label>当前密码<V3Input v-model:value="currentPassword" aria-label="当前云同步密码" type="password" autocomplete="current-password" :maxlength="256" /></label>
        <label>新密码<V3Input v-model:value="newPassword" aria-label="新的云同步密码" type="password" autocomplete="new-password" :maxlength="256" placeholder="至少 6 个字符" /></label>
        <label>确认新密码<V3Input v-model:value="newPasswordConfirmation" aria-label="确认新的云同步密码" type="password" autocomplete="new-password" :maxlength="256" /></label>
        <p v-if="newPasswordConfirmation && newPassword !== newPasswordConfirmation" role="alert" class="cloud-feedback">两次输入的密码不一致。</p>
        <p v-if="passwordError" role="alert" class="cloud-feedback">{{ passwordError }}</p>
        <button type="submit" class="m-btn pri" :aria-busy="working" :disabled="working || !currentPassword || newPassword.length < 6 || newPassword !== newPasswordConfirmation">{{ working ? '正在修改…' : '确认修改密码' }}</button>
      </form>
    </V3Modal>
    <V3Modal :show="!!recoveryCode" class="cloud-recovery-modal" title="账号恢复码" :closable="false">
      <p>恢复码只显示这一次。忘记密码时可凭它恢复账号，请单独妥善保存，不要发送给他人。</p>
      <div class="cloud-secret"><code>{{ recoveryCode }}</code><button type="button" class="m-ibtn" title="复制恢复码" aria-label="复制恢复码" @click="copy(recoveryCode, 'recovery')"><V3Icon name="copy" /></button></div>
      <p v-if="recoveryFeedback" role="status" class="cloud-copy-feedback">{{ recoveryFeedback }}</p>
      <a v-if="recoveryDownloadUrl" class="cloud-download-fallback" :href="recoveryDownloadUrl" download="云同步账号恢复码.txt" @click="recoveryFeedback = '已开始下载，请查看浏览器下载列表或默认下载目录。'">如果没有自动下载，点此保存</a>
      <template #footer><button type="button" class="m-btn" @click="downloadRecovery">下载恢复码</button><button type="button" class="m-btn pri" @click="recoveryCode = ''">已妥善保存</button></template>
    </V3Modal>
    <V3Modal :show="!!mergePreview" title="合并同名知识库" size="wide" :closable="!working"
      :description="mergePreview ? `《${mergePreview.name}》：合并将保留目标库编号，无损保留双方独有及有差异条目，迁移全部挂载与灵感引用，确认落地后再清理副本。` : undefined"
      @update:show="value => { if (!value) closeDuplicateMerge() }">
      <div v-if="mergePreview" class="cloud-merge-preview">
        <div class="cloud-controls">
          <span class="cloud-note">保留目标库：<strong>{{ mergePreview.targetId === mergePreview.recommendedTargetId ? '推荐目标库' : '已切换目标库' }}</strong></span>
          <button type="button" class="m-btn sm" :disabled="working" @click="swapMergeTarget">切换保留另一份为主库</button>
        </div>
        <div class="cloud-merge-stats">
          <span>相同条目：{{ mergePreview.identical.length }}</span>
          <span>有差异条目（均保留）：{{ mergePreview.different.length }}</span>
          <span>目标独有：{{ mergePreview.targetOnly.length }}</span>
          <span>副本独有（将并入）：{{ mergePreview.duplicateOnly.length }}</span>
        </div>
        <p class="cloud-note">受影响迁移：{{ mergePreview.affected.novels }} 部作品挂载、{{ mergePreview.affected.sessionSelections }} 个灵感会话、{{ mergePreview.affected.messageReferences }} 处历史引用。</p>
        <div v-if="mergePreview.duplicateOnly.length" class="cloud-merge-list">
          <b>将并入目标库的副本独有条目</b>
          <ul><li v-for="entry in mergePreview.duplicateOnly" :key="entry.id">{{ entry.title }}</li></ul>
        </div>
        <div v-if="mergePreview.different.length" class="cloud-merge-list">
          <b>标题或内容存在差异（双方条目均保留）</b>
          <ul><li v-for="pair in mergePreview.different" :key="`${pair.target.id}:${pair.duplicate.id}`">{{ pair.target.title }} / {{ pair.duplicate.title }}</li></ul>
        </div>
      </div>
      <template #footer>
        <button type="button" class="m-btn" :disabled="working" @click="closeDuplicateMerge">取消</button>
        <button type="button" class="m-btn pri" :aria-busy="working" :disabled="working || !mergeToken" @click="confirmDuplicateMerge">{{ working ? '正在合并…' : '确认合并并迁移引用' }}</button>
      </template>
    </V3Modal>
  </section>
</template>

<script setup lang="ts">
import { errorText } from '@/services/userFacingError'
import { computed, onMounted, ref, watch } from 'vue'
import { useDialog } from '@/v3/feedback'
import V3Icon from '@/v3/components/V3Icon.vue'
import V3Modal from '@/v3/components/V3Modal.vue'
import V3Input from '@/v3/components/form/V3Input.vue'
import V3Number from '@/v3/components/form/V3Number.vue'
import V3Switch from '@/v3/components/form/V3Switch.vue'
import { useCloudSyncStore } from '@/stores/cloudSync'
import type { KnowledgeMergePreview } from '@/services/knowledgeDuplicateMerge'
import CloudPreferencesPanel from './CloudPreferencesPanel.vue'
import { copyText } from '@/utils/clipboard'

const sync = useCloudSyncStore()
const dialog = useDialog()
const mode = ref<'login' | 'register' | 'recover'>('login')
const authModes = [{ value: 'login', label: '登录' }, { value: 'register', label: '邀请码注册' }, { value: 'recover', label: '恢复账号' }] as const
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const passwordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const newPasswordConfirmation = ref('')
const passwordError = ref('')
watch(mode, () => { password.value = ''; confirmPassword.value = ''; feedback.value = '' }, { flush: 'sync' })
watch(passwordDialog, () => { currentPassword.value = ''; newPassword.value = ''; newPasswordConfirmation.value = ''; passwordError.value = '' })
const invite = ref('')
const recoveryInput = ref('')
const recoveryCode = ref('')
const recoveryFeedback = ref('')
const recoveryDownloadUrl = ref('')
const inviteFeedback = ref('')
watch(recoveryCode, value => {
  recoveryFeedback.value = ''
  if (!value && recoveryDownloadUrl.value) {
    URL.revokeObjectURL(recoveryDownloadUrl.value)
    recoveryDownloadUrl.value = ''
  }
})
const working = ref(false)
const selectedUploads = ref<string[]>([])
const kindLabel = (kind: string) => kind === 'novel' ? '小说' : kind === 'knowledge' ? '知识库' : '灵感会话'
function selectUpload(key: string, value: boolean) { selectedUploads.value = value ? [...new Set([...selectedUploads.value, key])] : selectedUploads.value.filter(item => item !== key) }
watch(() => sync.pendingUploads, items => { selectedUploads.value = selectedUploads.value.filter(key => items?.some(item => item.key === key)) })
const feedback = ref('')
const inviteUses = ref<number | null>(1)
const createdInvite = ref('')
const archives = computed(() => sync.conflicts.filter(item => item.resolution))
function size(bytes: number) { return `${(bytes / 1024 / 1024).toFixed(1)} MiB` }
function describe(payload: string | null) {
  if (payload === null) return '已删除'
  try {
    const value = JSON.parse(payload)
    if (value.kind === 'novel') return `${value.novel.title || '未命名小说'} · ${value.novel.chapters.length} 章 · ${value.novel.currentWordCount.toLocaleString('zh-CN')} 字 · ${new Date(value.novel.updatedAt).toLocaleString('zh-CN')}`
    if (value.kind === 'inspiration') return `${value.inspiration.title} · ${value.inspiration.messages.length} 条消息${value.inspiration.draft ? ' · 含未发送草稿' : ''}`
    return `${value.knowledge.entries.length} 条资料 · ${value.knowledge.name}`
  } catch { return '已保存的版本' }
}
async function perform(action: () => Promise<unknown>) {
  if (working.value) return
  working.value = true
  feedback.value = ''
  try { await action() }
  catch (cause) { feedback.value = errorText(cause, '操作未完成，请重试。') }
  finally { working.value = false }
}
async function submitAuth() {
  await perform(async () => {
    if (mode.value !== 'login' && (password.value.length < 6 || password.value !== confirmPassword.value)) {
      throw new Error('密码至少 6 个字符，且两次输入必须一致。')
    }
    if (mode.value === 'recover') {
      recoveryCode.value = (await sync.recover(username.value.trim(), recoveryInput.value.trim(), password.value)).recoveryCode
      mode.value = 'login'
      recoveryInput.value = ''
      feedback.value = '密码已重置，请使用新密码登录。'
    } else recoveryCode.value = await sync.authenticate(mode.value, username.value.trim(), password.value, invite.value.trim())
    password.value = ''
    confirmPassword.value = ''
    invite.value = ''
  })
}
async function submitPasswordChange() {
  if (working.value) return
  passwordError.value = ''
  if (newPassword.value.length < 6 || newPassword.value !== newPasswordConfirmation.value) {
    passwordError.value = '新密码至少 6 个字符，且两次输入必须一致。'
    return
  }
  working.value = true
  try {
    const account = sync.session?.user.username || ''
    await sync.changePassword(currentPassword.value, newPassword.value)
    passwordDialog.value = false
    mode.value = 'login'
    username.value = account
    password.value = ''
    await Promise.resolve()
    feedback.value = '密码已修改，请使用新密码重新登录。其他设备也需要重新登录。'
  } catch (cause) { passwordError.value = errorText(cause, '修改密码失败，请重试。') }
  finally { working.value = false }
}
async function makeInvite() {
  await perform(async () => { createdInvite.value = (await sync.createInvite(inviteUses.value || 1)).code })
}
async function copy(value: string, kind: 'recovery' | 'invite') {
  const result = kind === 'recovery' ? recoveryFeedback : inviteFeedback
  result.value = ''
  try {
    const channel = await copyText(value)
    result.value = channel === 'system' ? '已复制到系统剪贴板。' : '已请求浏览器复制，请粘贴确认。若没有内容，请选中文字后按 Ctrl+C，或下载保存。'
  } catch { result.value = '复制失败，请选中文字后按 Ctrl+C，或下载保存。' }
}
function downloadRecovery() {
  const blob = new Blob([`墨笔生花云同步账号：${username.value.trim()}\n恢复码：${recoveryCode.value}\n请勿向他人提供恢复码。\n`], { type: 'text/plain;charset=utf-8' })
  if (recoveryDownloadUrl.value) URL.revokeObjectURL(recoveryDownloadUrl.value)
  const url = URL.createObjectURL(blob)
  recoveryDownloadUrl.value = url
  const link = document.createElement('a')
  link.href = url
  link.download = '云同步账号恢复码.txt'
  document.body.appendChild(link)
  link.click()
  link.remove()
  recoveryFeedback.value = '已发起下载，请查看浏览器下载列表或默认下载目录。'
  setTimeout(() => {
    if (recoveryDownloadUrl.value !== url) return
    URL.revokeObjectURL(url)
    recoveryDownloadUrl.value = ''
  }, 60000)
}
function resolve(id: string, side: 'local' | 'remote') {
  dialog.warning({ title: side === 'local' ? '保留本机版本？' : '采用云端版本？',
    content: '未采用的版本仍保存在冲突备份中。此操作会决定后续同步采用哪一份内容。',
    positiveText: '确认', negativeText: '取消',
    onPositiveClick: () => perform(() => sync.resolveConflict(id, side)),
  })
}

const duplicateLibraries = ref<KnowledgeMergePreview[]>([])
const mergePreview = ref<KnowledgeMergePreview | null>(null)
const mergeToken = ref('')
async function refreshDuplicates() {
  try { duplicateLibraries.value = await sync.listKnowledgeDuplicates() }
  catch { duplicateLibraries.value = [] }
}
onMounted(() => { void refreshDuplicates() })
watch(() => sync.state.lastSync, () => { void refreshDuplicates() })
async function openDuplicateMerge(item: KnowledgeMergePreview) {
  await perform(async () => {
    const data = await sync.getKnowledgeMergePreview({ targetId: item.targetId, duplicateId: item.duplicateId })
    if (!data) { await refreshDuplicates(); return }
    mergePreview.value = data
    mergeToken.value = data.token
  })
}
async function swapMergeTarget() {
  if (!mergePreview.value) return
  const next = { targetId: mergePreview.value.duplicateId, duplicateId: mergePreview.value.targetId }
  await perform(async () => {
    const data = await sync.getKnowledgeMergePreview(next)
    if (!data) { closeDuplicateMerge(); await refreshDuplicates(); return }
    mergePreview.value = data
    mergeToken.value = data.token
  })
}
function closeDuplicateMerge() {
  mergePreview.value = null
  mergeToken.value = ''
}
async function confirmDuplicateMerge() {
  if (!mergePreview.value || !mergeToken.value) return
  const selection = { targetId: mergePreview.value.targetId, duplicateId: mergePreview.value.duplicateId, token: mergeToken.value }
  await perform(async () => {
    await sync.confirmKnowledgeMerge(selection)
    closeDuplicateMerge()
    await refreshDuplicates()
    feedback.value = '同名知识库已合并，作品挂载与灵感引用已迁移。'
  })
}
</script>

<style scoped>
.cloud-heading,.cloud-account,.cloud-controls,.cloud-toggle,.cloud-secret { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.cloud-heading,.cloud-account { justify-content:space-between; }
.cloud-heading h3 { display:flex; align-items:center; gap:8px; margin:0; }
.cloud-panel { min-width:0; }
.cloud-state,.cloud-role,.cloud-note,.cloud-details { font-size:12px; color:var(--ink-2); overflow-wrap:anywhere; }
.cloud-state.problem,.cloud-feedback { color:var(--zhu); }
.cloud-feedback { font-size:13px; overflow-wrap:anywhere; }
.cloud-form { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-top:16px; }
.cloud-form label { display:grid; gap:6px; font-size:13px; min-width:0; }
.cloud-password-form,.cloud-password-form label { display:grid; gap:10px; min-width:0; }
.cloud-form > .m-btn { justify-self:start; align-self:end; }
.cloud-invite-uses { width:110px; }
.cloud-spin { animation: cloud-spin 1s linear infinite; }
@keyframes cloud-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cloud-spin { animation: none; } }
.cloud-server { margin-top:14px; font-size:13px; }
summary { cursor:pointer; padding:8px 0; }
.cloud-role { margin-left:10px; }
.cloud-account { margin-top:16px; }
.cloud-details { display:flex; flex-wrap:wrap; gap:8px 20px; margin:10px 0 16px; }
.cloud-consent { display:flex; margin-bottom:12px; }
.cloud-toggle { font-size:13px; }
.cloud-note { margin:12px 0; line-height:1.6; }
.cloud-explanation { margin-top:12px; font-size:12px; color:var(--ink-2); }
.cloud-invites,.cloud-conflicts,.cloud-archives { margin-top:20px; padding-top:14px; border-top:1px solid var(--line); }
h4 { font-size:14px; margin:0 0 12px; }
.cloud-secret { margin-top:12px; padding:10px 0; overflow-wrap:anywhere; }
.cloud-secret code { min-width:0; flex:1; word-break:break-all; user-select:all; }
.cloud-secret span { font-size:12px; color:var(--ink-2); }
.cloud-copy-feedback { font-size:12px; line-height:1.6; margin:8px 0 0; overflow-wrap:anywhere; }
.cloud-download-fallback { display:inline-block; margin-top:8px; color:var(--zhu); font-size:12px; text-decoration:underline; }
.cloud-conflict { padding:14px 0; border-bottom:1px solid var(--line); }
.cloud-conflict > strong { display:block; overflow-wrap:anywhere; }
.cloud-versions { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin:12px 0; }
.cloud-versions b { font-size:13px; }
.cloud-versions p { font-size:12px; color:var(--ink-2); overflow-wrap:anywhere; }
.cloud-archive { display:flex; flex-wrap:wrap; gap:8px; padding:8px 0; }
.cloud-archive > span { flex:1 1 180px; font-size:12px; overflow-wrap:anywhere; }
@media (max-width:600px) { .cloud-form,.cloud-versions { grid-template-columns:minmax(0,1fr); } }

.cloud-page { display: flex; flex-direction: column; gap: 20px; padding: 0; }
.cloud-heading { margin-bottom: 4px; }
.cloud-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.cloud-heading h2 { margin: 0; font-size: 30px; }
.cloud-page-subtitle { margin-top: 6px; font-size: 14px; color: var(--ink-2); }
.cloud-account-card, .cloud-sync-settings, .cloud-auth-card { padding: 24px; }
.cloud-account-card > h3, .cloud-sync-settings > h3 { font-size: 21px; margin: 0 0 20px; }
.cloud-account { gap: 16px; }
.cloud-account strong { font-size: 18px; }
.cloud-account > .cloud-controls { margin-left: auto; }
.cloud-account-avatar { width: 48px; height: 48px; display: grid; place-items: center; background: var(--dai); color: var(--on-accent); border-radius: 50%; font-size: 24px; }
.cloud-quota-track { height: 5px; background: var(--panel-2); margin-top: 22px; border-radius: 8px; overflow: hidden; }
.cloud-quota-track > span { display: block; min-width: 2px; height: 100%; background: var(--dai); }
.cloud-details { margin-bottom: 0; justify-content: space-between; }
.cloud-sync-settings > .cloud-controls { justify-content: space-between; }
.cloud-sync-settings .cloud-toggle { flex: 1; justify-content: space-between; padding-right: 20px; }
.cloud-invites.paper-panel { margin-top: 0; padding: 24px; }
.cloud-duplicates.paper-panel { padding: 20px 24px; border-color: color-mix(in srgb, var(--zhu) 40%, var(--line)); }
.cloud-duplicate-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding-top: 10px; border-top: 1px solid var(--line); }
.cloud-duplicate-row:first-of-type { border-top: 0; padding-top: 0; }
.cloud-merge-preview { display: grid; gap: 10px; }
.cloud-merge-stats { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); font-size: 12px; color: var(--ink-2); }
.cloud-merge-list { display: grid; gap: 4px; font-size: 12px; color: var(--ink-2); }
.cloud-merge-list ul { margin: 0; padding-left: 18px; display: grid; gap: 2px; }
.cloud-explanation.paper-panel { margin-top: 0; padding: 8px 20px; }
@media (max-width: 600px) { .cloud-account-card, .cloud-sync-settings, .cloud-auth-card { padding: 18px; } .cloud-account > .cloud-controls { margin-left: 0; } }
</style>
