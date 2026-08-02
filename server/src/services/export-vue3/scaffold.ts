import type { LubanProjectConfig } from '../../types/luban-project.js'
import type { ColorPalette } from '../../types/color-palette.js'
import { buildPaletteCssVars } from '../../types/color-palette.js'
import { pageIdToViewName } from './naming.js'

export interface ScaffoldContext {
  projectName: string
  config: LubanProjectConfig
  pages: Array<{ id: string; title: string }>
  componentIds: string[]
  colorPalette?: ColorPalette
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
  <div class="app-stage" :style="{ height: vh + 'px' }">
    <div
      class="app-page"
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
.app-stage {
  width: 100%;
  overflow: hidden;
  position: relative;
  background: #ededed;
}
.app-page {
  position: relative;
  overflow: hidden;
}
</style>
`

  files['src/style.css'] = `@tailwind base;
@tailwind components;
@tailwind utilities;
${ctx.colorPalette?.colors.length ? `\n${buildPaletteCssVars(ctx.colorPalette)}` : ''}
html, body, #app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  font-size: 14px;
}

.app-toast {
  position: absolute;
  left: 50%;
  bottom: 72px;
  z-index: 1000;
  transform: translateX(-50%) translateY(8px);
  max-width: calc(100% - 48px);
  padding: 10px 16px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.86);
  color: #fff;
  font-size: 14px;
  line-height: 1.4;
  text-align: center;
  word-break: break-word;
  pointer-events: none;
  opacity: 0;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.app-toast.is-visible {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
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

  files['src/components/AppIcon.vue'] = `<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ICON_PRIVATE_BINDINGS,
  ICON_REMOTE_URLS,
  type IconRemoteBinding,
} from '../assets/icon-remotes'

const SIGN_EXPIRES_IN = 7 * 24 * 3600
const CACHE_SKEW_MS = 60 * 60 * 1000

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

const remoteSvg = ref('')
let fetchToken = 0

const localSvg = computed(() => {
  const id = String(props.name || '').trim()
  if (!id) return ''
  return modules[\`../assets/icons/\${id}.svg\`] ?? ''
})

const publicUrl = computed(() => {
  const id = String(props.name || '').trim()
  if (!id) return ''
  return ICON_REMOTE_URLS[id] ?? ''
})

const privateBinding = computed((): IconRemoteBinding | null => {
  const id = String(props.name || '').trim()
  if (!id) return null
  return ICON_PRIVATE_BINDINGS[id] ?? null
})

const svg = computed(() =>
  publicUrl.value || privateBinding.value ? remoteSvg.value : localSvg.value,
)

function storageKey(iconId: string, objectKey: string) {
  return \`icon_url_\${iconId}_\${objectKey || ''}\`
}

function readCachedUrl(iconId: string, objectKey: string): string {
  try {
    const raw = localStorage.getItem(storageKey(iconId, objectKey))
    if (!raw) return ''
    const data = JSON.parse(raw) as { url?: string; expiresAt?: number }
    if (!data?.url) return ''
    const expiresAt = Number(data.expiresAt) || 0
    if (expiresAt && expiresAt <= Date.now() + CACHE_SKEW_MS) return ''
    return data.url
  } catch {
    return ''
  }
}

function writeCachedUrl(
  iconId: string,
  objectKey: string,
  url: string,
  expiresInSec = SIGN_EXPIRES_IN,
) {
  try {
    const ttl =
      Number.isFinite(expiresInSec) && expiresInSec > 0
        ? expiresInSec
        : SIGN_EXPIRES_IN
    localStorage.setItem(
      storageKey(iconId, objectKey),
      JSON.stringify({
        url,
        expiresAt: Date.now() + ttl * 1000,
        objectKey,
      }),
    )
  } catch {
    // quota / private mode
  }
}

function clearCachedUrl(iconId: string, objectKey: string) {
  try {
    localStorage.removeItem(storageKey(iconId, objectKey))
  } catch {
    // ignore
  }
}

function parseApiBaseUrls(): Record<string, string> {
  const raw = String(import.meta.env.VITE_API_BASE_URLS || '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) out[k] = v.trim().replace(/\\/+$/, '')
        }
        return out
      }
    } catch {
      // ignore
    }
  }
  const legacy = String(import.meta.env.VITE_API_BASE || '').trim()
  return legacy ? { default: legacy.replace(/\\/+$/, '') } : {}
}

async function signPrivate(
  binding: IconRemoteBinding,
): Promise<{ url: string; expiresIn: number }> {
  const map = parseApiBaseUrls()
  const base = (
    map.oss ||
    map.default ||
    Object.values(map).find((v) => typeof v === 'string' && v.trim()) ||
    String(import.meta.env.VITE_API_BASE || '')
  ).replace(/\\/+$/, '')
  if (!base) {
    throw new Error('VITE_API_BASE_URLS / VITE_API_BASE missing')
  }
  const res = await fetch(\`\${base}/oss/sign\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connectionId: binding.connectionId,
      bucketName: binding.bucketName,
      key: binding.objectKey,
      expiresIn: SIGN_EXPIRES_IN,
    }),
  })
  const body = (await res.json().catch(() => null)) as {
    code?: number
    data?: { signedUrl?: string; url?: string; expiresIn?: number }
    signedUrl?: string
    url?: string
    expiresIn?: number
    message?: string
  } | null
  const signed =
    body?.data?.signedUrl ||
    body?.data?.url ||
    body?.signedUrl ||
    body?.url ||
    ''
  const expiresIn = Number(body?.data?.expiresIn ?? body?.expiresIn) || SIGN_EXPIRES_IN
  if (!res.ok || !signed) {
    throw new Error(
      (body?.code !== 0 && body?.message) ||
        (!signed ? '签名响应缺少 url' : '') ||
        \`sign HTTP \${res.status}\`,
    )
  }
  return { url: signed, expiresIn }
}

async function resolveRemoteUrl(
  iconId: string,
  url: string,
  binding: IconRemoteBinding | null,
): Promise<string> {
  if (url) {
    const cached = readCachedUrl(iconId, 'public')
    if (cached) return cached
    writeCachedUrl(iconId, 'public', url, SIGN_EXPIRES_IN)
    return url
  }
  if (!binding) return ''
  const objectKey = binding.objectKey || ''
  const cached = readCachedUrl(iconId, objectKey)
  if (cached) return cached
  const signed = await signPrivate(binding)
  writeCachedUrl(iconId, objectKey, signed.url, signed.expiresIn)
  return signed.url
}

watch(
  [publicUrl, privateBinding, () => props.name],
  async ([url, binding]) => {
    const token = ++fetchToken
    const iconId = String(props.name || '').trim()
    remoteSvg.value = ''
    if (!iconId || (!url && !binding)) return
    try {
      let fetchUrl = await resolveRemoteUrl(iconId, url, binding)
      let res = await fetch(fetchUrl)
      if (!res.ok && binding) {
        clearCachedUrl(iconId, binding.objectKey || '')
        const signed = await signPrivate(binding)
        writeCachedUrl(iconId, binding.objectKey || '', signed.url, signed.expiresIn)
        fetchUrl = signed.url
        res = await fetch(fetchUrl)
      }
      if (!res.ok) return
      const text = await res.text()
      if (token !== fetchToken) return
      remoteSvg.value = text
    } catch {
      if (token !== fetchToken) return
      remoteSvg.value = ''
    }
  },
  { immediate: true },
)

const box = computed(() => {
  const n = Number(props.size)
  return Number.isFinite(n) && n > 0 ? n : 16
})
</script>

<template>
  <span
    class="app-icon inline-flex items-center justify-center shrink-0"
    :style="{ width: box + 'px', height: box + 'px', color: color || 'currentColor' }"
    v-html="svg"
    aria-hidden="true"
  />
</template>

<style scoped>
.app-icon :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
`

  files['src/components/AppSwiper.vue'] = `<script setup lang="ts">
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
let pointerCaptured = false

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
  pointerCaptured = false
  startX = event.clientX
  startY = event.clientY
  startOffset = 0
  dragOffset.value = 0
  clearTimer()
  // 勿在此处 capture：否则 click 会落到 viewport，子控件 onClick 失效
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
    try {
      viewportRef.value?.setPointerCapture?.(event.pointerId)
      pointerCaptured = true
    } catch {
      // ignore
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
  const wasSwipe = lockAxis === 'x' && Math.abs(dx) > width * 0.18
  lockAxis = null
  if (pointerCaptured) {
    try {
      viewportRef.value?.releasePointerCapture?.(event.pointerId)
    } catch {
      // ignore
    }
    pointerCaptured = false
  }
  if (wasSwipe) {
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
    class="app-swiper"
    :class="{ dragging }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <div class="app-swiper-track" :style="trackStyle">
      <slot />
    </div>
    <div
      v-if="indicator && count > 1"
      class="app-swiper-dots"
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
.app-swiper {
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
.app-swiper.dragging {
  cursor: grabbing;
}
.app-swiper-track {
  display: flex;
  flex-direction: row;
  height: 100%;
  width: 100%;
  will-change: transform;
  box-sizing: border-box;
}
.app-swiper-track > :deep(*) {
  position: relative;
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}
.app-swiper-dots {
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

  files['src/runtime/app.ts'] = RUNTIME_APP_TS

  files['src/runtime/helpers.ts'] = `import { useRouter } from 'vue-router'

let toastTimer: ReturnType<typeof setTimeout> | null = null
let toastEl: HTMLDivElement | null = null

function ensureToastHost(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('showToast requires DOM')
  }
  const page = document.querySelector('.app-page') as HTMLElement | null
  return page ?? document.body
}

