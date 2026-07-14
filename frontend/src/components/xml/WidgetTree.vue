<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AllowDropType, ElTree, NodeDropType, RenderContentContext } from 'element-plus'
import { ElMessageBox } from 'element-plus'
import { buildWidgetTree, type TreeNodeData } from '../../utils/widget-tree'
import {
  canMoveWidget,
  isContainerTag,
  type MovePosition,
} from '../../utils/xml-node'
import RepeatBadge from './RepeatBadge.vue'

type TreeNode = RenderContentContext['node']

const props = defineProps<{
  xml: string
  selectedId?: string
  /** 编辑模式才允许拖拽 */
  editable?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  'open-repeat': [id: string]
  move: [payload: { sourceId: string; targetId: string; position: MovePosition }]
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
  const result = buildWidgetTree(props.xml)
  treeError.value = result.error
  treeData.value = cloneTree(result.tree)
}

function collectExpandedKeys(selectedId?: string): string[] {
  const keys = new Set(treeData.value.map((node) => node.id))
  if (selectedId) {
    const parts = selectedId.split('/')
    for (let i = 1; i <= parts.length; i += 1) {
      keys.add(parts.slice(0, i).join('/'))
    }
  }
  return Array.from(keys)
}

function handleNodeClick(data: { id: string }) {
  emit('select', data.id)
}

function handleOpenRepeat(id: string) {
  emit('open-repeat', id)
}

function allowDrag(node: TreeNode) {
  if (!props.editable) return false
  const id = (node.data as TreeNodeData).id
  return Boolean(id && id.includes('/'))
}

function allowDrop(draggingNode: TreeNode, dropNode: TreeNode, type: AllowDropType) {
  if (!props.editable) return false

  const sourceId = (draggingNode.data as TreeNodeData).id
  const target = dropNode.data as TreeNodeData
  const position: MovePosition =
    type === 'prev' ? 'before' : type === 'next' ? 'after' : 'inner'

  // 叶子节点可拖入（显示落地指示），落点确认时改为同级
  if (position === 'inner' && !isContainerTag(target.tag)) {
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

  const invalid = canMoveWidget(source.id, target.id, position, target.tag)
  if (invalid) {
    if (position === 'inner' && !isContainerTag(target.tag)) {
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

watch(
  () => props.xml,
  () => {
    syncTreeFromXml()
    if (!props.selectedId) return
    const exists = JSON.stringify(treeData.value).includes(`"id":"${props.selectedId}"`)
    if (!exists) emit('select', '')
  },
  { immediate: true },
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
        :draggable="editable"
        :allow-drag="allowDrag"
        :allow-drop="allowDrop"
        highlight-current
        @node-click="handleNodeClick"
        @node-drop="handleNodeDrop"
      >
        <template #default="{ data }">
          <div class="tree-node">
            <span class="tree-label">{{ (data as TreeNodeData).label }}</span>
            <RepeatBadge
              v-if="(data as TreeNodeData).hasRepeat"
              :size="14"
              clickable
              @click="handleOpenRepeat((data as TreeNodeData).id)"
            />
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
  padding-right: 4px;
}

.tree-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

:deep(.el-tree-node__content) {
  height: 30px;
}
</style>
