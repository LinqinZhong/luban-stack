import type { VoiderProjectConfig } from '../../types/voider-project.js'
import { pageIdToViewName } from './naming.js'

export interface ScaffoldContext {
  projectName: string
  config: VoiderProjectConfig
  pages: Array<{ id: string; title: string }>
  componentIds: string[]
}

export function scaffoldFiles(ctx: ScaffoldContext): Record<string, string> {
  const entryPage = ctx.config.entryPage ?? ctx.pages[0]?.id ?? 'home'
  const files: Record<string, string> = {}

  files['package.json'] = JSON.stringify(
    {
      name: slugify(ctx.projectName),
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vue-tsc -b && vite build',
        preview: 'vite preview',
        lint: 'eslint .',
      },
      dependencies: {
        pinia: '^2.3.1',
        vue: '^3.5.13',
        'vue-router': '^4.5.0',
      },
      devDependencies: {
        '@vitejs/plugin-vue': '^5.2.1',
        autoprefixer: '^10.4.20',
        eslint: '^9.17.0',
        'eslint-plugin-vue': '^9.32.0',
        postcss: '^8.5.1',
        tailwindcss: '^3.4.17',
        typescript: '^5.7.3',
        'typescript-eslint': '^8.18.0',
        vite: '^6.0.7',
        'vue-tsc': '^2.2.0',
      },
    },
    null,
    2,
  ) + '\n'

  files['vite.config.ts'] = `import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
`

  files['tsconfig.json'] = `{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
`

  files['tsconfig.app.json'] = `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noImplicitAny": false,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue"]
}
`

  files['eslint.config.js'] = `import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...pluginVue.configs['flat/essential'],
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,vue}'],
    rules: {
      // 导出代码大量内联事件，允许 any / 隐式 any
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
)
`

  files['tsconfig.node.json'] = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["vite.config.ts"]
}
`

  files['index.html'] = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(ctx.projectName)}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`

  files['postcss.config.js'] = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`

  files['tailwind.config.js'] = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
`

  files['.gitignore'] = `node_modules
dist
.DS_Store
*.local
`

  files['src/main.ts'] = `import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
`

  files['src/App.vue'] = `<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

/** 与编辑器画布设计宽度一致，导出按此等比缩放 */
const DESIGN_WIDTH = 375

const vw = ref(DESIGN_WIDTH)
const vh = ref(667)

function syncViewport() {
  vw.value = window.innerWidth
  vh.value = window.innerHeight
}

onMounted(() => {
  syncViewport()
  window.addEventListener('resize', syncViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', syncViewport)
})

const scale = computed(() => vw.value / DESIGN_WIDTH)
/** 设计坐标系下一屏高度，缩放后视觉上正好铺满视口高度 */
const designScreenH = computed(() => vh.value / scale.value)
</script>

<template>
  <div class="voider-stage" :style="{ height: vh + 'px' }">
    <div
      class="voider-page"
      :style="{
        width: DESIGN_WIDTH + 'px',
        height: designScreenH + 'px',
        transform: \`scale(\${scale})\`,
        transformOrigin: 'top left',
      }"
    >
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.voider-stage {
  width: 100%;
  overflow: hidden;
  position: relative;
  background: #ededed;
}
.voider-page {
  position: relative;
}
</style>
`

  files['src/style.css'] = `@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
}
`

  files['src/env.d.ts'] = `/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, any>
  export default component
}

declare module '*.svg?raw' {
  const src: string
  export default src
}
`

  files['src/components/VoiderIcon.vue'] = `<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
    color?: string
  }>(),
  {
    size: 16,
    color: 'currentColor',
  },
)

const modules = import.meta.glob('../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const svg = computed(() => {
  const id = String(props.name || '').trim()
  if (!id) return ''
  return modules[\`../assets/icons/\${id}.svg\`] ?? ''
})

const box = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) && n > 0 ? n : 16
})
</script>

<template>
  <span
    class="voider-icon inline-flex items-center justify-center shrink-0"
    :style="{ width: box + 'px', height: box + 'px', color: color || 'currentColor' }"
    v-html="svg"
    aria-hidden="true"
  />
</template>

<style scoped>
.voider-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
`

  files['src/components/VoiderSwiper.vue'] = `<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    slideCount: number
    autoplay?: boolean
    interval?: number
    circular?: boolean
    indicator?: boolean
    indicatorColor?: string
    indicatorActiveColor?: string
    duration?: number
    current?: number
  }>(),
  {
    autoplay: false,
    interval: 3000,
    circular: true,
    indicator: true,
    indicatorColor: 'rgba(0,0,0,0.25)',
    indicatorActiveColor: '#409eff',
    duration: 280,
    current: 0,
  },
)

const index = ref(Math.max(0, props.current || 0))
const viewportRef = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragOffset = ref(0)
let startX = 0
let startY = 0
let startOffset = 0
let lockAxis: 'x' | 'y' | null = null
let timer: ReturnType<typeof setInterval> | null = null

const count = computed(() => Math.max(0, props.slideCount))
const clampedIndex = computed(() => {
  if (count.value <= 0) return 0
  return ((index.value % count.value) + count.value) % count.value
})

const trackStyle = computed(() => {
  const percent = count.value > 0 ? -clampedIndex.value * 100 : 0
  return {
    transform: \`translate3d(calc(\${percent}% + \${dragOffset.value}px), 0, 0)\`,
    transition: dragging.value ? 'none' : \`transform \${props.duration}ms ease\`,
  }
})

function clearTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function goTo(next: number) {
  if (count.value <= 0) return
  if (props.circular) {
    index.value = ((next % count.value) + count.value) % count.value
  } else {
    index.value = Math.max(0, Math.min(count.value - 1, next))
  }
}

function goNext() {
  if (count.value <= 0) return
  if (!props.circular && clampedIndex.value >= count.value - 1) {
    goTo(0)
    return
  }
  goTo(clampedIndex.value + 1)
}

function goPrev() {
  if (count.value <= 0) return
  if (!props.circular && clampedIndex.value <= 0) {
    goTo(count.value - 1)
    return
  }
  goTo(clampedIndex.value - 1)
}

function restartTimer() {
  clearTimer()
  if (!props.autoplay || count.value <= 1) return
  const ms = Math.max(800, props.interval || 3000)
  timer = setInterval(() => goNext(), ms)
}

function onPointerDown(event: PointerEvent) {
  if (count.value <= 1 || event.button !== 0) return
  const el = viewportRef.value
  if (!el) return
  dragging.value = true
  lockAxis = null
  startX = event.clientX
  startY = event.clientY
  startOffset = 0
  dragOffset.value = 0
  clearTimer()
  el.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const dx = event.clientX - startX
  const dy = event.clientY - startY
  if (!lockAxis) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    lockAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
    if (lockAxis === 'y') {
      dragging.value = false
      dragOffset.value = 0
      restartTimer()
      return
    }
  }
  if (lockAxis !== 'x') return
  event.preventDefault()
  const width = viewportRef.value?.clientWidth || 1
  let next = dx
  if (!props.circular) {
    if (clampedIndex.value === 0 && dx > 0) next = dx * 0.35
    if (clampedIndex.value === count.value - 1 && dx < 0) next = dx * 0.35
  }
  startOffset = next
  dragOffset.value = Math.max(-width * 0.95, Math.min(width * 0.95, next))
}

function onPointerUp(event: PointerEvent) {
  if (!dragging.value && lockAxis !== 'x') {
    restartTimer()
    return
  }
  const width = viewportRef.value?.clientWidth || 1
  const dx = startOffset
  dragging.value = false
  dragOffset.value = 0
  lockAxis = null
  try {
    viewportRef.value?.releasePointerCapture?.(event.pointerId)
  } catch {
    // ignore
  }
  if (Math.abs(dx) > width * 0.18) {
    if (dx < 0) goNext()
    else goPrev()
  }
  restartTimer()
}

watch(
  () => [props.autoplay, props.interval, props.slideCount, props.circular] as const,
  () => restartTimer(),
)
watch(
  () => props.current,
  (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) goTo(v)
  },
)

onMounted(() => restartTimer())
onBeforeUnmount(() => clearTimer())
</script>

<template>
  <div
    ref="viewportRef"
    class="voider-swiper"
    :class="{ dragging }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="voider-swiper-track" :style="trackStyle">
      <slot />
    </div>
    <div
      v-if="indicator && count > 1"
      class="voider-swiper-dots"
      aria-hidden="true"
    >
      <button
        v-for="i in count"
        :key="i - 1"
        type="button"
        class="dot"
        :class="{ active: clampedIndex === i - 1 }"
        :style="{
          background: clampedIndex === i - 1 ? indicatorActiveColor : indicatorColor,
        }"
        @click.stop="goTo(i - 1)"
      />
    </div>
  </div>
</template>

<style scoped>
.voider-swiper {
  /* 尺寸由外层 shell / class 决定，这里只做填满，避免盖掉 absolute / 固定宽高 */
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: pan-y;
  user-select: none;
  box-sizing: border-box;
}
.voider-swiper.dragging {
  cursor: grabbing;
}
.voider-swiper-track {
  display: flex;
  flex-direction: row;
  height: 100%;
  width: 100%;
  will-change: transform;
  box-sizing: border-box;
}
.voider-swiper-track > :deep(*) {
  position: relative;
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.voider-swiper-dots {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 8px;
  display: flex;
  justify-content: center;
  gap: 6px;
  z-index: 2;
  pointer-events: auto;
}
.dot {
  width: 6px;
  height: 6px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}
</style>
`

  const routeLines = ctx.pages.map((page) => {
    const view = pageIdToViewName(page.id)
    return `  {
    path: '/${page.id}',
    name: '${page.id}',
    component: () => import('../views/${view}.vue'),
  },`
  })

  files['src/router/index.ts'] = `import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/${entryPage}',
  },
${routeLines.join('\n')}
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
`

  files['src/runtime/voider.ts'] = RUNTIME_VOIDER_TS

  files['src/runtime/helpers.ts'] = `import { useRouter } from 'vue-router'

/** 简易 toast（可按需替换为 UI 库） */
export function showToast(message?: string) {
  alert(String(message ?? ''))
}

export interface MenuButtonBoundingClientRect {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
}

export interface DeviceInfo {
  statusBarHeight: number
  userAgent: string
  /** 微信小程序胶囊；H5 为 null */
  menuButton: MenuButtonBoundingClientRect | null
  platform: 'h5' | 'miniprogram'
}

function readUserAgent(): string {
  if (typeof navigator !== 'undefined' && navigator.userAgent) return navigator.userAgent
  return ''
}

function isWxMiniProgramRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as any
  if (w.__wxjs_environment === 'miniprogram') return true
  if (w.wx && typeof w.wx.getMenuButtonBoundingClientRect === 'function') return true
  const ua = readUserAgent()
  return /miniProgram/i.test(ua) || /MiniProgramEnv/i.test(ua)
}

function readWxStatusBarHeight(): number | null {
  const wx = (typeof window !== 'undefined' ? (window as any).wx : null) as any
  if (!wx) return null
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const n = Number(wx.getWindowInfo()?.statusBarHeight)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    // ignore
  }
  try {
    if (typeof wx.getSystemInfoSync === 'function') {
      const n = Number(wx.getSystemInfoSync()?.statusBarHeight)
      if (Number.isFinite(n) && n >= 0) return n
    }
  } catch {
    // ignore
  }
  return null
}

function readWxMenuButton(): MenuButtonBoundingClientRect | null {
  const wx = (typeof window !== 'undefined' ? (window as any).wx : null) as any
  if (!wx || typeof wx.getMenuButtonBoundingClientRect !== 'function') return null
  try {
    const rect = wx.getMenuButtonBoundingClientRect()
    if (!rect || typeof rect !== 'object') return null
    return {
      width: Number(rect.width) || 0,
      height: Number(rect.height) || 0,
      top: Number(rect.top) || 0,
      right: Number(rect.right) || 0,
      bottom: Number(rect.bottom) || 0,
      left: Number(rect.left) || 0,
    }
  } catch {
    return null
  }
}

function readH5StatusBarHeight(): number {
  if (typeof document === 'undefined') return 0
  try {
    const el = document.createElement('div')
    el.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);'
    document.body.appendChild(el)
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0
    document.body.removeChild(el)
    return pad > 0 ? Math.round(pad) : 0
  } catch {
    return 0
  }
}

/**
 * 获取设备信息：
 * - statusBarHeight
 * - userAgent
 * - menuButton（微信小程序胶囊；纯 H5 为 null）
 */
export function getDeviceInfo(): DeviceInfo {
  const ua = readUserAgent()
  if (isWxMiniProgramRuntime()) {
    return {
      statusBarHeight: readWxStatusBarHeight() ?? 0,
      userAgent: ua,
      menuButton: readWxMenuButton(),
      platform: 'miniprogram',
    }
  }
  return {
    statusBarHeight: readH5StatusBarHeight(),
    userAgent: ua,
    menuButton: null,
    platform: 'h5',
  }
}

/** 页面/组件内导航（须在 setup 中调用） */
export function useNavigation() {
  const router = useRouter()

  function navigateTo(to: string, params?: Record<string, any>) {
    router.push({
      path: '/' + String(to).replace(/^\\//, ''),
      query: (params ?? {}) as Record<string, string>,
    })
  }

  function navigateBack() {
    router.back()
  }

  return { router, navigateTo, navigateBack }
}
`

  files['README.md'] = `# ${ctx.projectName}

Exported from Voider as a Vue 3 + Vite + TypeScript + Tailwind CSS + Pinia + Vue Router project.

## Setup

\`\`\`bash
npm install
npm run dev
\`\`\`

Open the URL shown in the terminal (default http://localhost:5173).

## Project structure

- \`src/views/\` — page views (data pool as ref/computed in the page)
- \`src/components/\` — reusable components
- \`src/stores/\` — Pinia stores for component data pools
- \`src/runtime/helpers.ts\` — navigateTo / navigateBack / showToast / getDeviceInfo
- \`src/runtime/voider.ts\` — visibility & interpolate helpers
`

  return files
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'voider-export'
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const RUNTIME_VOIDER_TS = `import type { Router } from 'vue-router'
import { getDeviceInfo } from './helpers'

export interface EventScope {
  item?: any
  index?: number
}

export interface VoiderStoreLike {
  $state: Record<string, any>
  setData: (prop: string, value: any) => void
}

export interface EventContext {
  store: VoiderStoreLike
  router: Router
  route: Record<string, any>
  modalVisible: Record<string, boolean>
  scope?: EventScope
  props?: Record<string, any>
  eventArgs?: Record<string, any>
  componentRefs?: Record<string, { open?: () => void; hide?: () => void; show?: () => void }>
  emit?: (event: string, payload?: Record<string, any>) => void
  showToast?: (message: string) => void
}

export interface VisibilityConfig {
  scenarios?: Array<{
    conditions?: Array<{ field: string; op: string; value: string }>
  }>
}

function getByPath(source: any, path: string): any {
  if (!path) return source
  const parts = path.split('.')
  let current: any = source
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, any>)[part]
  }
  return current
}

function formatValue(value: any): string {
  if (value == null) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Interpolate {name}, {item.x}, {$props.x}, {$route.x}, {index} */
export function interpolate(
  template: string,
  ctx: {
    store?: VoiderStoreLike
    scope?: EventScope
    props?: Record<string, any>
    route?: Record<string, any>
  },
): string {
  if (!template || !template.includes('{')) return template
  return template.replace(/\\{([^{}]+)\\}/g, (match, rawExpr: string) => {
    const expr = rawExpr.trim()
    if (!expr) return match
    if (expr === 'index') return String(ctx.scope?.index ?? 0)
    if (expr === 'item') return formatValue(ctx.scope?.item)
    if (expr.startsWith('item.')) {
      const value = getByPath(ctx.scope?.item, expr.slice(5))
      return value == null ? '' : formatValue(value)
    }
    if (expr === '$props' || expr === 'props') return formatValue(ctx.props)
    if (expr.startsWith('$props.') || expr.startsWith('props.')) {
      const path = expr.replace(/^\\$?props\\./, '')
      const value = getByPath(ctx.props, path)
      return value == null ? '' : formatValue(value)
    }
    if (expr === '$route' || expr === 'route') return formatValue(ctx.route)
    if (expr.startsWith('$route.') || expr.startsWith('route.')) {
      const path = expr.replace(/^\\$?route\\./, '')
      const value = getByPath(ctx.route, path)
      return value == null ? '' : formatValue(value)
    }
    if (ctx.store && expr in ctx.store.$state) {
      return formatValue(ctx.store.$state[expr])
    }
    const nested = getByPath(ctx.store?.$state, expr)
    if (nested !== undefined) return formatValue(nested)
    return match
  })
}

function resolveConditionValue(
  path: string,
  ctx: {
    store?: VoiderStoreLike
    scope?: EventScope
    props?: Record<string, any>
    route?: Record<string, any>
  },
): any {
  const raw = path.trim()
  if (!raw) return undefined
  if (raw === 'index') return ctx.scope?.index
  if (raw === 'item') return ctx.scope?.item
  if (raw.startsWith('item.')) return getByPath(ctx.scope?.item, raw.slice(5))
  if (raw.startsWith('$props.')) return getByPath(ctx.props, raw.slice(7))
  if (raw.startsWith('$route.')) return getByPath(ctx.route, raw.slice(7))
  if (ctx.store && raw in ctx.store.$state) return ctx.store.$state[raw]
  return getByPath(ctx.store?.$state, raw)
}

function compareValues(op: string, left: any, right: string): boolean {
  switch (op) {
    case 'empty':
      return left == null || left === '' || (Array.isArray(left) && left.length === 0)
    case 'notEmpty':
      return !(left == null || left === '' || (Array.isArray(left) && left.length === 0))
    case 'contains':
      return String(left ?? '').includes(right)
    case 'eq':
      return String(left ?? '') === String(right)
    case 'neq':
      return String(left ?? '') !== String(right)
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    default:
      return false
  }
}

function evaluateScenarios(
  scenarios: VisibilityConfig['scenarios'],
  ctx: Parameters<typeof resolveConditionValue>[1],
): boolean {
  const active = (scenarios ?? []).filter((s) => (s.conditions ?? []).some((c) => c.field?.trim()))
  if (!active.length) return true
  return active.some((scene) =>
    (scene.conditions ?? [])
      .filter((c) => c.field?.trim())
      .every((cond) => compareValues(cond.op, resolveConditionValue(cond.field, ctx), cond.value ?? '')),
  )
}

export function evalVShow(raw: string | undefined, ctx: Parameters<typeof resolveConditionValue>[1]): boolean {
  if (!raw?.trim()) return true
  try {
    const parsed = JSON.parse(raw) as VisibilityConfig
    return evaluateScenarios(parsed.scenarios, ctx)
  } catch {
    return true
  }
}

export function evalVIf(raw: string | undefined, ctx: Parameters<typeof resolveConditionValue>[1]): boolean {
  return evalVShow(raw, ctx)
}

interface EventBinding {
  id?: string
  method: string
  args?: Record<string, string>
  body?: string
}

function parseBindings(raw: string | undefined): EventBinding[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as any
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item) => item as EventBinding)
      .filter((item) => item.method)
  } catch {
    return []
  }
}

function parseParamsObject(raw: string): Record<string, any> | undefined {
  if (!raw.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as any
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, any>
    }
  } catch {
    // ignore
  }
  return undefined
}

function resolveArgs(
  args: Record<string, string> | undefined,
  ctx: EventContext,
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(args ?? {})) {
    let resolved = interpolate(value, {
      store: ctx.store,
      scope: ctx.scope,
      props: ctx.props,
      route: ctx.route,
    })
    if (resolved.includes('{') && ctx.eventArgs) {
      resolved = resolved.replace(/\\{([^{}]+)\\}/g, (match, rawExpr: string) => {
        const expr = rawExpr.trim()
        if (!expr) return match
        if (Object.prototype.hasOwnProperty.call(ctx.eventArgs!, expr)) {
          return formatValue(ctx.eventArgs![expr])
        }
        const nested = getByPath(ctx.eventArgs, expr)
        return nested === undefined ? match : formatValue(nested)
      })
    }
    next[key] = resolved
  }
  return next
}

export async function runEventBindings(
  raw: string | undefined,
  ctx: EventContext,
): Promise<void> {
  const bindings = parseBindings(raw)
  for (const binding of bindings) {
    if (binding.method === '__custom__') {
      const body = binding.body?.trim()
      if (!body) continue
      try {
        const scope: Record<string, any> = {
          ...ctx.store.$state,
          item: ctx.scope?.item,
          index: ctx.scope?.index ?? 0,
          $props: ctx.props ?? {},
          navigateTo: (to: string, params?: Record<string, any>) => {
            const path = '/' + String(to).replace(/^\\//, '')
            ctx.router.push({ path, query: params as Record<string, string> })
          },
          navigateBack: () => ctx.router.back(),
          setData: (prop: string, value: any) => ctx.store.setData(prop, value),
          showToast: (msg?: string) => ctx.showToast?.(String(msg ?? '')),
          getDeviceInfo,
          emit: ctx.emit,
        }
        for (const [name, ref] of Object.entries(ctx.componentRefs ?? {})) {
          scope[name] = ref
        }
        const fn = new Function(...Object.keys(scope), body)
        fn(...Object.values(scope))
      } catch (err) {
        console.warn('[voider] custom event failed', err)
      }
      continue
    }

    const args = resolveArgs(binding.args, ctx)
    if (binding.method === 'navigateTo') {
      const to = (args.to ?? '').trim()
      if (!to) continue
      const params = parseParamsObject(args.params ?? '')
      ctx.router.push({ path: '/' + to.replace(/^\\//, ''), query: params as Record<string, string> })
      continue
    }
    if (binding.method === 'navigateBack') {
      ctx.router.back()
      continue
    }
    if (binding.method === 'setData') {
      const prop = (args.prop ?? '').trim()
      if (!prop) continue
      let value: any = args.value ?? ''
      try {
        value = JSON.parse(args.value ?? '')
      } catch {
        // keep string
      }
      ctx.store.setData(prop, value)
      continue
    }
    if (binding.method === 'showToast') {
      ctx.showToast?.(args.message ?? '')
      continue
    }
    if (binding.method === 'emit') {
      const eventName = (args.event ?? '').trim()
      if (!eventName) continue
      const payload: Record<string, any> = {}
      for (const [key, value] of Object.entries(args)) {
        if (key === 'event') continue
        payload[key] = value
      }
      ctx.emit?.(eventName, payload)
      continue
    }
    console.warn('[voider] unknown event method:', binding.method)
  }
}
`
