<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  expression: string
  ambientHint: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [expression: string]
}>()

const draft = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) draft.value = props.expression
  },
)

function handleSave() {
  emit('save', draft.value.trim())
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑判断节点"
    width="520px"
    destroy-on-close
    append-to-body
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
    >
      <el-form-item label="条件表达式">
        <el-input
          v-model="draft"
          type="textarea"
          :rows="4"
          placeholder="例如：goodsList.length > 0"
        />
      </el-form-item>
      <el-form-item v-if="ambientHint" label="可访问变量">
        <span class="hint-inline">{{ ambientHint }}</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint-inline {
  font-size: 12px;
  color: #909399;
  line-height: 32px;
}
</style>
