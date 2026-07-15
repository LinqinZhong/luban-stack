<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { Box, Delete, Plus, RefreshRight } from '@element-plus/icons-vue'
import { colorPickState } from '../../composables/useColorPick'
import {
  createMaskStack,
  MASK_HOST_KEY,
  MASK_STACK_KEY,
  type MaskStackApi,
} from '../../composables/useMaskStack'
import type { IconLibrary } from '../../types/icon-library'
import type { PageData } from '../../types/page-data'
import type { ComponentRenderMap } from '../../types/component-render'
import { expandRepeatTree } from '../../utils/repeat'
import { parsePageXml, type XmlNode } from '../../utils/xml'
import IconSprite from './IconSprite.vue'
import XmlNodeView from './XmlNodeView.vue'

const props = defineProps<{
  xml: string
  canvasWidth: number
  selectedId?: string
  selectable?: boolean
  showAddButton?: boolean
  showAddComponentButton?: boolean
  showDeleteButton?: boolean
  /** 预览时展开 repeat（类似 v-for） */
  expandRepeat?: boolean
  pageData?: PageData
  iconLibrary?: IconLibrary
  /** 仅编辑态：画布上隐藏这些节点 */
  hiddenNodeIds?: string[]
  /** 页面中 Component 节点的渲染数据 */
  componentMap?: ComponentRenderMap
  /** 画布高度；不传则默认 min 667。传 auto 则按内容撑开 */
  canvasHeight?: number | 'auto'
  /** 编辑/预览组件自身时注入 $props（默认值） */
  dollarProps?: Record<string, unknown>
  /** 预览态路由参数（$route） */
  routeParams?: Record<string, unknown>
  /** 预览态 Toast（显示在手机框内） */
  toast?: { message: string; id: number } | null
  /** 页面级遮罩堆栈（工作区持有，切页可清空） */
  maskStack?: MaskStackApi
}>()

const emit = defineEmits<{
  select: [id: string]
  add: []
  'add-component': []
  delete: []
  'open-repeat': [id: string]
  interact: [payload: import('../../utils/event-runtime').PreviewInteractPayload]
}>()

const fallbackMaskStack = createMaskStack()
const maskHostRef = ref<HTMLElement | null>(null)

provide(MASK_STACK_KEY, props.maskStack ?? fallbackMaskStack)
provide(MASK_HOST_KEY, maskHostRef)

watch(
  () => props.selectable,
  (selectable) => {
    if (selectable) (props.maskStack ?? fallbackMaskStack).closeAll()
  },
)
const parsed = computed<{ root: XmlNode | null; error: string }>(() => {
  if (!props.xml.trim()) {
    return { root: null, error: '页面 XML 为空' }
  }
  try {
    const root = parsePageXml(props.xml)
    const viewRoot =
      props.expandRepeat && root ? expandRepeatTree(root, props.pageData) : root
    return { root: viewRoot, error: '' }
  } catch (err) {
    return {
      root: null,
      error: err instanceof Error ? err.message : 'XML 解析失败',
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

/** 画布平移 / 缩放由父组件持有，切换页面时保持 */
const panX = defineModel<number>('panX', { default: 0 })
const panY = defineModel<number>('panY', { default: 0 })
const zoom = defineModel<number>('zoom', { default: 1 })
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
  // 以光标位置为缩放锚点，同步调整平移
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

  // world 以 center top 为原点：内容中心 x = stageWidth/2，顶端 y = 0（再加 padding 影响较小）
  const ox = rect.width / 2
  const oy = 0
  // 光标相对缩放原点的向量，缩放前后保持屏幕位置不变
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
  // 仅中键拖动画布
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

/** 阻止中键默认自动滚动等行为 */
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
      v-if="showAddButton || showAddComponentButton || showDeleteButton"
      class="stage-toolbar color-pick-ignore"
    >
      <el-tooltip v-if="showAddButton" content="添加控件" placement="left">
        <el-button type="primary" circle :icon="Plus" @click="emit('add')" />
      </el-tooltip>
      <el-tooltip v-if="showAddComponentButton" content="添加组件" placement="left">
        <el-button type="success" circle :icon="Box" @click="emit('add-component')" />
      </el-tooltip>
      <el-tooltip v-if="showDeleteButton" content="删除控件" placement="left">
        <el-button type="danger" circle :icon="Delete" @click="emit('delete')" />
      </el-tooltip>
    </div>

    <div class="stage-world" :style="worldStyle">
      <div
        class="phone"
        :class="{
          'is-picking': colorPickState.picking.value,
          'is-fit-content': phoneFitContent,
          'is-edit': selectable,
        }"
        :style="phoneFrameStyle"
        @click="handlePhoneClick"
        @mouseleave="clearHover"
      >
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
          :selected-id="selectedId"
          :hovered-id="hoveredNodeId"
          :selectable="selectable"
          :interact-enabled="!selectable"
          :icon-library="iconLibrary"
          :page-data="pageData"
          :hidden-node-ids="hiddenNodeIds"
          :component-map="componentMap"
          :dollar-props="dollarProps"
          :route-params="routeParams"
          is-root
          @select="emit('select', $event)"
          @hover="handleHover"
          @open-repeat="emit('open-repeat', $event)"
          @interact="emit('interact', $event)"
        />
        <div ref="maskHostRef" class="phone-mask-host" />
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
      </div>
    </div>

    <div class="stage-status color-pick-ignore">
      <span class="zoom-label" title="Ctrl + 滚轮缩放">{{ zoomPercent }}%</span>
      <el-tooltip content="复位画布（中键拖拽平移 · Ctrl+滚轮缩放）" placement="left">
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
      <span>点击画布取色，点击空白处取消</span>
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
  /* 提示可用中键拖拽 */
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

.pan-reset {
  opacity: 0.35;
  transition: opacity 0.15s ease;
}

.pan-reset.visible {
  opacity: 1;
}

.stage-status {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
}

.zoom-label {
  min-width: 48px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #e4e7ed;
  color: #606266;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  line-height: 1.4;
  user-select: none;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
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

.phone-mask-host {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  overflow: hidden;
}

.phone-mask-host :deep(.mask-overlay) {
  pointer-events: auto;
}

/* 编辑态允许子控件（如 Swiper 多页）溢出手机框显示 */
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
  /* 组件画布：透明底，白底卡片圆角才可见 */
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
