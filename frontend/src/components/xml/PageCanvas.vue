<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { colorPickState } from '../../composables/useColorPick'
import type { PageData } from '../../types/page-data'
import { expandRepeatTree } from '../../utils/repeat'
import { parsePageXml, type XmlNode } from '../../utils/xml'
import XmlNodeView from './XmlNodeView.vue'

const props = defineProps<{
  xml: string
  canvasWidth: number
  selectedId?: string
  selectable?: boolean
  showAddButton?: boolean
  showDeleteButton?: boolean
  /** 预览时展开 repeat（类似 v-for） */
  expandRepeat?: boolean
  pageData?: PageData
}>()

const emit = defineEmits<{
  select: [id: string]
  add: []
  delete: []
  'open-repeat': [id: string]
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
    <div v-if="showAddButton || showDeleteButton" class="stage-toolbar color-pick-ignore">
      <el-tooltip v-if="showAddButton" content="添加控件" placement="left">
        <el-button type="primary" circle :icon="Plus" @click="emit('add')" />
      </el-tooltip>
      <el-tooltip v-if="showDeleteButton" content="删除控件" placement="left">
        <el-button type="danger" circle :icon="Delete" @click="emit('delete')" />
      </el-tooltip>
    </div>

    <div
      class="phone"
      :class="{ 'is-picking': colorPickState.picking.value }"
      :style="{ width: `${canvasWidth}px` }"
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
        is-root
        @select="emit('select', $event)"
        @hover="handleHover"
        @open-repeat="emit('open-repeat', $event)"
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
