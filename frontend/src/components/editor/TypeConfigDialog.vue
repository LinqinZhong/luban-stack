<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Plus, Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import TypeExprEditor from './TypeExprEditor.vue'
import {
  cloneDataTypeDef,
  createEmptyClearedTypeExpr,
  createEmptyEnumMember,
  createEmptyGenericParam,
  createEmptyInterfaceField,
  formatTypeExprPreview,
  isTypeExprCleared,
  isValidTypeName,
  selectValueToTypeExpr,
  typeExprToSelectValue,
  type DataTypeDef,
  type TypeAtom,
  type TypeExpr,
  type TypeGenericParam,
} from '../../types/data-types'

const props = defineProps<{
  modelValue: boolean
  typeDef: DataTypeDef | null
  namedOptions: Array<{ id: string; label: string }>
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [def: DataTypeDef]
}>()

const draft = ref<DataTypeDef | null>(null)
const showFieldErrors = ref(false)

const genericDialogVisible = ref(false)
const genericIndex = ref(-1)
const genericDraft = ref<TypeGenericParam | null>(null)

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible || !props.typeDef) {
      draft.value = null
      showFieldErrors.value = false
      genericDialogVisible.value = false
      return
    }
    draft.value = cloneDataTypeDef(props.typeDef)
    showFieldErrors.value = false
    if (draft.value.kind === 'interface' && !draft.value.fields.length) {
      draft.value.fields = [createEmptyInterfaceField()]
    }
    if (draft.value.kind === 'enum' && !draft.value.enumMembers.length) {
      draft.value.enumMembers = [createEmptyEnumMember()]
    }
  },
)

const title = computed(() => {
  if (!draft.value) return props.readonly ? '查看类型' : '配置类型'
  const verb = props.readonly ? '查看' : '配置'
  if (draft.value.kind === 'interface') return `${verb}接口 · ${draft.value.name || '未命名'}`
  if (draft.value.kind === 'enum') return `${verb}枚举 · ${draft.value.name || '未命名'}`
  return props.readonly ? '查看类型' : '配置类型'
})

const genericNames = computed(() =>
  (draft.value?.generics ?? []).map((g) => g.name).filter(Boolean),
)

const fieldTypeOptions = computed(() => {
  const base: Array<{ label: string; value: string }> = [
    { label: '数字', value: 'number' },
    { label: '字符串', value: 'string' },
    { label: '布尔值', value: 'boolean' },
    { label: 'any', value: 'any' },
  ]
  for (const name of genericNames.value) {
    base.push({ label: `泛型 ${name}`, value: `generic:${name}` })
  }
  for (const opt of props.namedOptions) {
    base.push({ label: opt.label, value: `named:${opt.id}` })
  }
  return base
})

function namedLookup(id: string): string {
  return props.namedOptions.find((o) => o.id === id)?.label || id
}

function genericSummary(g: TypeGenericParam): string {
  const parts: string[] = []
  if (g.constraint) {
    parts.push(`extends ${formatTypeExprPreview(g.constraint, namedLookup)}`)
  }
  if (g.default) {
    parts.push(`= ${formatTypeExprPreview(g.default, namedLookup)}`)
  }
  return parts.join(' ') || '无约束'
}

function close() {
  emit('update:modelValue', false)
}

function fieldNameError(index: number): string {
  if (!draft.value || draft.value.kind !== 'interface') return ''
  const name = draft.value.fields[index]?.name.trim() ?? ''
  if (!name) return '必填'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return '不合法'
  const dup = draft.value.fields.some(
    (f, i) => i !== index && f.name.trim() === name,
  )
  if (dup) return '重复'
  return ''
}

