import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// V3 主题：实际配色在 src/v3/styles 中按 data-theme 定义。
export type ThemeName = 'fanqie' | 'eyecare' | 'dark'

export interface ThemeOption {
  name: ThemeName
  label: string
  description: string
  /** 色块预览：背景 / 主色 */
  swatch: [string, string]
}

// 主题选项列表
export const themeOptions: ThemeOption[] = [
  { name: 'fanqie', label: '宣纸', description: '东方书卷，淡雅舒适', swatch: ['#ECE7DC', '#B8321F'] },
  { name: 'eyecare', label: '青瓷', description: '柔和豆青，长时写作', swatch: ['#E3E9E4', '#2C5470'] },
  { name: 'dark', label: '夜墨', description: '深色护眼，专注沉浸', swatch: ['#141311', '#E0634B'] },
]

export const useThemeStore = defineStore('theme', () => {
  // 当前主题名
  const currentTheme = ref<ThemeName>('fanqie')

  // 是否为深色模式
  const isDark = computed(() => currentTheme.value === 'dark')

  // 切换主题
  function switchTheme(theme: ThemeName) {
    // A storage failure must leave the visible theme unchanged during restore.
    localStorage.setItem('mojian-v3-theme', theme)
    currentTheme.value = theme
    document.documentElement.setAttribute('data-theme', theme)
    // 持久化到 localStorage
  }

  // 初始化主题（从 localStorage 或默认）
  function initTheme() {
    const saved = localStorage.getItem('mojian-v3-theme') as ThemeName | null
    if (saved && ['fanqie', 'eyecare', 'dark'].includes(saved)) {
      switchTheme(saved)
    } else {
      switchTheme('fanqie')
    }
  }

  return {
    currentTheme,
    isDark,
    switchTheme,
    initTheme,
  }
})
