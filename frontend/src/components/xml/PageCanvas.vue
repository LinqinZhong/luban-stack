<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { Delete, Plus, RefreshRight } from '@element-plus/icons-vue'
import { colorPickState } from '../../composables/useColorPick'
import {
  BADGE_HOST_KEY,
  createModalStack,
  MODAL_HOST_KEY,
  MODAL_STACK_KEY,
  type ModalStackApi,
} from '../../composables/useModalStack'
import { CANVAS_RUNTIME_KEY } from '../../composables/useCanvasRuntime'
import { getDeviceInfo } from '../../utils/device-info'
import type { IconLibrary } from '../../types/icon-library'
import type { PageData } from '../../types/page-data'
import type { ComponentRenderMap } from '../../types/component-render'
import { buildRepeatExpandKey, expandRepeatTree } from '../../utils/repeat'
import { parsePageXml, type XmlNode } from '../../utils/xml'
import IconSprite from './IconSprite.vue'
import XmlNodeView from './XmlNodeView.vue'
import { STATUS_BAR_NODE_ID } from '../../utils/status-bar'

const props = defineProps<{
  xml: string
  canvasWidth: number
  selectedId?: string
  selectable?: boolean
  showAddButton?: boolean
  /** 选中插槽时：添加调试元素 */
  showAddDebugButton?: boolean
  showDeleteButton?: boolean
  /** ????? repeat??? v-for? */
  expandRepeat?: boolean
  pageData?: PageData
  iconLibrary?: IconLibrary
  /** ?????????????? */
  hiddenNodeIds?: string[]
  /** ??? Component ??????? */
  componentMap?: ComponentRenderMap
  /** ?????????? min 667?? auto ?????? */
  canvasHeight?: number | 'auto'
  /** ??/????????? $props????? */
  dollarProps?: Record<string, unknown>
  /** ????????$route? */
  routeParams?: Record<string, unknown>
  /** 当前工程路径（组件 api 参数预览） */
  projectPath?: string
  /** 预览运行时就绪闸门（递增后触发嵌套组件生命周期） */
  previewLifecycleGate?: number
  /** ??? Toast????????? */
  toast?: { message: string; id: number } | null
  /** ??? Modal ??????????????? */
  modalStack?: ModalStackApi
  /** 页面预览显示状态栏/胶囊；组件预览不显示 */
  showDeviceChrome?: boolean
  /** 状态栏是否可选中（编辑态） */
  statusBarSelectable?: boolean
  /** 状态栏背景色 */
  statusBarBackground?: string
  /** 状态栏文字/图标色 black | white */
  statusBarTextStyle?: 'black' | 'white'
  /** 状态栏与页面重叠（沉浸式） */
  statusBarCover?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  add: []
  'add-debug': []
  delete: []
  'open-repeat': [id: string]
  'add-window': [parentId: string]
  interact: [payload: import('../../utils/event-runtime').PreviewInteractPayload]
}>()

const fallbackModalStack = createModalStack()
const modalHostRef = ref<HTMLElement | null>(null)
const badgeHostRef = ref<HTMLElement | null>(null)

/** 画布场景：H5 / 小程序 */
const scene = defineModel<'h5' | 'miniprogram'>('scene', { default: 'h5' })

provide(MODAL_STACK_KEY, props.modalStack ?? fallbackModalStack)
provide(MODAL_HOST_KEY, modalHostRef)
provide(BADGE_HOST_KEY, badgeHostRef)
provide(CANVAS_RUNTIME_KEY, {
  getDeviceInfo: () =>
    getDeviceInfo({
      platform: scene.value,
      windowWidth: props.canvasWidth,
    }),
  get projectPath() {
    return props.projectPath
  },
})

watch(
  () => props.selectable,
  (selectable) => {
    if (selectable) (props.modalStack ?? fallbackModalStack).closeAll()
  },
)
/** 页面级 repeat：仅数组变化时重建，避免标量 setData 每帧拆树 */
let cachedPageExpandKey = ''
let cachedPageRoot: XmlNode | null = null

