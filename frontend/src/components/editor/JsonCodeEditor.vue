<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import type { JsonSchema } from '../../utils/json-type-schema'

;(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'json') return new jsonWorker()
    return new editorWorker()
  },
}

const jsonLang = (monaco.languages as any).json

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    /** 编辑器最小高度 */
    minHeight?: number
    /** JSON Schema，用于类型校验红线 */
    schema?: JsonSchema | null
  }>(),
  {
    readonly: false,
    minHeight: 320,
    schema: null,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const hostRef = ref<HTMLDivElement | null>(null)
let editor: monaco.editor.IStandaloneCodeEditor | null = null
let model: monaco.editor.ITextModel | null = null
let syncing = false
const schemaUri = `inmemory://luban/schema-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
const modelUri = monaco.Uri.parse(
  `inmemory://luban/json-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
)

function applySchema(schema: JsonSchema | null | undefined) {
  const existing =
    jsonLang.jsonDefaults.diagnosticsOptions.schemas?.filter(
      (item: { uri: string }) => item.uri !== schemaUri,
    ) ?? []

  if (!schema) {
    jsonLang.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemas: existing,
    })
    return
  }

  jsonLang.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [
      ...existing,
      {
        uri: schemaUri,
        fileMatch: [modelUri.toString()],
        schema,
      },
    ],
  })
}

onMounted(() => {
  if (!hostRef.value) return

  model = monaco.editor.createModel(props.modelValue || '', 'json', modelUri)

  applySchema(props.schema)

  editor = monaco.editor.create(hostRef.value, {
    model,
    language: 'json',
    readOnly: props.readonly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    renderLineHighlight: 'line',
    padding: { top: 8, bottom: 8 },
  })

  editor.onDidChangeModelContent(() => {
    if (syncing || !model) return
    emit('update:modelValue', model.getValue())
  })
})

watch(
  () => props.modelValue,
  (value) => {
    if (!model || syncing) return
    if (model.getValue() === value) return
    syncing = true
    model.setValue(value ?? '')
    syncing = false
  },
)

watch(
  () => props.schema,
  (schema) => {
    applySchema(schema)
  },
  { deep: true },
)

watch(
  () => props.readonly,
  (readonly) => {
    editor?.updateOptions({ readOnly: Boolean(readonly) })
  },
)

onBeforeUnmount(() => {
  applySchema(null)
  editor?.dispose()
  model?.dispose()
  editor = null
  model = null
})

function focus() {
  editor?.focus()
}

/** 是否存在 Monaco 标记的错误（语法或 schema） */
function hasErrorMarkers(): boolean {
  if (!model) return false
  return monaco.editor
    .getModelMarkers({ resource: model.uri })
    .some((m) => m.severity === monaco.MarkerSeverity.Error)
}

function getErrorMessages(): string[] {
  if (!model) return []
  return monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter((m) => m.severity === monaco.MarkerSeverity.Error)
    .map((m) => `第 ${m.startLineNumber} 行：${m.message}`)
}

defineExpose({ focus, hasErrorMarkers, getErrorMessages })
</script>

<template>
  <div
    ref="hostRef"
    class="json-code-editor"
    :style="{ minHeight: `${minHeight}px` }"
  />
</template>

<style scoped>
.json-code-editor {
  width: 100%;
  height: 100%;
  min-height: 320px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
</style>
