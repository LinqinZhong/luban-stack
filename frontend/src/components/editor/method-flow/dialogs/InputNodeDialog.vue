<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { getServiceProcessors } from '../../../../api/projects'
import type {
  ProcessorMethodParam,
  ServiceProcessor,
} from '../../../../types/backend-services'
import type { DataTypeLibrary } from '../../../../types/data-types'
import type { MethodParam } from '../../../../types/page-method'
import { processorTypeExprToTs } from '../../../../types/page-method'
import TypedBindingCascader from '../TypedBindingCascader.vue'
import FlowPrintField from '../FlowPrintField.vue'
import NetworkRequestFields from './NetworkRequestFields.vue'
import {
  INPUT_HEADER_CUSTOM,
  INPUT_HEADER_FIELD_OPTIONS,
  INPUT_HEADER_PRESET_FIELDS,
  createEmptyInputNodeForm,
  normalizeInputDataSource,
  type InputDataSource,
  type InputModuleOption,
  type InputNodeForm,
} from './input-node'
import {
  createEmptyNetworkInputConfig,
  networkSummaryLabel,
  validateNetworkParamRows,
} from './network-request'

const props = defineProps<{
  modelValue: boolean
  form: InputNodeForm
  projectPath: string
  /** 当前正在编辑的模块（服务）id */
  currentServiceId: string
  /** 全部模块选项 */
  moduleOptions: InputModuleOption[]
  /** 当前服务全部业务层处理器 */
  businessProcessors: ServiceProcessor[]
  /** 当前服务全部数据层处理器 */
  dataProcessors: ServiceProcessor[]
  /** 当前正在编辑的业务处理器 */
  currentProcessorId: string
  /** 当前正在编辑的业务方法（当前业务来源中排除自身） */
  currentMethodId: string
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

const draft = reactive<InputNodeForm>(createEmptyInputNodeForm())

/** 请求头下拉：预设或「自定义」 */
const headerKind = ref<string>('user-id')
/** 自定义请求头名 */
const customHeaderName = ref('')

const remoteBusiness = ref<ServiceProcessor[]>([])
const remoteData = ref<ServiceProcessor[]>([])
const loadingProcessors = ref(false)
const processorCache = new Map<
  string,
  { business: ServiceProcessor[]; data: ServiceProcessor[] }
>()

const businessOnly = computed(() => props.sourceMode === 'business')

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const isNetwork = computed(() => draft.channel === 'network')
const isHeaderSource = computed(
  () => !isNetwork.value && draft.dataSource === 'request_header',
)
const isBusinessSource = computed(() => draft.dataSource === 'business')

function onChannelChange(channel: string | number | boolean | undefined) {
  draft.channel = channel === 'network' ? 'network' : 'local'
  if (draft.channel === 'network') {
    draft.network = createEmptyNetworkInputConfig(draft.network)
  }
}

const layerOptions = computed(() => {
  const opts: Array<{ value: InputDataSource; label: string }> = [
    { value: 'business', label: '业务层' },
  ]
  if (!businessOnly.value) {
    opts.push({ value: 'data', label: '数据层' })
    opts.push({ value: 'request_header', label: '请求头' })
  }
  return opts
})

const methodFieldLabel = computed(() => {
  if (isHeaderSource.value) return '请求头字段'
  if (isBusinessSource.value || businessOnly.value) return '业务方法'
  return '数据层方法'
})

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

function coerceLayer(source: InputDataSource): InputDataSource {
  if (businessOnly.value) return 'business'
  if (source === 'request_header') return 'request_header'
  if (source === 'business' || source === 'data') return source
  return 'data'
}

function clearMethodSelection() {
  draft.dataProcessorId = ''
  draft.dataMethodId = ''
  draft.methodLabel = ''
  draft.paramBindings = {}
}

async function ensureProcessorsForModule(serviceId: string) {
  const sid = serviceId.trim()
  if (!sid || !props.projectPath) {
    remoteBusiness.value = []
    remoteData.value = []
    return
  }
  if (sid === props.currentServiceId) {
    remoteBusiness.value = props.businessProcessors
    remoteData.value = props.dataProcessors
    return
  }
  const cached = processorCache.get(sid)
  if (cached) {
    remoteBusiness.value = cached.business
    remoteData.value = cached.data
    return
  }
  loadingProcessors.value = true
  try {
    const [biz, data] = await Promise.all([
      getServiceProcessors(props.projectPath, sid, 'business'),
      getServiceProcessors(props.projectPath, sid, 'data'),
    ])
    const next = {
      business: biz.processors ?? [],
      data: data.processors ?? [],
    }
    processorCache.set(sid, next)
    remoteBusiness.value = next.business
    remoteData.value = next.data
  } catch {
    remoteBusiness.value = []
    remoteData.value = []
  } finally {
    loadingProcessors.value = false
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    const next: InputNodeForm = createEmptyInputNodeForm({
      ...props.form,
      paramBindings: { ...(props.form.paramBindings ?? {}) },
      network: props.form.network,
    })
    next.dataSource = coerceLayer(
      normalizeInputDataSource(next.dataSource, {
        businessOnly: businessOnly.value,
      }),
    )
    if (!next.serviceId.trim()) {
      next.serviceId = props.currentServiceId
    }
    Object.assign(draft, next)
    syncHeaderUiFromField(next.headerField)
    if (next.dataSource !== 'request_header') {
      await ensureProcessorsForModule(next.serviceId)
    }
  },
)

watch(
  () => draft.dataSource,
  async (source, prev) => {
    if (!props.modelValue) return
    if (source === prev) return
    clearMethodSelection()
    if (source === 'request_header') {
      headerKind.value = 'user-id'
      customHeaderName.value = ''
      draft.headerField = 'user-id'
      return
    }
    if (!draft.serviceId.trim()) {
      draft.serviceId = props.currentServiceId
    }
    await ensureProcessorsForModule(draft.serviceId)
  },
)

watch(
  () => draft.serviceId,
  async (sid, prev) => {
    if (!props.modelValue || isHeaderSource.value) return
    if (sid === prev) return
    clearMethodSelection()
    await ensureProcessorsForModule(sid)
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

const activeProcessors = computed(() => {
  if (isHeaderSource.value) return [] as ServiceProcessor[]
  if (isBusinessSource.value) return remoteBusiness.value
  return remoteData.value
})

const methodOptions = computed((): MethodOpt[] => {
  if (isHeaderSource.value) return []
  const sameModule = draft.serviceId.trim() === props.currentServiceId
  if (isBusinessSource.value) {
    return collectMethods(remoteBusiness.value, (proc, methodId) => {
      if (
        sameModule &&
        props.currentProcessorId &&
        proc.id === props.currentProcessorId &&
        methodId === props.currentMethodId
      ) {
        return false
      }
      return true
    })
  }
  return collectMethods(remoteData.value)
})

const selectedMethod = computed(() => {
  for (const proc of activeProcessors.value) {
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
      clearMethodSelection()
      return
    }
    draft.dataProcessorId = opt.processorId
    draft.dataMethodId = opt.methodId
    draft.methodLabel = opt.label
    const method = activeProcessors.value
      .find((p) => p.id === opt.processorId)
      ?.methods.find((m) => m.id === opt.methodId)
    syncParamBindings(method?.params ?? [])
  },
})

watch(
  methodParams,
  (params) => {
    if (isHeaderSource.value) return
    if (!params.length && !Object.keys(draft.paramBindings).length) return
    syncParamBindings(params)
  },
  { deep: true },
)

function identError(name: string, label: string, required: boolean): string {
  const n = name.trim()
  if (!n) return required ? `请填写${label}` : ''
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
    return `${label}须为合法标识符`
  }
  if (props.reservedNames.includes(n)) {
    return `${label}与已有名称冲突`
  }
  return ''
}

const varNameError = computed(() => {
  if (isNetwork.value) return ''
  return identError(draft.varName, '变量名', true)
})

const responseBodyVarError = computed(() => {
  if (!isNetwork.value) return ''
  return identError(draft.network.responseBodyVarName, '响应体变量名', true)
})

const responseHeaderVarError = computed(() => {
  if (!isNetwork.value) return ''
  return identError(draft.network.responseHeaderVarName, '响应头变量名', false)
})

const statusCodeVarError = computed(() => {
  if (!isNetwork.value) return ''
  return identError(draft.network.statusCodeVarName, '状态码变量名', false)
})

const networkError = computed(() => {
  if (!isNetwork.value) return ''
  if (!draft.network.apiUrl.trim()) return '请填写 API 地址'
  const h = validateNetworkParamRows(draft.network.headers, '请求头')
  if (h) return h
  const q = validateNetworkParamRows(draft.network.queryParams, '查询参数')
  if (q) return q
  const f = validateNetworkParamRows(draft.network.formParams, '表单参数')
  if (f) return f
  if (responseBodyVarError.value) return responseBodyVarError.value
  if (responseHeaderVarError.value) return responseHeaderVarError.value
  if (statusCodeVarError.value) return statusCodeVarError.value
  return ''
})

const bindingError = computed(() => {
  if (isNetwork.value || isHeaderSource.value) return ''
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

const moduleError = computed(() => {
  if (isNetwork.value || isHeaderSource.value) return ''
  if (!draft.serviceId.trim()) return '请选择模块'
  return ''
})

function paramTypeLabel(p: ProcessorMethodParam): string {
  return processorTypeExprToTs(p.typeExpr, props.typeLibrary)
}

const canSave = computed(() => {
  if (isNetwork.value) return !networkError.value
  if (varNameError.value) return false
  if (isHeaderSource.value) return !headerError.value
  return (
    !moduleError.value &&
    !bindingError.value &&
    Boolean(draft.dataProcessorId && draft.dataMethodId)
  )
})

function handleSave() {
  if (!canSave.value) return
  if (isNetwork.value) {
    const network = createEmptyNetworkInputConfig({
      ...draft.network,
      apiUrl: draft.network.apiUrl.trim(),
      bodyVarName: draft.network.bodyVarName.trim(),
      responseBodyVarName: draft.network.responseBodyVarName.trim(),
      responseHeaderVarName: draft.network.responseHeaderVarName.trim(),
      statusCodeVarName: draft.network.statusCodeVarName.trim(),
    })
    const label = networkSummaryLabel(network)
    emit('save', {
      ...createEmptyInputNodeForm(),
      channel: 'network',
      varName: network.responseBodyVarName,
      methodLabel: label,
      printExpr: draft.printExpr.trim(),
      network,
    })
    visible.value = false
    return
  }
  if (isHeaderSource.value) {
    const field = resolvedHeaderField()
    emit('save', {
      ...createEmptyInputNodeForm(),
      channel: 'local',
      serviceId: '',
      dataSource: 'request_header',
      headerField: field,
      varName: draft.varName.trim(),
      methodLabel: `请求头.${field}`,
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
    ...createEmptyInputNodeForm(),
    channel: 'local',
    serviceId: draft.serviceId.trim() || props.currentServiceId,
    dataSource: draft.dataSource,
    dataProcessorId: draft.dataProcessorId,
    dataMethodId: draft.dataMethodId,
    headerField: '',
    varName: draft.varName.trim(),
    methodLabel: draft.methodLabel,
    paramBindings,
    printExpr: draft.printExpr.trim(),
    outputTypeExpr: selectedMethod.value?.output
      ? { ...selectedMethod.value.output }
      : null,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="编辑输入节点"
    :width="isNetwork ? '720px' : '560px'"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="flow-node-form"
      label-position="right"
      label-width="110px"
      size="small"
    >
      <el-form-item label="类型" required>
        <el-radio-group
          :model-value="draft.channel"
          size="small"
          @update:model-value="onChannelChange"
        >
          <el-radio-button value="local">本地</el-radio-button>
          <el-radio-button value="network">网络</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <template v-if="isNetwork">
        <NetworkRequestFields
          v-model="draft.network"
          :ambient-vars="ambientVars"
        />
        <el-form-item label="响应体类型" required>
          <el-select
            v-model="draft.network.responseBodyType"
            size="small"
            style="width: 100%"
          >
            <el-option label="字符串" value="string" />
            <el-option label="JSON" value="json" />
          </el-select>
        </el-form-item>
        <el-form-item
          label="响应体变量名"
          required
          :error="responseBodyVarError || undefined"
        >
          <el-input
            v-model="draft.network.responseBodyVarName"
            size="small"
            placeholder="如 responseBody"
            maxlength="64"
          />
        </el-form-item>
        <el-form-item
          label="响应头变量名"
          :error="responseHeaderVarError || undefined"
        >
          <el-input
            v-model="draft.network.responseHeaderVarName"
            size="small"
            placeholder="可选，为空则不接收"
            maxlength="64"
            clearable
          />
        </el-form-item>
        <el-form-item
          label="状态码变量名"
          :error="statusCodeVarError || undefined"
        >
          <el-input
            v-model="draft.network.statusCodeVarName"
            size="small"
            placeholder="可选，为空则不接收"
            maxlength="64"
            clearable
          />
        </el-form-item>
        <el-form-item v-if="networkError" label=" ">
          <span class="hint-inline error-hint">{{ networkError }}</span>
        </el-form-item>
        <el-form-item label="打印">
          <FlowPrintField
            v-model="draft.printExpr"
            :ambient-names="ambientVars.map((v) => v.name).filter(Boolean)"
          />
        </el-form-item>
      </template>

      <template v-else>
      <el-form-item
        v-if="!isHeaderSource"
        label="模块"
        required
        :error="moduleError || undefined"
      >
        <el-select
          v-model="draft.serviceId"
          filterable
          placeholder="选择模块"
          style="width: 100%"
        >
          <el-option
            v-for="opt in moduleOptions"
            :key="opt.id"
            :label="opt.name ? `${opt.name}（${opt.id}）` : opt.id"
            :value="opt.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item v-if="layerOptions.length > 1" label="层" required>
        <el-select
          v-model="draft.dataSource"
          placeholder="选择层"
          style="width: 100%"
        >
          <el-option
            v-for="opt in layerOptions"
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
            :loading="loadingProcessors"
            :placeholder="
              isBusinessSource || businessOnly
                ? '选择业务层方法'
                : '选择数据层方法'
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
          <p v-if="!loadingProcessors && !methodOptions.length" class="hint">
            <template v-if="isBusinessSource || businessOnly">
              该模块暂无业务层方法
            </template>
            <template v-else> 该模块暂无数据层方法 </template>
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
      </template>
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

.error-hint {
  color: var(--el-color-danger);
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