const parsed = computed<{ root: XmlNode | null; error: string }>(() => {
  if (!props.xml.trim()) {
    cachedPageExpandKey = ''
    cachedPageRoot = null
    return { root: null, error: '?? XML ??' }
  }
  try {
    const root = parsePageXml(props.xml)
    if (!props.expandRepeat || !root) {
      return { root, error: '' }
    }
    const expandKey = `${props.xml}\0${buildRepeatExpandKey(props.pageData, props.dollarProps)}`
    if (expandKey === cachedPageExpandKey && cachedPageRoot) {
      return { root: cachedPageRoot, error: '' }
    }
    const viewRoot = expandRepeatTree(root, props.pageData, props.dollarProps)
    cachedPageExpandKey = expandKey
    cachedPageRoot = viewRoot
    return { root: viewRoot, error: '' }
  } catch (err) {
    cachedPageExpandKey = ''
    cachedPageRoot = null
    return {
      root: null,
      error: err instanceof Error ? err.message : 'XML ????',
    }
  }
})

const rootId = computed(() =>
  parsed.value.root ? `0:${parsed.value.root.tag}` : '',
)

const hoveredNodeId = ref('')

const phoneFrameStyle = computed(() => {
  const style: Record<string, string> = {
    width: `${props.canvasWidth}px`,
  }
  if (typeof props.canvasHeight === 'number' && Number.isFinite(props.canvasHeight)) {
    style.height = `${props.canvasHeight}px`
    style.minHeight = `${props.canvasHeight}px`
  } else if (props.canvasHeight === 'auto') {
    style.height = 'auto'
    style.minHeight = '0'
  }
  return style
})

const phoneFitContent = computed(
  () => props.canvasHeight === 'auto' || typeof props.canvasHeight === 'number',
)

/** ???? / ???????????????? */
const panX = defineModel<number>('panX', { default: 0 })
const panY = defineModel<number>('panY', { default: 0 })
const zoom = defineModel<number>('zoom', { default: 1 })
const sceneTabs = [
  { key: 'h5' as const, label: 'H5' },
  { key: 'miniprogram' as const, label: '微信小程序' },
]
const panning = ref(false)
const stageRef = ref<HTMLElement | null>(null)
let panOriginX = 0
let panOriginY = 0
let panStartClientX = 0
let panStartClientY = 0
let panPointerId: number | null = null

const MIN_ZOOM = 0.25
const MAX_ZOOM = 3

const zoomPercent = computed(() => Math.round(zoom.value * 100))

const statusBarSelected = computed(
  () =>
    Boolean(props.selectable) &&
    props.selectedId === STATUS_BAR_NODE_ID,
)

/** H5 场景固定白底黑字、无沉浸；小程序场景用页面配置 */
const effectiveStatusBar = computed(() => {
  if (scene.value !== 'miniprogram') {
    return {
      background: '#ffffff',
      textStyle: 'black' as const,
      cover: false,
    }
  }
  return {
    background: props.statusBarBackground?.trim() || '#ffffff',
    textStyle: props.statusBarTextStyle === 'white' ? ('white' as const) : ('black' as const),
    cover: Boolean(props.statusBarCover),
  }
})

const statusBarStyle = computed(() => {
  const light = effectiveStatusBar.value.textStyle === 'white'
  return {
    background: effectiveStatusBar.value.background,
    color: light ? '#ffffff' : '#111111',
  }
})

const statusBarCover = computed(() => effectiveStatusBar.value.cover)

function handleStatusBarSelect(event: MouseEvent) {
  if (!props.statusBarSelectable) return
  event.stopPropagation()
  emit('select', STATUS_BAR_NODE_ID)
}

const worldStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
  transformOrigin: 'center top',
}))

const viewMoved = computed(
  () => panX.value !== 0 || panY.value !== 0 || zoom.value !== 1,
)

