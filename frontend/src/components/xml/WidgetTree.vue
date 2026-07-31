<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AllowDropType, ElTree, NodeDropType, RenderContentContext } from 'element-plus'
import { ElMessageBox } from 'element-plus'
import { Hide, View } from '@element-plus/icons-vue'
import { buildWidgetTree, type TreeNodeData } from '../../utils/widget-tree'
import { STATUS_BAR_NODE_ID } from '../../utils/status-bar'
import {
  canMoveWidget,
  isContainerTag,
  type MovePosition,
} from '../../utils/xml-node'
import { isSlotOutletNodeId, parseSlotOutletNodeId } from '../../utils/slot-outlet'
import RepeatBadge from './RepeatBadge.vue'
import EventBadge from './EventBadge.vue'

type TreeNode = RenderContentContext['node']

const props = defineProps<{
  xml: string
  selectedId?: string
  /** 编辑模式才允许拖拽 / 眼睛显隐 */
  editable?: boolean
  /** 编辑态被隐藏的节点 id */
  hiddenIds?: string[]
  /** 页面预览时在树顶插入状态栏虚拟节点 */
  includeStatusBar?: boolean
  /** 用于展开 Component 下的插槽子节点 */
  componentMap?: import('../../types/component-render').ComponentRenderMap
}>()

const emit = defineEmits<{
  select: [id: string]
  'open-repeat': [id: string]
  'open-event': [id: string]
  move: [
    payload: {
      sourceId: string
      targetId: string
      position: MovePosition
      slot?: string
    },
  ]
  'toggle-hidden': [id: string]
  contextmenu: [payload: { nodeId: string; x: number; y: number }]
}>()

const treeRef = ref<InstanceType<typeof ElTree>>()
const treeData = ref<TreeNodeData[]>([])
const treeError = ref('')

function cloneTree(nodes: TreeNodeData[]): TreeNodeData[] {
  return nodes.map((node) => ({
    ...node,
    children: node.children ? cloneTree(node.children) : undefined,
  }))
}

function syncTreeFromXml() {
  const result = buildWidgetTree(props.xml, {
    includeStatusBar: props.includeStatusBar,
    componentMap: props.componentMap,
  })
  treeError.value = result.error
  treeData.value = cloneTree(result.tree)
}

function findAncestorIds(nodes: TreeNodeData[], id: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    const next = [...trail, node.id]
    if (node.id === id) return next
    if (node.children?.length) {
      const found = findAncestorIds(node.children, id, next)
      if (found) return found
    }
  }
  return null
}

function collectExpandedKeys(selectedId?: string): string[] {
  const keys = new Set(treeData.value.map((node) => node.id))
  if (selectedId) {
    const ancestors = findAncestorIds(treeData.value, selectedId)
    if (ancestors) {
      for (const id of ancestors) keys.add(id)
    } else {
      const parts = selectedId.split('/')
      for (let i = 1; i <= parts.length; i += 1) {
        keys.add(parts.slice(0, i).join('/'))
      }
    }
  }
  return Array.from(keys)
}

function isHidden(id: string) {
  return (props.hiddenIds ?? []).includes(id)
}

function handleNodeClick(data: { id: string }) {
  emit('select', data.id)
}

function handleOpenRepeat(id: string) {
  emit('open-repeat', id)
}

function handleOpenEvent(id: string) {
  emit('open-event', id)
}

function handleToggleHidden(event: MouseEvent, id: string) {
  event.stopPropagation()
  emit('toggle-hidden', id)
}

function handleNodeContextMenu(event: MouseEvent, data: TreeNodeData) {
  if (!props.editable) return
  if (data.id === STATUS_BAR_NODE_ID) return
  if (isSlotOutletNodeId(data.id)) return
  event.preventDefault()
  event.stopPropagation()
  emit('select', data.id)
  emit('contextmenu', {
    nodeId: data.id,
    x: event.clientX,
    y: event.clientY,
  })
}

