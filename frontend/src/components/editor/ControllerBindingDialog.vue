<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getBackendServiceLibrary,
  getServiceControllers,
  getServiceProcessors,
} from '../../api/projects'
import type {
  BackendService,
  ProcessorTypeExpr,
  ServiceApi,
  ServiceApiParam,
  ServiceApiParamLocation,
  ServiceController,
  ServiceProcessor,
} from '../../types/backend-services'
import { createEmptyProcessorTypeExpr } from '../../types/backend-services'
import {
  createEmptyControllerBinding,
  type ControllerBindingConfig,
  type ControllerInputParamConfig,
  type ControllerInputSource,
  type DataField,
} from '../../types/page-data'
import {
  buildTypeLibraryAmbientDeclarations,
  countEventBindings,
  dataFieldToMethodParamType,
  dataFieldToTsType,
  dataFieldsToAmbientVars,
  type MethodParam,
  type MethodReturnType,
  type PageMethod,
} from '../../types/page-method'
import type { ComponentPropDef } from '../../types/component'
import type { ComponentEventDef } from '../../types/component'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import type { DataTypeDef, DataTypeLibrary, TypeExpr } from '../../types/data-types'
import { buildDollarPropsAmbientDeclaration } from '../../utils/component-props'
import { buildGetDeviceInfoAmbientDeclaration } from '../../utils/device-info'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import { resolveFlowReturnMethodParam } from './method-flow/method-flow-debug'
import TypedBindingCascader from './method-flow/TypedBindingCascader.vue'
import TsCodeEditor from './TsCodeEditor.vue'
import EventBindDialog from './EventBindDialog.vue'

type EventKind = 'onLoading' | 'onSuccess' | 'onError'
type LiteralMode = 'scalar' | 'object' | 'json'
type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'array'

type ObjectFieldForm = {
  name: string
  remark: string
  kind: FieldKind
  enumOptions: string[]
}

const props = defineProps<{
  modelValue: boolean
  field: DataField | null
  projectPath: string
  methods?: PageMethod[]
  dataFields?: DataField[]
  xml?: string
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  iconOptions?: Array<{ id: string; label: string }>
  componentProps?: ComponentPropDef[] | null
  emitEvents?: ComponentEventDef[]
  typeLibrary?: DataTypeLibrary | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [config: ControllerBindingConfig]
}>()

const draft = ref<ControllerBindingConfig>(createEmptyControllerBinding())
const editorRef = ref<{ getBody: () => string } | null>(null)
/** json/array 固定值的文本草稿（按 varName） */
const jsonTextDraft = ref<Record<string, string>>({})

const services = ref<BackendService[]>([])
const controllers = ref<ServiceController[]>([])
const businessProcessors = ref<ServiceProcessor[]>([])
const dataProcessors = ref<ServiceProcessor[]>([])
const loadingServices = ref(false)
const loadingControllers = ref(false)

const eventBindVisible = ref(false)
const eventBindKind = ref<EventKind>('onLoading')

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

const fieldName = computed(() => props.field?.name.trim() || '未命名字段')

const returnType = computed<MethodReturnType>(() =>
  dataFieldToMethodParamType(props.field?.type ?? 'string'),
)

const returnTypeTs = computed(() =>
  props.field ? dataFieldToTsType(props.field, props.typeLibrary) : 'any',
)

const selectedApi = computed<ServiceApi | null>(() => {
  const ctrl = controllers.value.find((c) => c.id === draft.value.controllerId)
  return ctrl?.apis.find((a) => a.id === draft.value.apiId) ?? null
})

const apiDataParam = computed<MethodParam>(() =>
  resolveFlowReturnMethodParam({
    flow: selectedApi.value?.flow,
    dataProcessors: dataProcessors.value,
    businessProcessors: businessProcessors.value,
    typeLibrary: props.typeLibrary,
  }),
)

