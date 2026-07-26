<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  getBackendServiceLibrary,
  getServiceControllers,
} from '../../api/projects'
import type {
  BackendService,
  ServiceApi,
  ServiceController,
  ProcessorTypeExpr,
} from '../../types/backend-services'
import {
  apiMatchesApiPropConstraint,
  createEmptyApiPropBinding,
  parseApiPropBinding,
  serializeApiPropBinding,
  type ApiPropBinding,
} from '../../utils/api-prop'
import type { MethodParam } from '../../types/page-method'

const props = defineProps<{
  modelValue: string
  projectPath: string
  apiParams?: MethodParam[] | null
  apiReturnType?: ProcessorTypeExpr | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const services = ref<BackendService[]>([])
const controllers = ref<ServiceController[]>([])
const loadingServices = ref(false)
const loadingControllers = ref(false)

const draft = ref<ApiPropBinding>(createEmptyApiPropBinding())

function syncFromModel(raw: string) {
  draft.value = parseApiPropBinding(raw) ?? createEmptyApiPropBinding()
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
  () => [props.projectPath, draft.value.serviceId] as const,
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

function commit() {
  const next =
    draft.value.serviceId && draft.value.controllerId && draft.value.apiId
      ? serializeApiPropBinding(draft.value)
      : ''
  emit('update:modelValue', next)
  emit('change', next)
}

function onServiceChange(serviceId: string | null) {
  draft.value.serviceId = serviceId?.trim() || ''
  draft.value.controllerId = ''
  draft.value.apiId = ''
  commit()
}

function onControllerChange(controllerId: string | null) {
  draft.value.controllerId = controllerId?.trim() || ''
  draft.value.apiId = ''
  commit()
}

function onApiChange(apiId: string | null) {
  draft.value.apiId = apiId?.trim() || ''
  commit()
}

function apiLabel(api: ServiceApi): string {
  const method = (api.method || 'GET').toUpperCase()
  const path = api.path?.trim() || ''
  return `${api.name || api.id} · ${method} ${path}`.trim()
}

const unmatchedHint = computed(() => {
  const total = selectedController.value?.apis?.length ?? 0
  const matched = matchingApis.value.length
  if (!draft.value.controllerId || total === 0) return ''
  if (matched === total) return ''
  return `已按入参/出参过滤：${matched}/${total} 个接口可选`
})
</script>

<template>
  <div class="api-prop-bind">
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
    <el-select
      :model-value="draft.apiId || undefined"
      clearable
      filterable
      placeholder="选择 API（必填入参与出参须匹配）"
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
  </div>
</template>

<style scoped>
.api-prop-bind {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}
</style>
