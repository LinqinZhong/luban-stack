<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Plus, Setting } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import TypeExprEditor from './TypeExprEditor.vue'
import {
  cloneDataTypeDef,
  cloneTypeExpr,
  createEmptyEnumMember,
  createEmptyGenericParam,
  createEmptyInterfaceField,
  createEmptyTypeExpr,
  formatTypeExprPreview,
  isValidTypeName,
  selectValueToTypeExpr,
  typeExprToSelectValue,
  type DataTypeDef,
  type TypeExpr,
  type TypeGenericParam,
} from '../../types/data-types'

const props = defineProps<{
  modelValue: boolean
  typeDef: DataTypeDef | null
  namedOptions: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [def: DataTypeDef]
}>()

const draft = ref<DataTypeDef | null>(null)

const unionDialogVisible = ref(false)
const unionFieldIndex = ref(-1)
const unionDraft = ref<TypeExpr>(createEmptyTypeExpr())

const genericDialogVisible = ref(false)
const genericIndex = ref(-1)
const genericDraft = ref<TypeGenericParam | null>(null)

watch(
  () => props.modelValue,
  (visible) => {
    if (!visible || !props.typeDef) {
      draft.value = null
      unionDialogVisible.value = false
      genericDialogVisible.value = false
      return
    }
    draft.value = cloneDataTypeDef(props.typeDef)
    if (draft.value.kind === 'interface' && !draft.value.fields.length) {
      draft.value.fields = [createEmptyInterfaceField()]
    }
    if (draft.value.kind === 'enum' && !draft.value.enumMembers.length) {
      draft.value.enumMembers = [createEmptyEnumMember()]
    }
    if (draft.value.kind === 'combination' && !draft.value.combination.intersections.length) {
      draft.value.combination = createEmptyTypeExpr()
    }
  },
)

