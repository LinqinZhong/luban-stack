<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble.vue'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)

const summary = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
  const methodLabel =
    typeof data.methodLabel === 'string' ? data.methodLabel.trim() : ''
  if (varName && methodLabel) return `${varName} ← ${methodLabel}`
  if (varName) return varName
  if (methodLabel) return methodLabel
  return '未配置'
})
</script>

<template>
  <!-- 输入/输出：平行四边形 -->
  <div class="io-wrap" :class="debugClass">
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="io-shape input-node">
      <div class="io-content">
        <div class="flow-node-kind">输入</div>
        <div class="flow-node-summary" :title="summary">{{ summary }}</div>
      </div>
    </div>
    <Handle id="default" type="source" :position="Position.Bottom" />
    <FlowNodePrintBubble :node-id="id" />
  </div>
</template>

<style scoped>
.io-wrap {
  position: relative;
  overflow: visible;
  min-width: 148px;
  max-width: 260px;
}

.io-shape {
  transform: skewX(-18deg);
  border: 1.5px solid #95d475;
  background: #f0f9eb;
  padding: 8px 14px;
  box-sizing: border-box;
}

.io-content {
  transform: skewX(18deg);
  font-size: 12px;
  color: #303133;
  line-height: 1.3;
  min-width: 0;
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