const parseParams = computed<MethodParam[]>(() => [apiDataParam.value])

const ambientExtra = computed(() =>
  [
    buildTypeLibraryAmbientDeclarations(props.typeLibrary),
    buildGetDeviceInfoAmbientDeclaration(),
    buildDollarPropsAmbientDeclaration(props.componentProps, props.typeLibrary),
  ]
    .filter(Boolean)
    .join('\n'),
)

const functionName = computed(() =>
  fieldName.value === '未命名字段' ? 'parse' : `parse_${fieldName.value}`,
)

const apiOptions = computed(() => {
  const ctrl = controllers.value.find((c) => c.id === draft.value.controllerId)
  return ctrl?.apis ?? []
})

/** 绑定入参可选：同级数据池（排除自身） */
const bindingAmbientVars = computed(() =>
  dataFieldsToAmbientVars(
    (props.dataFields ?? []).filter(
      (f) => f.name.trim() && f.name.trim() !== fieldName.value,
    ),
    props.typeLibrary,
  ),
)

const eventRows = computed(() => [
  {
    kind: 'onLoading' as const,
    label: '开始加载',
    raw: draft.value.onLoading,
  },
  {
    kind: 'onSuccess' as const,
    label: '加载成功',
    raw: draft.value.onSuccess,
  },
  {
    kind: 'onError' as const,
    label: '加载失败',
    raw: draft.value.onError,
  },
])

const eventBindLabel = computed(() => {
  const row = eventRows.value.find((r) => r.kind === eventBindKind.value)
  return row?.label ?? '事件'
})

const eventBindRaw = computed(() => draft.value[eventBindKind.value] ?? '')

/** 控制器加载事件形参：成功/失败带 res */
const controllerEventParams = computed<MethodParam[]>(() => {
  if (eventBindKind.value === 'onLoading') return []
  if (eventBindKind.value === 'onError') {
    return [{ name: 'res', type: 'any', tsType: 'unknown' }]
  }
  // onSuccess：res = 解析后写入本字段的值
  const field = props.field
  if (!field) return [{ name: 'res', type: 'any', tsType: 'any' }]
  return [
    {
      name: 'res',
      type: dataFieldToMethodParamType(field.type),
      tsType: dataFieldToTsType(field, props.typeLibrary),
    },
  ]
})

function formatApiLabel(api: ServiceApi): string {
  const name = api.name.trim() || api.id
  const path = api.path.trim() || '/'
  return `${name} (${path}) · ${api.method}`
}

function formatControllerLabel(ctrl: ServiceController): string {
  const name = ctrl.name.trim() || ctrl.id
  return ctrl.path.trim() ? `${name} (${ctrl.path})` : name
}

function locationLabel(loc: ServiceApiParamLocation): string {
  switch (loc) {
    case 'query':
      return 'query'
    case 'param':
      return 'param'
    case 'body':
      return 'body'
    case 'httpHeader':
      return 'header'
    default:
      return loc
  }
}

function locationClass(loc: ServiceApiParamLocation): string {
  return `loc-${loc === 'httpHeader' ? 'header' : loc}`
}

function namedTypeLabel(typeRef: string): string {
  if (!typeRef) return ''
  return findDataTypeDef(props.typeLibrary, typeRef)?.name || typeRef
}

function apiParamTypeLabel(p: ServiceApiParam): string {
  if (p.typeRef) return namedTypeLabel(p.typeRef) || p.typeRef
  return p.type || 'string'
}

function apiParamToTypeExpr(p: ServiceApiParam): ProcessorTypeExpr {
  if (p.typeRef) {
    return {
      ...createEmptyProcessorTypeExpr('json'),
      typeRef: p.typeRef,
    }
  }
  return createEmptyProcessorTypeExpr(p.type || 'string')
}

function primaryAtom(expr: TypeExpr | undefined | null) {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
}

