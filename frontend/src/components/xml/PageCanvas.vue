<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Box, Delete, Plus } from '@element-plus/icons-vue'
import { colorPickState } from '../../composables/useColorPick'
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
}>()

const emit = defineEmits<{
  select: [id: string]
  add: []
  'add-component': []
  delete: []
  'open-repeat': [id: string]
  interact: [payload: import('../../utils/event-runtime').PreviewInteractPayload]
}>()

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
</script>

<template>
  <div class="stage">
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

    <div
      class="phone"
      :class="{
        'is-picking': colorPickState.picking.value,
        'is-fit-content': phoneFitContent,
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
        :icon-library="iconLibrary"
        :page-data="pageData"
        :hidden-node-ids="hiddenNodeIds"
        :component-map="componentMap"
        :dollar-props="dollarProps"
        is-root
        @select="emit('select', $event)"
        @hover="handleHover"
        @open-repeat="emit('open-repeat', $event)"
        @interact="emit('interact', $event)"
      />
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
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(15, 23, 42, 0.04) 1px, transparent 1px),
    linear-gradient(rgba(15, 23, 42, 0.04) 1px, transparent 1px);
  background-size: 16px 16px;
  background-color: #e8edf3;
}

.stage-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: flex;
  gap: 8px;
}

.phone {
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
