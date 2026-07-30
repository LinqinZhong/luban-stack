<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type {
  ProcessorMethodParam,
  ServiceProcessor,
} from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import TypedBindingCascader from '../TypedBindingCascader.vue'
import FlowPrintField from '../FlowPrintField.vue'
import {
  INPUT_HEADER_CUSTOM,
  INPUT_HEADER_FIELD_OPTIONS,
  INPUT_HEADER_PRESET_FIELDS,
  type InputDataSource,
  type InputNodeForm,
} from './input-node'

const props = defineProps<{
  modelValue: boolean
  form: InputNodeForm
  /** 当前服务全部业务层处理器 */
  businessProcessors: ServiceProcessor[]
  /** 当前服务全部数据层处理器 */
  dataProcessors: ServiceProcessor[]
  /** 当前正在编辑的业务处理器 */
  currentProcessorId: string
  /** 当前正在编辑的业务方法（当前业务来源中排除自身） */
  currentMethodId: string
  /** 当前业务处理器绑定的数据层 id；空则不展示「当前数据层」 */
  boundDataProcessorId: string
  /**
   * 输入来源范围：
   * - all：业务 / 数据层 / 请求头（业务方法流）
   * - business：仅业务层方法（API 编排流）
   */
  sourceMode?: 'all' | 'business'
  reservedNames: string[]
  ambientVars: MethodParam[]
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [form: InputNodeForm]
}>()

const draft = reactive<InputNodeForm>({
  dataSource: 'other_business',
  dataProcessorId: '',
  dataMethodId: '',
  headerField: '',
  varName: '',
  methodLabel: '',
  paramBindings: {},
  printExpr: '',
})

/** 请求头下拉：预设或「自定义」 */
const headerKind = ref<string>('user-id')
/** 自定义请求头名 */
const customHeaderName = ref('')

const businessOnly = computed(() => props.sourceMode === 'business')

function isPresetHeader(field: string): boolean {
  return (INPUT_HEADER_PRESET_FIELDS as readonly string[]).includes(field)
}

function syncHeaderUiFromField(field: string) {
  if (!field) {
    headerKind.value = 'user-id'
    customHeaderName.value = ''
    return
  }
  if (isPresetHeader(field)) {
    headerKind.value = field
    customHeaderName.value = ''
    return
  }
  headerKind.value = INPUT_HEADER_CUSTOM
  customHeaderName.value = field
}

function resolvedHeaderField(): string {
  if (headerKind.value === INPUT_HEADER_CUSTOM) {
    return customHeaderName.value.trim()
  }
  return headerKind.value.trim()
}

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const dataSourceOptions = computed(() => {
  const opts: Array<{ value: InputDataSource; label: string }> = []
  if (props.currentProcessorId) {
    opts.push({ value: 'current_business', label: '当前业务' })
  }
  opts.push({
    value: 'other_business',
    label: businessOnly.value && !props.currentProcessorId ? '业务层' : '其它业务',
  })
  if (businessOnly.value) return opts
  if (props.boundDataProcessorId) {
    opts.push({ value: 'current_data', label: '当前数据层' })
  }
  opts.push(
    { value: 'other_data', label: '其它数据层' },
    { value: 'request_header', label: '请求头' },
  )
  return opts
})

const showDataSourceSelect = computed(() => dataSourceOptions.value.length > 1)

const isHeaderSource = computed(() => draft.dataSource === 'request_header')
const isBusinessSource = computed(
  () =>
    draft.dataSource === 'current_business' ||
    draft.dataSource === 'other_business',
)
const methodFieldLabel = computed(() => {
  if (isHeaderSource.value) return '请求头字段'
  if (isBusinessSource.value || businessOnly.value) return '业务方法'
  return '数据层方法'
})

function coerceDataSource(source: InputDataSource): InputDataSource {
  if (businessOnly.value) {
    if (source === 'current_business' && props.currentProcessorId) {
      return 'current_business'
    }
    return 'other_business'
  }
  if (source === 'current_data' && !props.boundDataProcessorId) {
    return 'other_data'
  }
  if (source === 'current_business' && !props.currentProcessorId) {
    return 'other_business'
  }
  return source
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const next: InputNodeForm = {
      ...props.form,
      paramBindings: { ...(props.form.paramBindings ?? {}) },
    }
    next.dataSource = coerceDataSource(next.dataSource)
    Object.assign(draft, next)
    syncHeaderUiFromField(next.headerField)
  },
)

watch(
  () => draft.dataSource,
  (source) => {
    if (!props.modelValue) return
    const coercedForm = coerceDataSource(props.form.dataSource)
    // 打开弹窗同步 form 时不要清空已有配置
    if (source === coercedForm) return
    clearMethodSelection()
    if (source === 'request_header') {
      headerKind.value = 'user-id'
      customHeaderName.value = ''
      draft.headerField = 'user-id'
    }
  },
)

watch(headerKind, (kind) => {
  if (!props.modelValue || !isHeaderSource.value) return
  if (kind === INPUT_HEADER_CUSTOM) {
    draft.headerField = customHeaderName.value.trim()
  } else {
    draft.headerField = kind
    customHeaderName.value = ''
  }
})

