<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getBackendServiceLibrary,
  getServiceControllers,
} from '../../api/projects'
import type {
  BackendService,
  ProcessorTypeExpr,
  ServiceApi,
  ServiceApiParam,
  ServiceController,
} from '../../types/backend-services'
import {
  createEmptyProcessorTypeExpr,
  normalizeProcessorTypeExpr,
} from '../../types/backend-services'
import type { DataField } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import type { PageQueryParamDef } from '../../types/page-query'
import {
  dataFieldsToAmbientVars,
  type MethodParam,
} from '../../types/page-method'
import {
  API_PROP_LITERAL_SELECT,
  apiMatchesApiPropConstraint,
  createEmptyApiPropBinding,
  isApiPropParamBoundConfigured,
  parseApiPropBinding,
  serializeApiPropBinding,
  type ApiPropBinding,
  type ApiPropParamBinding,
} from '../../utils/api-prop'
import {
  buildFlatSelectableBindingOptions,
  buildQueryBindingRoot,
} from '../../utils/typed-binding-paths'

const props = defineProps<{
  modelValue: string
  projectPath: string
  apiParams?: MethodParam[] | null
  apiReturnType?: ProcessorTypeExpr | null
  /** 页面数据池（入参绑定可选） */
  dataFields?: DataField[] | null
  pageQueryParams?: PageQueryParamDef[] | null
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const dialogVisible = ref(false)
const services = ref<BackendService[]>([])
const controllers = ref<ServiceController[]>([])
const loadingServices = ref(false)
const loadingControllers = ref(false)

/** 外层展示用（已保存） */
const saved = ref<ApiPropBinding>(createEmptyApiPropBinding())
/** 弹窗草稿 */
const draft = ref<ApiPropBinding>(createEmptyApiPropBinding())

function syncFromModel(raw: string) {
  saved.value = parseApiPropBinding(raw) ?? createEmptyApiPropBinding()
}

watch(
  () => props.modelValue,
  (raw) => syncFromModel(raw ?? ''),
  { immediate: true },
)

watch(
  () => props.projectPath,
  async (path) => {
    if (!path) {
      services.value = []
      return
    }
    loadingServices.value = true
    try {
      const lib = await getBackendServiceLibrary(path)
      services.value = lib.services ?? []
    } catch {
      services.value = []
    } finally {
      loadingServices.value = false
    }
  },
  { immediate: true },
)

watch(
  () =>
    [props.projectPath, dialogVisible.value ? draft.value.serviceId : ''] as const,
  async ([path, serviceId]) => {
    if (!path || !serviceId) {
      controllers.value = []
      return
    }
    loadingControllers.value = true
    try {
      const res = await getServiceControllers(path, serviceId)
      controllers.value = res.controllers ?? []
    } catch {
      controllers.value = []
    } finally {
      loadingControllers.value = false
    }
  },
  { immediate: true },
)

const selectedController = computed(() =>
  controllers.value.find((c) => c.id === draft.value.controllerId) ?? null,
)

const matchingApis = computed(() => {
  const apis = selectedController.value?.apis ?? []
  return apis.filter((api) =>
    apiMatchesApiPropConstraint(api, {
      apiParams: props.apiParams,
      apiReturnType: props.apiReturnType,
    }),
  )
})

const selectedApi = computed((): ServiceApi | null => {
  const id = draft.value.apiId
  if (!id) return null
  return matchingApis.value.find((a) => a.id === id) ?? null
})

const formalParamNames = computed(() => {
  const set = new Set<string>()
  for (const p of props.apiParams ?? []) {
    const n = p.name.trim()
    if (n) set.add(n)
  }
  return set
})

/** 全部 API 入参（形参置灰展示，额外入参可绑定） */
const allApiInputs = computed((): ServiceApiParam[] => {
  const api = selectedApi.value
  if (!api) return []
  return (api.inputs ?? []).filter((inp) => Boolean(inp.varName.trim()))
})

/** 组件形参之外的 API 入参，需在页面侧绑定 */
const extraApiInputs = computed((): ServiceApiParam[] =>
  allApiInputs.value.filter(
    (inp) => !formalParamNames.value.has(inp.varName.trim()),
  ),
)

function isFormalParam(inp: ServiceApiParam): boolean {
  return formalParamNames.value.has(inp.varName.trim())
}

function apiParamTypeExpr(inp: ServiceApiParam): ProcessorTypeExpr {
  return normalizeProcessorTypeExpr({
    ...createEmptyProcessorTypeExpr(inp.typeRef ? 'json' : inp.type || 'string'),
    type: inp.typeRef ? 'json' : inp.type || 'string',
    typeRef: inp.typeRef || '',
    genericArgs: { ...(inp.genericArgs ?? {}) },
  })
}

function apiParamTypeLabel(inp: ServiceApiParam): string {
  if (inp.typeRef) return inp.typeRef
  return inp.type || 'string'
}

const bindingAmbientVars = computed((): MethodParam[] =>
  dataFieldsToAmbientVars(props.dataFields ?? [], props.typeLibrary),
)

function queryExtraRoots(targetType: ProcessorTypeExpr) {
  const root = buildQueryBindingRoot(
    props.pageQueryParams,
    targetType,
    props.typeLibrary,
  )
  return root ? [root] : []
}

function bindingOptionsFor(inp: ServiceApiParam) {
  const target = apiParamTypeExpr(inp)
  return buildFlatSelectableBindingOptions(
    bindingAmbientVars.value,
    target,
    props.typeLibrary,
    queryExtraRoots(target),
  )
}

function syncParamBindingsForApi(api: ServiceApi | null) {
  const next: Record<string, ApiPropParamBinding> = {}
  const prev = draft.value.paramBindings ?? {}
  for (const inp of api?.inputs ?? []) {
    const name = inp.varName.trim()
    if (!name || formalParamNames.value.has(name)) continue
    const old = prev[name]
    if (old?.source === 'literal') {
      next[name] = { source: 'literal', literal: old.literal ?? '' }
    } else if (old?.source === 'binding' && (old.binding ?? '').trim()) {
      next[name] = { source: 'binding', binding: old.binding!.trim() }
    } else {
      next[name] = { source: 'binding', binding: '' }
    }
  }
  draft.value = { ...draft.value, paramBindings: next }
}

function openDialog() {
  draft.value = {
    ...saved.value,
    paramBindings: { ...(saved.value.paramBindings ?? {}) },
  }
  dialogVisible.value = true
}

function onServiceChange(serviceId: string | null) {
  draft.value = {
    ...draft.value,
    serviceId: serviceId?.trim() || '',
    controllerId: '',
    apiId: '',
    paramBindings: {},
  }
}

function onControllerChange(controllerId: string | null) {
  draft.value = {
    ...draft.value,
    controllerId: controllerId?.trim() || '',
    apiId: '',
    paramBindings: {},
  }
}

function onApiChange(apiId: string | null) {
  draft.value = {
    ...draft.value,
    apiId: apiId?.trim() || '',
  }
  const api = matchingApis.value.find((a) => a.id === draft.value.apiId) ?? null
  syncParamBindingsForApi(api)
}

function paramBindingOf(name: string): ApiPropParamBinding {
  return (
    draft.value.paramBindings?.[name] ?? { source: 'binding', binding: '' }
  )
}

function paramSelectValue(name: string): string | undefined {
  const cfg = paramBindingOf(name)
  if (cfg.source === 'literal') return API_PROP_LITERAL_SELECT
  const b = (cfg.binding ?? '').trim()
  return b || undefined
}

function onParamSelectChange(name: string, value: string | null | undefined) {
  const v = String(value ?? '').trim()
  const next: ApiPropParamBinding =
    v === API_PROP_LITERAL_SELECT
      ? {
          source: 'literal',
          literal: paramBindingOf(name).source === 'literal'
            ? paramBindingOf(name).literal ?? ''
            : '',
        }
      : { source: 'binding', binding: v }
  draft.value = {
    ...draft.value,
    paramBindings: {
      ...(draft.value.paramBindings ?? {}),
      [name]: next,
    },
  }
}

function onParamLiteralChange(name: string, value: string) {
  draft.value = {
    ...draft.value,
    paramBindings: {
      ...(draft.value.paramBindings ?? {}),
      [name]: { source: 'literal', literal: value },
    },
  }
}

function apiLabel(api: ServiceApi): string {
  const method = (api.method || 'GET').toUpperCase()
  const path = api.path?.trim() || '/'
  return `${api.name || api.id} · ${method} ${path}`.trim()
}

const unmatchedHint = computed(() => {
  const total = selectedController.value?.apis?.length ?? 0
  const matched = matchingApis.value.length
  if (!draft.value.controllerId || total === 0) return ''
  if (matched === total) return ''
  return `已按入参/出参过滤：${matched}/${total} 个接口可选`
})

const summaryText = computed(() => {
  const b = saved.value
  if (!b.serviceId || !b.controllerId || !b.apiId) return '未配置'
  const svc =
    services.value.find((s) => s.id === b.serviceId)?.name || b.serviceId
  return `${svc} / ${b.controllerId} / ${b.apiId}`
})

function clearBinding() {
  saved.value = createEmptyApiPropBinding()
  emit('update:modelValue', '')
  emit('change', '')
}

function handleSave() {
  if (!draft.value.serviceId || !draft.value.controllerId || !draft.value.apiId) {
    ElMessage.warning('请选择服务、控制器与 API')
    return
  }
  const unbound = extraApiInputs.value
    .filter((inp) => inp.required)
    .map((inp) => inp.varName.trim())
    .filter((name) => !isApiPropParamBoundConfigured(draft.value.paramBindings?.[name]))
  if (unbound.length) {
    ElMessage.warning(`请完成入参绑定：${unbound.join('、')}`)
    return
  }
  const next = serializeApiPropBinding(draft.value)
  saved.value = parseApiPropBinding(next) ?? draft.value
  emit('update:modelValue', next)
  emit('change', next)
  dialogVisible.value = false
}

watch(selectedApi, (api) => {
  if (!dialogVisible.value) return
  if (!api) return
  // 打开后 controllers 异步加载完成时，补齐绑定行
  if (draft.value.apiId === api.id) syncParamBindingsForApi(api)
})
</script>

<template>
  <div class="api-prop-bind">
    <div class="summary-row">
      <span class="summary-text" :title="summaryText">{{ summaryText }}</span>
      <el-button type="primary" link @click="openDialog">配置</el-button>
      <el-button
        v-if="saved.serviceId"
        type="danger"
        link
        @click="clearBinding"
      >
        清除
      </el-button>
    </div>

    <el-dialog
      v-model="dialogVisible"
      title="配置后端 API"
      width="560px"
      destroy-on-close
      append-to-body
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form label-position="top" class="bind-form" @submit.prevent>
        <el-form-item label="后端服务" required>
          <el-select
            :model-value="draft.serviceId || undefined"
            clearable
            filterable
            placeholder="选择后端服务"
            :loading="loadingServices"
            style="width: 100%"
            @update:model-value="onServiceChange"
          >
            <el-option
              v-for="svc in services"
              :key="svc.id"
              :label="svc.name || svc.id"
              :value="svc.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="控制器" required>
          <el-select
            :model-value="draft.controllerId || undefined"
            clearable
            filterable
            placeholder="选择控制器"
            :loading="loadingControllers"
            :disabled="!draft.serviceId"
            style="width: 100%"
            @update:model-value="onControllerChange"
          >
            <el-option
              v-for="ctrl in controllers"
              :key="ctrl.id"
              :label="`${ctrl.name || ctrl.id}${ctrl.path ? ` · ${ctrl.path}` : ''}`"
              :value="ctrl.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="API" required>
          <el-select
            :model-value="draft.apiId || undefined"
            clearable
            filterable
            placeholder="选择 API（组件形参与出参须匹配）"
            :disabled="!draft.controllerId"
            style="width: 100%"
            @update:model-value="onApiChange"
          >
            <el-option
              v-for="api in matchingApis"
              :key="api.id"
              :label="apiLabel(api)"
              :value="api.id"
            />
          </el-select>
          <p v-if="unmatchedHint" class="hint">{{ unmatchedHint }}</p>
        </el-form-item>

        <el-form-item
          v-if="selectedApi && allApiInputs.length"
          label="入参绑定"
          :required="extraApiInputs.some((i) => i.required)"
        >
          <div class="param-bindings">
            <div
              v-for="inp in allApiInputs"
              :key="inp.id"
              class="param-row"
              :class="{ 'is-formal': isFormalParam(inp) }"
            >
              <span
                class="param-name"
                :title="`${inp.remark || inp.varName} · ${apiParamTypeLabel(inp)}`"
              >
                {{ inp.varName }}
                <em v-if="inp.required && !isFormalParam(inp)" class="req">*</em>
                <em class="param-type">{{ apiParamTypeLabel(inp) }}</em>
              </span>
              <el-input
                v-if="isFormalParam(inp)"
                class="param-bind"
                model-value="由调用时传入（形参）"
                disabled
              />
              <div v-else class="param-bind-row">
                <el-select
                  class="param-source"
                  :model-value="paramSelectValue(inp.varName)"
                  filterable
                  clearable
                  placeholder="选择数据池 / $query"
                  @update:model-value="
                    onParamSelectChange(inp.varName, $event as string | null)
                  "
                >
                  <el-option
                    :label="'常量'"
                    :value="API_PROP_LITERAL_SELECT"
                  />
                  <el-option
                    v-for="opt in bindingOptionsFor(inp)"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <el-input
                  v-if="paramBindingOf(inp.varName).source === 'literal'"
                  class="param-literal"
                  :model-value="paramBindingOf(inp.varName).literal ?? ''"
                  :placeholder="
                    inp.type === 'number'
                      ? '输入数字常量'
                      : inp.type === 'boolean'
                        ? 'true / false'
                        : inp.type === 'time'
                          ? 'HH:mm:ss'
                          : inp.type === 'date'
                            ? 'YYYY-MM-DD'
                            : inp.type === 'datetime'
                              ? 'YYYY-MM-DD HH:mm:ss'
                              : '输入常量'
                  "
                  @update:model-value="
                    onParamLiteralChange(inp.varName, String($event ?? ''))
                  "
                />
              </div>
            </div>
          </div>
          <p class="hint">
            组件形参由调用时传入（置灰）；其余 API 入参在此绑定。
          </p>
        </el-form-item>
        <el-form-item v-else-if="selectedApi" label="入参绑定">
          <span class="hint">该方法无入参</span>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSave">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.api-prop-bind {
  width: 100%;
}

.summary-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.summary-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bind-form {
  padding-right: 4px;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
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

.param-row.is-formal .param-name {
  color: #a8abb2;
  background: #f0f2f5;
}

.param-name {
  flex: 0 0 132px;
  box-sizing: border-box;
  height: 32px;
  padding: 0 8px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #f5f7fa;
  font-size: 13px;
  color: #606266;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  white-space: nowrap;
}

.param-bind-row {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.param-source {
  flex: 1 1 0;
  min-width: 0;
}

.param-literal {
  flex: 1 1 0;
  min-width: 80px;
}

.req {
  font-style: normal;
  color: #f56c6c;
}

.param-type {
  font-style: normal;
  font-size: 11px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.param-bind {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
}
</style>
