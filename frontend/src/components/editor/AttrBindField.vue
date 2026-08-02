<script setup lang="ts">
import { computed, ref } from 'vue'
import { EditPen } from '@element-plus/icons-vue'
import type { DataField } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import { defaultValue } from '../../types/page-data'
import { isSimpleBindingPath, unwrapWholeBinding } from '../../utils/binding-expr'
import AttrBindExprDialog, {
  type AttrBindExprKind,
} from './AttrBindExprDialog.vue'

type CascaderOption = {
  value: string
  label: string
  disabled?: boolean
  children?: CascaderOption[]
}

const LITERAL_KEY = '__literal__'
const CUSTOM_KEY = '__custom__'
const POOL_KEY = '__pool__'
const QUERY_KEY = '__query__'
const PROPS_KEY = '__props__'
const REPEAT_KEY = '__repeat__'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    dataFields?: DataField[]
    componentProps?: ComponentPropDef[] | null
    routeParams?: Record<string, unknown> | null
    pageQueryParams?: PageQueryParamDef[] | null
    repeatListName?: string | null
  }>(),
  {
    placeholder: '选择绑定或常量',
    dataFields: () => [],
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: [value: string]
}>()

const dialogVisible = ref(false)
const dialogKind = ref<AttrBindExprKind>('literal')

function commit(next: string) {
  emit('update:modelValue', next)
  emit('change', next)
}

function buildFromUnknown(
  path: string,
  label: string,
  value: unknown,
): CascaderOption {
  if (Array.isArray(value)) {
    const children = value.slice(0, 8).map((item, index) =>
      buildFromUnknown(`${path}[${index}]`, `[${index}]`, item),
    )
    return {
      value: path,
      label,
      children: children.length ? children : undefined,
    }
  }
  if (value && typeof value === 'object') {
    const children = Object.entries(value as Record<string, unknown>).map(
      ([key, child]) => buildFromUnknown(`${path}.${key}`, key, child),
    )
    return {
      value: path,
      label,
      children: children.length ? children : undefined,
    }
  }
  return { value: path, label }
}

const querySource = computed<Record<string, unknown>>(() => {
  if (props.routeParams && Object.keys(props.routeParams).length) {
    return props.routeParams
  }
  const out: Record<string, unknown> = {}
  for (const item of props.pageQueryParams ?? []) {
    const name = item.name?.trim()
    if (name) out[name] = ''
  }
  return out
})

const cascaderOptions = computed<CascaderOption[]>(() => {
  const roots: CascaderOption[] = []

  const poolChildren = (props.dataFields ?? [])
    .filter((f) => {
      const name = f.name.trim()
      return name && name !== '$props' && name !== '$query' && name !== '$route'
    })
    .map((f) => buildFromUnknown(f.name.trim(), f.name.trim(), f.value))
  roots.push({
    value: POOL_KEY,
    label: '数据池',
    children: poolChildren.length
      ? poolChildren
      : [{ value: `${POOL_KEY}__empty`, label: '（暂无变量）', disabled: true }],
  })

  const queryEntries = Object.entries(querySource.value)
  roots.push({
    value: QUERY_KEY,
    label: '$query',
    children: queryEntries.length
      ? queryEntries.map(([key, value]) =>
          buildFromUnknown(`$query.${key}`, key, value),
        )
      : [{ value: '$query.id', label: 'id' }],
  })

  if (props.componentProps != null) {
    const defs = (props.componentProps ?? []).filter((d) => d?.name?.trim())
    roots.push({
      value: PROPS_KEY,
      label: '$props',
      children: defs.length
        ? defs.map((def) => {
            const name = def.name.trim()
            const sample =
              def.defaultValue === '' || def.defaultValue === undefined
                ? defaultValue(def.type)
                : def.defaultValue
            return buildFromUnknown(`$props.${name}`, name, sample)
          })
        : [
            {
              value: `${PROPS_KEY}__empty`,
              label: '（暂无参数）',
              disabled: true,
            },
          ],
    })
  }

  const repeat = props.repeatListName?.trim()
  if (repeat) {
    const field = (props.dataFields ?? []).find((f) => f.name.trim() === repeat)
    let sample: unknown = undefined
    if (field?.type === 'array' && Array.isArray(field.value) && field.value[0]) {
      sample = field.value[0]
    }
    const itemChildren: CascaderOption[] = [
      { value: 'index', label: 'index（索引）' },
      { value: 'item', label: 'item' },
    ]
    if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
      for (const [key, child] of Object.entries(
        sample as Record<string, unknown>,
      )) {
        itemChildren.push(buildFromUnknown(`item.${key}`, key, child))
      }
    }
    roots.push({
      value: REPEAT_KEY,
      label: '重复项',
      children: itemChildren,
    })
  }

  roots.push({ value: LITERAL_KEY, label: '常量' })
  roots.push({ value: CUSTOM_KEY, label: '自定义' })
  return roots
})

