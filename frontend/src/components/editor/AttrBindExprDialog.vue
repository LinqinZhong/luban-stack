<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import type { DataField, DataFieldType } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import type { DataTypeLibrary } from '../../types/data-types'
import { dataFieldToTsType } from '../../types/page-method'
import { buildDollarQueryAmbientDeclaration } from '../../types/page-query'
import {
  buildDollarColorAmbientDeclaration,
  isValidPaletteColorName,
} from '../../types/color-palette'
import { buildDollarPropsAmbientDeclaration } from '../../utils/component-props'
import { unwrapWholeBinding } from '../../utils/binding-expr'
import { colorPaletteState } from '../../composables/useColorPalette'
import ColorPicker from './ColorPicker.vue'
import DateTimeValueInput from './DateTimeValueInput.vue'
import IconValueSelect from './IconValueSelect.vue'

export type AttrBindExprKind = 'literal' | 'expression'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment =
  {
    getWorker(_: string, label: string) {
      if (label === 'json') return new jsonWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }

const tsLang = (monaco.languages as any).typescript

/** 仅展示用壳，保存/落盘只取 return 后的表达式 */
const SHELL_OPEN = 'function get(){'
const RETURN_PREFIX = '  return '
const SHELL_CLOSE = '}'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 当前写入的属性值（常量原文，或带 {} 的表达式） */
    attrValue: string
    initialKind?: AttrBindExprKind
    title?: string
    valueType?: DataFieldType
    typeRef?: string | null
    itemType?: DataFieldType
    itemTypeRef?: string | null
    dataFields?: DataField[]
    componentProps?: ComponentPropDef[] | null
    routeParams?: Record<string, unknown> | null
    pageQueryParams?: PageQueryParamDef[] | null
    repeatListName?: string | null
    iconOptions?: Array<{ id: string; label: string }>
    typeLibrary?: DataTypeLibrary | null
    projectPath?: string | null
  }>(),
  {
    valueType: 'string',
  },
)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [serialized: string]
}>()

const kind = ref<AttrBindExprKind>('literal')
const literalDraft = ref('')
const exprDraft = ref('')
const hostRef = ref<HTMLDivElement | null>(null)

let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let ambientLib: monaco.IDisposable | null = null
let shellDecorations: string[] = []
let syncing = false
let lastValidFull = ''
let ambientLibSeq = 0

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

function isValidIdent(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

type SuggestItem = {
  insert: string
  label: string
  group: string
}

/** 右侧变量建议（点击插入光标处） */
const suggestItems = computed((): SuggestItem[] => {
  const items: SuggestItem[] = []
  const seen = new Set<string>()

  function push(group: string, insert: string, label?: string) {
    const key = insert.trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    items.push({ group, insert: key, label: label || key })
  }

  for (const field of props.dataFields ?? []) {
    const name = field.name.trim()
    if (!name || !isValidIdent(name)) continue
    if (name === '$props' || name === '$query' || name === '$route') continue
    const remark = field.remark?.trim()
    push('数据池', name, remark ? `${name} · ${remark}` : name)
  }

  if (props.componentProps != null) {
    push('$props', '$props')
    for (const def of props.componentProps) {
      const name = def.name?.trim()
      if (!name || !isValidIdent(name)) continue
      push('$props', `$props.${name}`)
    }
  }

  const queryNames = new Set<string>()
  for (const q of props.pageQueryParams ?? []) {
    const name = q.name?.trim()
    if (name) queryNames.add(name)
  }
  for (const key of Object.keys(props.routeParams ?? {})) {
    if (key.trim()) queryNames.add(key.trim())
  }
  if (queryNames.size) {
    push('$query', '$query')
    for (const name of queryNames) {
      if (!isValidIdent(name)) continue
      push('$query', `$query.${name}`)
    }
  } else {
    push('$query', '$query')
    push('$query', '$query.id')
  }

  if (props.repeatListName?.trim()) {
    push('重复项', 'index', 'index · 索引')
    push('重复项', 'item')
    const repeat = props.repeatListName.trim()
    const field = (props.dataFields ?? []).find((f) => f.name.trim() === repeat)
    const sample =
      field?.type === 'array' && Array.isArray(field.value) ? field.value[0] : null
    if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
      for (const key of Object.keys(sample as Record<string, unknown>)) {
        if (!isValidIdent(key)) continue
        push('重复项', `item.${key}`)
      }
    }
  }

  // 依赖 colorPaletteState，画板变更时列表刷新
  const palette = colorPaletteState.value
  push('$color', '$color')
  for (const c of palette.colors ?? []) {
    const name = c.name.trim()
    if (!name || !isValidPaletteColorName(name)) continue
    const tip = c.description?.trim() || c.value || ''
    const insert = isValidIdent(name) ? `$color.${name}` : `$color[${JSON.stringify(name)}]`
    push('$color', insert, tip ? `${insert} · ${tip}` : insert)
  }

  return items
})

