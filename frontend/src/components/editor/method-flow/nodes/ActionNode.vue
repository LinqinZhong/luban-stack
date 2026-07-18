<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { useFlowDebugNode } from '../use-flow-debug-node'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)

const summary = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  const description =
    typeof data.description === 'string' ? data.description.trim() : ''
  if (description) return description

  const outputVar =
    typeof data.outputVarName === 'string' ? data.outputVarName.trim() : ''
  if (outputVar) return `→ ${outputVar}`

  const code = typeof data.code === 'string' ? data.code.trim() : ''
  if (!code) return '未编写代码'
  const first = code.split(/\r?\n/).find((l) => l.trim()) ?? ''
  return first.length > 28 ? `${first.slice(0, 28)}…` : first
})
</script>

<template>
  <!-- 节点：矩形 -->
  <div class="flow-node action-node" :class="debugClass">
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="flow-node-kind">操作</div>
    <div class="flow-node-summary" :title="summary">{{ summary }}</div>
    <Handle id="default" type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.flow-node {
  min-width: 140px;
  max-width: 240px;
  padding: 8px 12px;
  border-radius: 0;
  border: 1.5px solid #a8abb2;
  background: #f4f4f5;
  font-size: 12px;
  color: #303133;
  line-height: 1.3;
  box-sizing: border-box;
}

.flow-node-kind {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 2px;
  color: #606266;
}

.flow-node-summary {
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
