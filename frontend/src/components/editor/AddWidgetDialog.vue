<script setup lang="ts">
import { WIDGET_OPTIONS, type WidgetTag } from '../../utils/xml-node'

const visible = defineModel<boolean>({ default: false })

const emit = defineEmits<{
  select: [tag: WidgetTag]
}>()

function pick(tag: WidgetTag) {
  emit('select', tag)
  visible.value = false
}

function shortLabel(label: string) {
  return label.split(/\s+/)[0] || label
}
</script>

<template>
  <el-dialog v-model="visible" title="添加控件" width="560px" destroy-on-close>
    <div class="widget-options">
      <button
        v-for="opt in WIDGET_OPTIONS"
        :key="opt.tag"
        type="button"
        class="widget-option"
        :title="opt.description"
        @click="pick(opt.tag)"
      >
        <div class="option-title">{{ shortLabel(opt.label) }}</div>
        <div class="option-tag">{{ opt.tag }}</div>
        <div class="option-desc">{{ opt.description }}</div>
      </button>
    </div>
  </el-dialog>
</template>

<style scoped>
.widget-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  max-height: min(58vh, 460px);
  overflow-y: auto;
  padding: 2px;
}

.widget-option {
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
  transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
}

.widget-option:hover {
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
