<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { useFlowDebugNode } from '../use-flow-debug-node'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)
</script>

<template>
  <!-- 开始/结束：圆角胶囊 -->
  <div class="flow-node start-node" :class="debugClass">
    <div class="flow-node-title">开始</div>
    <Handle id="default" type="source" :position="Position.Bottom" />
  </div>
</template>

<style scoped>
.flow-node {
  min-width: 88px;
  padding: 10px 28px;
  border-radius: 999px;
  border: 1.5px solid #79bbff;
  background: #ecf5ff;
  font-size: 13px;
  color: #303133;
  text-align: center;
  line-height: 1.3;
  box-sizing: border-box;
}

.flow-node-title {
  font-weight: 600;
  color: #337ecc;
  letter-spacing: 0.08em;
}
</style>