const title = computed(() => {
  if (!draft.value) return '配置类型'
  if (draft.value.kind === 'interface') return `配置接口 · ${draft.value.name || '未命名'}`
  if (draft.value.kind === 'enum') return `配置枚举 · ${draft.value.name || '未命名'}`
  if (draft.value.kind === 'combination') return `配置组合 · ${draft.value.name || '未命名'}`
  return '配置类型'
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
    { label: 'unknown', value: 'unknown' },
    { label: '联合类型', value: 'combination' },
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

function save() {
  if (!draft.value) return
  if (draft.value.kind === 'interface') {
    for (const g of draft.value.generics) {
      if (g.name && !isValidTypeName(g.name)) {
        ElMessage.error(`泛型参数名不合法：${g.name}`)
        return
      }
    }
    for (const f of draft.value.fields) {
      if (f.name && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) {
        ElMessage.error(`字段名不合法：${f.name}`)
        return
      }
    }
  }
  if (draft.value.kind === 'enum') {
    for (const m of draft.value.enumMembers) {
      if (m.name && !isValidTypeName(m.name)) {
        ElMessage.error(`枚举成员名不合法：${m.name}`)
        return
      }
    }
  }
  emit('save', cloneDataTypeDef(draft.value))
  close()
}

function fieldSelectValue(index: number): string {
  const field = draft.value?.fields[index]
  if (!field) return 'string'
  return typeExprToSelectValue(field.type)
}

function handleFieldTypeChange(index: number, value: string) {
  if (!draft.value) return
  const prev = draft.value.fields[index]?.type
  const next =
    value === 'combination' && prev && typeExprToSelectValue(prev) === 'combination'
      ? cloneTypeExpr(prev)
      : selectValueToTypeExpr(value)
  draft.value.fields = draft.value.fields.map((f, i) =>
    i === index ? { ...f, type: next } : f,
  )
  if (value === 'combination') {
    openUnionConfig(index)
  }
}

function openUnionConfig(index: number) {
  const field = draft.value?.fields[index]
  if (!field) return
  unionFieldIndex.value = index
  unionDraft.value = cloneTypeExpr(
    typeExprToSelectValue(field.type) === 'combination'
      ? field.type
      : createEmptyTypeExpr(),
  )
  unionDialogVisible.value = true
}

function saveUnionConfig() {
  if (!draft.value || unionFieldIndex.value < 0) return
  const idx = unionFieldIndex.value
  draft.value.fields = draft.value.fields.map((f, i) =>
    i === idx ? { ...f, type: cloneTypeExpr(unionDraft.value) } : f,
  )
  unionDialogVisible.value = false
  unionFieldIndex.value = -1
}

function openGenericConfig(index: number) {
  const g = draft.value?.generics[index]
  if (!g) return
  genericIndex.value = index
  genericDraft.value = JSON.parse(JSON.stringify(g)) as TypeGenericParam
  genericDialogVisible.value = true
}

function saveGenericConfig() {
  if (!draft.value || !genericDraft.value || genericIndex.value < 0) return
  const name = genericDraft.value.name.trim()
  if (!isValidTypeName(name)) {
    ElMessage.error('泛型参数名不合法')
    return
  }
  draft.value.generics = draft.value.generics.map((g, i) =>
    i === genericIndex.value
      ? { ...genericDraft.value!, name }
      : g,
  )
  genericDialogVisible.value = false
  genericIndex.value = -1
  genericDraft.value = null
}

function setGenericConstraint(enabled: boolean) {
  if (!genericDraft.value) return
  genericDraft.value.constraint = enabled ? createEmptyTypeExpr() : null
}

function setGenericDefault(enabled: boolean) {
  if (!genericDraft.value) return
  genericDraft.value.default = enabled ? createEmptyTypeExpr() : null
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
    <template v-if="draft?.kind === 'interface'">
      <div class="section">
        <div class="section-head">
          <span class="section-title">泛型参数</span>
          <el-button
            type="primary"
            link
            :icon="Plus"
            @click="draft.generics = [...draft.generics, createEmptyGenericParam()]"
          >
            添加
          </el-button>
        </div>
        <el-empty
          v-if="!draft.generics.length"
          description="无泛型（例如 List&lt;T&gt; 可添加 T）"
          :image-size="48"
        />
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
            type="primary"
            link
            :icon="Setting"
            @click="openGenericConfig(gi)"
          >
            配置
          </el-button>
          <el-button
            type="danger"
            link
            :icon="Delete"
            @click="draft.generics = draft.generics.filter((_, i) => i !== gi)"
          />
        </div>
      </div>

      <div class="section">
        <div class="section-head">
          <span class="section-title">字段</span>
          <el-button
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
            :model-value="fieldSelectValue(fi)"
            placeholder="类型"
            style="width: 150px"
            filterable
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
            v-if="fieldSelectValue(fi) === 'combination'"
            type="primary"
            link
            :icon="Setting"
            @click="openUnionConfig(fi)"
          >
            配置
          </el-button>
          <span
            v-if="fieldSelectValue(fi) === 'combination'"
            class="union-preview"
            :title="formatTypeExprPreview(field.type, namedLookup)"
          >
            {{ formatTypeExprPreview(field.type, namedLookup) }}
          </span>
          <el-button
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
          <el-table-column label="操作" width="72" align="center">
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

    <template v-else-if="draft?.kind === 'combination'">
      <div class="section">
        <div class="section-title" style="margin-bottom: 10px">组合类型（| 与 &amp;）</div>
        <TypeExprEditor
          v-model="draft.combination"
          :named-options="namedOptions"
        />
        <div class="preview">
          预览：
          {{ formatTypeExprPreview(draft.combination, namedLookup) }}
        </div>
      </div>
    </template>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="unionDialogVisible"
    title="配置联合类型"
    width="640px"
    append-to-body
    destroy-on-close
  >
    <TypeExprEditor
      v-model="unionDraft"
      :named-options="namedOptions"
      :generic-names="genericNames"
    />
    <div class="preview">
      预览：{{ formatTypeExprPreview(unionDraft, namedLookup) }}
    </div>
    <template #footer>
      <el-button @click="unionDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveUnionConfig">确定</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="genericDialogVisible"
    :title="`配置泛型 · ${genericDraft?.name || 'T'}`"
    width="640px"
    append-to-body
    destroy-on-close
  >
    <template v-if="genericDraft">
      <div class="generic-cfg-row">
        <span class="cfg-label">参数名</span>
        <el-input v-model="genericDraft.name" placeholder="如 T" style="width: 160px" />
      </div>
      <div class="generic-cfg-row">
        <span class="cfg-label">约束 extends</span>
        <el-switch
          :model-value="genericDraft.constraint != null"
          @update:model-value="setGenericConstraint"
        />
      </div>
      <TypeExprEditor
        v-if="genericDraft.constraint"
        :model-value="genericDraft.constraint"
        :named-options="namedOptions"
        :generic-names="genericNames"
        compact
        @update:model-value="genericDraft.constraint = $event"
      />
      <div class="generic-cfg-row">
        <span class="cfg-label">默认类型</span>
        <el-switch
          :model-value="genericDraft.default != null"
          @update:model-value="setGenericDefault"
        />
      </div>
      <TypeExprEditor
        v-if="genericDraft.default"
        :model-value="genericDraft.default"
        :named-options="namedOptions"
        :generic-names="genericNames"
        compact
        @update:model-value="genericDraft.default = $event"
      />
    </template>
    <template #footer>
      <el-button @click="genericDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="saveGenericConfig">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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

.union-preview {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #94a3b8;
}

.preview {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
  word-break: break-all;
}

.generic-cfg-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.cfg-label {
  width: 100px;
  flex-shrink: 0;
  font-size: 13px;
  color: #606266;
}
</style>