function save() {
  if (!draft.value || props.readonly) return
  if (draft.value.kind === 'interface') {
    showFieldErrors.value = true

    if (!draft.value.fields.length) {
      ElMessage.error('请至少添加一个字段')
      return
    }

    const genericNames = new Set<string>()
    for (const g of draft.value.generics) {
      const name = g.name.trim()
      if (!name) {
        ElMessage.error('泛型参数名不能为空')
        return
      }
      if (!isValidTypeName(name)) {
        ElMessage.error(`泛型参数名不合法：${name}`)
        return
      }
      if (genericNames.has(name)) {
        ElMessage.error(`泛型参数名重复：${name}`)
        return
      }
      genericNames.add(name)
    }

    const fieldNames = new Set<string>()
    for (let i = 0; i < draft.value.fields.length; i++) {
      const f = draft.value.fields[i]!
      const name = f.name.trim()
      if (!name) {
        ElMessage.error(`第 ${i + 1} 个字段名不能为空`)
        return
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        ElMessage.error(`字段名不合法：${name}`)
        return
      }
      if (fieldNames.has(name)) {
        ElMessage.error(`字段名重复：${name}`)
        return
      }
      fieldNames.add(name)
      f.name = name
      if (isTypeExprCleared(f.type)) {
        ElMessage.error(`字段「${name}」的类型不能为空`)
        return
      }
    }
  }
  if (draft.value.kind === 'enum') {
    if (!draft.value.enumMembers.length) {
      ElMessage.error('请至少添加一个枚举成员')
      return
    }
    const memberNames = new Set<string>()
    for (let i = 0; i < draft.value.enumMembers.length; i++) {
      const m = draft.value.enumMembers[i]!
      const name = m.name.trim()
      if (!name) {
        ElMessage.error(`第 ${i + 1} 个枚举成员名不能为空`)
        return
      }
      if (!isValidTypeName(name)) {
        ElMessage.error(`枚举成员名不合法：${name}`)
        return
      }
      if (memberNames.has(name)) {
        ElMessage.error(`枚举成员名重复：${name}`)
        return
      }
      memberNames.add(name)
      m.name = name
    }
  }
  showFieldErrors.value = false
  emit('save', cloneDataTypeDef(draft.value))
  close()
}

function fieldSelectValue(index: number): string {
  const field = draft.value?.fields[index]
  if (!field) return ''
  return typeExprToSelectValue(field.type)
}

function fieldTypeError(index: number): boolean {
  if (!showFieldErrors.value || !draft.value) return false
  const field = draft.value.fields[index]
  return Boolean(field && isTypeExprCleared(field.type))
}

function handleFieldTypeChange(index: number, value: string | null | undefined) {
  if (!draft.value) return
  const next = value
    ? selectValueToTypeExpr(value)
    : createEmptyClearedTypeExpr()
  draft.value.fields = draft.value.fields.map((f, i) =>
    i === index ? { ...f, type: next } : f,
  )
}

/** 清除已不存在的泛型引用（字段类型 / 其它泛型的约束与默认） */
function scrubStaleGenericRefs() {
  if (!draft.value) return
  const names = new Set(
    draft.value.generics.map((g) => g.name.trim()).filter(Boolean),
  )

  function scrubExpr(expr: TypeExpr | null): TypeExpr | null {
    if (!expr) return null
    const atom = expr.intersections[0]?.alternatives[0]
    if (!atom) return expr
    if (atom.kind === 'array') {
      const itemScrubbed = scrubExpr({
        intersections: [{ alternatives: [atom.item ?? { kind: 'any' }] }],
      })
      if (!itemScrubbed) return null
      const item = itemScrubbed.intersections[0]?.alternatives[0] ?? { kind: 'any' as const }
      return {
        intersections: [{ alternatives: [{ kind: 'array', item }] }],
      }
    }
    if (atom.kind === 'generic' && (!atom.ref || !names.has(atom.ref))) {
      return null
    }
    return expr
  }

  draft.value.fields = draft.value.fields.map((f) => {
    const scrubbed = scrubExpr(f.type)
    if (!scrubbed) {
      return { ...f, type: createEmptyClearedTypeExpr() }
    }
    return { ...f, type: scrubbed }
  })

  draft.value.generics = draft.value.generics.map((g) => ({
    ...g,
    constraint: scrubExpr(g.constraint),
    default: scrubExpr(g.default),
  }))
}

