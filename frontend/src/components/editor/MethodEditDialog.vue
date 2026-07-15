<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import TsCodeEditor from './TsCodeEditor.vue'
import {
  METHOD_PARAM_TYPE_OPTIONS,
  METHOD_RETURN_TYPE_OPTIONS,
  createEmptyMethod,
  isValidMethodName,
  type MethodParam,
  type MethodReturnType,
  type PageMethod,
} from '../../types/page-method'

const props = defineProps<{
  modelValue: boolean
  method: PageMethod | null
  /** 组件方法体可用的 emit 等 ambient 声明 */
  ambientExtra?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [method: PageMethod, previousName?: string]
}>()

const editorRef = ref<{ getBody: () => string } | null>(null)

const draft = reactive<{
  name: string
  params: MethodParam[]
  returnType: MethodReturnType
  body: string
  previousName: string
  builtin: boolean
}>({
  name: '',
  params: [],
  returnType: 'void',
  body: '',
  previousName: '',
  builtin: false,
})

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

const title = computed(() => {
  if (draft.builtin) return `查看方法 · ${draft.name}`
  return draft.previousName ? '编辑方法' : '添加方法'
})

watch(
  () => [props.modelValue, props.method] as const,
  ([open, method]) => {
    if (!open) return
    const source = method ?? createEmptyMethod()
    draft.name = source.name
    draft.params = source.params.map((item) => ({ ...item }))
    draft.returnType = source.returnType || 'void'
    draft.body = source.body || ''
    draft.previousName = source.name
    draft.builtin = Boolean(source.builtin)
  },
)

function addParam() {
  draft.params.push({ name: '', type: 'string' })
}

function removeParam(index: number) {
  draft.params.splice(index, 1)
}

function handleSave() {
  if (draft.builtin) {
    visible.value = false
    return
  }
  const name = draft.name.trim()
  if (!isValidMethodName(name)) {
    ElMessage.error('方法名需以字母或下划线开头，仅含字母、数字、下划线')
    return
  }
  const params = draft.params
    .map((item) => ({
      name: item.name.trim(),
      type: item.type,
    }))
    .filter((item) => item.name)
  const dup = new Set<string>()
  for (const item of params) {
    if (dup.has(item.name)) {
      ElMessage.error(`参数名重复：${item.name}`)
      return
    }
    dup.add(item.name)
  }

  const body = editorRef.value?.getBody?.() ?? draft.body

  emit(
    'save',
    {
      name,
      params,
      returnType: draft.returnType,
      body,
      builtin: false,
    },
    draft.previousName || undefined,
  )
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="760px"
    destroy-on-close
    append-to-body
  >
    <el-form label-position="top" size="default">
      <el-form-item label="命名" required>
        <el-input
          v-model="draft.name"
          :disabled="draft.builtin"
          placeholder="例如：loadMessages"
        />
      </el-form-item>

      <el-form-item label="入参">
        <div class="param-list">
          <div v-for="(param, index) in draft.params" :key="index" class="param-row">
            <el-input
              v-model="param.name"
              :disabled="draft.builtin"
              placeholder="参数名"
            />
            <el-select
              v-model="param.type"
              :disabled="draft.builtin"
              style="width: 140px"
            >
              <el-option
                v-for="opt in METHOD_PARAM_TYPE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <el-button
              type="danger"
              link
              :icon="Delete"
              :disabled="draft.builtin"
              @click="removeParam(index)"
            />
          </div>
          <el-button
            v-if="!draft.builtin"
            type="primary"
            link
            :icon="Plus"
            @click="addParam"
          >
            添加参数
          </el-button>
          <span v-else-if="!draft.params.length" class="muted">无参数</span>
        </div>
      </el-form-item>

      <el-form-item label="返回值类型">
        <el-select
          v-model="draft.returnType"
          :disabled="draft.builtin"
          style="width: 100%"
        >
          <el-option
            v-for="opt in METHOD_RETURN_TYPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="引入依赖">
        <el-select disabled multiple placeholder="暂未实现" style="width: 100%" />
      </el-form-item>

      <el-form-item label="方法体">
        <p class="hint">语法 TypeScript：顶部方法声明只读，只需编写方法体内部代码。</p>
        <TsCodeEditor
          ref="editorRef"
          v-model="draft.body"
          :function-name="draft.name || 'fn'"
          :readonly="draft.builtin"
          :params="draft.params"
          :return-type="draft.returnType"
          :ambient-extra="draft.builtin ? '' : ambientExtra"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">{{ draft.builtin ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!draft.builtin" type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.param-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.param-row {
  display: grid;
  grid-template-columns: 1fr 140px 36px;
  gap: 8px;
  align-items: center;
}

.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #909399;
}

.muted {
  font-size: 13px;
  color: #c0c4cc;
}
</style>
