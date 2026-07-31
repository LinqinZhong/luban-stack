<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import TsCodeEditor from './TsCodeEditor.vue'
import { defaultComputeBody, type DataField } from '../../types/page-data'
import {
  buildTypeLibraryAmbientDeclarations,
  dataFieldsToAmbientVars,
  dataFieldToMethodParamType,
  dataFieldToTsType,
  type MethodParam,
  type MethodReturnType,
} from '../../types/page-method'
import { buildGetDeviceInfoAmbientDeclaration } from '../../utils/device-info'
import { buildDollarPropsAmbientDeclaration, buildUpdatePropsAmbientDeclarations } from '../../utils/component-props'
import { buildDollarQueryAmbientDeclaration } from '../../types/page-query'
import {
  buildDollarColorAmbientDeclaration,
  type ColorPalette,
} from '../../types/color-palette'
import type { ComponentPropDef } from '../../types/component'
import type { DataTypeLibrary } from '../../types/data-types'
import type { PageQueryParamDef } from '../../types/page-query'

const props = defineProps<{
  modelValue: boolean
  field: DataField | null
  /** 同级字段，用于方法体内直接引用（非形参） */
  siblingFields?: DataField[]
  /** 编辑组件时传入参数定义，注入 $props 提示 */
  componentProps?: ComponentPropDef[] | null
  /** 页面 Query 入参定义，注入 $query / $route 提示 */
  pageQueryParams?: PageQueryParamDef[] | null
  /** 项目数据类型库：具名类型 ambient + 精确返回类型 */
  typeLibrary?: DataTypeLibrary | null
  /** 画板颜色：$color.xxx 运行提示与补全 */
  colorPalette?: ColorPalette | null
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [body: string]
}>()

const body = ref('')
const editorRef = ref<{ getBody: () => string } | null>(null)

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

const fieldName = computed(() => props.field?.name.trim() || '未命名字段')

/** 同级字段 → ambient，方法签名无入参 */
const ambientVars = computed<MethodParam[]>(() =>
  dataFieldsToAmbientVars(props.siblingFields, props.typeLibrary),
)

/** 类型库 + 内置方法 + $props / $query ambient */
const ambientExtra = computed(() =>
  [
    buildTypeLibraryAmbientDeclarations(props.typeLibrary),
    buildGetDeviceInfoAmbientDeclaration(),
    buildDollarColorAmbientDeclaration(props.colorPalette),
    buildDollarPropsAmbientDeclaration(props.componentProps, props.typeLibrary),
    buildUpdatePropsAmbientDeclarations(props.componentProps, props.typeLibrary),
    props.pageQueryParams != null
      ? buildDollarQueryAmbientDeclaration(props.pageQueryParams)
      : '',
  ]
    .filter(Boolean)
    .join('\n'),
)

const showQueryHint = computed(() => props.pageQueryParams != null)

const returnType = computed<MethodReturnType>(() =>
  dataFieldToMethodParamType(props.field?.type ?? 'string'),
)

const returnTypeTs = computed(() =>
  props.field ? dataFieldToTsType(props.field, props.typeLibrary) : 'any',
)

const functionName = computed(() =>
  fieldName.value === '未命名字段' ? 'compute' : fieldName.value,
)

watch(
  () => [props.modelValue, props.field] as const,
  ([open, field]) => {
    if (!open || !field) return
    body.value =
      field.computeBody?.trim() ? field.computeBody : defaultComputeBody(field.type)
  },
)

function handleSave() {
  const next = editorRef.value?.getBody?.() ?? body.value
  body.value = next
  emit('save', next)
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`计算 · ${fieldName}`"
    width="760px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form label-position="top">
      <el-form-item label="方法体">
        <p class="hint">
          语法 TypeScript：顶部方法声明只读且无入参；同级数据池字段可直接按名字引用。
          亦可调用 <code>getDeviceInfo()</code>；画板颜色用 <code>$color.xxx</code>；组件内可用 <code>$props</code>。<template
            v-if="showQueryHint"
          > 页面可用 <code>$query</code> / <code>$route</code> 读取路由参数。</template>
          <code>return</code> 的值即为该字段的计算值。
        </p>
        <TsCodeEditor
          ref="editorRef"
          v-model="body"
          :function-name="functionName"
          :ambient-vars="ambientVars"
          :ambient-extra="ambientExtra"
          :return-type="returnType"
          :return-type-ts="returnTypeTs"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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
</style>