function removeGeneric(index: number) {
  if (!draft.value || props.readonly) return
  draft.value.generics = draft.value.generics.filter((_, i) => i !== index)
  scrubStaleGenericRefs()
}

function openGenericConfig(index: number) {
  const g = draft.value?.generics[index]
  if (!g) return
  genericIndex.value = index
  genericDraft.value = JSON.parse(JSON.stringify(g)) as TypeGenericParam
  genericDialogVisible.value = true
}

function saveGenericConfig() {
  if (props.readonly) return
  if (!draft.value || !genericDraft.value || genericIndex.value < 0) return
  const name = genericDraft.value.name.trim()
  if (!isValidTypeName(name)) {
    ElMessage.error('泛型参数名不合法')
    return
  }
  const prevName = draft.value.generics[genericIndex.value]?.name.trim() ?? ''
  draft.value.generics = draft.value.generics.map((g, i) =>
    i === genericIndex.value
      ? { ...genericDraft.value!, name }
      : g,
  )
  // 重命名时同步字段里的旧泛型引用
  if (prevName && prevName !== name) {
    function renameGenericInAtom(atom: TypeAtom): TypeAtom {
      if (atom.kind === 'array') {
        return {
          kind: 'array',
          item: renameGenericInAtom(atom.item ?? { kind: 'any' }),
        }
      }
      if (atom.kind === 'generic' && atom.ref === prevName) {
        return { kind: 'generic', ref: name }
      }
      return atom
    }
    draft.value.fields = draft.value.fields.map((f) => {
      const atom = f.type.intersections[0]?.alternatives[0]
      if (!atom) return f
      return {
        ...f,
        type: {
          intersections: [{ alternatives: [renameGenericInAtom(atom)] }],
        },
      }
    })
  }
  scrubStaleGenericRefs()
  genericDialogVisible.value = false
  genericIndex.value = -1
  genericDraft.value = null
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="title"
    width="820px"
    destroy-on-close
    append-to-body
    @update:model-value="emit('update:modelValue', $event)"
  >
    <fieldset class="readonly-fieldset" :disabled="readonly">
    <template v-if="draft?.kind === 'interface'">
      <div class="section">
        <div class="section-head">
          <span class="section-title">泛型参数</span>
          <el-button
            v-if="!readonly"
            type="primary"
            link
            :icon="Plus"
            @click="draft.generics = [...draft.generics, createEmptyGenericParam()]"
          >
            添加
          </el-button>
        </div>
        <p v-if="!draft.generics.length" class="section-hint">
          无泛型（例如 List&lt;T&gt; 可添加 T）
        </p>
        <div
          v-for="(g, gi) in draft.generics"
          :key="g.id"
          class="generic-row"
        >
          <el-input
            v-model="g.name"
            placeholder="参数名，如 T"
            style="width: 120px"
          />
          <span class="generic-summary" :title="genericSummary(g)">
            {{ genericSummary(g) }}
          </span>
          <el-button
            v-if="!readonly"
            type="primary"
            link
            :icon="Setting"
            @click="openGenericConfig(gi)"
          >
            配置
          </el-button>
          <el-button
            v-else
            type="primary"
            link
            :icon="Setting"
            @click="openGenericConfig(gi)"
          >
            查看
          </el-button>
          <el-button
            v-if="!readonly"
            type="danger"
            link
            :icon="Delete"
            @click="removeGeneric(gi)"
          />
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">字段</span>
          <el-button
            v-if="!readonly"
            type="primary"
            link
            :icon="Plus"
            @click="draft.fields = [...draft.fields, createEmptyInterfaceField()]"
          >
            添加
          </el-button>
        </div>

        <div v-for="(field, fi) in draft.fields" :key="field.id" class="field-row">
          <el-input
            v-model="field.name"
            placeholder="字段名"
            style="width: 120px"
            :status="showFieldErrors && fieldNameError(fi) ? 'error' : undefined"
          />
          <div class="optional-box">
            <span class="optional-label">可选</span>
            <el-switch v-model="field.optional" size="small" />
          </div>
          <el-input
            v-model="field.remark"
            placeholder="备注"
            style="flex: 1; min-width: 80px"
          />
          <el-select
            :model-value="fieldSelectValue(fi) || undefined"
            placeholder="选择类型"
            style="width: 150px"
            filterable
            clearable
            :status="fieldTypeError(fi) ? 'error' : undefined"
            @update:model-value="handleFieldTypeChange(fi, $event)"
          >
            <el-option
              v-for="opt in fieldTypeOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-button
            v-if="!readonly"
            type="danger"
            link
            :icon="Delete"
            @click="draft.fields = draft.fields.filter((_, i) => i !== fi)"
          />
        </div>
      </div>
    </template>

    <template v-else-if="draft?.kind === 'enum'">
      <div class="section">
        <div class="section-head">
          <span class="section-title">枚举成员</span>
          <el-button
            v-if="!readonly"
            type="primary"
            link
            :icon="Plus"
            @click="draft.enumMembers = [...draft.enumMembers, createEmptyEnumMember()]"
          >
            添加
          </el-button>
        </div>
        <el-table :data="draft.enumMembers" border size="small">
          <el-table-column label="成员名" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.name" placeholder="如 Active" />
            </template>
          </el-table-column>
          <el-table-column label="值（可选）" min-width="140">
            <template #default="{ row }">
              <el-input v-model="row.value" placeholder="留空则自动" />
            </template>
          </el-table-column>
          <el-table-column
            v-if="!readonly"
            label="操作"
            width="72"
            align="center"
          >
            <template #default="{ $index }">
              <el-button
                type="danger"
                link
                :icon="Delete"
                @click="draft.enumMembers = draft.enumMembers.filter((_, i) => i !== $index)"
              />
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
    </fieldset>

    <template #footer>
      <el-button @click="close">{{ readonly ? '关闭' : '取消' }}</el-button>
      <el-button v-if="!readonly" type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="genericDialogVisible"
    :title="`配置泛型 · ${genericDraft?.name || 'T'}`"
    width="680px"
    append-to-body
    destroy-on-close
  >
    <template v-if="genericDraft">
      <div class="generic-form">
        <div class="generic-form-item">
          <div class="cfg-label">参数名</div>
          <div class="cfg-content">
            <el-input
              v-model="genericDraft.name"
              placeholder="如 T"
              style="width: 160px"
            />
          </div>
        </div>

        <div class="generic-form-item">
          <div class="cfg-label">约束 extends</div>
          <div class="cfg-content">
            <TypeExprEditor
              class="cfg-editor"
              :model-value="genericDraft.constraint"
              :named-options="namedOptions"
              :generic-names="genericNames"
              allow-none
              @update:model-value="genericDraft.constraint = $event"
            />
          </div>
        </div>

        <div class="generic-form-item">
          <div class="cfg-label">默认类型</div>
          <div class="cfg-content">
            <TypeExprEditor
              class="cfg-editor"
              :model-value="genericDraft.default"
              :named-options="namedOptions"
              :generic-names="genericNames"
              allow-none
              @update:model-value="genericDraft.default = $event"
            />
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <el-button @click="genericDialogVisible = false">
        {{ readonly ? '关闭' : '取消' }}
      </el-button>
      <el-button v-if="!readonly" type="primary" @click="saveGenericConfig">
        确定
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.readonly-fieldset {
  margin: 0;
  padding: 0;
  border: 0;
  min-width: 0;
}

.section {
  margin-bottom: 20px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.section-hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.4;
}

.generic-row,
.field-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
}

.generic-summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #94a3b8;
}

.optional-box {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  background: #fff;
  box-sizing: border-box;
  flex-shrink: 0;
}

.optional-label {
  font-size: 13px;
  color: #606266;
  line-height: 1;
  white-space: nowrap;
}

.preview {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
  word-break: break-all;
}

.generic-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.generic-form-item {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.cfg-label {
  width: 96px;
  flex-shrink: 0;
  padding-top: 6px;
  font-size: 13px;
  line-height: 20px;
  color: #606266;
  text-align: right;
}

.cfg-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.cfg-editor {
  width: 100%;
}
</style>