function allowDrag(node: TreeNode) {
  if (!props.editable) return false
  const id = (node.data as TreeNodeData).id
  if (id === STATUS_BAR_NODE_ID) return false
  if (isSlotOutletNodeId(id)) return false
  return Boolean(id && id.includes('/'))
}

function allowDrop(draggingNode: TreeNode, dropNode: TreeNode, type: AllowDropType) {
  if (!props.editable) return false

  const sourceId = (draggingNode.data as TreeNodeData).id
  const target = dropNode.data as TreeNodeData
  if (target.id === STATUS_BAR_NODE_ID || sourceId === STATUS_BAR_NODE_ID) return false
  if (isSlotOutletNodeId(sourceId)) return false

  const position: MovePosition =
    type === 'prev' ? 'before' : type === 'next' ? 'after' : 'inner'

  // 虚拟插槽：仅允许放入内部
  if (isSlotOutletNodeId(target.id)) {
    return position === 'inner'
  }

  // 叶子节点可拖入（显示落地指示），落点确认时改为同级
  if (
    position === 'inner' &&
    !isContainerTag(target.tag) &&
    target.tag !== 'Component'
  ) {
    return canMoveWidget(sourceId, target.id, 'after', target.tag) === null
  }

  return canMoveWidget(sourceId, target.id, position, target.tag) === null
}

function positionLabel(position: MovePosition, targetTag: string): string {
  if (position === 'inner') return `放入「${targetTag}」内部`
  if (position === 'before') return `放到「${targetTag}」前面`
  return `放到「${targetTag}」后面`
}

