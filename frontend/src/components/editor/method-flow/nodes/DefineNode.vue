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
  const varName = typeof data.varName === 'string' ? data.varName.trim() : ''
  const initExpr = typeof data.initExpr === 'string' ? data.initExpr.trim() : ''
  if (varName && initExpr) return `${varName} = ${initExpr}`
  if (varName) return varName
  return '未配置'
})
</script>

<template>
  <!-- 子流程风格：双边竖线矩形（定义数据） -->
  <div class="flow-node define-node" :class="debugClass">
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="flow-node-kind">定义数据</div>
    <div class="flow-node-summary" :title="summary">{{ summary }}</div>
    <Handle id="default" type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.flow-node {
  position: relative;
  min-width: 140px;
  max-width: 240px;
  padding: 8px 16px;
  border-radius: 0;
  border: 1.5px solid #b39ddb;
  background: #f5f0fa;
  font-size: 12px;
  color: #303133;
  line-height: 1.3;
  box-sizing: border-box;
}

/* 子流程：左右内侧竖线 */
.flow-node::before,
.flow-node::after {
  content: '';
  position: absolute;
  top: 4px;
  bottom: 4px;
  width: 0;
  border-left: 1.5px solid #b39ddb;
}

.flow-node::before {
  left: 5px;
}

.flow-node::after {
  right: 5px;
}

.flow-node-kind {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 2px;
  color: #7b5ea7;
}

.flow-node-summary {
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