watch(customHeaderName, (name) => {
  if (!props.modelValue || headerKind.value !== INPUT_HEADER_CUSTOM) return
  draft.headerField = name.trim()
})

type MethodOpt = {
  value: string
  label: string
  processorId: string
  methodId: string
}

function collectMethods(
  processors: ServiceProcessor[],
  filter?: (proc: ServiceProcessor, methodId: string) => boolean,
): MethodOpt[] {
  const opts: MethodOpt[] = []
  for (const proc of processors) {
    for (const m of proc.methods) {
      if (filter && !filter(proc, m.id)) continue
      const name = m.name.trim() || m.id
      opts.push({
        value: `${proc.id}::${m.id}`,
        label: `${proc.name || proc.id}.${name}`,
        processorId: proc.id,
        methodId: m.id,
      })
    }
  }
  return opts
}

const methodOptions = computed((): MethodOpt[] => {
  const source = draft.dataSource
  if (source === 'request_header') return []
  if (source === 'current_business') {
    const proc = props.businessProcessors.find(
      (p) => p.id === props.currentProcessorId,
    )
    if (!proc) return []
    return collectMethods([proc], (_p, methodId) => {
      return methodId !== props.currentMethodId
    })
  }
  if (source === 'other_business') {
    return collectMethods(props.businessProcessors, (proc) => {
      return proc.id !== props.currentProcessorId
    })
  }
  if (source === 'current_data') {
    const bound = props.boundDataProcessorId
    if (!bound) return []
    const proc = props.dataProcessors.find((p) => p.id === bound)
    return proc ? collectMethods([proc]) : []
  }
  // other_data
  const bound = props.boundDataProcessorId
  return collectMethods(props.dataProcessors, (proc) => {
    return !bound || proc.id !== bound
  })
})

const processorPool = computed(() =>
  isBusinessSource.value ? props.businessProcessors : props.dataProcessors,
)

const selectedMethod = computed(() => {
  for (const proc of processorPool.value) {
    if (proc.id !== draft.dataProcessorId) continue
    const method = proc.methods.find((m) => m.id === draft.dataMethodId)
    if (method) return method
  }
  return null
})

const methodParams = computed((): ProcessorMethodParam[] => {
  return (selectedMethod.value?.params ?? []).filter((p) => p.name.trim())
})

function syncParamBindings(params: ProcessorMethodParam[]) {
  const next: Record<string, string> = {}
  for (const p of params) {
    const name = p.name.trim()
    if (!name) continue
    next[name] = draft.paramBindings[name] ?? ''
  }
  draft.paramBindings = next
}

const selectedMethodKey = computed({
  get() {
    if (!draft.dataProcessorId || !draft.dataMethodId) return ''
    return `${draft.dataProcessorId}::${draft.dataMethodId}`
  },
  set(key: string) {
    const opt = methodOptions.value.find((o) => o.value === key)
    if (!opt) {
      draft.dataProcessorId = ''
      draft.dataMethodId = ''
      draft.methodLabel = ''
      draft.paramBindings = {}
      return
    }
    draft.dataProcessorId = opt.processorId
    draft.dataMethodId = opt.methodId
    draft.methodLabel = opt.label
    const method = processorPool.value
      .find((p) => p.id === opt.processorId)
      ?.methods.find((m) => m.id === opt.methodId)
    syncParamBindings(method?.params ?? [])
  },
})

function clearMethodSelection() {
  draft.dataProcessorId = ''
  draft.dataMethodId = ''
  draft.methodLabel = ''
  draft.paramBindings = {}
  draft.headerField = ''
  headerKind.value = 'user-id'
  customHeaderName.value = ''
}

watch(
  methodParams,
  (params) => {
    if (isHeaderSource.value) return
    if (!params.length && !Object.keys(draft.paramBindings).length) return
    syncParamBindings(params)
  },
  { deep: true },
)

const varNameError = computed(() => {
  const name = draft.varName.trim()
  if (!name) return '请填写变量名'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return '变量名须为合法标识符'
  }
  if (props.reservedNames.includes(name)) {
    return '与方法入参或其他节点变量重名'
  }
  return ''
})

const bindingError = computed(() => {
  if (isHeaderSource.value) return ''
  for (const p of methodParams.value) {
    const name = p.name.trim()
    if (!name) continue
    if (!(draft.paramBindings[name] ?? '').trim()) {
      return `请绑定入参「${name}」`
    }
  }
  return ''
})

const headerError = computed(() => {
  if (!isHeaderSource.value) return ''
  if (headerKind.value === INPUT_HEADER_CUSTOM) {
    if (!customHeaderName.value.trim()) return '请填写自定义请求头名'
    return ''
  }
  if (!headerKind.value.trim()) return '请选择请求头字段'
  return ''
})

function paramTypeLabel(p: ProcessorMethodParam): string {
  return processorTypeExprToTs(p.typeExpr, props.typeLibrary)
}

