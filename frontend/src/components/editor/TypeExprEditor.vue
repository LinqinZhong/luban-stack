<script setup lang="ts">
import { Delete, Plus } from '@element-plus/icons-vue'
import type { TypeAtom, TypeAtomKind, TypeExpr } from '../../types/data-types'
import { createEmptyTypeAtom, createEmptyTypeUnion } from '../../types/data-types'

const props = defineProps<{
  modelValue: TypeExpr
  /** 可引用的具名类型 */
  namedOptions?: Array<{ id: string; label: string }>
  /** 当前接口可用的泛型参数名 */
  genericNames?: string[]
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: TypeExpr]
}>()

const ATOM_KIND_OPTIONS: Array<{ label: string; value: TypeAtomKind }> = [
  { label: '数字', value: 'number' },
  { label: '字符串', value: 'string' },
  { label: '布尔值', value: 'boolean' },
  { label: '具名类型', value: 'named' },
  { label: '泛型参数', value: 'generic' },
  { label: 'any', value: 'any' },
  { label: 'unknown', value: 'unknown' },
]

function patch(next: TypeExpr) {
  emit('update:modelValue', next)
}

function updateAtom(
  interIndex: number,
  altIndex: number,
  patchAtom: Partial<TypeAtom>,
) {
  const intersections = props.modelValue.intersections.map((union, i) => {
    if (i !== interIndex) return union
    return {
      alternatives: union.alternatives.map((atom, j) => {
        if (j !== altIndex) return atom
        const next = { ...atom, ...patchAtom }
        if (next.kind !== 'named' && next.kind !== 'generic') {
          delete next.ref
        }
        return next
      }),
    }
  })
  patch({ intersections })
}

function addIntersection() {
  patch({
    intersections: [...props.modelValue.intersections, createEmptyTypeUnion()],
  })
}

function removeIntersection(index: number) {
  if (props.modelValue.intersections.length <= 1) return
  patch({
    intersections: props.modelValue.intersections.filter((_, i) => i !== index),
  })
}

function addAlternative(interIndex: number) {
  const intersections = props.modelValue.intersections.map((union, i) => {
    if (i !== interIndex) return union
    return { alternatives: [...union.alternatives, createEmptyTypeAtom()] }
  })
  patch({ intersections })
}

function removeAlternative(interIndex: number, altIndex: number) {
  const intersections = props.modelValue.intersections.map((union, i) => {
    if (i !== interIndex) return union
    if (union.alternatives.length <= 1) return union
    return {
      alternatives: union.alternatives.filter((_, j) => j !== altIndex),
    }
  })
  patch({ intersections })
}

function tabLabel(atom: TypeAtom, index: number): string {
  if (atom.kind === 'named') {
    const hit = props.namedOptions?.find((o) => o.id === atom.ref)
    return hit?.label || atom.ref || `分支 ${index + 1}`
  }
  if (atom.kind === 'generic') return atom.ref || `T${index + 1}`
  return atom.kind
}
</script>

<template>
  <div class="type-expr" :class="{ compact }">
    <div class="expr-hint">
      列表各项用 <code>&amp;</code> 相交；每一项内用 Tabs 表示 <code>|</code> 联合
    </div>

    <div
      v-for="(union, interIndex) in modelValue.intersections"
      :key="interIndex"
      class="inter-block"
    >
      <div class="inter-head">
        <span class="inter-label">
          {{ interIndex === 0 ? '类型' : '&amp;' }}
          <span class="muted">第 {{ interIndex + 1 }} 项</span>
        </span>
        <el-button
          type="danger"
          link
          :icon="Delete"
          :disabled="modelValue.intersections.length <= 1"
          @click="removeIntersection(interIndex)"
        >
          删除
        </el-button>
      </div>

      <div class="union-toolbar">
        <span class="union-hint">| 联合分支</span>
        <el-button type="primary" link :icon="Plus" @click="addAlternative(interIndex)">
          添加分支
        </el-button>
      </div>

      <el-tabs
        type="card"
        class="union-tabs"
        :closable="union.alternatives.length > 1"
        @tab-remove="(name) => removeAlternative(interIndex, Number(name))"
      >
        <el-tab-pane
          v-for="(atom, altIndex) in union.alternatives"
          :key="`${interIndex}-${altIndex}`"
          :label="tabLabel(atom, altIndex)"
          :name="String(altIndex)"
        >
          <div class="atom-row">
            <el-select
              :model-value="atom.kind"
              style="width: 140px"
              @update:model-value="updateAtom(interIndex, altIndex, { kind: $event })"
            >
              <el-option
                v-for="opt in ATOM_KIND_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>

            <el-select
              v-if="atom.kind === 'named'"
              :model-value="atom.ref || ''"
              filterable
              clearable
              placeholder="选择类型"
              style="flex: 1"
              @update:model-value="updateAtom(interIndex, altIndex, { ref: $event || '' })"
            >
              <el-option
                v-for="opt in namedOptions ?? []"
                :key="opt.id"
                :label="opt.label"
                :value="opt.id"
              />
            </el-select>

            <el-select
              v-else-if="atom.kind === 'generic'"
              :model-value="atom.ref || ''"
              filterable
              allow-create
              default-first-option
              placeholder="泛型参数名"
              style="flex: 1"
              @update:model-value="updateAtom(interIndex, altIndex, { ref: $event || '' })"
            >
              <el-option
                v-for="name in genericNames ?? []"
                :key="name"
                :label="name"
                :value="name"
              />
            </el-select>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-button :icon="Plus" size="small" @click="addIntersection">
      添加 &amp; 项
    </el-button>
  </div>
</template>

<style scoped>
.type-expr {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.expr-hint {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
}

.expr-hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: #f1f5f9;
  color: #475569;
  font-size: 12px;
}

.inter-block {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fafafa;
}

.inter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.inter-label {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.muted {
  margin-left: 6px;
  font-weight: 400;
  color: #94a3b8;
}

.union-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.union-hint {
  font-size: 12px;
  color: #64748b;
}

.atom-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0 8px;
}

.union-tabs :deep(.el-tabs__header) {
  margin-bottom: 8px;
}

.compact .inter-block {
  padding: 8px;
}
</style>
