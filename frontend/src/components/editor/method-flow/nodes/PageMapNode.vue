<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble.vue'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)

const summary = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  const description =
    typeof data.description === 'string' ? data.description.trim() : ''
  if (description) return description
  const sourceKind = data.sourceKind === 'array' ? 'array' : 'page'
  const kindLabel = sourceKind === 'array' ? '[]' : '分页'
  const sourcePath =
    typeof data.sourcePath === 'string' ? data.sourcePath.trim() : ''
  const targetVarName =
    (typeof data.targetVarName === 'string' ? data.targetVarName.trim() : '') ||
    (typeof data.targetPath === 'string' ? data.targetPath.trim() : '')
  if (sourcePath && targetVarName) {
    return `${kindLabel} · ${sourcePath} → ${targetVarName}`
  }
  if (sourcePath) return `${kindLabel} · 源：${sourcePath}`
  if (targetVarName) return `目标：${targetVarName}`
  return '未配置分页映射'
})
</script>

<template>
  <div class="flow-node page-map-node" :class="debugClass">
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="flow-node-kind">分页映射</div>
    <div class="flow-node-summary" :title="summary">{{ summary }}</div>
    <Handle id="default" type="source" :position="Position.Bottom" />
    <FlowNodePrintBubble :node-id="id" />
  </div>
</template>

<style scoped>
.flow-node {
  position: relative;
  overflow: visible;
  min-width: 140px;
  max-width: 240px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1.5px solid #67c23a;
  background: #f0f9eb;
  font-size: 12px;
  color: #303133;
  line-height: 1.3;
  box-sizing: border-box;
}

.flow-node-kind {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 2px;
  color: #529b2e;
}

.flow-node-summary {
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