watch(
  () => props.selectable,
  (selectable) => {
    if (!selectable) hoveredNodeId.value = ''
  },
)

function handleHover(id: string) {
  if (!props.selectable) return
  hoveredNodeId.value = id
}

function clearHover() {
  hoveredNodeId.value = ''
}

function handlePhoneClick(event: MouseEvent) {
  if (!colorPickState.picking.value) return
  event.preventDefault()
  event.stopPropagation()
  colorPickState.pickFromPoint(event.clientX, event.clientY)
}

/** ??????????????????????????? */
const phoneRef = ref<HTMLElement | null>(null)
const touchCursorVisible = ref(false)
const touchCursorPressed = ref(false)
const touchCursorPos = ref({ x: 0, y: 0 })

const showTouchCursor = computed(
  () => !props.selectable && !colorPickState.picking.value,
)

const touchCursorStyle = computed(() => ({
  left: `${touchCursorPos.value.x}px`,
  top: `${touchCursorPos.value.y}px`,
}))

function updateTouchCursorPos(event: PointerEvent) {
  const phone = phoneRef.value
  if (!phone) return
  const rect = phone.getBoundingClientRect()
  if (rect.width < 1 || rect.height < 1) return
  const scaleX = phone.offsetWidth / rect.width
  const scaleY = phone.offsetHeight / rect.height
  touchCursorPos.value = {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

function onPhonePointerMove(event: PointerEvent) {
  if (!showTouchCursor.value) return
  touchCursorVisible.value = true
  updateTouchCursorPos(event)
}

function onPhonePointerDown(event: PointerEvent) {
  if (!showTouchCursor.value) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  touchCursorVisible.value = true
  touchCursorPressed.value = true
  updateTouchCursorPos(event)
}

function onPhonePointerUp() {
  touchCursorPressed.value = false
}

function onPhonePointerLeave() {
  touchCursorVisible.value = false
  touchCursorPressed.value = false
}

watch(
  () => props.selectable,
  () => {
    touchCursorVisible.value = false
    touchCursorPressed.value = false
  },
)

function resetView() {
  panX.value = 0
  panY.value = 0
  zoom.value = 1
}

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

function onStageWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return
  event.preventDefault()
  // ?????????????????
  const stage = stageRef.value
  if (!stage) {
    const factor = event.deltaY > 0 ? 0.9 : 1 / 0.9
    zoom.value = clampZoom(zoom.value * factor)
    return
  }
  const rect = stage.getBoundingClientRect()
  const cx = event.clientX - rect.left
  const cy = event.clientY - rect.top
  const oldZoom = zoom.value
  const factor = event.deltaY > 0 ? 0.9 : 1 / 0.9
  const nextZoom = clampZoom(oldZoom * factor)
  if (nextZoom === oldZoom) return

  // world ? center top ???????? x = stageWidth/2??? y = 0??? padding ?????
  const ox = rect.width / 2
  const oy = 0
  // ????????????????????????
  const dx = cx - ox - panX.value
  const dy = cy - oy - panY.value
  const ratio = nextZoom / oldZoom
  panX.value = cx - ox - dx * ratio
  panY.value = cy - oy - dy * ratio
  zoom.value = nextZoom
}

function endPan(target?: HTMLElement | null) {
  if (!panning.value) return
  panning.value = false
  if (panPointerId != null && target) {
    try {
      target.releasePointerCapture(panPointerId)
    } catch {
      // ignore
    }
  }
  panPointerId = null
}

function onStagePointerDown(event: PointerEvent) {
  // ???????
  if (event.button !== 1) return
  event.preventDefault()
  event.stopPropagation()
  panning.value = true
  panStartClientX = event.clientX
  panStartClientY = event.clientY
  panOriginX = panX.value
  panOriginY = panY.value
  panPointerId = event.pointerId
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onStagePointerMove(event: PointerEvent) {
  if (!panning.value) return
  panX.value = panOriginX + (event.clientX - panStartClientX)
  panY.value = panOriginY + (event.clientY - panStartClientY)
}

function onStagePointerUp(event: PointerEvent) {
  if (event.button !== 1 && !panning.value) return
  endPan(event.currentTarget as HTMLElement)
}

/** ????????????? */
function onStageMouseDown(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault()
  }
}

function onStageAuxClick(event: MouseEvent) {
  if (event.button === 1) {
    event.preventDefault()
  }
}

onMounted(() => {
  stageRef.value?.addEventListener('wheel', onStageWheel, { passive: false })
})

onBeforeUnmount(() => {
  endPan()
  stageRef.value?.removeEventListener('wheel', onStageWheel)
})
</script>

<template>
  <div
    ref="stageRef"
    class="stage"
    :class="{ panning }"
    @pointerdown="onStagePointerDown"
    @pointermove="onStagePointerMove"
    @pointerup="onStagePointerUp"
    @pointercancel="onStagePointerUp"
    @mousedown="onStageMouseDown"
    @auxclick="onStageAuxClick"
  >
    <IconSprite
      v-if="iconLibrary"
      :library="iconLibrary"
    />
    <div
      v-if="showAddButton || showAddDebugButton || showDeleteButton"
      class="stage-toolbar color-pick-ignore"
    >
      <el-tooltip v-if="showAddDebugButton" content="添加调试元素" placement="left">
        <el-button type="warning" circle class="btn-plus-bug" @click="emit('add-debug')">
          <span class="plus-bug-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path
                fill="currentColor"
                d="M11 3h2v2.06c1.72.34 3.1 1.5 3.74 3.09L19 7.5l1 1.73-2.1 1.21c.07.41.1.84.1 1.28v.5h2.5v2H18v.5c0 .44-.03.87-.1 1.28L20 17.77 19 19.5l-2.26-.65A5.98 5.98 0 0 1 13 18.94V21h-2v-2.06a5.98 5.98 0 0 1-3.74-3.09L5 19.5l-1-1.73 2.1-1.21A7.4 7.4 0 0 1 6 13.5v-.5H3.5v-2H6v-.5c0-.44.03-.87.1-1.28L4 9.23 5 7.5l2.26.65A5.98 5.98 0 0 1 11 5.06V3zm1 4a4 4 0 0 0-4 4v2a4 4 0 0 0 8 0v-2a4 4 0 0 0-4-4zm-1 3h2v4h-2v-4z"
              />
              <path
                fill="currentColor"
                d="M17.5 2.5h1.5v1.5H20.5v1.5h-1.5V7h-1.5V5.5H16V4h1.5z"
              />
            </svg>
          </span>
        </el-button>
      </el-tooltip>
      <el-tooltip v-if="showAddButton" content="添加控件 / 组件" placement="left">
        <el-button type="primary" circle :icon="Plus" @click="emit('add')" />
      </el-tooltip>
      <el-tooltip v-if="showDeleteButton" content="删除" placement="left">
        <el-button type="danger" circle :icon="Delete" @click="emit('delete')" />
      </el-tooltip>
    </div>

    <div class="stage-world" :style="worldStyle">
      <div
        ref="phoneRef"
        class="phone"
        :class="{
          'is-picking': colorPickState.picking.value,
          'is-fit-content': phoneFitContent,
          'is-edit': selectable,
          'is-preview': showTouchCursor,
          'is-miniprogram': showDeviceChrome && scene === 'miniprogram',
          'has-status-bar': showDeviceChrome,
          'status-bar-cover': showDeviceChrome && statusBarCover,
        }"
        :style="phoneFrameStyle"
        @click="handlePhoneClick"
        @mouseleave="clearHover"
        @pointermove="onPhonePointerMove"
        @pointerdown="onPhonePointerDown"
        @pointerup="onPhonePointerUp"
        @pointercancel="onPhonePointerUp"
        @pointerleave="onPhonePointerLeave"
      >
        <div
          v-if="showDeviceChrome"
          class="device-status-bar color-pick-ignore"
          :class="{
            selectable: statusBarSelectable,
            selected: statusBarSelected,
            cover: statusBarCover,
          }"
          :style="statusBarStyle"
          aria-hidden="true"
          @click="handleStatusBarSelect"
        >
          <span class="status-time">9:41</span>
          <div class="status-trailing">
            <svg class="status-icon status-signal" viewBox="0 0 17 12" fill="currentColor">
              <rect x="0" y="7.5" width="3" height="4.5" rx="0.75" />
              <rect x="4.5" y="5" width="3" height="7" rx="0.75" />
              <rect x="9" y="2.5" width="3" height="9.5" rx="0.75" />
              <rect x="13.5" y="0" width="3" height="12" rx="0.75" />
            </svg>
            <svg class="status-icon status-wifi" viewBox="0 0 16 12" fill="currentColor">
              <circle cx="8" cy="10.6" r="1.15" />
              <path
                d="M4.55 7.55a4.9 4.9 0 0 1 6.9 0l-1.15 1.2a3.25 3.25 0 0 0-4.6 0l-1.15-1.2Z"
              />
              <path
                d="M2.2 5.05a8.2 8.2 0 0 1 11.6 0l-1.15 1.2a6.55 6.55 0 0 0-9.3 0L2.2 5.05Z"
              />
              <path
                d="M.15 2.7a11.2 11.2 0 0 1 15.7 0l-1.15 1.2a9.55 9.55 0 0 0-13.4 0L.15 2.7Z"
              />
            </svg>
            <svg class="status-icon status-battery" viewBox="0 0 28 13" fill="none">
              <rect
                x="0.75"
                y="0.75"
                width="23.5"
                height="11.5"
                rx="2.5"
                stroke="currentColor"
                stroke-width="1.5"
                opacity="0.35"
              />
              <rect x="2.4" y="2.35" width="17.5" height="8.3" rx="1.5" fill="currentColor" />
              <rect
                x="25.2"
                y="4.1"
                width="2"
                height="4.8"
                rx="0.7"
                fill="currentColor"
                opacity="0.4"
              />
            </svg>
          </div>
        </div>
        <div
          v-if="showDeviceChrome && scene === 'miniprogram'"
          class="mp-capsule color-pick-ignore"
          aria-hidden="true"
        >
          <span class="mp-capsule-more" />
          <span class="mp-capsule-divider" />
          <span class="mp-capsule-close" />
        </div>
        <el-alert
          v-if="parsed.error"
          :title="parsed.error"
          type="error"
          show-icon
          :closable="false"
        />
        <XmlNodeView
          v-else-if="parsed.root"
          :node="parsed.root"
          :node-id="rootId"
          :selected-id="selectable ? selectedId : ''"
          :hovered-id="hoveredNodeId"
          :selectable="selectable"
          :interact-enabled="!selectable"
          :expand-repeat="expandRepeat"
          :icon-library="iconLibrary"
          :page-data="pageData"
          :hidden-node-ids="hiddenNodeIds"
          :component-map="componentMap"
          :dollar-props="dollarProps"
          :route-params="routeParams"
          :preview-lifecycle-gate="previewLifecycleGate"
          is-root
          @select="emit('select', $event)"
          @hover="handleHover"
          @open-repeat="emit('open-repeat', $event)"
          @add-window="emit('add-window', $event)"
          @interact="emit('interact', $event)"
        />
        <div ref="modalHostRef" class="phone-modal-host" />
        <!-- ?????????????????/?????????? -->
        <div
          v-if="selectable"
          class="phone-screen-frame"
          aria-hidden="true"
        />
        <!-- ????????????????? -->
        <div
          v-if="selectable"
          ref="badgeHostRef"
          class="phone-badge-host"
        />
        <Transition name="phone-toast">
          <div
            v-if="toast?.message"
            :key="toast.id"
            class="phone-toast"
            role="status"
          >
            {{ toast.message }}
          </div>
        </Transition>
        <div
          v-if="showTouchCursor && touchCursorVisible"
          class="phone-touch-cursor"
          :class="{ 'is-pressed': touchCursorPressed }"
          :style="touchCursorStyle"
          aria-hidden="true"
        />
      </div>
    </div>

    <div class="stage-status color-pick-ignore">
      <div class="scene-tabs" role="tablist" aria-label="画布场景">
        <button
          v-for="tab in sceneTabs"
          :key="tab.key"
          type="button"
          role="tab"
          class="scene-tab"
          :class="{ active: scene === tab.key }"
          :aria-selected="scene === tab.key"
          @click="scene = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
      <span class="zoom-label" title="Ctrl + 滚轮缩放">{{ zoomPercent }}%</span>
      <el-tooltip content="重置视图 · Ctrl+0" placement="left">
        <el-button
          class="pan-reset"
          :class="{ visible: viewMoved }"
          circle
          :icon="RefreshRight"
          :disabled="!viewMoved"
          @click="resetView"
        />
      </el-tooltip>
    </div>

    <div
      v-if="colorPickState.picking.value"
      class="pick-overlay color-pick-ignore"
      @click="colorPickState.cancelPick()"
    >
      <span>??????????????</span>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  height: 100%;
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background:
    linear-gradient(90deg, rgba(15, 23, 42, 0.04) 1px, transparent 1px),
    linear-gradient(rgba(15, 23, 42, 0.04) 1px, transparent 1px);
  background-size: 16px 16px;
  background-color: #e8edf3;
  /* ???????? */
  cursor: default;
}