/** 页面内 Toast（对齐编辑器预览；挂在 .app-page 上随设计稿缩放） */
export function showToast(message?: string, duration: 'short' | 'long' = 'short') {
  if (typeof document === 'undefined') return
  const text = String(message ?? '').trim() || ' '
  const host = ensureToastHost()
  if (getComputedStyle(host).position === 'static') {
    host.style.position = 'relative'
  }
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'app-toast'
    toastEl.setAttribute('role', 'status')
  }
  toastEl.textContent = text
  if (toastEl.parentElement !== host) {
    host.appendChild(toastEl)
  }
  // 触发重排以便重复弹出时重新播放过渡
  toastEl.classList.remove('is-visible')
  void toastEl.offsetWidth
  toastEl.classList.add('is-visible')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(
    () => {
      toastEl?.classList.remove('is-visible')
      toastTimer = null
    },
    duration === 'long' ? 4500 : 2000,
  )
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

export type ApiBinding = {
  serviceId?: string
  serviceName?: string
  controllerId?: string
  apiId?: string
  method?: string
  path?: string
}

function parseApiBaseUrls(): Record<string, string> {
  const raw = String(import.meta.env.VITE_API_BASE_URLS || '').trim()
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {}
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) out[k] = v.trim().replace(/\\/+$/, '')
        }
        return out
      }
    } catch {
      // ignore
    }
  }
  const legacy = String(import.meta.env.VITE_API_BASE || '').trim()
  return legacy ? { default: legacy.replace(/\\/+$/, '') } : {}
}

