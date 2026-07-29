<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { computed } from 'vue'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble.vue'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)

const messageExpr = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  return typeof data.messageExpr === 'string' ? data.messageExpr.trim() : ''
})
</script>

<template>
  <div class="flow-node throw-node" :class="debugClass">
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="flow-node-title">业务异常</div>
    <div class="flow-node-summary" :title="messageExpr || '未配置错误信息'">
      {{ messageExpr || '未配置错误信息' }}
    </div>
    <FlowNodePrintBubble :node-id="id" />
  </div>
</template>

<style scoped>
.flow-node {
  position: relative;
  overflow: visible;
  min-width: 100px;
  max-width: 220px;
  padding: 8px 18px;
  border-radius: 10px;
  border: 1.5px solid #f56c6c;
  background: #fef0f0;
  font-size: 13px;
  color: #303133;
  text-align: center;
  line-height: 1.3;
  box-sizing: border-box;
}

.flow-node-title {
  font-weight: 600;
  color: #c45656;
  letter-spacing: 0.04em;
}

.flow-node-summary {
  margin-top: 2px;
  font-size: 11px;
  color: #909399;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}
</style>
