<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { getServiceProcessors } from '../../api/projects'
import {
  createEmptyProcessorTypeExpr,
  createEmptyServiceApiParam,
  createDefaultMethodFlow,
  HTTP_METHOD_OPTIONS,
  normalizeProcessorTypeExpr,
  PROCESSOR_METHOD_SCOPE_OPTIONS,
  type HttpMethod,
  type MethodFlow,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorMethodScope,
  type ProcessorTypeExpr,
  type ServiceApi,
  type ServiceApiParam,
  type ServiceApiParamLocation,
  type ServiceProcessor,
} from '../../types/backend-services'
import type { DataFieldType } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  dataFieldToMethodParamType,
  processorTypeExprToTs,
  type MethodParam,
} from '../../types/page-method'
import {
  buildApiBusinessFlow,
  extractApiBusinessBinding,
  findProcessorMethod,
} from '../../utils/api-business-binding'
import DataFieldTypeTreeSelect, { type TypeSelectPayload } from './DataFieldTypeTreeSelect.vue'
import TypeGenericArgsDialog from './TypeGenericArgsDialog.vue'
import ServiceApiParamsDialog from './ServiceApiParamsDialog.vue'
import TypedBindingCascader from './method-flow/TypedBindingCascader.vue'

export type ServiceApiEditPayload = {
  name: string
  path: string
  remark: string
  method: HttpMethod
  inputs: ServiceApiParam[]
  output: ProcessorTypeExpr
  requireAuth: boolean
  scope: ProcessorMethodScope
  flow: MethodFlow
}

const props = defineProps<{
  modelValue: boolean
  api: ServiceApi | null
  dtoOptions: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  reservedNames?: string[]
  projectPath?: string
  serviceId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: ServiceApiEditPayload]
}>()

const draftName = ref('')
const draftPath = ref('')
const draftRemark = ref('')
const draftMethod = ref<HttpMethod>('GET')
const draftInputs = ref<ServiceApiParam[]>([])
const draftOutput = ref<ProcessorTypeExpr>(createEmptyProcessorTypeExpr('any'))
const draftRequireAuth = ref(false)
const draftScope = ref<ProcessorMethodScope>('public')
const draftProcessorId = ref('')
const draftMethodId = ref('')
/** 业务方法入参名 → API 入参/表达式 */
const draftParamBindings = ref<Record<string, string>>({})

const businessProcessors = ref<ServiceProcessor[]>([])
const processorsLoading = ref(false)

const inputsDialogVisible = ref(false)
const genericVisible = ref(false)
const genericNames = ref<string[]>([])
const genericTypeName = ref('')
const genericArgs = ref<Record<string, string>>({})

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const title = computed(() => {
  const name = props.api?.name?.trim()
  return name ? `编辑 API · ${name}` : '编辑 API'
})

function processorTypeExprsEqual(
  a: ProcessorTypeExpr | null | undefined,
  b: ProcessorTypeExpr | null | undefined,
): boolean {
  const x = normalizeProcessorTypeExpr(a)
  const y = normalizeProcessorTypeExpr(b)
  if (x.type !== y.type) return false
  if (x.typeRef !== y.typeRef) return false
  if (x.itemType !== y.itemType) return false
  if (x.itemTypeRef !== y.itemTypeRef) return false
  if (x.itemItemType !== y.itemItemType) return false
  if (x.itemItemTypeRef !== y.itemItemTypeRef) return false
  if ((x.keyType || '') !== (y.keyType || '')) return false
  const ax = x.genericArgs ?? {}
  const ay = y.genericArgs ?? {}
  const keys = new Set([...Object.keys(ax), ...Object.keys(ay)])
  for (const k of keys) {
    if ((ax[k] ?? '') !== (ay[k] ?? '')) return false
  }
  return true
}

