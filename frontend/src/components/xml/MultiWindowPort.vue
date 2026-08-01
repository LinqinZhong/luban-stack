<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { Plus } from '@element-plus/icons-vue'
import type { OverflowStrategy } from '../../utils/xml'

const props = withDefaults(
  defineProps<{
    /** 编辑态：横向平铺全部窗口；预览态：仅展示激活项匹配的窗口 */
    editable?: boolean
    /** 是否显示「新建窗口」并允许点选切换焦点（组件实例内为 false） */
    allowManage?: boolean
    /** 预览态溢出策略（默认 visible）；编辑态忽略，始终可溢出 */
    overflow?: OverflowStrategy
    /** 激活项（已解析的数据池值或字面量） */
    activeValue?: string | number | null
    /** 编辑态当前聚焦的窗口下标 */
    focusIndex?: number
    windows: Array<{ key: string; index: number }>
  }>(),
  {
    editable: false,
    allowManage: true,
    overflow: 'visible',
    activeValue: '',
    focusIndex: 0,
  },
)

const emit = defineEmits<{
  'add-window': []
  'select-window': [index: number]
}>()

const viewportRef = ref<HTMLElement | null>(null)
const paneWidthPx = ref(0)
/** 编辑态锁定屏幕宽（每一页内容区宽） */
const lockedEditPaneW = ref(0)
/**
 * 深度优先：本页右侧需让出的宽度（嵌套 Swiper 第 2+ 窗、嵌套多窗体等），
 * 用 margin-right 占位，形成：
 * 【第一页【Swiper1】】【Swiper2】【Swiper3】【第二页】【第三页】
 */
const dfsExtraByIndex = ref<Record<number, number>>({})
const paneElByIndex = new Map<number, HTMLElement>()

let resizeObserver: ResizeObserver | null = null
let measureRaf = 0

const EDIT_GAP_PX = 10

const activeKey = computed(() => {
  const v = props.activeValue
  if (v == null) return ''
  return String(v)
})

const previewIndex = computed(() => {
  const key = activeKey.value
  if (!key) return -1
  return props.windows.findIndex((w) => w.key === key)
})

const editIndex = computed(() => {
  if (!props.windows.length) return -1
  const fi = props.focusIndex ?? 0
  if (fi >= 0 && fi < props.windows.length) return fi
  return 0
})

function isPreviewVisible(index: number, key: string): boolean {
  if (!key) return false
  return index === previewIndex.value
}

function paneStyle(index: number): Record<string, string> | undefined {
  if (!props.editable) return undefined
  const w = paneWidthPx.value
  if (!(w > 0)) return undefined
  const extra = dfsExtraByIndex.value[index] ?? 0
  const style: Record<string, string> = {
    width: `${w}px`,
    flex: `0 0 ${w}px`,
    minWidth: `${w}px`,
    maxWidth: `${w}px`,
  }
  // 让出内层平铺占用的横向空间，后续页不会叠上来
  if (extra > 0) style.marginRight = `${extra}px`
  return style
}

const viewportStyle = computed(() => {
  const style: Record<string, string> = {}
  if (props.editable && paneWidthPx.value) {
    style['--pane-w'] = `${paneWidthPx.value}px`
  }
  if (!props.editable) {
    style.overflow = props.overflow === 'hidden' ? 'hidden' : 'visible'
  }
  return Object.keys(style).length ? style : undefined
})

const trackStyle = computed(() => {
  if (!props.editable) return undefined
  return {
    display: 'flex',
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
    height: '100%',
    width: 'max-content',
    maxWidth: 'none',
    gap: `${EDIT_GAP_PX}px`,
    boxSizing: 'border-box' as const,
  }
})

function setPaneRef(index: number, el: Element | null) {
  if (el instanceof HTMLElement) paneElByIndex.set(index, el)
  else paneElByIndex.delete(index)
}

/**
 * 深度优先：量本页内嵌套平铺超出「第一屏」的宽度。
 * - Swiper：track 总宽 − 单窗宽（第 2、3… 窗）
 * - 嵌套 MultiWindow：其子 track 总宽 − 单页宽
 */
function measureDfsExtra(pane: HTMLElement, baseW: number): number {
  if (!(baseW > 0)) return 0
  let extra = 0

  pane.querySelectorAll('.swiper-viewport.editable').forEach((node) => {
    const vp = node as HTMLElement
    const track = vp.querySelector('.swiper-track') as HTMLElement | null
    if (!track) return
    const trackW = track.scrollWidth
    // 窗口宽 = Swiper 宿主布局宽，与 slide 锁定宽一致
    const hostW = Math.round(vp.parentElement?.clientWidth || 0)
    const slide = vp.querySelector('.swiper-slide.editable') as HTMLElement | null
    const winW = hostW || Math.round(slide?.offsetWidth || baseW)
    if (trackW > winW) extra = Math.max(extra, trackW - winW)
  })

  const selfPort = viewportRef.value
  pane.querySelectorAll('.multi-window-port.is-edit').forEach((node) => {
    const port = node as HTMLElement
    if (port === selfPort) return
    if (!pane.contains(port)) return
    const track = port.querySelector(
      ':scope > .multi-window-track',
    ) as HTMLElement | null
    if (!track) return
    const trackW = track.scrollWidth
    if (trackW > baseW) extra = Math.max(extra, trackW - baseW)
  })

  return Math.max(0, Math.ceil(extra))
}