.stage.panning,
.stage.panning :deep(*) {
  cursor: grabbing !important;
}

.stage-world {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 24px;
  width: 100%;
  height: 100%;
  min-width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  will-change: transform;
}

.stage-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: flex;
  gap: 8px;
}

.btn-plus-bug :deep(span) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.plus-bug-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  line-height: 0;
}

.plus-bug-icon svg {
  display: block;
}

.stage-status {
  --ctrl-h: 28px;
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
}

.scene-tabs {
  display: inline-flex;
  align-items: stretch;
  box-sizing: border-box;
  height: var(--ctrl-h);
  padding: 2px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e4e7ed;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.scene-tab {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  border: none;
  background: transparent;
  color: #606266;
  font-size: 12px;
  line-height: 1;
  padding: 0 10px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.scene-tab:hover {
  color: #303133;
}

.scene-tab.active {
  background: #ecf5ff;
  color: #409eff;
  font-weight: 600;
}

.zoom-label {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: var(--ctrl-h);
  min-width: 48px;
  padding: 0 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e4e7ed;
  color: #606266;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  user-select: none;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.stage-status :deep(.pan-reset) {
  box-sizing: border-box;
  width: var(--ctrl-h);
  height: var(--ctrl-h);
  min-height: var(--ctrl-h);
  padding: 0;
  opacity: 0.35;
  transition: opacity 0.15s ease;
}

.stage-status :deep(.pan-reset.visible) {
  opacity: 1;
}

/* 系统状态栏：时间 · 信号 · Wi‑Fi · 电量 */
.device-status-bar {
  flex-shrink: 0;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  background: #fff;
  color: #111;
  pointer-events: none;
  z-index: 6;
  box-sizing: border-box;
  outline: 2px solid transparent;
  outline-offset: -2px;
  transition: outline-color 0.12s ease;
}

.device-status-bar.selectable {
  pointer-events: auto;
  cursor: pointer;
}

.device-status-bar.selectable:hover {
  outline-color: rgba(64, 158, 255, 0.55);
}

.device-status-bar.selected {
  outline-color: #409eff;
}

.device-status-bar.cover {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  flex-shrink: 0;
}

.phone.status-bar-cover > :deep(.select-shell) {
  /* 重叠时页面仍铺满手机框，状态栏浮层不占流 */
  flex: 1 1 auto;
  min-height: 0;
}

/* 小程序标题栏胶囊：需避开状态栏高度 */
.phone.status-bar-cover .mp-capsule {
  top: 30px;
}

.status-time {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.status-trailing {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.status-icon {
  display: block;
  flex-shrink: 0;
  color: inherit;
}

.status-signal {
  width: 14px;
  height: 10px;
}

.status-wifi {
  width: 13px;
  height: 10px;
}

.status-battery {
  width: 22px;
  height: 10px;
}

/* 小程序标题栏胶囊：三点 · 关闭环 */
.mp-capsule {
  position: absolute;
  top: 30px;
  right: 7px;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 2px;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #fff;
  box-sizing: border-box;
  pointer-events: none;
}

.mp-capsule-more,
.mp-capsule-close {
  position: relative;
  width: 36px;
  height: 28px;
  flex-shrink: 0;
}

/* 三点：中间略大 */
.mp-capsule-more::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  border-radius: 50%;
  background: #111;
  box-shadow:
    -6px 0 0 -0.5px #111,
    6px 0 0 -0.5px #111;
}

.mp-capsule-divider {
  width: 1px;
  height: 16px;
  background: rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
}

/* 关闭：外环 + 实心圆心 */
.mp-capsule-close::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 15px;
  height: 15px;
  margin: -7.5px 0 0 -7.5px;
  border-radius: 50%;
  border: 2.5px solid #111;
  box-sizing: border-box;
}

.mp-capsule-close::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: #111;
}

.phone.has-status-bar > :deep(.select-shell) {
  flex: 1 1 auto;
  min-height: 0;
}

.phone.is-miniprogram {
  border-radius: 0;
}

.phone {
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 667px;
  height: 100%;
  background: #fff;
  border: 1px solid #d0d7de;
  box-shadow: 0 12px 40px rgba(15, 23, 42, 0.08);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}

.phone.is-preview {
  cursor: none;
  /* ??????/?????? touch-action??????? */
  touch-action: auto;
}

.phone.is-preview :deep(*) {
  cursor: none;
}

.phone.is-preview :deep(.overlay-scroll-body.is-drag-scrolling),
.phone.is-preview :deep(.overlay-scroll-body.is-drag-scrolling *) {
  cursor: grabbing;
}

.phone-touch-cursor {
  position: absolute;
  z-index: 300;
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border-radius: 50%;
  background: rgba(64, 158, 255, 0.28);
  border: 2px solid rgba(64, 158, 255, 0.55);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18);
  pointer-events: none;
  transform: scale(1);
  transition: transform 0.08s ease, background 0.08s ease, border-color 0.08s ease;
}