/** 出参是否已选完整（方法列表依赖固定出参过滤） */
function isOutputConfigured(expr: ProcessorTypeExpr): boolean {
  const o = normalizeProcessorTypeExpr(expr)
  if (!o.type.trim()) return false
  if (o.type === 'json' && !o.typeRef.trim()) return false
  if (o.type === 'map') {
    if (!o.itemType.trim()) return false
    if (o.itemType === 'json' && !o.itemTypeRef.trim()) return false
    if (o.itemType === 'array') {
      if (!o.itemItemType.trim()) return false
      if (o.itemItemType === 'json' && !o.itemItemTypeRef.trim()) return false
    }
    return true
  }
  if (o.type === 'array') {
    if (!o.itemType.trim()) return false
    if (o.itemType === 'json' && !o.itemTypeRef.trim()) return false
    if (o.itemType === 'array') {
      if (!o.itemItemType.trim()) return false
      if (o.itemItemType === 'json' && !o.itemItemTypeRef.trim()) return false
    }
  }
  return true
}

const outputReady = computed(() => isOutputConfigured(draftOutput.value))

const methodOptions = computed((): ProcessorMethod[] => {
  const proc = businessProcessors.value.find((p) => p.id === draftProcessorId.value)
  return (proc?.methods ?? []).filter((m) => !m.disabled)
})

function isMethodSelectable(method: ProcessorMethod): boolean {
  return (
    outputReady.value &&
    processorTypeExprsEqual(method.output, draftOutput.value)
  )
}

const matchingMethodOptions = computed(() =>
  methodOptions.value.filter((m) => isMethodSelectable(m)),
)

const selectedBizMethod = computed(() => {
  const hit = findProcessorMethod(
    businessProcessors.value,
    draftProcessorId.value,
    draftMethodId.value,
  )
  return hit?.method ?? null
})

const methodParams = computed((): ProcessorMethodParam[] =>
  (selectedBizMethod.value?.params ?? []).filter((p) => p.name.trim()),
)

const bindingAmbientVars = computed((): MethodParam[] => {
  const out: MethodParam[] = []
  for (const p of draftInputs.value) {
    const name = p.varName.trim()
    if (!name) continue
    const fieldType = (p.typeRef ? 'json' : p.type || 'string') as DataFieldType
    const typeExpr = normalizeProcessorTypeExpr({
      type: fieldType,
      typeRef: p.typeRef || '',
      genericArgs: p.genericArgs ?? {},
    })
    out.push({
      name,
      type: dataFieldToMethodParamType(fieldType),
      typeExpr,
      typeRef: p.typeRef || undefined,
    })
  }
  return out
})

function paramTypeLabel(p: ProcessorMethodParam): string {
  return processorTypeExprToTs(p.typeExpr, props.typeLibrary)
}

function syncParamBindings(
  method: ProcessorMethod | null | undefined,
  opts?: { preferSameName?: boolean; seed?: Record<string, string> },
) {
  const seed = opts?.seed ?? {}
  const names = new Set(
    draftInputs.value.map((p) => p.varName.trim()).filter(Boolean),
  )
  const next: Record<string, string> = {}
  for (const p of method?.params ?? []) {
    const name = p.name.trim()
    if (!name) continue
    const prev = (seed[name] ?? draftParamBindings.value[name] ?? '').trim()
    if (prev) {
      next[name] = prev
    } else if (opts?.preferSameName && names.has(name)) {
      next[name] = name
    } else {
      next[name] = ''
    }
  }
  draftParamBindings.value = next
}

function updateParamBinding(paramName: string, value: string) {
  draftParamBindings.value = {
    ...draftParamBindings.value,
    [paramName]: value,
  }
}

const namedTypeOptions = computed(() => {
  const opts: Array<{ id: string; label: string }> = []
  for (const group of props.typeLibrary?.groups ?? []) {
    for (const t of group.types) {
      if (!t.name.trim()) continue
      opts.push({ id: t.id, label: `${group.name} / ${t.name}` })
    }
  }
  if (!opts.length) {
    for (const o of props.dtoOptions) {
      opts.push({ id: o.id, label: o.label })
    }
  }
  return opts
})

function typeDefById(id: string) {
  if (!id) return null
  for (const group of props.typeLibrary?.groups ?? []) {
    const hit = group.types.find((t) => t.id === id)
    if (hit) return hit
  }
  return null
}

function genericNamesOf(typeRef: string): string[] {
  return (typeDefById(typeRef)?.generics ?? [])
    .map((g) => g.name.trim())
    .filter(Boolean)
}

