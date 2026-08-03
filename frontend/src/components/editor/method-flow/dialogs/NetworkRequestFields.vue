<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MethodParam } from '../../../../types/page-method'
import {
  NETWORK_HTTP_METHODS,
  NETWORK_MEDIA_CUSTOM,
  NETWORK_MEDIA_TYPE_OPTIONS,
  createEmptyNetworkParamRow,
  isFormUrlEncoded,
  usesRequestBody,
  type NetworkConstantType,
  type NetworkParamRow,
  type NetworkRequestConfig,
} from './network-request'

const props = defineProps<{
  modelValue: NetworkRequestConfig
  ambientVars: MethodParam[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: NetworkRequestConfig]
}>()

const draft = computed({
  get: () => props.modelValue,
  set: (v: NetworkRequestConfig) => emit('update:modelValue', v),
})

const mediaPreset = ref<string>('application/json')
const customMedia = ref('')

watch(
  () => props.modelValue.mediaType,
  (mt) => {
    const known = NETWORK_MEDIA_TYPE_OPTIONS.some(
      (o) => o.value !== NETWORK_MEDIA_CUSTOM && o.value === mt,
    )
    if (known) {
      mediaPreset.value = mt
      customMedia.value = ''
    } else if (mt.trim()) {
      mediaPreset.value = NETWORK_MEDIA_CUSTOM
      customMedia.value = mt.startsWith('application/')
        ? mt.slice('application/'.length)
        : mt
    } else {
      mediaPreset.value = 'application/json'
      customMedia.value = ''
    }
  },
  { immediate: true },
)

function patch(partial: Partial<NetworkRequestConfig>) {
  emit('update:modelValue', { ...props.modelValue, ...partial })
}

function onMediaPresetChange(preset: string) {
  mediaPreset.value = preset
  if (preset === NETWORK_MEDIA_CUSTOM) {
    const suffix = customMedia.value.trim() || ''
    patch({
      mediaType: suffix ? `application/${suffix}` : 'application/',
    })
    return
  }
  patch({ mediaType: preset })
}

function onCustomMediaInput(suffix: string) {
  customMedia.value = suffix
  patch({ mediaType: `application/${suffix.trim()}` })
}

const showFormParams = computed(() =>
  isFormUrlEncoded(props.modelValue.mediaType),
)
const showBodyVar = computed(() => usesRequestBody(props.modelValue.mediaType))

const ambientOptions = computed(() =>
  props.ambientVars
    .map((v) => v.name.trim())
    .filter(Boolean)
    .map((name) => ({ value: name, label: name })),
)

function updateRow(
  key: 'headers' | 'queryParams' | 'formParams',
  index: number,
  patchRow: Partial<NetworkParamRow>,
) {
  const list = props.modelValue[key].map((r, i) =>
    i === index ? { ...r, ...patchRow } : r,
  )
  patch({ [key]: list })
}

function addRow(key: 'headers' | 'queryParams' | 'formParams') {
  patch({
    [key]: [...props.modelValue[key], createEmptyNetworkParamRow()],
  })
}

function removeRow(
  key: 'headers' | 'queryParams' | 'formParams',
  index: number,
) {
  patch({
    [key]: props.modelValue[key].filter((_, i) => i !== index),
  })
}

const CONSTANT_TYPES: Array<{ value: NetworkConstantType; label: string }> = [
  { value: 'string', label: '字符串' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '布尔' },
]
</script>