const suggestGroups = computed(() => {
  const map = new Map<string, SuggestItem[]>()
  for (const item of suggestItems.value) {
    const list = map.get(item.group) ?? []
    list.push(item)
    map.set(item.group, list)
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }))
})

function insertAtCursor(text: string) {
  if (!editor || !model || kind.value !== 'expression') return
  editor.focus()
  clampSelectionToEditable()
  const sel = editor.getSelection()
  if (!sel) return
  editor.executeEdits('attr-bind-suggest', [
    {
      range: sel,
      text,
      forceMoveMarkers: true,
    },
  ])
  const pos = editor.getPosition()
  if (pos) {
    editor.setPosition({
      lineNumber: pos.lineNumber,
      column: pos.column,
    })
  }
  editor.focus()
}

function buildAmbientDts(): string {
  const parts: string[] = []

  for (const field of props.dataFields ?? []) {
    const name = field.name.trim()
    if (!name || !isValidIdent(name)) continue
    if (name === '$props' || name === '$query' || name === '$route') continue
    parts.push(`declare const ${name}: ${dataFieldToTsType(field)};`)
  }

  if (props.componentProps != null) {
    parts.push(buildDollarPropsAmbientDeclaration(props.componentProps))
  }

  const queryDefs =
    props.pageQueryParams ??
    Object.keys(props.routeParams ?? {}).map(
      (name): PageQueryParamDef => ({
        name,
        type: 'string',
        remark: '',
      }),
    )
  parts.push(buildDollarQueryAmbientDeclaration(queryDefs))

  if (props.repeatListName?.trim()) {
    const repeat = props.repeatListName.trim()
    const field = (props.dataFields ?? []).find((f) => f.name.trim() === repeat)
    let itemTs = 'any'
    if (field?.type === 'array') {
      const arrTs = dataFieldToTsType(field)
      const m = arrTs.match(/^(.*)\[]$/)
      itemTs = m?.[1]?.trim() || 'any'
    }
    parts.push(`declare const index: number;`)
    parts.push(`declare const item: ${itemTs};`)
  }

  parts.push(buildDollarColorAmbientDeclaration(colorPaletteState.value))

  return parts.filter((line) => line.trim()).join('\n')
}

function indentExpr(expr: string): string {
  const lines = (expr ?? '').replace(/\r\n/g, '\n').split('\n')
  if (!lines.length) return ''
  return lines
    .map((line, i) => {
      if (i === 0) return line
      return line.length ? `    ${line}` : ''
    })
    .join('\n')
}

function composeFull(expr: string): string {
  const body = indentExpr(expr)
  return `${SHELL_OPEN}\n${RETURN_PREFIX}${body}\n${SHELL_CLOSE}`
}

function extractExpr(full: string): string {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < 3) return ''
  const mid = lines.slice(1, -1)
  if (!mid.length) return ''
  const first = mid[0] ?? ''
  if (!first.startsWith(RETURN_PREFIX)) {
    return mid.map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n')
  }
  const head = first.slice(RETURN_PREFIX.length)
  const rest = mid.slice(1).map((l) => (l.startsWith('    ') ? l.slice(4) : l))
  return [head, ...rest].join('\n')
}

function shellIntact(full: string): boolean {
  const lines = full.replace(/\r\n/g, '\n').split('\n')
  if (lines.length < 3) return false
  if (lines[0] !== SHELL_OPEN) return false
  if (lines[lines.length - 1] !== SHELL_CLOSE) return false
  return (lines[1] ?? '').startsWith(RETURN_PREFIX)
}