function formatTypeWithGenerics(
  typeRef: string,
  args: Record<string, string>,
): string {
  const def = typeDefById(typeRef)
  if (!def?.name) return typeRef || '—'
  const names = genericNamesOf(typeRef)
  if (!names.length) return def.name
  const inner = names
    .map((n) => {
      const ref = args[n] ?? ''
      if (!ref) return 'any'
      return typeDefById(ref)?.name || ref
    })
    .join(', ')
  return `${def.name}<${inner}>`
}

async function loadBusinessProcessors() {
  const path = props.projectPath?.trim()
  const sid = props.serviceId?.trim()
  if (!path || !sid) {
    businessProcessors.value = []
    return
  }
  processorsLoading.value = true
  try {
    const res = await getServiceProcessors(path, sid, 'business')
    businessProcessors.value = res.processors ?? []
  } catch (err) {
    console.error(err)
    businessProcessors.value = []
  } finally {
    processorsLoading.value = false
  }
}

function syncInputsFromMethod(method: ProcessorMethod) {
  const location: ServiceApiParamLocation =
    draftMethod.value === 'GET' || draftMethod.value === 'DELETE'
      ? 'query'
      : 'body'
  draftInputs.value = (method.params ?? [])
    .map((p) => {
      const name = p.name.trim()
      if (!name) return null
      const te = p.typeExpr
      return createEmptyServiceApiParam({
        varName: name,
        location,
        type: te?.typeRef ? 'json' : (te?.type as DataFieldType) || 'string',
        typeRef: te?.typeRef ?? '',
        genericArgs: { ...(te?.genericArgs ?? {}) },
        required: Boolean(p.required),
        remark: p.remark ?? '',
      })
    })
    .filter((x): x is ServiceApiParam => Boolean(x))
  syncParamBindings(method, { preferSameName: true })
}

function inputsSummary(inputs: ServiceApiParam[]): string {
  const named = inputs.filter((p) => p.varName.trim())
  if (!named.length) return '无入参，点击编辑'
  return named
    .map((p) => {
      const typeLabel = p.typeRef
        ? typeDefById(p.typeRef)?.name || p.typeRef
        : p.type || 'string'
      return `${p.varName}: ${typeLabel}`
    })
    .join(', ')
}

function openInputsDialog() {
  inputsDialogVisible.value = true
}

function saveInputsFromDialog(inputs: ServiceApiParam[]) {
  draftInputs.value = inputs
  syncParamBindings(selectedBizMethod.value, { preferSameName: true })
}

function handleSyncInputsInDialog() {
  if (!selectedBizMethod.value) return
  syncInputsFromMethod(selectedBizMethod.value)
}

function applyMethodSelection(methodId: string, opts?: { forceSyncInputs?: boolean }) {
  draftMethodId.value = methodId
  if (!methodId) {
    draftParamBindings.value = {}
    return
  }
  const hit = findProcessorMethod(
    businessProcessors.value,
    draftProcessorId.value,
    methodId,
  )
  if (!hit) return
  // 出参已固定，选方法只同步入参，不回写出参
  if (!processorTypeExprsEqual(hit.method.output, draftOutput.value)) {
    draftMethodId.value = ''
    draftParamBindings.value = {}
    ElMessage.warning('该方法出参与当前 API 出参不一致')
    return
  }
  const force = Boolean(opts?.forceSyncInputs) || draftInputs.value.length === 0
  if (force) syncInputsFromMethod(hit.method)
  else syncParamBindings(hit.method, { preferSameName: true })
}

function clearMethodIfMismatched() {
  if (!draftMethodId.value) {
    draftParamBindings.value = {}
    return
  }
  const hit = findProcessorMethod(
    businessProcessors.value,
    draftProcessorId.value,
    draftMethodId.value,
  )
  if (!hit || !isMethodSelectable(hit.method)) {
    draftMethodId.value = ''
    draftParamBindings.value = {}
  }
}