function fieldKindFromTypeExpr(
  expr: TypeExpr,
  library: DataTypeLibrary | null | undefined,
): { kind: FieldKind; enumOptions: string[] } {
  const mapped = typeExprToDataFieldType(expr, library)
  if (mapped.type === 'number') return { kind: 'number', enumOptions: [] }
  if (mapped.type === 'boolean') return { kind: 'boolean', enumOptions: [] }
  if (mapped.type === 'array') return { kind: 'array', enumOptions: [] }
  if (mapped.typeRef) {
    const def = findDataTypeDef(library, mapped.typeRef)
    if (def?.kind === 'enum') {
      return {
        kind: 'enum',
        enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
      }
    }
    if (def?.kind === 'interface') {
      return { kind: 'json', enumOptions: [] }
    }
  }
  const atom = primaryAtom(expr)
  if (atom.kind === 'number') return { kind: 'number', enumOptions: [] }
  if (atom.kind === 'boolean') return { kind: 'boolean', enumOptions: [] }
  return { kind: 'string', enumOptions: [] }
}

function objectFieldsOf(def: DataTypeDef | null): ObjectFieldForm[] {
  if (!def || def.kind !== 'interface') return []
  return def.fields
    .map((f) => {
      const name = f.name.trim()
      if (!name) return null
      const info = fieldKindFromTypeExpr(f.type, props.typeLibrary)
      return {
        name,
        remark: f.remark?.trim() || '',
        kind: info.kind,
        enumOptions: info.enumOptions,
      }
    })
    .filter((x): x is ObjectFieldForm => Boolean(x))
}

function literalModeOf(p: ServiceApiParam): LiteralMode {
  if (p.type === 'array') return 'json'
  if (p.typeRef) {
    const def = findDataTypeDef(props.typeLibrary, p.typeRef)
    if (def?.kind === 'interface' && objectFieldsOf(def).length) return 'object'
    if (def?.kind === 'enum') return 'scalar'
    return 'json'
  }
  if (p.type === 'json') return 'json'
  return 'scalar'
}

function defaultLiteralForParam(p: ServiceApiParam): unknown {
  if (p.typeRef) {
    const def = findDataTypeDef(props.typeLibrary, p.typeRef)
    if (def?.kind === 'enum') return def.enumMembers[0]?.name ?? ''
    if (def?.kind === 'interface') {
      const obj: Record<string, unknown> = {}
      for (const f of objectFieldsOf(def)) {
        if (f.kind === 'number') obj[f.name] = 0
        else if (f.kind === 'boolean') obj[f.name] = false
        else if (f.kind === 'enum') obj[f.name] = f.enumOptions[0] ?? ''
        else if (f.kind === 'array') obj[f.name] = []
        else if (f.kind === 'json') obj[f.name] = {}
        else obj[f.name] = ''
      }
      return obj
    }
  }
  if (p.type === 'number') return 0
  if (p.type === 'boolean') return false
  if (p.type === 'array') return []
  if (p.type === 'json') return {}
  return ''
}

function syncInputsForApi(
  api: ServiceApi | null,
  prev: Record<string, ControllerInputParamConfig> | undefined,
): Record<string, ControllerInputParamConfig> {
  if (!api?.inputs?.length) return {}
  const next: Record<string, ControllerInputParamConfig> = {}
  const debug = api.debugParams ?? {}
  for (const inp of api.inputs) {
    const name = inp.varName.trim()
    if (!name) continue
    const old = prev?.[name]
    if (old) {
      next[name] = {
        source: old.source === 'binding' ? 'binding' : 'literal',
        ...(old.source === 'binding'
          ? { binding: old.binding ?? '' }
          : { literal: old.literal }),
      }
      continue
    }
    next[name] = {
      source: 'literal',
      literal: name in debug ? debug[name] : defaultLiteralForParam(inp),
    }
  }
  return next
}