const canSave = computed(() => {
  if (varNameError.value) return false
  if (isHeaderSource.value) return !headerError.value
  return (
    !bindingError.value &&
    Boolean(draft.dataProcessorId && draft.dataMethodId)
  )
})

function handleSave() {
  if (!canSave.value) return
  if (isHeaderSource.value) {
    const field = resolvedHeaderField()
    emit('save', {
      dataSource: 'request_header',
      dataProcessorId: '',
      dataMethodId: '',
      headerField: field,
      varName: draft.varName.trim(),
      methodLabel: `请求头.${field}`,
      paramBindings: {},
      printExpr: draft.printExpr.trim(),
    })
    visible.value = false
    return
  }
  const paramBindings: Record<string, string> = {}
  for (const p of methodParams.value) {
    const name = p.name.trim()
    if (!name) continue
    paramBindings[name] = (draft.paramBindings[name] ?? '').trim()
  }
  emit('save', {
    dataSource: draft.dataSource,
    dataProcessorId: draft.dataProcessorId,
    dataMethodId: draft.dataMethodId,
    headerField: '',
    varName: draft.varName.trim(),
    methodLabel: draft.methodLabel,
    paramBindings,
    printExpr: draft.printExpr.trim(),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑输入节点"
    width="560px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
    >
      <el-form-item v-if="showDataSourceSelect" label="数据来源" required>
        <el-select
          v-model="draft.dataSource"
          placeholder="选择数据来源"
          style="width: 100%"
        >
          <el-option
            v-for="opt in dataSourceOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item
        v-if="isHeaderSource"
        label="请求头字段"
        required
        :error="headerError || undefined"
      >
        <div class="header-field-block">
          <el-select
            v-model="headerKind"
            placeholder="选择请求头字段"
            style="width: 100%"
          >
            <el-option
              v-for="opt in INPUT_HEADER_FIELD_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-input
            v-if="headerKind === INPUT_HEADER_CUSTOM"
            v-model="customHeaderName"
            class="custom-header-input"
            placeholder="自定义请求头名，如 X-Request-Id"
            maxlength="128"
          />
        </div>
      </el-form-item>

      <template v-else>
        <el-form-item :label="methodFieldLabel" required>
          <el-select
            v-model="selectedMethodKey"
            filterable
            clearable
            :placeholder="
              isBusinessSource || businessOnly
                ? '选择业务层处理器方法'
                : '选择数据层处理器方法'
            "
            style="width: 100%"
          >
            <el-option
              v-for="opt in methodOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <p v-if="!methodOptions.length" class="hint">
            <template v-if="draft.dataSource === 'current_business'">
              当前业务暂无其它可调用方法
            </template>
            <template v-else-if="draft.dataSource === 'other_business'">
              {{
                businessOnly
                  ? '暂无业务层方法，请先在业务层创建'
                  : '暂无其它业务处理器方法'
              }}
            </template>
            <template v-else-if="draft.dataSource === 'current_data'">
              当前绑定的数据层暂无方法
            </template>
            <template v-else> 暂无其它数据层方法，请先在数据层创建 </template>
          </p>
        </el-form-item>

        <el-form-item
          v-if="methodParams.length"
          label="绑定入参"
          required
          :error="bindingError || undefined"
        >
          <div class="param-bindings">
            <div
              v-for="p in methodParams"
              :key="p.id"
              class="param-row"
            >
              <span
                class="param-name"
                :title="`${p.remark || p.name} · ${paramTypeLabel(p)}`"
              >
                {{ p.name }}
                <em class="param-type">{{ paramTypeLabel(p) }}</em>
              </span>
              <TypedBindingCascader
                v-model="draft.paramBindings[p.name]"
                class="param-bind"
                :ambient-vars="ambientVars"
                :target-type="p.typeExpr"
                :type-library="typeLibrary"
              />
            </div>
          </div>
        </el-form-item>
        <el-form-item v-else-if="selectedMethodKey" label="绑定入参">
          <span class="hint-inline">该方法无入参</span>
        </el-form-item>
      </template>

      <el-form-item
        label="结果变量名"
        required
        :error="draft.varName ? varNameError : ''"
      >
        <el-input
          v-model="draft.varName"
          placeholder="如 goodsList"
          maxlength="64"
        />
      </el-form-item>
      <el-form-item label="打印">
        <FlowPrintField
          v-model="draft.printExpr"
          :ambient-names="ambientVars.map((v) => v.name).filter(Boolean)"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button type="primary" :disabled="!canSave" @click="handleSave">
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}

.header-field-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.custom-header-input {
  width: 100%;
}

.hint-inline {
  font-size: 12px;
  color: #909399;
}

.param-bindings {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.param-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
}

.param-name {
  flex: 0 0 128px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f5f7fa;
  font-size: 13px;
  color: #606266;
  line-height: 30px;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  white-space: nowrap;
}

.param-type {
  font-style: normal;
  font-size: 11px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.param-bind {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
}

.flow-node-form :deep(.el-form-item__content) {
  flex: 1;
  min-width: 0;
}
</style>
