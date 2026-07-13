<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ElTree } from 'element-plus'
import { buildWidgetTree, type TreeNodeData } from '../../utils/widget-tree'
import RepeatBadge from './RepeatBadge.vue'

const props = defineProps<{
  xml: string
  selectedId?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  'open-repeat': [id: string]
}>()

const treeRef = ref<InstanceType<typeof ElTree>>()

const result = computed(() => buildWidgetTree(props.xml))

const expandedKeys = computed(() => {
  const keys = new Set(result.value.tree.map((node) => node.id))
  if (props.selectedId) {
    const parts = props.selectedId.split('/')
    for (let i = 1; i <= parts.length; i += 1) {
      keys.add(parts.slice(0, i).join('/'))
    }
  }
  return Array.from(keys)
})

function handleNodeClick(data: { id: string }) {
  emit('select', data.id)
}

function handleOpenRepeat(id: string) {
  emit('open-repeat', id)
}

watch(
  () => [props.selectedId, props.xml] as const,
  async ([selectedId]) => {
    await nextTick()
    if (!treeRef.value) return
    if (selectedId) {
      treeRef.value.setCurrentKey(selectedId)
      for (const key of expandedKeys.value) {
        const node = treeRef.value.getNode(key)
        if (node) node.expanded = true
      }
    } else {
      treeRef.value.setCurrentKey(undefined)
    }
  },
  { immediate: true },
)

watch(
  () => props.xml,
  () => {
    if (!props.selectedId) return
    const exists = JSON.stringify(result.value.tree).includes(`"id":"${props.selectedId}"`)
    if (!exists) emit('select', '')
  },
)
</script>

<template>
  <div class="widget-tree">
    <div class="tree-header">控件树</div>
    <div class="tree-body">
      <el-alert
        v-if="result.error"
        :title="result.error"
        type="error"
        show-icon
        :closable="false"
      />
      <el-empty
        v-else-if="!result.tree.length"
        description="暂无节点"
        :image-size="56"
      />
      <el-tree
        v-else
        ref="treeRef"
        :data="result.tree"
        node-key="id"
        :props="{ label: 'label', children: 'children' }"
        :default-expanded-keys="expandedKeys"
        highlight-current
        @node-click="handleNodeClick"
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
