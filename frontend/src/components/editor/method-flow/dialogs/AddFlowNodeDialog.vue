<script setup lang="ts">
import type { FlowNodeKind } from '../../../types/backend-services'

export type AddableFlowNodeKind = Exclude<FlowNodeKind, 'start'>

const NODE_OPTIONS: {
  kind: AddableFlowNodeKind
  label: string
  desc: string
}[] = [
  { kind: 'input', label: '输入', desc: '调用方法或读取请求头写入变量' },
  { kind: 'define', label: '定义数据', desc: '声明局部变量并赋初值' },
  { kind: 'branch', label: '判断', desc: '按表达式分支到「是 / 否」' },
  { kind: 'action', label: '操作', desc: '执行自定义代码片段' },
  { kind: 'output', label: '输出', desc: '调用数据层写入方法' },
  { kind: 'throw', label: '业务异常', desc: '中断流程并返回业务错误（400）' },
  { kind: 'end', label: '终止', desc: '结束流程并可返回结果' },
]

const visible = defineModel<boolean>({ default: false })

const emit = defineEmits<{
  select: [kind: AddableFlowNodeKind]
}>()

function pick(kind: AddableFlowNodeKind) {
  emit('select', kind)
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="添加节点"
    width="560px"
    destroy-on-close
    append-to-body
  >
    <div class="node-options">
      <button
        v-for="opt in NODE_OPTIONS"
        :key="opt.kind"
        type="button"
        class="node-option"
        @click="pick(opt.kind)"
      >
        <div class="option-title">{{ opt.label }}</div>
        <div class="option-tag">{{ opt.kind }}</div>
        <div class="option-desc">{{ opt.desc }}</div>
      </button>
    </div>
  </el-dialog>
</template>

<style scoped>
.node-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  max-height: min(58vh, 460px);
  overflow-y: auto;
  padding: 2px;
}

.node-option {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s;
}

.node-option:hover {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 0 0 1px #409eff inset;
}

.option-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  line-height: 1.3;
}

.option-tag {
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #64748b;
  line-height: 1.2;
}

.option-desc {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}
</style>
