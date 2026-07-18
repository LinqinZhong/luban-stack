<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position, type NodeProps } from '@vue-flow/core'
import { useFlowDebugNode } from '../use-flow-debug-node'

const props = defineProps<NodeProps>()
const { debugClass } = useFlowDebugNode(props.id)

const summary = computed(() => {
  const data = (props.data ?? {}) as Record<string, unknown>
  const expr = typeof data.expression === 'string' ? data.expression.trim() : ''
  return expr || '未配置条件'
})
</script>

<template>
  <!-- 判定：菱形 -->
  <div class="diamond-wrap" :class="debugClass">
    <Handle id="default" type="target" :position="Position.Top" />
    <div class="diamond-shape">
      <div class="diamond-inner">
        <div class="flow-node-kind">判断</div>
        <div class="flow-node-summary" :title="summary">{{ summary }}</div>
      </div>
    </div>
    <span class="side-label true">是</span>
    <span class="side-label false">否</span>
    <Handle
      id="true"
      type="source"
      :position="Position.Right"
      :style="{ top: '50%', right: '0', transform: 'translate(50%, -50%)' }"
    />
    <Handle
      id="false"
      type="source"
      :position="Position.Left"
      :style="{ top: '50%', left: '0', transform: 'translate(-50%, -50%)' }"
    />
  </div>
</template>

<style scoped>
.diamond-wrap {
  position: relative;
  width: 148px;
  height: 148px;
}

.diamond-shape {
  position: absolute;
  inset: 18px;
  transform: rotate(45deg);
  border: 1.5px solid #eebe77;
  background: #fdf6ec;
  box-sizing: border-box;
}

.diamond-inner {
  position: absolute;
  inset: 0;
  transform: rotate(-45deg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  box-sizing: border-box;
  font-size: 12px;
  color: #303133;
  line-height: 1.3;
  text-align: center;
}

.flow-node-kind {
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 2px;
  color: #b88230;
}

.flow-node-summary {
  color: #606266;
  max-width: 88px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.side-label {
  position: absolute;
  top: 50%;
  font-size: 11px;
  font-weight: 600;
  transform: translateY(-50%);
  pointer-events: none;
}

.side-label.true {
  right: -4px;
  transform: translate(100%, -50%);
  color: #67c23a;
  padding-left: 6px;
}

.side-label.false {
  left: -4px;
  transform: translate(-100%, -50%);
  color: #f56c6c;
  padding-right: 6px;
}
</style>
