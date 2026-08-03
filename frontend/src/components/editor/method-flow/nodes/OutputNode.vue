<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble.vue'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)

const summary = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  if (data.channel === 'network') {
    const network =
      data.network && typeof data.network === 'object'
        ? (data.network as Record<string, unknown>)
        : data
    const method =
      typeof network.httpMethod === 'string' ? network.httpMethod : 'GET'
    const url =
      typeof network.apiUrl === 'string' ? network.apiUrl.trim() : ''
    const description =
      typeof data.description === 'string' ? data.description.trim() : ''
    if (description) return description
    return `${method} ${url || '(未填地址)'}`
  }
  const description =
    typeof data.description === 'string' ? data.description.trim() : ''
  if (description) return description
  const methodLabel =
    typeof data.methodLabel === 'string' ? data.methodLabel.trim() : ''
  if (methodLabel) {
    // goods.save（插入）→ goods.save
    return methodLabel.replace(/（[^）]*）$/, '')
  }
  return '未绑定写入方法'
})
</script>

<template>
  <!-- 输入/输出：平行四边形 -->
  <div class="io-wrap" :class="debugClass">
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="io-shape output-node">
      <div class="io-content">
        <div class="flow-node-kind">输出</div>
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
  border: 1.5px solid #79bbff;
  background: #ecf5ff;
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
  color: #337ecc;
}

.flow-node-summary {
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