function applyShellDecorations() {
  if (!editor || !model) return
  const last = model.getLineCount()
  const ranges: monaco.editor.IModelDeltaDecoration[] = [
    {
      range: new monaco.Range(1, 1, 1, Number.MAX_SAFE_INTEGER),
      options: {
        isWholeLine: true,
        className: 'attr-shell-readonly',
        marginClassName: 'attr-shell-readonly-margin',
        stickiness:
          monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    },
    {
      range: new monaco.Range(2, 1, 2, RETURN_PREFIX.length + 1),
      options: {
        className: 'attr-shell-readonly',
        stickiness:
          monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    },
  ]
  if (last >= 3) {
    ranges.push({
      range: new monaco.Range(last, 1, last, Number.MAX_SAFE_INTEGER),
      options: {
        isWholeLine: true,
        className: 'attr-shell-readonly',
        marginClassName: 'attr-shell-readonly-margin',
        stickiness:
          monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    })
  }
  shellDecorations = editor.deltaDecorations(shellDecorations, ranges)
}

function syncAmbientLib() {
  ambientLib?.dispose()
  ambientLib = null
  const dts = buildAmbientDts()
  if (!dts.trim()) return
  ambientLibSeq += 1
  ambientLib = tsLang.typescriptDefaults.addExtraLib(
    dts,
    `inmemory://luban/attr-bind-ambient-${ambientLibSeq}.d.ts`,
  )
}

function restoreShell(expr?: string, preserveCursor = true) {
  if (!model || !editor) return
  syncAmbientLib()
  const nextExpr = expr ?? (extractExpr(lastValidFull) || exprDraft.value || '')
  const full = composeFull(nextExpr)
  if (full === model.getValue()) {
    lastValidFull = full
    applyShellDecorations()
    return
  }
  const pos = preserveCursor ? editor.getPosition() : null
  syncing = true
  model.setValue(full)
  lastValidFull = full
  syncing = false
  applyShellDecorations()
  if (pos) {
    const last = model.getLineCount()
    const line = Math.min(Math.max(pos.lineNumber, 2), Math.max(2, last - 1))
    const minCol = line === 2 ? RETURN_PREFIX.length + 1 : 1
    const maxCol = model.getLineMaxColumn(line)
    editor.setPosition({
      lineNumber: line,
      column: Math.min(Math.max(pos.column, minCol), maxCol),
    })
  }
}

function clampSelectionToEditable() {
  if (!editor || !model || syncing) return
  const last = model.getLineCount()
  const bodyFirst = 2
  const bodyLast = last - 1
  if (bodyLast < bodyFirst) return
  const sel = editor.getSelection()
  if (!sel) return

  const clampLine = (line: number) =>
    Math.min(Math.max(line, bodyFirst), bodyLast)
  let startLine = clampLine(sel.startLineNumber)
  let endLine = clampLine(sel.endLineNumber)
  let startCol = sel.startColumn
  let endCol = sel.endColumn

  if (startLine === 2 && startCol < RETURN_PREFIX.length + 1) {
    startCol = RETURN_PREFIX.length + 1
  }
  if (endLine === 2 && endCol < RETURN_PREFIX.length + 1) {
    endCol = RETURN_PREFIX.length + 1
  }
  if (sel.startLineNumber < bodyFirst) startCol = RETURN_PREFIX.length + 1
  if (sel.endLineNumber < bodyFirst) endCol = RETURN_PREFIX.length + 1
  if (sel.startLineNumber > bodyLast) {
    startCol = model.getLineMaxColumn(startLine)
  }
  if (sel.endLineNumber > bodyLast) {
    endCol = model.getLineMaxColumn(endLine)
  }

  if (
    startLine !== sel.startLineNumber ||
    endLine !== sel.endLineNumber ||
    startCol !== sel.startColumn ||
    endCol !== sel.endColumn
  ) {
    editor.setSelection(
      new monaco.Selection(startLine, startCol, endLine, endCol),
    )
  }
}

function disposeEditor() {
  ambientLib?.dispose()
  ambientLib = null
  editor?.dispose()
  model?.dispose()
  editor = null
  model = null
  shellDecorations = []
}

function createEditor() {
  if (!hostRef.value || editor) return

  tsLang.typescriptDefaults.setCompilerOptions({
    target: tsLang.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    moduleResolution: tsLang.ModuleResolutionKind.NodeJs,
    module: tsLang.ModuleKind.ESNext,
    noEmit: true,
    esModuleInterop: true,
    strict: false,
  })
  tsLang.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })

  syncAmbientLib()
  const initial = composeFull(exprDraft.value)
  lastValidFull = initial

  model = monaco.editor.createModel(
    initial,
    'typescript',
    monaco.Uri.parse(`inmemory://luban/attr-bind-${Date.now()}.ts`),
  )
  editor = monaco.editor.create(hostRef.value, {
    model,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'on',
    theme: 'vs',
    fixedOverflowWidgets: true,
    hover: { enabled: true, above: false },
    quickSuggestions: { other: true, comments: false, strings: true },
    suggestOnTriggerCharacters: true,
    snippetSuggestions: 'inline',
  })

  applyShellDecorations()

  model.onDidChangeContent(() => {
    if (syncing || !model) return
    const full = model.getValue()
    if (!shellIntact(full)) {
      restoreShell()
      return
    }
    lastValidFull = full
    applyShellDecorations()
    exprDraft.value = extractExpr(full)
  })

  editor.onDidChangeCursorSelection(() => {
    clampSelectionToEditable()
  })

  editor.onKeyDown((e) => {
    if (
      e.keyCode === monaco.KeyCode.Tab ||
      e.keyCode === monaco.KeyCode.Space
    ) {
      e.browserEvent.stopPropagation()
    }
  })
}

function resetFromAttr() {
  const raw = String(props.attrValue ?? '')
  const inner = unwrapWholeBinding(raw)

  if (props.initialKind === 'literal' && inner == null) {
    kind.value = 'literal'
    literalDraft.value = raw
    exprDraft.value = ''
    return
  }

  if (inner != null) {
    kind.value = 'expression'
    literalDraft.value = ''
    exprDraft.value = inner
    return
  }

  kind.value = props.initialKind === 'expression' ? 'expression' : 'literal'
  if (kind.value === 'literal') {
    literalDraft.value = raw
    exprDraft.value = ''
  } else {
    literalDraft.value = ''
    exprDraft.value = raw
  }
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) {
      disposeEditor()
      return
    }
    resetFromAttr()
    await nextTick()
    if (kind.value === 'expression') {
      createEditor()
    }
  },
)