function inputCfg(varName: string): ControllerInputParamConfig {
  return (
    draft.value.inputs?.[varName] ?? {
      source: 'literal' as const,
      literal: '',
    }
  )
}

function setInputSource(varName: string, source: ControllerInputSource) {
  const apiInp = selectedApi.value?.inputs.find(
    (i) => i.varName.trim() === varName,
  )
  const prev = inputCfg(varName)
  const next: ControllerInputParamConfig =
    source === 'binding'
      ? { source: 'binding', binding: prev.binding ?? '' }
      : {
          source: 'literal',
          literal:
            prev.literal !== undefined
              ? prev.literal
              : apiInp
                ? defaultLiteralForParam(apiInp)
                : '',
        }
  draft.value = {
    ...draft.value,
    inputs: { ...(draft.value.inputs ?? {}), [varName]: next },
  }
  if (source === 'literal' && apiInp && literalModeOf(apiInp) === 'json') {
    syncJsonText(varName, next.literal)
  }
}

function setInputBinding(varName: string, binding: string) {
  draft.value = {
    ...draft.value,
    inputs: {
      ...(draft.value.inputs ?? {}),
      [varName]: { source: 'binding', binding },
    },
  }
}

function setScalarLiteral(varName: string, value: unknown) {
  draft.value = {
    ...draft.value,
    inputs: {
      ...(draft.value.inputs ?? {}),
      [varName]: { source: 'literal', literal: value },
    },
  }
}

function objectLiteral(varName: string): Record<string, unknown> {
  const lit = inputCfg(varName).literal
  if (lit && typeof lit === 'object' && !Array.isArray(lit)) {
    return { ...(lit as Record<string, unknown>) }
  }
  return {}
}

function setObjectField(varName: string, field: string, value: unknown) {
  const obj = objectLiteral(varName)
  obj[field] = value
  setScalarLiteral(varName, obj)
}

function syncJsonText(varName: string, literal: unknown) {
  try {
    jsonTextDraft.value = {
      ...jsonTextDraft.value,
      [varName]:
        literal === undefined
          ? ''
          : JSON.stringify(literal, null, 2),
    }
  } catch {
    jsonTextDraft.value = { ...jsonTextDraft.value, [varName]: '' }
  }
}

function onJsonTextChange(varName: string, text: string) {
  jsonTextDraft.value = { ...jsonTextDraft.value, [varName]: text }
  try {
    const parsed = text.trim() ? JSON.parse(text) : null
    setScalarLiteral(varName, parsed)
  } catch {
    // 编辑中允许非法 JSON，保存时再校验
  }
}

function objectFieldsForParam(p: ServiceApiParam): ObjectFieldForm[] {
  if (!p.typeRef) return []
  const def = findDataTypeDef(props.typeLibrary, p.typeRef)
  return objectFieldsOf(def)
}

function scalarKind(p: ServiceApiParam): FieldKind {
  if (p.typeRef) {
    const def = findDataTypeDef(props.typeLibrary, p.typeRef)
    if (def?.kind === 'enum') return 'enum'
  }
  if (p.type === 'number') return 'number'
  if (p.type === 'boolean') return 'boolean'
  return 'string'
}

function enumOptionsOf(p: ServiceApiParam): string[] {
  if (!p.typeRef) return []
  const def = findDataTypeDef(props.typeLibrary, p.typeRef)
  if (def?.kind !== 'enum') return []
  return def.enumMembers.map((m) => m.name).filter(Boolean)
}

async function loadServices() {
  if (!props.projectPath) {
    services.value = []
    return
  }
  loadingServices.value = true
  try {
    const lib = await getBackendServiceLibrary(props.projectPath)
    services.value = lib.services ?? []
  } catch (err) {
    services.value = []
    console.error(err)
    ElMessage.error('加载服务列表失败')
  } finally {
    loadingServices.value = false
  }
}