async function handleNodeDrop(
  draggingNode: TreeNode,
  dropNode: TreeNode,
  dropType: Exclude<NodeDropType, 'none'>,
) {
  const source = draggingNode.data as TreeNodeData
  const target = dropNode.data as TreeNodeData
  const position: MovePosition =
    dropType === 'before' ? 'before' : dropType === 'after' ? 'after' : 'inner'

  // el-tree 已改动本地 data，先还原，确认后再写 XML
  syncTreeFromXml()
  await nextTick()
  restoreSelectionAndExpand()

  // 拖入虚拟插槽 → 挂到 Component 下对应 slot
  if (isSlotOutletNodeId(target.id) && position === 'inner') {
    const outlet = parseSlotOutletNodeId(target.id)
    if (!outlet) return
    try {
      await ElMessageBox.confirm(
        `确定将「${source.label}」放入插槽「${outlet.slotName}」吗？`,
        '调整控件结构',
        {
          type: 'info',
          confirmButtonText: '确定',
          cancelButtonText: '取消',
        },
      )
    } catch {
      return
    }
    emit('move', {
      sourceId: source.id,
      targetId: outlet.hostId,
      position: 'inner',
      slot: outlet.slotName,
    })
    return
  }

  const invalid = canMoveWidget(source.id, target.id, position, target.tag)
  if (invalid) {
    if (
      position === 'inner' &&
      !isContainerTag(target.tag) &&
      target.tag !== 'Component'
    ) {
      try {
        await ElMessageBox.confirm(
          `「${target.tag}」不支持子节点，是否改为放到其后面？`,
          '无法放入内部',
          {
            type: 'warning',
            confirmButtonText: '放到后面',
            cancelButtonText: '取消',
          },
        )
      } catch {
        return
      }
      emit('move', {
        sourceId: source.id,
        targetId: target.id,
        position: 'after',
      })
      return
    }
    return
  }

  try {
    await ElMessageBox.confirm(
      `确定将「${source.label}」${positionLabel(position, target.tag)}吗？`,
      '调整控件结构',
      {
        type: 'info',
        confirmButtonText: '确定',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  emit('move', {
    sourceId: source.id,
    targetId: target.id,
    position,
  })
}

async function restoreSelectionAndExpand() {
  await nextTick()
  if (!treeRef.value) return
  if (props.selectedId) {
    treeRef.value.setCurrentKey(props.selectedId)
    for (const key of collectExpandedKeys(props.selectedId)) {
      const node = treeRef.value.getNode(key)
      if (node) node.expanded = true
    }
  } else {
    treeRef.value.setCurrentKey(undefined)
  }
}

function treeHasId(nodes: TreeNodeData[], id: string): boolean {
  for (const node of nodes) {
    if (node.id === id) return true
    if (node.children?.length && treeHasId(node.children, id)) return true
  }
  return false
}

watch(
  () => [props.xml, props.includeStatusBar, props.componentMap] as const,
  () => {
    syncTreeFromXml()
    if (!props.selectedId) return
    // 解析失败时保留选中，避免属性连续改写时误清空
    if (treeError.value) return
    if (!treeHasId(treeData.value, props.selectedId)) {
      emit('select', '')
    }
  },
  { immediate: true, deep: true },
)

watch(
  () => [props.selectedId, props.xml] as const,
  async () => {
    await restoreSelectionAndExpand()
  },
  { immediate: true },
)
</script>

<template>
  <div class="widget-tree">
    <div class="tree-header">控件树</div>
    <div class="tree-body">
      <el-alert
        v-if="treeError"
        :title="treeError"
        type="error"
        show-icon
        :closable="false"
      />
      <el-empty
        v-else-if="!treeData.length"
        description="暂无节点"
        :image-size="56"
      />
      <el-tree
        v-else
        ref="treeRef"
        :data="treeData"
        node-key="id"
        :props="{ label: 'label', children: 'children' }"
        :default-expanded-keys="collectExpandedKeys(selectedId)"
        :expand-on-click-node="false"
        :draggable="editable"
        :allow-drag="allowDrag"
        :allow-drop="allowDrop"
        highlight-current
        @node-click="handleNodeClick"
        @node-drop="handleNodeDrop"
      >
        <template #default="{ data }">
          <div
            class="tree-node"
            :class="{ 'is-hidden': isHidden((data as TreeNodeData).id) }"
            @contextmenu="handleNodeContextMenu($event, data as TreeNodeData)"
          >
            <span class="tree-label">{{ (data as TreeNodeData).label }}</span>
            <EventBadge
              v-if="((data as TreeNodeData).eventBindingCount ?? 0) > 0"
              :size="14"
              :count="(data as TreeNodeData).eventBindingCount"
              clickable
              @click="handleOpenEvent((data as TreeNodeData).id)"
            />
            <RepeatBadge
              v-if="(data as TreeNodeData).hasRepeat"
              :size="14"
              clickable
              @click="handleOpenRepeat((data as TreeNodeData).id)"
            />
            <button
              v-if="
                editable &&
                (data as TreeNodeData).id !== STATUS_BAR_NODE_ID &&
                !isSlotOutletNodeId((data as TreeNodeData).id)
              "
              type="button"
              class="eye-btn"
              :title="isHidden((data as TreeNodeData).id) ? '显示（仅编辑态，占位保留）' : '隐藏（仅编辑态，占位保留）'"
              @click="handleToggleHidden($event, (data as TreeNodeData).id)"
            >
              <el-icon :size="14">
                <Hide v-if="isHidden((data as TreeNodeData).id)" />
                <View v-else />
              </el-icon>
            </button>
          </div>
        </template>
      </el-tree>
    </div>
  </div>
</template>

<style scoped>
.widget-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  border-top: 1px solid #ebeef5;
}

.tree-header {
  flex-shrink: 0;
  height: 40px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  padding-right: 2px;
}

.tree-node.is-hidden .tree-label {
  color: #c0c4cc;
  text-decoration: line-through;
}

.tree-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.eye-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: auto;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #909399;
  cursor: pointer;
}

.eye-btn:hover {
  color: #409eff;
  background: #ecf5ff;
}

.tree-node.is-hidden .eye-btn {
  color: #c0c4cc;
}

:deep(.el-tree-node__content) {
  height: 30px;
}

:deep(.el-tree-node__expand-icon) {
  cursor: pointer;
}
</style>