function remeasureDfsExtras() {
  if (!props.editable) return
  const base = lockedEditPaneW.value || paneWidthPx.value
  if (!(base > 0)) return

  const next: Record<number, number> = {}
  let changed = false
  for (const [index, pane] of paneElByIndex) {
    const extra = measureDfsExtra(pane, base)
    next[index] = extra
    if ((dfsExtraByIndex.value[index] ?? 0) !== extra) changed = true
  }
  if (changed) dfsExtraByIndex.value = next
}

function scheduleRemeasure() {
  if (!props.editable) return
  if (measureRaf) cancelAnimationFrame(measureRaf)
  measureRaf = requestAnimationFrame(() => {
    measureRaf = 0
    void nextTick(() => {
      remeasureDfsExtras()
      observeTileSources()
    })
  })
}

function observeTileSources() {
  if (!resizeObserver || !props.editable) return
  const root = viewportRef.value
  if (!root) return
  root
    .querySelectorAll(
      '.swiper-viewport.editable, .swiper-track, .multi-window-port.is-edit > .multi-window-track',
    )
    .forEach((node) => {
      resizeObserver!.observe(node)
    })
  for (const pane of paneElByIndex.values()) {
    resizeObserver!.observe(pane)
  }
}

function syncPaneWidth() {
  const el = viewportRef.value
  if (!el) return
  if (props.editable) {
    if (lockedEditPaneW.value > 0) {
      paneWidthPx.value = lockedEditPaneW.value
      scheduleRemeasure()
      return
    }
    const w = Math.max(0, Math.round(el.clientWidth))
    if (w > 0) {
      lockedEditPaneW.value = w
      paneWidthPx.value = w
      scheduleRemeasure()
    }
    return
  }
  lockedEditPaneW.value = 0
  dfsExtraByIndex.value = {}
  paneWidthPx.value = Math.max(0, Math.round(el.clientWidth))
}

watch(
  () => props.windows.length,
  (n, prev) => {
    if (props.editable && props.allowManage && n > (prev ?? 0)) {
      emit('select-window', n - 1)
    }
    scheduleRemeasure()
  },
)

watch(
  () => props.editable,
  () => {
    lockedEditPaneW.value = 0
    dfsExtraByIndex.value = {}
    void nextTick(() => syncPaneWidth())
  },
)

watch(
  () => props.windows.map((w) => w.key).join('\0'),
  () => scheduleRemeasure(),
)

onMounted(() => {
  syncPaneWidth()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      const root = viewportRef.value
      for (const entry of entries) {
        if (entry.target === root) syncPaneWidth()
        else scheduleRemeasure()
      }
    })
    if (viewportRef.value) resizeObserver.observe(viewportRef.value)
    observeTileSources()
  }
})

onBeforeUnmount(() => {
  if (measureRaf) cancelAnimationFrame(measureRaf)
  resizeObserver?.disconnect()
  resizeObserver = null
  paneElByIndex.clear()
})
</script>

<template>
  <div
    ref="viewportRef"
    class="multi-window-port"
    :class="{ 'is-edit': editable }"
    :style="viewportStyle"
  >
    <div class="multi-window-track" :style="trackStyle">
      <div
        v-for="win in windows"
        v-show="editable || isPreviewVisible(win.index, win.key)"
        :key="`${win.index}:${win.key}`"
        :ref="(el) => setPaneRef(win.index, el as Element | null)"
        class="multi-window-pane"
        :class="{
          editable,
          active: editable && win.index === editIndex,
          unbound: editable && !win.key,
          'is-preview-hidden':
            !editable && !isPreviewVisible(win.index, win.key),
        }"
        :style="paneStyle(win.index)"
        @click.stop="editable && allowManage && emit('select-window', win.index)"
      >
        <div class="multi-window-pane-screen">
          <slot :index="win.index" />
        </div>
      </div>

      <button
        v-if="editable && allowManage"
        type="button"
        class="multi-window-add"
        @click.stop="emit('add-window')"
      >
        <el-icon :size="22"><Plus /></el-icon>
        <span>新建窗口</span>
      </button>

      <div
        v-if="editable && allowManage && !windows.length"
        class="multi-window-empty multi-window-empty--edit"
      >
        点击右侧新建窗口
      </div>
      <div
        v-else-if="!editable && previewIndex < 0"
        class="multi-window-empty"
      >
        {{ activeKey ? `无匹配窗口「${activeKey}」` : '未绑定激活项' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.multi-window-port {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  box-sizing: border-box;
  overflow: visible;
}

.multi-window-port.is-edit {
  overflow: visible;
}

.multi-window-track {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 48px;
  box-sizing: border-box;
}

.multi-window-pane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  overflow: visible;
}

/* 预览非激活窗：绝对定位叠层 + display:flex 时，强化隐藏，避免与 data 窗叠出「加载中」 */
.multi-window-pane.is-preview-hidden {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

.multi-window-pane.editable {
  position: relative;
  inset: auto;
  height: 100%;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.04);
  overflow: visible;
  box-sizing: border-box;
}

.multi-window-pane-screen {
  /* 透传 pane 的 column flex，避免预览态 match_parent / flex:1 子节点高度塌缩 */
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  overflow: visible;
  position: relative;
}

.multi-window-pane.editable.active {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.06);
}

.multi-window-pane.editable.unbound {
  border-style: dashed;
  border-color: #f59e0b;
}

.multi-window-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
  font-size: 12px;
  pointer-events: none;
}

.multi-window-empty--edit {
  position: relative;
  inset: auto;
  flex: 0 0 var(--pane-w, 160px);
  width: var(--pane-w, 160px);
  min-width: 120px;
  height: 100%;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
}

.multi-window-add {
  flex: 0 0 88px;
  width: 88px;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  padding: 8px;
  box-sizing: border-box;
}

.multi-window-add:hover {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}
</style>
