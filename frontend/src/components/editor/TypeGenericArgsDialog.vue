<script setup lang="ts">
import { computed, reactive, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  typeName: string
  genericNames: string[]
  args: Record<string, string>
  typeOptions: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [args: Record<string, string>]
}>()

const draft = reactive<Record<string, string>>({})

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

watch(
  () => [props.modelValue, props.genericNames, props.args] as const,
  ([open]) => {
    if (!open) return
    for (const key of Object.keys(draft)) delete draft[key]
    for (const name of props.genericNames) {
      draft[name] = props.args[name] ?? ''
    }
  },
)

function handleSave() {
  const next: Record<string, string> = {}
  for (const name of props.genericNames) {
    next[name] = (draft[name] ?? '').trim()
  }
  emit('save', next)
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`配置泛型 · ${typeName || '类型'}`"
    width="440px"
    destroy-on-close
    append-to-body
  >
    <p class="hint">未选择时按 <code>any</code> 处理。</p>
    <el-form label-width="48px" @submit.prevent="handleSave">
      <el-form-item v-for="name in genericNames" :key="name" :label="name">
        <el-select
          v-model="draft[name]"
          clearable
          filterable
          placeholder="any"
          style="width: 100%"
        >
          <el-option
            v-for="opt in typeOptions"
            :key="opt.id"
            :label="opt.label"
            :value="opt.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: #f5f7fa;
  color: #606266;
}
</style>
