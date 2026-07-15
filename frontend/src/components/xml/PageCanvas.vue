<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { Box, Delete, Plus, RefreshRight } from '@element-plus/icons-vue'
import { colorPickState } from '../../composables/useColorPick'
import {
  createModalStack,
  MODAL_HOST_KEY,
  MODAL_STACK_KEY,
  type ModalStackApi,
} from '../../composables/useModalStack'
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
  /** ??? Toast????????? */
  toast?: { message: string; id: number } | null
  /** ??? Modal ??????????????? */
  modalStack?: ModalStackApi
}>()

const emit = defineEmits<{
  select: [id: string]
  add: []
  'add-component': []
  delete: []
  'open-repeat': [id: string]
  interact: [payload: import('../../utils/event-runtime').PreviewInteractPayload]
}>()

const fallbackModalStack = createModalStack()
const modalHostRef = ref<HTMLElement | null>(null)

provide(MODAL_STACK_KEY, props.modalStack ?? fallbackModalStack)
provide(MODAL_HOST_KEY, modalHostRef)

watch(
  () => props.selectable,
  (selectable) => {
    if (selectable) (props.modalStack ?? fallbackModalStack).closeAll()
  },
)
const parsed = computed<{ root: XmlNode | null; error: string }>(() => {
  if (!props.xml.trim()) {
    return { root: null, error: '?? XML ??' }
  }
  try {
    const root = parsePageXml(props.xml)
    const viewRoot =
      props.expandRepeat && root ? expandRepeatTree(root, props.pageData) : root
    return { root: viewRoot, error: '' }
  } catch (err) {
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
      v-if="showAddButton || showAddComponentButton || showDeleteButton"
      class="stage-toolbar color-pick-ignore"
    >
      <el-tooltip v-if="showAddButton" content="????" placement="left">
        <el-button type="primary" circle :icon="Plus" @click="emit('add')" />
      </el-tooltip>
      <el-tooltip v-if="showAddComponentButton" content="????" placement="left">
        <el-button type="success" circle :icon="Box" @click="emit('add-component')" />
      </el-tooltip>
      <el-tooltip v-if="showDeleteButton" content="????" placement="left">
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
        <div ref="modalHostRef" class="phone-modal-host" />
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
      <span class="zoom-label" title="Ctrl + ????">{{ zoomPercent }}%</span>
      <el-tooltip content="??????????? ? Ctrl+?????" placement="left">
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
