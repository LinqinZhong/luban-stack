<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import {
  createEmptyServiceApiParam,
  HTTP_METHOD_OPTIONS,
  SERVICE_API_PARAM_LOCATION_OPTIONS,
  type HttpMethod,
  type ServiceApi,
  type ServiceApiParam,
  type ServiceApiParamLocation,
} from '../../types/backend-services'

export type ServiceApiEditPayload = {
  name: string
  path: string
  remark: string
  method: HttpMethod
  inputs: ServiceApiParam[]
  requireAuth: boolean
}

const props = defineProps<{
  modelValue: boolean
  api: ServiceApi | null
  dtoOptions: Array<{ id: string; label: string }>
  reservedNames?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [payload: ServiceApiEditPayload]
}>()

const PRIMITIVE_TYPES = [
  { label: 'string', value: 'string' },
  { label: 'number', value: 'number' },
  { label: 'boolean', value: 'boolean' },
] as const

const draftName = ref('')
const draftPath = ref('')
const draftRemark = ref('')
const draftMethod = ref<HttpMethod>('GET')
const draftInputs = ref<ServiceApiParam[]>([])
const draftRequireAuth = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const title = computed(() => {
  const name = props.api?.name?.trim()
  return name ? `设计 API · ${name}` : '设计 API'
})

const typeSelectOptions = computed(() => [
  ...PRIMITIVE_TYPES.map((t) => ({
    label: t.label,
    value: `prim:${t.value}`,
    type: t.value,
    typeRef: '',
  })),
  ...props.dtoOptions.map((o) => ({
    label: o.label,
    value: `dto:${o.id}`,
    type: 'json',
    typeRef: o.id,
  })),
])

watch(
  () => [props.modelValue, props.api] as const,
  ([open, api]) => {
    if (!open || !api) return
    draftName.value = api.name ?? ''
    draftPath.value = api.path ?? ''
    draftRemark.value = api.remark ?? ''
    draftMethod.value = api.method ?? 'GET'
    draftInputs.value = (api.inputs ?? []).map((p) => ({ ...p }))
    draftRequireAuth.value = Boolean(api.requireAuth)
  },
)

function typeSelectValue(row: ServiceApiParam): string {
  if (row.typeRef) return `dto:${row.typeRef}`
  return `prim:${row.type || 'string'}`
}

function addInput() {
  draftInputs.value = [
    ...draftInputs.value,
    createEmptyServiceApiParam({
      varName: `arg${draftInputs.value.length + 1}`,
      location: 'query',
    }),
  ]
}

function updateInput(index: number, patch: Partial<ServiceApiParam>) {
  draftInputs.value = draftInputs.value.map((p, i) =>
    i === index ? { ...p, ...patch } : p,
  )
}

function handleTypeChange(index: number, value: string) {
  const opt = typeSelectOptions.value.find((o) => o.value === value)
  if (!opt) return
  updateInput(index, { type: opt.type, typeRef: opt.typeRef })
}

function removeInput(index: number) {
  draftInputs.value = draftInputs.value.filter((_, i) => i !== index)
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
  const inputs = draftInputs.value
    .map((p) => ({
      ...p,
      varName: p.varName.trim(),
      remark: p.remark.trim(),
      type: p.typeRef ? 'json' : p.type.trim() || 'string',
      typeRef: p.typeRef.trim(),
    }))
    .filter((p) => p.varName)
  for (const p of inputs) {
    if (!p.varName) {
      ElMessage.warning('请填写变量名')
      return
    }
  }
  emit('save', {
    name,
    path: draftPath.value.trim() || '/',
    remark: draftRemark.value.trim(),
    method: draftMethod.value,
    inputs,
    requireAuth: draftRequireAuth.value,
  })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="860px"
    destroy-on-close
    append-to-body
    class="service-api-dialog"
  >
    <el-form
      class="api-form"
      label-position="right"
      label-width="80px"
      @submit.prevent
    >
      <el-form-item label="名称" required>
        <el-input
          v-model="draftName"
          placeholder="如 list"
          maxlength="64"
        />
      </el-form-item>
      <el-form-item label="路径">
        <el-input
          v-model="draftPath"
          placeholder="如 / 或 /list"
          maxlength="128"
        />
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

      <el-form-item label="入参" class="inputs-item">
        <div class="inputs-block">
          <div class="inputs-toolbar">
            <el-button type="primary" link :icon="Plus" @click="addInput">
              添加
            </el-button>
          </div>
          <el-table
            :data="draftInputs"
            border
            stripe
            empty-text="暂无入参，点击添加"
            size="small"
          >
            <el-table-column label="变量名" min-width="110">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.varName"
                  placeholder="变量名"
                  size="small"
                  @update:model-value="
                    updateInput($index, { varName: String($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="来源" width="120">
              <template #default="{ row, $index }">
                <el-select
                  :model-value="row.location"
                  size="small"
                  style="width: 100%"
                  @update:model-value="
                    updateInput($index, {
                      location: $event as ServiceApiParamLocation,
                    })
                  "
                >
                  <el-option
                    v-for="opt in SERVICE_API_PARAM_LOCATION_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="类型" min-width="180">
              <template #default="{ row, $index }">
                <el-select
                  :model-value="typeSelectValue(row)"
                  filterable
                  size="small"
                  style="width: 100%"
                  @update:model-value="handleTypeChange($index, String($event))"
                >
                  <el-option
                    v-for="opt in typeSelectOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="必传" width="64" align="center">
              <template #default="{ row, $index }">
                <el-checkbox
                  :model-value="row.required"
                  @update:model-value="
                    updateInput($index, { required: Boolean($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="说明" min-width="110">
              <template #default="{ row, $index }">
                <el-input
                  :model-value="row.remark"
                  placeholder="可选"
                  size="small"
                  @update:model-value="
                    updateInput($index, { remark: String($event) })
                  "
                />
              </template>
            </el-table-column>
            <el-table-column label="" width="56" align="center">
              <template #default="{ $index }">
                <el-button
                  type="danger"
                  link
                  size="small"
                  @click="removeInput($index)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.api-form {
  padding-right: 8px;
}

.inputs-item :deep(.el-form-item__content) {
  display: block;
}

.inputs-block {
  width: 100%;
}

.inputs-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
</style>
