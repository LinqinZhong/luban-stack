<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import FlowPrintField from '../FlowPrintField.vue'

const props = defineProps<{
  modelValue: boolean
  printExpr: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: { printExpr: string }]
}>()

const draft = ref('')

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

watch(
  () => props.modelValue,
  (open) => {
    if (open) draft.value = props.printExpr ?? ''
  },
)

function handleSave() {
  emit('save', { printExpr: draft.value.trim() })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑开始节点"
    width="480px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
      @submit.prevent
    >
      <el-form-item label="打印">
        <FlowPrintField v-model="draft" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>
  </el-dialog>
</template>
