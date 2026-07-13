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
</script>

<template>
  <el-dialog v-model="visible" title="添加控件" width="440px" destroy-on-close>
    <div class="widget-options">
      <button
        v-for="opt in WIDGET_OPTIONS"
        :key="opt.tag"
        type="button"
        class="widget-option"
        @click="pick(opt.tag)"
      >
        <div class="option-title">{{ opt.label }}</div>
        <div class="option-desc">{{ opt.description }}</div>
      </button>
    </div>
  </el-dialog>
</template>

<style scoped>
.widget-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.widget-option {
  padding: 14px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}

.widget-option:hover {
  border-color: #409eff;
  background: #ecf5ff;
}

.option-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.option-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}
</style>