watch(kind, async (next, prev) => {
  if (!visible.value) return
  if (next === 'expression') {
    await nextTick()
    if (!editor) createEditor()
    else restoreShell(exprDraft.value, false)
  } else if (prev === 'expression') {
    if (editor && model) {
      exprDraft.value = extractExpr(model.getValue())
    }
    disposeEditor()
  }
})

onBeforeUnmount(() => {
  disposeEditor()
})

const effectiveType = computed<DataFieldType>(() => props.valueType || 'string')

const literalNumberModel = computed({
  get() {
    const raw = literalDraft.value.trim()
    if (!raw) return undefined
    const n = Number(raw)
    return Number.isFinite(n) ? n : undefined
  },
  set(v: number | undefined) {
    literalDraft.value =
      v == null || Number.isNaN(Number(v)) ? '' : String(v)
  },
})

const literalBoolModel = computed({
  get() {
    const raw = literalDraft.value.trim().toLowerCase()
    return raw === 'true' || raw === '1'
  },
  set(v: boolean) {
    literalDraft.value = v ? 'true' : 'false'
  },
})

function handleSave() {
  if (kind.value === 'literal') {
    emit('save', literalDraft.value.trim())
  } else {
    const expr =
      editor && model ? extractExpr(model.getValue()).trim() : exprDraft.value.trim()
    emit('save', expr ? `{${expr}}` : '')
  }
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title || '编辑属性值'"
    width="860px"
    destroy-on-close
    append-to-body
    :close-on-click-modal="false"
    class="attr-bind-expr-dialog"
  >
    <div class="form-rows">
      <div class="form-row">
        <span class="row-label">类型</span>
        <div class="row-value">
          <el-radio-group v-model="kind" size="small">
            <el-radio-button value="literal">常量</el-radio-button>
            <el-radio-button value="expression">自定义</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <div class="form-row form-row--editor">
        <span class="row-label">值</span>
        <div class="row-value">
          <template v-if="kind === 'literal'">
            <ColorPicker
              v-if="effectiveType === 'color'"
              v-model="literalDraft"
              compact
              placeholder="选择颜色"
            />
            <el-input-number
              v-else-if="effectiveType === 'number'"
              v-model="literalNumberModel"
              class="literal-input"
              size="small"
              controls-position="right"
              placeholder="数字"
            />
            <el-switch
              v-else-if="effectiveType === 'boolean'"
              v-model="literalBoolModel"
              size="small"
            />
            <DateTimeValueInput
              v-else-if="
                effectiveType === 'time' ||
                effectiveType === 'date' ||
                effectiveType === 'datetime'
              "
              v-model="literalDraft"
              :kind="effectiveType"
              size="small"
            />
            <IconValueSelect
              v-else-if="effectiveType === 'icon'"
              v-model="literalDraft"
              size="small"
              :options="iconOptions ?? []"
              allow-create
              clearable
              placeholder="选择图标"
            />
            <el-input
              v-else-if="
                effectiveType === 'json' ||
                effectiveType === 'map' ||
                effectiveType === 'array'
              "
              v-model="literalDraft"
              type="textarea"
              size="small"
              :rows="8"
              class="literal-input"
              :placeholder="
                effectiveType === 'array' ? 'JSON 数组，如 []' : 'JSON 对象，如 {}'
              "
              spellcheck="false"
            />
            <el-input
              v-else
              v-model="literalDraft"
              class="literal-input"
              size="small"
              placeholder="常量值"
              spellcheck="false"
            />
          </template>
          <div v-show="kind === 'expression'" class="expr-split">
            <div ref="hostRef" class="expr-editor nokey" />
            <aside class="suggest-pane">
              <div class="suggest-title">变量</div>
              <div v-if="!suggestGroups.length" class="suggest-empty">
                暂无可用变量
              </div>
              <div v-else class="suggest-scroll">
                <div
                  v-for="group in suggestGroups"
                  :key="group.group"
                  class="suggest-group"
                >
                  <div class="suggest-group-name">{{ group.group }}</div>
                  <button
                    v-for="item in group.items"
                    :key="item.insert"
                    type="button"
                    class="suggest-item"
                    :title="item.insert"
                    @click="insertAtCursor(item.insert)"
                  >
                    {{ item.label }}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.form-rows {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.form-row--editor {
  align-items: flex-start;
}

.row-label {
  flex: 0 0 40px;
  padding-top: 6px;
  font-size: 13px;
  line-height: 24px;
  color: var(--el-text-color-regular);
}

.row-value {
  flex: 1 1 0;
  min-width: 0;
}

.literal-input {
  width: 100%;
}

.expr-split {
  display: flex;
  align-items: stretch;
  gap: 10px;
  width: 100%;
  min-width: 0;
}

.expr-editor {
  flex: 1 1 0;
  min-width: 0;
  min-height: 280px;
  height: 280px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  overflow: hidden;
}

.suggest-pane {
  flex: 0 0 200px;
  width: 200px;
  min-height: 280px;
  height: 280px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-blank);
  overflow: hidden;
}

.suggest-title {
  flex-shrink: 0;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}

.suggest-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  padding: 6px;
}

.suggest-empty {
  padding: 16px 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.suggest-group + .suggest-group {
  margin-top: 8px;
}

.suggest-group-name {
  padding: 4px 6px 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}

.suggest-item {
  display: block;
  width: 100%;
  margin: 0;
  padding: 5px 8px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggest-item:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.expr-editor :deep(.attr-shell-readonly) {
  background: #f5f7fa;
  opacity: 0.92;
}

.expr-editor :deep(.attr-shell-readonly-margin) {
  background: #eef1f6;
}

.expr-editor :deep(.overflowingContentWidgets),
.expr-editor :deep(.overflow-widgets-container) {
  z-index: 20;
}
</style>