<template>
  <div class="network-request-fields">
    <el-form-item label="API地址" required>
      <el-input
        :model-value="draft.apiUrl"
        size="small"
        placeholder="如 https://api.example.com/v1/list 或含变量表达式"
        @update:model-value="patch({ apiUrl: $event })"
      />
    </el-form-item>

    <el-form-item label="请求方法" required>
      <el-select
        :model-value="draft.httpMethod"
        size="small"
        style="width: 100%"
        @update:model-value="patch({ httpMethod: $event })"
      >
        <el-option
          v-for="m in NETWORK_HTTP_METHODS"
          :key="m"
          :label="m"
          :value="m"
        />
      </el-select>
    </el-form-item>

    <el-form-item label="请求头">
      <div class="param-list">
        <div
          v-for="(row, idx) in draft.headers"
          :key="`h-${idx}`"
          class="param-row"
        >
          <el-input
            :model-value="row.name"
            size="small"
            class="param-name"
            placeholder="参数名"
            @update:model-value="updateRow('headers', idx, { name: $event })"
          />
          <el-select
            :model-value="row.valueKind"
            size="small"
            class="param-kind"
            @update:model-value="
              updateRow('headers', idx, { valueKind: $event, value: '' })
            "
          >
            <el-option label="变量" value="variable" />
            <el-option label="常量" value="constant" />
          </el-select>
          <el-select
            v-if="row.valueKind === 'variable'"
            :model-value="row.value"
            size="small"
            class="param-value"
            filterable
            clearable
            placeholder="选择变量"
            @update:model-value="updateRow('headers', idx, { value: $event })"
          >
            <el-option
              v-for="opt in ambientOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div v-else class="param-const">
            <el-select
              :model-value="row.constantType || 'string'"
              size="small"
              class="const-type"
              @update:model-value="
                updateRow('headers', idx, { constantType: $event })
              "
            >
              <el-option
                v-for="t in CONSTANT_TYPES"
                :key="t.value"
                :label="t.label"
                :value="t.value"
              />
            </el-select>
            <el-select
              v-if="(row.constantType || 'string') === 'boolean'"
              :model-value="row.value"
              size="small"
              class="const-value"
              placeholder="值"
              @update:model-value="updateRow('headers', idx, { value: $event })"
            >
              <el-option label="true" value="true" />
              <el-option label="false" value="false" />
            </el-select>
            <el-input
              v-else
              :model-value="row.value"
              size="small"
              class="const-value"
              :placeholder="
                (row.constantType || 'string') === 'number' ? '数字' : '值'
              "
              @update:model-value="updateRow('headers', idx, { value: $event })"
            />
          </div>
          <el-button
            size="small"
            text
            type="danger"
            @click="removeRow('headers', idx)"
          >
            删
          </el-button>
        </div>
        <el-button size="small" @click="addRow('headers')">添加请求头</el-button>
      </div>
    </el-form-item>

    <el-form-item label="查询参数">
      <div class="param-list">
        <div
          v-for="(row, idx) in draft.queryParams"
          :key="`q-${idx}`"
          class="param-row"
        >
          <el-input
            :model-value="row.name"
            size="small"
            class="param-name"
            placeholder="参数名"
            @update:model-value="
              updateRow('queryParams', idx, { name: $event })
            "
          />
          <el-select
            :model-value="row.valueKind"
            size="small"
            class="param-kind"
            @update:model-value="
              updateRow('queryParams', idx, { valueKind: $event, value: '' })
            "
          >
            <el-option label="变量" value="variable" />
            <el-option label="常量" value="constant" />
          </el-select>
          <el-select
            v-if="row.valueKind === 'variable'"
            :model-value="row.value"
            size="small"
            class="param-value"
            filterable
            clearable
            placeholder="选择变量"
            @update:model-value="
              updateRow('queryParams', idx, { value: $event })
            "
          >
            <el-option
              v-for="opt in ambientOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div v-else class="param-const">
            <el-select
              :model-value="row.constantType || 'string'"
              size="small"
              class="const-type"
              @update:model-value="
                updateRow('queryParams', idx, { constantType: $event })
              "
            >
              <el-option
                v-for="t in CONSTANT_TYPES"
                :key="t.value"
                :label="t.label"
                :value="t.value"
              />
            </el-select>
            <el-select
              v-if="(row.constantType || 'string') === 'boolean'"
              :model-value="row.value"
              size="small"
              class="const-value"
              placeholder="值"
              @update:model-value="
                updateRow('queryParams', idx, { value: $event })
              "
            >
              <el-option label="true" value="true" />
              <el-option label="false" value="false" />
            </el-select>
            <el-input
              v-else
              :model-value="row.value"
              size="small"
              class="const-value"
              :placeholder="
                (row.constantType || 'string') === 'number' ? '数字' : '值'
              "
              @update:model-value="
                updateRow('queryParams', idx, { value: $event })
              "
            />
          </div>
          <el-button
            size="small"
            text
            type="danger"
            @click="removeRow('queryParams', idx)"
          >
            删
          </el-button>
        </div>
        <el-button size="small" @click="addRow('queryParams')">
          添加查询参数
        </el-button>
      </div>
    </el-form-item>

    <el-form-item label="媒体类型" required>
      <div class="media-block">
        <el-select
          :model-value="mediaPreset"
          size="small"
          style="width: 100%"
          @update:model-value="onMediaPresetChange"
        >
          <el-option
            v-for="opt in NETWORK_MEDIA_TYPE_OPTIONS"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
        <el-input
          v-if="mediaPreset === NETWORK_MEDIA_CUSTOM"
          :model-value="customMedia"
          size="small"
          placeholder="如 soap+xml（将拼为 application/…）"
          @update:model-value="onCustomMediaInput"
        >
          <template #prepend>application/</template>
        </el-input>
      </div>
    </el-form-item>

    <el-form-item v-if="showFormParams" label="表单参数">
      <div class="param-list">
        <div
          v-for="(row, idx) in draft.formParams"
          :key="`f-${idx}`"
          class="param-row"
        >
          <el-input
            :model-value="row.name"
            size="small"
            class="param-name"
            placeholder="参数名"
            @update:model-value="updateRow('formParams', idx, { name: $event })"
          />
          <el-select
            :model-value="row.valueKind"
            size="small"
            class="param-kind"
            @update:model-value="
              updateRow('formParams', idx, { valueKind: $event, value: '' })
            "
          >
            <el-option label="变量" value="variable" />
            <el-option label="常量" value="constant" />
          </el-select>
          <el-select
            v-if="row.valueKind === 'variable'"
            :model-value="row.value"
            size="small"
            class="param-value"
            filterable
            clearable
            placeholder="选择变量"
            @update:model-value="
              updateRow('formParams', idx, { value: $event })
            "
          >
            <el-option
              v-for="opt in ambientOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <div v-else class="param-const">
            <el-select
              :model-value="row.constantType || 'string'"
              size="small"
              class="const-type"
              @update:model-value="
                updateRow('formParams', idx, { constantType: $event })
              "
            >
              <el-option
                v-for="t in CONSTANT_TYPES"
                :key="t.value"
                :label="t.label"
                :value="t.value"
              />
            </el-select>
            <el-select
              v-if="(row.constantType || 'string') === 'boolean'"
              :model-value="row.value"
              size="small"
              class="const-value"
              placeholder="值"
              @update:model-value="
                updateRow('formParams', idx, { value: $event })
              "
            >
              <el-option label="true" value="true" />
              <el-option label="false" value="false" />
            </el-select>
            <el-input
              v-else
              :model-value="row.value"
              size="small"
              class="const-value"
              :placeholder="
                (row.constantType || 'string') === 'number' ? '数字' : '值'
              "
              @update:model-value="
                updateRow('formParams', idx, { value: $event })
              "
            />
          </div>
          <el-button
            size="small"
            text
            type="danger"
            @click="removeRow('formParams', idx)"
          >
            删
          </el-button>
        </div>
        <el-button size="small" @click="addRow('formParams')">
          添加表单参数
        </el-button>
      </div>
    </el-form-item>

    <el-form-item v-if="showBodyVar" label="请求体">
      <el-select
        :model-value="draft.bodyVarName"
        size="small"
        filterable
        clearable
        placeholder="选择已有变量"
        style="width: 100%"
        @update:model-value="patch({ bodyVarName: $event || '' })"
      >
        <el-option
          v-for="opt in ambientOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
    </el-form-item>
  </div>
</template>

<style scoped>
.network-request-fields {
  width: 100%;
}

.param-list {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.param-name {
  flex: 0 0 110px;
  width: 110px;
}

.param-kind {
  flex: 0 0 84px;
  width: 84px;
}

.param-value {
  flex: 1 1 0;
  min-width: 0;
}

.param-const {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  gap: 4px;
}

.const-type {
  flex: 0 0 78px;
  width: 78px;
}

.const-value {
  flex: 1 1 0;
  min-width: 0;
}

.media-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