watch(
  () => [props.modelValue, props.api] as const,
  async ([open, api]) => {
    if (!open || !api) return
    draftName.value = api.name ?? ''
    draftPath.value = api.path ?? ''
    draftRemark.value = api.remark ?? ''
    draftMethod.value = api.method ?? 'GET'
    draftInputs.value = (api.inputs ?? []).map((p) => ({
      ...p,
      genericArgs: { ...(p.genericArgs ?? {}) },
    }))
    draftOutput.value = normalizeProcessorTypeExpr(api.output)
    draftRequireAuth.value = Boolean(api.requireAuth)
    draftScope.value = api.scope === 'private' ? 'private' : 'public'
    await loadBusinessProcessors()
    const binding = extractApiBusinessBinding(api.flow)
    draftProcessorId.value = binding?.processorId ?? ''
    draftMethodId.value = binding?.methodId ?? ''
    clearMethodIfMismatched()
    const hit = findProcessorMethod(
      businessProcessors.value,
      draftProcessorId.value,
      draftMethodId.value,
    )
    if (hit) {
      syncParamBindings(hit.method, {
        preferSameName: true,
        seed: binding?.paramBindings ?? {},
      })
    } else {
      draftParamBindings.value = {}
    }
  },
)

watch(draftProcessorId, (id, prev) => {
  if (!props.modelValue) return
  if (id === prev) return
  clearMethodIfMismatched()
})

watch(
  draftOutput,
  () => {
    if (!props.modelValue) return
    clearMethodIfMismatched()
  },
  { deep: true },
)

function handleOutputChange(payload: TypeSelectPayload) {
  if (payload.type === 'void' || payload.type === 'generic') return
  const prev = draftOutput.value
  const next: ProcessorTypeExpr = {
    ...createEmptyProcessorTypeExpr(payload.type),
    type: payload.type,
    typeRef: payload.typeRef ?? '',
    itemType: payload.itemType ?? '',
    itemTypeRef: payload.itemTypeRef ?? '',
    itemItemType: payload.itemItemType ?? '',
    itemItemTypeRef: payload.itemItemTypeRef ?? '',
    genericArgs: {},
  }
  const named = next.type === 'array'
    ? next.itemType === 'array'
      ? next.itemItemTypeRef
      : next.itemTypeRef
    : next.typeRef
  const prevNamed =
    prev.type === 'array'
      ? prev.itemType === 'array'
        ? prev.itemItemTypeRef
        : prev.itemTypeRef
      : prev.typeRef
  if (named && named === prevNamed) {
    next.genericArgs = { ...(prev.genericArgs ?? {}) }
  } else {
    for (const n of genericNamesOf(named)) next.genericArgs[n] = ''
  }
  draftOutput.value = next
  clearMethodIfMismatched()
  if (genericNamesOf(named).length) {
    openOutputGenerics(next)
  }
}

function openOutputGenerics(expr?: ProcessorTypeExpr) {
  const output = expr ?? draftOutput.value
  const named =
    output.type === 'array'
      ? output.itemType === 'array'
        ? output.itemItemTypeRef
        : output.itemTypeRef
      : output.typeRef
  const names = genericNamesOf(named)
  if (!names.length) return
  genericNames.value = names
  genericTypeName.value = typeDefById(named)?.name ?? ''
  genericArgs.value = { ...(output.genericArgs ?? {}) }
  genericVisible.value = true
}

function handleGenericSave(args: Record<string, string>) {
  draftOutput.value = {
    ...draftOutput.value,
    genericArgs: { ...args },
  }
  genericVisible.value = false
}

