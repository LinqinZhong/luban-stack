<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export type AttrBindExprKind = 'literal' | 'expression'

const props = defineProps<{
  modelValue: boolean
  /** 当前写入的属性值（常量原文，或带 {} 的表达式） */
  attrValue: string
  /** 打开时默认类型 */
  initialKind?: AttrBindExprKind
  title?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [serialized: string]
}>()

const kind = ref<AttrBindExprKind>('literal')
const draft = ref('')

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

function unwrapBinding(raw: string): string | null {
  const t = raw.trim()
  if (!t.startsWith('{') || !t.endsWith('}')) return null
  let depth = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        if (i !== t.length - 1) return null
        return t.slice(1, -1).trim()
      }
    }
  }
  return null
}

watch(
  () => [props.modelValue, props.attrValue, props.initialKind] as const,
  ([open, attrValue, initialKind]) => {
    if (!open) return
    const raw = String(attrValue ?? '')
    const inner = unwrapBinding(raw)

    if (initialKind === 'literal') {
      kind.value = 'literal'
      // 常量编辑：若当前是绑定则清空，否则保留常量原文
      draft.value = inner != null ? '' : raw
      return
    }
    if (initialKind === 'expression') {
      kind.value = 'expression'
      draft.value = inner ?? (raw.startsWith('{') ? '' : raw)
      return
    }

    // 未指定：按当前值推断
    if (inner != null) {
      kind.value = 'expression'
      draft.value = inner
    } else {
      kind.value = 'literal'
      draft.value = raw
    }
  },
)

function handleSave() {
  const text = draft.value.trim()
  if (kind.value === 'literal') {
    emit('save', text)
  } else {
    emit('save', text ? `{${text}}` : '')
  }
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title || '编辑属性值'"
    width="520px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
  >
    <div class="kind-row">
      <span class="kind-label">类型</span>
      <el-radio-group v-model="kind" size="small">
        <el-radio-button value="literal">常量</el-radio-button>
        <el-radio-button value="expression">变量</el-radio-button>
      </el-radio-group>
    </div>
    <p class="hint">
      <template v-if="kind === 'literal'">
        直接输入常量（如 <code>16</code>），无需花括号。
      </template>
      <template v-else>
        直接输入表达式（如 <code>padding</code>、<code>$props.size</code>），保存时自动加上
        <code>{ }</code>。
      </template>
    </p>
    <el-input
      v-model="draft"
      type="textarea"
      :rows="6"
      class="code-input"
      :placeholder="kind === 'literal' ? '例如：16' : '例如：padding 或 $props.gap'"
      spellcheck="false"
    />
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.kind-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.kind-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  line-height: 1.5;
}

.hint code {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--el-fill-color);
  font-size: 12px;
}

.code-input :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
}
</style>