function findCascaderPath(
  options: CascaderOption[],
  leafValue: string,
  trail: string[] = [],
): string[] | null {
  for (const opt of options) {
    const next = [...trail, opt.value]
    if (opt.value === leafValue && !opt.disabled) return next
    if (opt.children?.length) {
      const hit = findCascaderPath(opt.children, leafValue, next)
      if (hit) return hit
    }
  }
  return null
}

const mode = computed<'literal' | 'binding' | 'custom' | 'empty'>(() => {
  const raw = String(props.modelValue ?? '').trim()
  if (!raw) return 'empty'
  const inner = unwrapWholeBinding(raw)
  if (inner == null) return 'literal'
  if (isSimpleBindingPath(inner) && findCascaderPath(cascaderOptions.value, inner)) {
    return 'binding'
  }
  return 'custom'
})

const cascaderValue = computed<string[]>({
  get() {
    const raw = String(props.modelValue ?? '').trim()
    if (!raw) return []
    if (mode.value === 'literal') {
      return [LITERAL_KEY]
    }
    if (mode.value === 'custom') {
      return [CUSTOM_KEY]
    }
    const inner = unwrapWholeBinding(raw)
    if (!inner) return []
    return findCascaderPath(cascaderOptions.value, inner) ?? [CUSTOM_KEY]
  },
  set(_v) {
    // handled in onCascaderChange
  },
})

const showEditButton = computed(
  () => mode.value === 'literal' || mode.value === 'custom',
)

function openDialog(kind: AttrBindExprKind) {
  dialogKind.value = kind
  dialogVisible.value = true
}

function onCascaderChange(val: string[] | null | undefined) {
  const path = Array.isArray(val) ? val.filter(Boolean) : []
  if (!path.length) {
    commit('')
    return
  }
  const leaf = path[path.length - 1]!
  if (leaf === LITERAL_KEY || path[0] === LITERAL_KEY) {
    openDialog('literal')
    return
  }
  if (leaf === CUSTOM_KEY || path[0] === CUSTOM_KEY) {
    openDialog('expression')
    return
  }
  // 分组根不可单独选
  if (
    leaf === POOL_KEY ||
    leaf === QUERY_KEY ||
    leaf === PROPS_KEY ||
    leaf === REPEAT_KEY ||
    leaf.endsWith('__empty')
  ) {
    return
  }
  commit(`{${leaf}}`)
}

function onEditClick() {
  openDialog(mode.value === 'custom' ? 'expression' : 'literal')
}

function onDialogSave(serialized: string) {
  commit(serialized)
}
</script>

<template>
  <div class="attr-bind-field">
    <el-cascader
      :model-value="cascaderValue"
      class="attr-cascader"
      :options="cascaderOptions"
      clearable
      filterable
      :placeholder="placeholder"
      :props="{
        expandTrigger: 'hover',
        emitPath: true,
        checkStrictly: false,
      }"
      @change="onCascaderChange"
    />
    <el-button
      v-if="showEditButton"
      class="edit-btn"
      :icon="EditPen"
      title="编辑"
      @click="onEditClick"
    />

    <AttrBindExprDialog
      v-model="dialogVisible"
      :attr-value="modelValue"
      :initial-kind="dialogKind"
      @save="onDialogSave"
    />
  </div>
</template>

<style scoped>
.attr-bind-field {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
}

.attr-cascader {
  flex: 1;
  min-width: 0;
}

.attr-cascader :deep(.el-input) {
  width: 100%;
}

.edit-btn {
  flex-shrink: 0;
  padding: 8px;
}
</style>
