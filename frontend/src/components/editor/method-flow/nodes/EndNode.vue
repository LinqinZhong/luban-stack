<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { useFlowDebugNode } from '../use-flow-debug-node'
import FlowNodePrintBubble from '../FlowNodePrintBubble.vue'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)

const returnExpr = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  return typeof data.returnExpr === 'string' ? data.returnExpr.trim() : ''
})

const needsReturn = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  return Boolean(data.needsReturn)
})
</script>

<template>
  <!-- 开始/结束：圆角胶囊 -->
  <div
    class="flow-node end-node"
    :class="[{ 'has-return': needsReturn }, debugClass]"
  >
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="flow-node-title">终止</div>
    <div
      v-if="needsReturn"
      class="flow-node-summary"
      :title="returnExpr || '未选择返回数据'"
    >
      {{ returnExpr || '未选择返回数据' }}
    </div>
    <FlowNodePrintBubble :node-id="id" />
  </div>
</template>

<style scoped>
.flow-node {
  position: relative;
  overflow: visible;
  min-width: 88px;
  max-width: 220px;
  padding: 10px 28px;
  border-radius: 999px;
  border: 1.5px solid #f89898;
  background: #fef0f0;
  font-size: 13px;
  color: #303133;
  text-align: center;
  line-height: 1.3;
  box-sizing: border-box;
}

.flow-node.has-return {
  padding: 8px 22px;
}

.flow-node-title {
  font-weight: 600;
  color: #c45656;
  letter-spacing: 0.08em;
}

.flow-node-summary {
  margin-top: 2px;
  font-size: 11px;
  color: #909399;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}
</style>