.phone-touch-cursor.is-pressed {
  background: rgba(64, 158, 255, 0.42);
  border-color: rgba(64, 158, 255, 0.75);
  transform: scale(1.2);
}

.phone-modal-host {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  overflow: hidden;
}

.phone-modal-host :deep(.modal-overlay) {
  pointer-events: auto;
}

.phone-screen-frame {
  position: absolute;
  inset: 0;
  z-index: 200;
  pointer-events: none;
  box-sizing: border-box;
  border: 2px dashed #79bbff;
}

.phone-badge-host {
  position: absolute;
  inset: 0;
  z-index: 210;
  pointer-events: none;
  overflow: visible;
}

.phone-badge-host :deep(.badge-stack) {
  pointer-events: auto;
}

/* ?????????? Swiper ?????????? */
.phone.is-edit {
  overflow: visible;
}

.phone-toast {
  position: absolute;
  left: 50%;
  bottom: 72px;
  z-index: 100;
  transform: translateX(-50%);
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
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
}

.phone-toast-enter-active,
.phone-toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.phone-toast-enter-from,
.phone-toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

.phone.is-fit-content {
  height: auto;
  min-height: 0;
  align-self: flex-start;
  /* ?????????????????? */
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.phone.is-picking {
  cursor: crosshair;
}

.pick-overlay {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12px;
  background: rgba(15, 23, 42, 0.08);
  color: #303133;
  font-size: 13px;
  cursor: crosshair;
}
</style>