function handleSave() {
  const name = draftName.value.trim()
  if (!name) {
    ElMessage.warning('请填写名称')
    return
  }
  const reserved = props.reservedNames ?? []
  if (reserved.some((n) => n.toLowerCase() === name.toLowerCase())) {
    ElMessage.warning(`API 名称「${name}」已存在`)
    return
  }
  if (!draftProcessorId.value) {
    ElMessage.warning('请选择业务')
    return
  }
  if (!draftMethodId.value) {
    ElMessage.warning('请选择方法')
    return
  }
  const hit = findProcessorMethod(
    businessProcessors.value,
    draftProcessorId.value,
    draftMethodId.value,
  )
  if (!hit) {
    ElMessage.warning('所选业务方法无效')
    return
  }
  if (!outputReady.value) {
    ElMessage.warning('请先选择出参')
    return
  }
  if (!processorTypeExprsEqual(hit.method.output, draftOutput.value)) {
    ElMessage.warning('业务方法出参须与 API 出参一致')
    return
  }
  const inputs = draftInputs.value
    .map((p) => ({
      ...p,
      varName: p.varName.trim(),
      remark: p.remark.trim(),
      type: p.typeRef ? 'json' : p.type.trim() || 'string',
      typeRef: p.typeRef.trim(),
      genericArgs: { ...(p.genericArgs ?? {}) },
    }))
    .filter((p) => p.varName)
  for (const p of inputs) {
    if (!p.varName) {
      ElMessage.warning('请填写变量名')
      return
    }
  }
  const output = normalizeProcessorTypeExpr(draftOutput.value)
  const paramBindings: Record<string, string> = {}
  for (const p of hit.method.params ?? []) {
    const name = p.name.trim()
    if (!name) continue
    paramBindings[name] = (draftParamBindings.value[name] ?? '').trim()
  }
  const unbound = Object.entries(paramBindings)
    .filter(([, v]) => !String(v).trim())
    .map(([k]) => k)
  if (unbound.length) {
    ElMessage.warning(
      `请完成业务方法入参绑定：${unbound.join('、')}`,
    )
    return
  }
  const methodLabel = `${hit.processor.name || hit.processor.id}.${hit.method.name}`
  const flow = buildApiBusinessFlow({
    serviceId: props.serviceId?.trim() || '',
    processorId: hit.processor.id,
    methodId: hit.method.id,
    methodLabel,
    varName: 'result',
    paramBindings,
    outputTypeExpr: output,
  })
  emit('save', {
    name,
    path: draftPath.value.trim() || '/',
    remark: draftRemark.value.trim(),
    method: draftMethod.value,
    inputs,
    output,
    requireAuth: draftRequireAuth.value,
    scope: draftScope.value,
    flow: flow.nodes.length ? flow : createDefaultMethodFlow(),
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="900px"
    destroy-on-close
    append-to-body
    class="service-api-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form
      class="api-form"
      label-position="right"
      label-width="88px"
      @submit.prevent
    >
      <el-form-item label="名称" required>
        <el-input v-model="draftName" placeholder="如 list" maxlength="64" />
      </el-form-item>
      <el-form-item label="路径">
        <el-input v-model="draftPath" placeholder="如 / 或 /list" maxlength="128" />
      </el-form-item>
      <el-form-item label="说明">
        <el-input
          v-model="draftRemark"
          type="textarea"
          :rows="2"
          placeholder="可选说明"
          maxlength="200"
        />
      </el-form-item>
      <el-form-item label="请求方法">
        <el-select v-model="draftMethod" style="width: 160px">
          <el-option
            v-for="opt in HTTP_METHOD_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="需要鉴权">
        <el-switch v-model="draftRequireAuth" />
      </el-form-item>
      <el-form-item label="作用域">
        <el-select v-model="draftScope" style="width: 160px">
          <el-option
            v-for="opt in PROCESSOR_METHOD_SCOPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="出参">
        <div class="output-row">
          <DataFieldTypeTreeSelect
            class="type-select"
            :type="(draftOutput.type || 'any') as DataFieldType"
            :type-ref="draftOutput.typeRef"
            :item-type="(draftOutput.itemType || undefined) as DataFieldType | undefined"
            :item-type-ref="draftOutput.itemTypeRef"
            :item-item-type="(draftOutput.itemItemType || undefined) as DataFieldType | undefined"
            :item-item-type-ref="draftOutput.itemItemTypeRef"
            :library="typeLibrary"
            composable
            :exclude-types="['api', 'icon', 'color', 'ref', 'resource']"
            @change="handleOutputChange"
          />
          <el-button
            v-if="
              genericNamesOf(
                draftOutput.type === 'array'
                  ? draftOutput.itemType === 'array'
                    ? draftOutput.itemItemTypeRef
                    : draftOutput.itemTypeRef
                  : draftOutput.typeRef,
              ).length
            "
            type="primary"
            link
            @click="openOutputGenerics()"
          >
            泛型
          </el-button>
        </div>
        <p
          v-if="
            genericNamesOf(
              draftOutput.type === 'array'
                ? draftOutput.itemType === 'array'
                  ? draftOutput.itemItemTypeRef
                  : draftOutput.itemTypeRef
                : draftOutput.typeRef,
            ).length
          "
          class="generic-preview"
        >
          {{
            formatTypeWithGenerics(
              draftOutput.type === 'array'
                ? draftOutput.itemType === 'array'
                  ? draftOutput.itemItemTypeRef
                  : draftOutput.itemTypeRef
                : draftOutput.typeRef,
              draftOutput.genericArgs ?? {},
            )
          }}
        </p>
      </el-form-item>

      <el-form-item label="选择业务" required>
        <el-select
          v-model="draftProcessorId"
          filterable
          clearable
          :loading="processorsLoading"
          placeholder="选择业务处理器"
          style="width: 100%"
        >
          <el-option
            v-for="proc in businessProcessors"
            :key="proc.id"
            :label="proc.name || proc.id"
            :value="proc.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="选择方法" required>
        <el-select
          :model-value="draftMethodId || undefined"
          filterable
          clearable
          :disabled="!draftProcessorId"
          :placeholder="
            !draftProcessorId
              ? '请先选择业务'
              : !outputReady
                ? '请先选择出参后再选方法'
                : matchingMethodOptions.length
                  ? '选择与出参匹配的业务方法'
                  : '无匹配出参的业务方法（灰色项不可选）'
          "
          style="width: 100%"
          @update:model-value="
            (id: string | undefined) =>
              applyMethodSelection(String(id ?? ''), {
                forceSyncInputs: !draftInputs.length,
              })
          "
        >
          <el-option
            v-for="m in methodOptions"
            :key="m.id"
            :label="m.remark ? `${m.name} · ${m.remark}` : m.name"
            :value="m.id"
            :disabled="!isMethodSelectable(m)"
          />
        </el-select>
        <p
          v-if="draftProcessorId && outputReady && !matchingMethodOptions.length"
          class="method-hint"
        >
          当前业务下没有出参与「出参」一致的方法（灰色项仅供对照，不可选）
        </p>
        <p v-else-if="selectedBizMethod" class="method-hint">
          将调用
          {{
            businessProcessors.find((p) => p.id === draftProcessorId)?.name ||
            draftProcessorId
          }}.{{ selectedBizMethod.name }}
        </p>
      </el-form-item>

      <el-form-item label="入参" class="inputs-item">
        <div class="inputs-trigger-row">
          <button
            type="button"
            class="inputs-trigger"
            @click="openInputsDialog"
          >
            {{ inputsSummary(draftInputs) }}
          </button>
          <el-button type="primary" link @click="openInputsDialog">
            编辑
          </el-button>
        </div>
      </el-form-item>

      <el-form-item
        v-if="selectedBizMethod && methodParams.length"
        label="入参绑定"
        required
        class="bindings-item"
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
              class="param-bind"
              :model-value="draftParamBindings[p.name] ?? ''"
              :ambient-vars="bindingAmbientVars"
              :target-type="p.typeExpr"
              :type-library="typeLibrary"
              placeholder="选择 API 入参"
              @update:model-value="updateParamBinding(p.name, $event)"
            />
          </div>
        </div>
      </el-form-item>
      <el-form-item
        v-else-if="selectedBizMethod"
        label="入参绑定"
      >
        <span class="method-hint">该方法无入参，无需绑定</span>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>

  <ServiceApiParamsDialog
    v-model="inputsDialogVisible"
    :inputs="draftInputs"
    :type-library="typeLibrary"
    :type-options="namedTypeOptions"
    :can-sync-from-method="Boolean(selectedBizMethod)"
    @save="saveInputsFromDialog"
    @sync-from-method="handleSyncInputsInDialog"
  />

  <TypeGenericArgsDialog
    v-model="genericVisible"
    :type-name="genericTypeName"
    :generic-names="genericNames"
    :args="genericArgs"
    :type-options="namedTypeOptions"
    @save="handleGenericSave"
  />
</template>

<style scoped>
.api-form {
  padding-right: 8px;
}

.inputs-item :deep(.el-form-item__content) {
  display: block;
}

.inputs-trigger-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.inputs-trigger {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  color: #606266;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inputs-trigger:hover {
  border-color: #c0c4cc;
}

.type-select {
  flex: 1;
  min-width: 0;
}

.output-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.generic-preview,
.method-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
}

.bindings-item :deep(.el-form-item__content) {
  display: block;
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
  flex: 0 0 148px;
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
</style>