export function resolveApiBase(serviceId?: string, serviceName?: string): string {
  const map = parseApiBaseUrls()
  const keys = [serviceName, serviceId, 'default', 'oss']
  for (const key of keys) {
    const k = key?.trim()
    if (!k) continue
    const v = map[k]
    if (typeof v === 'string' && v.trim()) return v.replace(/\\/+$/, '')
  }
  const first = Object.values(map).find((v) => typeof v === 'string' && v.trim())
  return first ? first.replace(/\\/+$/, '') : ''
}

function unwrapResult(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const row = data as Record<string, unknown>
  if (!('data' in row)) return data
  const keys = Object.keys(row)
  const looksLikeResult =
    'code' in row || 'message' in row || 'msg' in row || keys.length <= 4
  return looksLikeResult ? row.data : data
}

/** 按 binding.serviceName 从 apiBaseUrls 字典取根地址并发请求 */
export async function invoke(
  binding: ApiBinding | null | undefined,
  args?: Record<string, unknown>,
): Promise<any> {
  if (!binding || typeof binding !== 'object') {
    throw new Error('API binding missing')
  }
  const path = typeof binding.path === 'string' ? binding.path.trim() : ''
  if (!path) {
    throw new Error(
      \`API missing path (serviceId=\${binding.serviceId || ''}, apiId=\${binding.apiId || ''})\`,
    )
  }
  const base = resolveApiBase(binding.serviceId, binding.serviceName)
  if (!base) {
    throw new Error(
      \`API baseUrl missing for serviceId=\${binding.serviceId || ''}（请在 .env.local 配置 VITE_API_BASE_URLS）\`,
    )
  }
  const url = /^https?:\\/\\//i.test(path)
    ? path
    : base + (path.startsWith('/') ? path : '/' + path)
  const method = String(binding.method || 'GET').toUpperCase()
  const payload = args && typeof args === 'object' ? args : {}
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  let finalUrl = url
  if (method === 'GET' || method === 'DELETE') {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(payload)) {
      if (v == null) continue
      q.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
    }
    const qs = q.toString()
    if (qs) finalUrl += (finalUrl.includes('?') ? '&' : '?') + qs
  } else {
    init.body = JSON.stringify(payload)
  }
  const res = await fetch(finalUrl, init)
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const msg =
      (body && typeof body === 'object' && ((body as any).message || (body as any).msg)) ||
      \`request failed \${res.status}\`
    throw new Error(String(msg))
  }
  return unwrapResult(body)
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

Vue 3 + Vite + TypeScript + Tailwind CSS + Pinia + Vue Router（由设计器导出）。

## Setup

\`\`\`bash
npm install
npm run dev
\`\`\`

Open the URL shown in the terminal (default http://localhost:5173).

API / OSS 签名根地址见 \`.env.local\` 中 \`VITE_API_BASE_URLS\`（字典，按 serviceName / default；默认直连 Nest \`http://127.0.0.1:3030\`）。

## Project structure

- \`src/views/\` — page views
- \`src/components/\` — reusable components（含 AppIcon / AppSwiper）
- \`src/stores/\` — Pinia stores
- \`src/runtime/helpers.ts\` — navigateTo / navigateBack / showToast / getDeviceInfo / invoke
- \`src/runtime/app.ts\` — visibility & interpolate helpers
`

  return files
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || "app-export"
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const RUNTIME_APP_TS = `import type { Router } from 'vue-router'
import { getDeviceInfo, showToast as defaultShowToast } from './helpers'

export interface EventScope {
  item?: any
  index?: number
}

export interface AppStoreLike {
  $state: Record<string, any>
  setData: (prop: string, value: any) => void
}

export interface EventContext {
  store: AppStoreLike
  router: Router
  route: Record<string, any>
  modalVisible: Record<string, boolean>
  scope?: EventScope
  props?: Record<string, any>
  eventArgs?: Record<string, any>
  componentRefs?: Record<string, { open?: () => void; hide?: () => void; show?: () => void }>
  emit?: (event: string, payload?: Record<string, any>) => void
  showToast?: (message: string, duration?: 'short' | 'long') => void
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

function isSimpleBindingPath(expr: string): boolean {
  return /^[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*|\\[\\d+\\])*$/.test(expr.trim())
}

function normalizeBindingOperators(expr: string): string {
  let out = ''
  let inSingle = false
  let inDouble = false
  let inTick = false
  let escape = false
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!
    if (escape) { out += c; escape = false; continue }
    if ((inSingle || inDouble || inTick) && c === '\\\\') { out += c; escape = true; continue }
    if (inSingle) { if (c === "'") inSingle = false; out += c; continue }
    if (inDouble) { if (c === '"') inDouble = false; out += c; continue }
    if (inTick) { if (c === '\`') inTick = false; out += c; continue }
    if (c === "'") { inSingle = true; out += c; continue }
    if (c === '"') { inDouble = true; out += c; continue }
    if (c === '\`') { inTick = true; out += c; continue }
    if (c === '？') { out += '?'; continue }
    if (c === '：') { out += ':'; continue }
    out += c
  }
  return out
}

function findBalancedBindingEnd(template: string, openIndex: number): number {
  if (template[openIndex] !== '{') return -1
  let depth = 0
  let inSingle = false
  let inDouble = false
  let inTick = false
  let escape = false
  for (let j = openIndex; j < template.length; j++) {
    const c = template[j]!
    if (escape) { escape = false; continue }
    if ((inSingle || inDouble || inTick) && c === '\\\\') { escape = true; continue }
    if (inSingle) { if (c === "'") inSingle = false; continue }
    if (inDouble) { if (c === '"') inDouble = false; continue }
    if (inTick) { if (c === '\`') inTick = false; continue }
    if (c === "'") { inSingle = true; continue }
    if (c === '"') { inDouble = true; continue }
    if (c === '\`') { inTick = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return j
    }
  }
  return -1
}

function scanBindingSpans(template: string): Array<{ start: number; end: number; expr: string }> {
  const spans: Array<{ start: number; end: number; expr: string }> = []
  let i = 0
  while (i < template.length) {
    if (template[i] !== '{') { i++; continue }
    let start = i
    let doubleWrap = false
    if (template[i + 1] === '{') { doubleWrap = true; start = i + 1 }
    const end = findBalancedBindingEnd(template, start)
    if (end < 0) { i++; continue }
    let close = end
    if (doubleWrap) {
      if (template[end + 1] !== '}') { i++; continue }
      close = end + 1
    }
    spans.push({
      start: doubleWrap ? i : start,
      end: close + 1,
      expr: template.slice(start + 1, end).trim(),
    })
    i = close + 1
  }
  return spans
}

function evaluateBindingExpression(
  expr: string,
  scope: Record<string, any>,
): { ok: true; value: any } | { ok: false } {
  const normalized = normalizeBindingOperators(expr.trim())
  if (!normalized) return { ok: false }
  try {
    const names = Object.keys(scope).filter((n) => /^[A-Za-z_$][\\w$]*$/.test(n))
    const values = names.map((n) => scope[n])
    const fn = new Function(...names, '"use strict"; return (' + normalized + ');')
    return { ok: true, value: fn(...values) }
  } catch {
    return { ok: false }
  }
}

/** Interpolate {name}, {item.x}, {$props.x}, 以及三元/模板字符串等表达式 */
export function interpolate(
  template: string,
  ctx: {
    store?: AppStoreLike
    scope?: EventScope
    props?: Record<string, any>
    route?: Record<string, any>
  },
): string {
  if (!template || !template.includes('{')) return template
  const spans = scanBindingSpans(template)
  if (!spans.length) return template

  const evalScope: Record<string, any> = {
    ...(ctx.store?.$state ?? {}),
  }
  if (ctx.scope?.item !== undefined) evalScope.item = ctx.scope.item
  if (ctx.scope?.index !== undefined) evalScope.index = ctx.scope.index
  if (ctx.props !== undefined) {
    evalScope.$props = ctx.props
    evalScope.props = ctx.props
  }
  if (ctx.route !== undefined) {
    evalScope.$route = ctx.route
    evalScope.route = ctx.route
    evalScope.$query = ctx.route
    evalScope.query = ctx.route
  }

  let out = ''
  let cursor = 0
  for (const span of spans) {
    out += template.slice(cursor, span.start)
    cursor = span.end
    const expr = span.expr
    if (!expr) {
      out += template.slice(span.start, span.end)
      continue
    }

    if (isSimpleBindingPath(expr)) {
      if (expr === 'index') {
        out += String(ctx.scope?.index ?? 0)
        continue
      }
      if (expr === 'item') {
        out += formatValue(ctx.scope?.item)
        continue
      }
      if (expr.startsWith('item.')) {
        const value = getByPath(ctx.scope?.item, expr.slice(5))
        out += value == null ? '' : formatValue(value)
        continue
      }
      if (expr === '$props' || expr === 'props') {
        out += formatValue(ctx.props)
        continue
      }
      if (expr.startsWith('$props.') || expr.startsWith('props.')) {
        const path = expr.replace(/^\\$?props\\./, '')
        const value = getByPath(ctx.props, path)
        out += value == null ? '' : formatValue(value)
        continue
      }
      if (expr === '$route' || expr === 'route' || expr === '$query' || expr === 'query') {
        out += formatValue(ctx.route)
        continue
      }
      if (
        expr.startsWith('$route.') ||
        expr.startsWith('route.') ||
        expr.startsWith('$query.') ||
        expr.startsWith('query.')
      ) {
        const path = expr.replace(/^\\$?(?:route|query)\\./, '')
        const value = getByPath(ctx.route, path)
        out += value == null ? '' : formatValue(value)
        continue
      }
      if (ctx.store && expr in ctx.store.$state) {
        out += formatValue(ctx.store.$state[expr])
        continue
      }
      const nested = getByPath(ctx.store?.$state, expr)
      if (nested !== undefined) {
        out += formatValue(nested)
        continue
      }
      out += template.slice(span.start, span.end)
      continue
    }

    const evaluated = evaluateBindingExpression(expr, evalScope)
    if (!evaluated.ok) {
      out += template.slice(span.start, span.end)
      continue
    }
    out += formatValue(evaluated.value)
  }
  out += template.slice(cursor)
  return out
}

function resolveConditionValue(
  path: string,
  ctx: {
    store?: AppStoreLike
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
  if (raw.startsWith('$query.')) return getByPath(ctx.route, raw.slice(7))
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
          updateProps: (prop: string, value: any) => {
            const name = String(prop ?? '').trim()
            if (!name) return
            if (ctx.props && typeof ctx.props === 'object') {
              ;(ctx.props as Record<string, any>)[name] = value
            }
            ctx.emit?.(\`update:\${name}\`, value)
          },
          showToast: (msg?: string, duration?: string) => {
            const d = duration === 'long' ? 'long' : 'short'
            if (ctx.showToast) ctx.showToast(String(msg ?? ''), d)
            else defaultShowToast(String(msg ?? ''), d)
          },
          getDeviceInfo,
          emit: ctx.emit,
        }
        for (const [name, ref] of Object.entries(ctx.componentRefs ?? {})) {
          scope[name] = ref
        }
        const fn = new Function(...Object.keys(scope), body)
        fn(...Object.values(scope))
      } catch (err) {
        console.warn('[app] custom event failed', err)
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
      const d = args.duration === 'long' ? 'long' : 'short'
      if (ctx.showToast) ctx.showToast(args.message ?? '', d)
      else defaultShowToast(args.message ?? '', d)
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
    if (binding.method === 'updateProps') {
      const prop = (args.prop ?? '').trim()
      if (!prop) continue
      let value: any = args.value ?? ''
      try {
        value = JSON.parse(args.value ?? '')
      } catch {
        // keep string
      }
      if (ctx.props && typeof ctx.props === 'object') {
        ;(ctx.props as Record<string, any>)[prop] = value
      }
      ctx.emit?.(\`update:\${prop}\`, value)
      continue
    }
    console.warn('[app] unknown event method:', binding.method)
  }
}
`