async function loadControllers(serviceId: string) {
  if (!props.projectPath || !serviceId) {
    controllers.value = []
    return
  }
  loadingControllers.value = true
  try {
    const res = await getServiceControllers(props.projectPath, serviceId)
    controllers.value = res.controllers ?? []
  } catch (err) {
    controllers.value = []
    console.error(err)
    ElMessage.error('加载控制器列表失败')
  } finally {
    loadingControllers.value = false
  }
}

async function loadProcessors(serviceId: string) {
  if (!props.projectPath || !serviceId) {
    businessProcessors.value = []
    dataProcessors.value = []
    return
  }
  try {
    const [biz, data] = await Promise.all([
      getServiceProcessors(props.projectPath, serviceId, 'business'),
      getServiceProcessors(props.projectPath, serviceId, 'data'),
    ])
    businessProcessors.value = biz.processors ?? []
    dataProcessors.value = data.processors ?? []
  } catch (err) {
    businessProcessors.value = []
    dataProcessors.value = []
    console.error(err)
  }
}

function onServiceChange(serviceId: string) {
  draft.value = {
    ...draft.value,
    serviceId,
    controllerId: '',
    apiId: '',
    inputs: {},
  }
  jsonTextDraft.value = {}
  void loadControllers(serviceId)
  void loadProcessors(serviceId)
}

function onControllerChange(controllerId: string) {
  draft.value = {
    ...draft.value,
    controllerId,
    apiId: '',
    inputs: {},
  }
  jsonTextDraft.value = {}
}

function onApiChange(apiId: string) {
  const ctrl = controllers.value.find((c) => c.id === draft.value.controllerId)
  const api = ctrl?.apis.find((a) => a.id === apiId) ?? null
  const inputs = syncInputsForApi(api, draft.value.inputs)
  draft.value = {
    ...draft.value,
    apiId,
    inputs,
  }
  const texts: Record<string, string> = {}
  for (const inp of api?.inputs ?? []) {
    const name = inp.varName.trim()
    if (!name) continue
    if (literalModeOf(inp) === 'json') {
      syncJsonText(name, inputs[name]?.literal)
      texts[name] = jsonTextDraft.value[name] ?? ''
    }
  }
  jsonTextDraft.value = { ...jsonTextDraft.value, ...texts }
}

function openEventBind(kind: EventKind) {
  eventBindKind.value = kind
  eventBindVisible.value = true
}

function saveEventBind(value: string) {
  draft.value = {
    ...draft.value,
    [eventBindKind.value]: value,
  }
}

function eventSummary(raw: string): string {
  const n = countEventBindings(raw)
  return n > 0 ? `已配置 ${n} 项` : '未配置'
}

function applyApiInputsAfterLoad() {
  const api = selectedApi.value
  if (!api) return
  const inputs = syncInputsForApi(api, draft.value.inputs)
  draft.value = { ...draft.value, inputs }
  for (const inp of api.inputs) {
    const name = inp.varName.trim()
    if (!name) continue
    if (literalModeOf(inp) === 'json') {
      syncJsonText(name, inputs[name]?.literal)
    }
  }
}

watch(
  () => [props.modelValue, props.field] as const,
  async ([open, field]) => {
    if (!open || !field) return
    const base =
      field.controllerBinding ?? createEmptyControllerBinding(field.type)
    let parseBody = base.parseBody
    if (/\bresponse\b/.test(parseBody) && !/\bdata\b/.test(parseBody)) {
      parseBody = parseBody.replace(/\bresponse\b/g, 'data')
    }
    draft.value = {
      ...base,
      parseBody,
      inputs: { ...(base.inputs ?? {}) },
    }
    jsonTextDraft.value = {}
    await loadServices()
    if (draft.value.serviceId) {
      await Promise.all([
        loadControllers(draft.value.serviceId),
        loadProcessors(draft.value.serviceId),
      ])
      applyApiInputsAfterLoad()
    } else {
      controllers.value = []
      businessProcessors.value = []
      dataProcessors.value = []
    }
  },
)

