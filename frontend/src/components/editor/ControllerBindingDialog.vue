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
  ServiceApi,
  ServiceController,
  ServiceProcessor,
} from '../../types/backend-services'
import {
  createEmptyControllerBinding,
  type ControllerBindingConfig,
  type DataField,
} from '../../types/page-data'
import {
  buildTypeLibraryAmbientDeclarations,
  countEventBindings,
  dataFieldToMethodParamType,
  dataFieldToTsType,
  type MethodParam,
  type MethodReturnType,
  type PageMethod,
} from '../../types/page-method'
import type { ComponentPropDef } from '../../types/component'
import type { ComponentEventDef } from '../../types/component'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import type { DataTypeLibrary } from '../../types/data-types'
import { buildDollarPropsAmbientDeclaration } from '../../utils/component-props'
import { buildGetDeviceInfoAmbientDeclaration } from '../../utils/device-info'
import { resolveFlowReturnMethodParam } from './method-flow/method-flow-debug'
import TsCodeEditor from './TsCodeEditor.vue'
import EventBindDialog from './EventBindDialog.vue'

type EventKind = 'onLoading' | 'onSuccess' | 'onError'

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

/** return：写入本数据池字段，类型跟字段走 */
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

/**
 * 形参 data：平台已从 Result 解包；类型取所选 API flow 的返回值
 *（通常来自业务方法出参），未选 API / 无法推断时为 any。
 */
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
    buildDollarPropsAmbientDeclaration(props.componentProps),
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

function formatApiLabel(api: ServiceApi): string {
  const name = api.name.trim() || api.id
  const path = api.path.trim() || '/'
  return `${name} (${path}) · ${api.method}`
}

function formatControllerLabel(ctrl: ServiceController): string {
  const name = ctrl.name.trim() || ctrl.id
  return ctrl.path.trim() ? `${name} (${ctrl.path})` : name
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
  }
  void loadControllers(serviceId)
  void loadProcessors(serviceId)
}

function onControllerChange(controllerId: string) {
  draft.value = {
    ...draft.value,
    controllerId,
    apiId: '',
  }
}

function onApiChange(apiId: string) {
  draft.value = {
    ...draft.value,
    apiId,
  }
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

watch(
  () => [props.modelValue, props.field] as const,
  async ([open, field]) => {
    if (!open || !field) return
    const base =
      field.controllerBinding ?? createEmptyControllerBinding(field.type)
    let parseBody = base.parseBody
    // 兼容旧版形参 response
    if (/\bresponse\b/.test(parseBody) && !/\bdata\b/.test(parseBody)) {
      parseBody = parseBody.replace(/\bresponse\b/g, 'data')
    }
    draft.value = { ...base, parseBody }
    await loadServices()
    if (draft.value.serviceId) {
      await Promise.all([
        loadControllers(draft.value.serviceId),
        loadProcessors(draft.value.serviceId),
      ])
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
  const parseBody = editorRef.value?.getBody?.() ?? draft.value.parseBody
  emit('save', {
    ...draft.value,
    parseBody,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`控制器 · ${fieldName}`"
    width="780px"
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
    :raw-value="eventBindRaw"
    :methods="methods ?? []"
    :data-fields="dataFields ?? []"
    :xml="xml"
    :component-map="componentMap"
    :component-methods-map="componentMethodsMap"
    :icon-options="iconOptions"
    :emit-events="emitEvents"
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