function handleSave() {
  if (!draft.value.serviceId || !draft.value.controllerId || !draft.value.apiId) {
    ElMessage.warning('请选择服务、控制器与 API')
    return
  }
  const api = selectedApi.value
  if (api?.inputs?.length) {
    for (const inp of api.inputs) {
      const name = inp.varName.trim()
      if (!name) continue
      const cfg = inputCfg(name)
      if (cfg.source === 'binding') {
        if (inp.required && !(cfg.binding ?? '').trim()) {
          ElMessage.warning(`请为必填入参「${name}」选择绑定`)
          return
        }
        continue
      }
      if (literalModeOf(inp) === 'json') {
        const text = jsonTextDraft.value[name]
        if (text !== undefined && text.trim()) {
          try {
            JSON.parse(text)
          } catch {
            ElMessage.warning(`入参「${name}」的 JSON 不合法`)
            return
          }
        } else if (inp.required && (cfg.literal === undefined || cfg.literal === null)) {
          ElMessage.warning(`请填写必填入参「${name}」`)
          return
        }
      } else if (
        inp.required &&
        (cfg.literal === undefined ||
          cfg.literal === null ||
          cfg.literal === '')
      ) {
        ElMessage.warning(`请填写必填入参「${name}」`)
        return
      }
    }
  }
  const parseBody = editorRef.value?.getBody?.() ?? draft.value.parseBody
  // 确保 inputs 含当前 API 全部 varName
  const inputs = syncInputsForApi(api, draft.value.inputs)
  emit('save', {
    ...draft.value,
    parseBody,
    inputs,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`控制器 · ${fieldName}`"
    width="820px"
    destroy-on-close
    append-to-body
    class="controller-binding-dialog"
  >
    <el-form label-position="top" class="bind-form">
      <el-form-item label="绑定 API" required>
        <div class="pick-row">
          <el-select
            :model-value="draft.serviceId"
            filterable
            clearable
            placeholder="服务"
            :loading="loadingServices"
            style="flex: 1"
            @update:model-value="onServiceChange(String($event || ''))"
          >
            <el-option
              v-for="s in services"
              :key="s.id"
              :label="s.name || s.id"
              :value="s.id"
            />
          </el-select>
          <el-select
            :model-value="draft.controllerId"
            filterable
            clearable
            placeholder="控制器"
            :disabled="!draft.serviceId"
            :loading="loadingControllers"
            style="flex: 1"
            @update:model-value="onControllerChange(String($event || ''))"
          >
            <el-option
              v-for="c in controllers"
              :key="c.id"
              :label="formatControllerLabel(c)"
              :value="c.id"
            />
          </el-select>
          <el-select
            :model-value="draft.apiId"
            filterable
            clearable
            placeholder="API"
            :disabled="!draft.controllerId"
            style="flex: 1"
            @update:model-value="onApiChange(String($event || ''))"
          >
            <el-option
              v-for="api in apiOptions"
              :key="api.id"
              :label="formatApiLabel(api)"
              :value="api.id"
            />
          </el-select>
        </div>
      </el-form-item>

      <el-form-item
        v-if="selectedApi?.inputs?.length"
        label="入参"
      >
        <div class="input-list">
          <div
            v-for="inp in selectedApi.inputs"
            :key="inp.id || inp.varName"
            class="input-card"
          >
            <div class="input-head">
              <span
                class="loc-badge"
                :class="locationClass(inp.location)"
              >
                {{ locationLabel(inp.location) }}
              </span>
              <span class="input-name">
                {{ inp.varName }}
                <em v-if="inp.required" class="req">*</em>
              </span>
              <span class="input-type">{{ apiParamTypeLabel(inp) }}</span>
              <el-radio-group
                :model-value="inputCfg(inp.varName).source"
                size="small"
                class="source-radio"
                @update:model-value="
                  setInputSource(inp.varName, $event as ControllerInputSource)
                "
              >
                <el-radio-button value="literal">固定值</el-radio-button>
                <el-radio-button value="binding">绑定</el-radio-button>
              </el-radio-group>
            </div>

            <div
              v-if="inputCfg(inp.varName).source === 'binding'"
              class="input-body"
            >
              <TypedBindingCascader
                :model-value="inputCfg(inp.varName).binding ?? ''"
                :ambient-vars="bindingAmbientVars"
                :target-type="apiParamToTypeExpr(inp)"
                :type-library="typeLibrary"
                placeholder="选择数据池字段"
                @update:model-value="setInputBinding(inp.varName, $event)"
              />
            </div>

            <div
              v-else-if="literalModeOf(inp) === 'object'"
              class="input-body object-fields"
            >
              <div
                v-for="f in objectFieldsForParam(inp)"
                :key="f.name"
                class="prop-row"
              >
                <div class="prop-label">
                  <span class="prop-name">{{ f.name }}</span>
                  <span v-if="f.remark" class="prop-type">{{ f.remark }}</span>
                </div>
                <el-switch
                  v-if="f.kind === 'boolean'"
                  :model-value="Boolean(objectLiteral(inp.varName)[f.name])"
                  @update:model-value="
                    setObjectField(inp.varName, f.name, $event)
                  "
                />
                <el-input-number
                  v-else-if="f.kind === 'number'"
                  :model-value="Number(objectLiteral(inp.varName)[f.name] ?? 0)"
                  controls-position="right"
                  style="width: 100%"
                  @update:model-value="
                    setObjectField(inp.varName, f.name, Number($event ?? 0))
                  "
                />
                <el-select
                  v-else-if="f.kind === 'enum'"
                  :model-value="String(objectLiteral(inp.varName)[f.name] ?? '')"
                  clearable
                  style="width: 100%"
                  @update:model-value="
                    setObjectField(inp.varName, f.name, $event ?? '')
                  "
                >
                  <el-option
                    v-for="opt in f.enumOptions"
                    :key="opt"
                    :label="opt"
                    :value="opt"
                  />
                </el-select>
                <el-input
                  v-else-if="f.kind === 'json' || f.kind === 'array'"
                  :model-value="
                    (() => {
                      try {
                        return JSON.stringify(
                          objectLiteral(inp.varName)[f.name] ??
                            (f.kind === 'array' ? [] : {}),
                        )
                      } catch {
                        return ''
                      }
                    })()
                  "
                  type="textarea"
                  :rows="2"
                  @update:model-value="
                    (t: string) => {
                      try {
                        setObjectField(
                          inp.varName,
                          f.name,
                          t.trim() ? JSON.parse(t) : f.kind === 'array' ? [] : {},
                        )
                      } catch {
                        /* editing */
                      }
                    }
                  "
                />
                <el-input
                  v-else
                  :model-value="String(objectLiteral(inp.varName)[f.name] ?? '')"
                  @update:model-value="
                    setObjectField(inp.varName, f.name, $event)
                  "
                />
              </div>
            </div>

            <div
              v-else-if="literalModeOf(inp) === 'json'"
              class="input-body"
            >
              <el-input
                :model-value="jsonTextDraft[inp.varName] ?? ''"
                type="textarea"
                :rows="4"
                placeholder="JSON"
                @update:model-value="onJsonTextChange(inp.varName, String($event))"
              />
            </div>

            <div v-else class="input-body">
              <el-switch
                v-if="scalarKind(inp) === 'boolean'"
                :model-value="Boolean(inputCfg(inp.varName).literal)"
                @update:model-value="setScalarLiteral(inp.varName, $event)"
              />
              <el-input-number
                v-else-if="scalarKind(inp) === 'number'"
                :model-value="Number(inputCfg(inp.varName).literal ?? 0)"
                controls-position="right"
                style="width: 100%"
                @update:model-value="
                  setScalarLiteral(inp.varName, Number($event ?? 0))
                "
              />
              <el-select
                v-else-if="scalarKind(inp) === 'enum'"
                :model-value="String(inputCfg(inp.varName).literal ?? '')"
                clearable
                style="width: 100%"
                @update:model-value="
                  setScalarLiteral(inp.varName, $event ?? '')
                "
              >
                <el-option
                  v-for="opt in enumOptionsOf(inp)"
                  :key="opt"
                  :label="opt"
                  :value="opt"
                />
              </el-select>
              <el-input
                v-else
                :model-value="String(inputCfg(inp.varName).literal ?? '')"
                @update:model-value="setScalarLiteral(inp.varName, $event)"
              />
            </div>
          </div>
        </div>
      </el-form-item>
      <el-form-item v-else-if="selectedApi" label="入参">
        <span class="hint-inline">该 API 无入参</span>
      </el-form-item>

      <el-form-item label="自定义解析">
        <p class="hint">
          语法 TypeScript：形参 <code>data</code> 为所选 API 返回的
          <code>Result.data</code>（已解包，类型随 API）；
          <code>return</code> 的值写入本数据池字段（类型随字段）。
        </p>
        <TsCodeEditor
          ref="editorRef"
          v-model="draft.parseBody"
          :function-name="functionName"
          :params="parseParams"
          :ambient-extra="ambientExtra"
          :return-type="returnType"
          :return-type-ts="returnTypeTs"
        />
      </el-form-item>

      <el-form-item label="加载事件">
        <div class="event-list">
          <div v-for="row in eventRows" :key="row.kind" class="event-row">
            <div class="event-meta">
              <span class="event-label">{{ row.label }}</span>
              <span class="event-summary">{{ eventSummary(row.raw) }}</span>
            </div>
            <el-button type="primary" link @click="openEventBind(row.kind)">
              配置
            </el-button>
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>

  <EventBindDialog
    v-model="eventBindVisible"
    :event-label="eventBindLabel"
    :event-key="eventBindKind"
    :event-params="controllerEventParams"
    :raw-value="eventBindRaw"
    :methods="methods ?? []"
    :data-fields="dataFields ?? []"
    :xml="xml"
    :component-map="componentMap"
    :component-methods-map="componentMethodsMap"
    :icon-options="iconOptions"
    :emit-events="emitEvents"
    :type-library="typeLibrary"
    :component-props="componentProps"
    @save="saveEventBind"
  />
</template>

<style scoped>
.bind-form {
  padding-right: 4px;
}

.pick-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  background: #f2f3f5;
  color: #606266;
}

.hint-inline {
  font-size: 13px;
  color: #909399;
}

.input-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.input-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
  padding: 10px 12px;
}

.input-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.loc-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.4;
}

.loc-query {
  color: #067647;
  background: #ecfdf3;
}

.loc-param {
  color: #b54708;
  background: #fffaeb;
}

.loc-body {
  color: #6941c6;
  background: #f4f3ff;
}

.loc-header {
  color: #175cd3;
  background: #eff8ff;
}

.input-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.req {
  color: #f56c6c;
  font-style: normal;
  margin-left: 2px;
}

.input-type {
  font-size: 12px;
  color: #909399;
  flex: 1;
  min-width: 0;
}

.source-radio {
  flex-shrink: 0;
}

.input-body {
  width: 100%;
}

.object-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.prop-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 8px;
  align-items: center;
}

.prop-label {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.prop-name {
  font-size: 13px;
  color: #303133;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.prop-type {
  font-size: 11px;
  color: #909399;
}

.event-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.event-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.event-label {
  font-size: 13px;
  color: #303133;
}

.event-summary {
  font-size: 12px;
  color: #909399;
}
</style>
