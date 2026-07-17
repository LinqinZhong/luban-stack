<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, RefreshRight } from '@element-plus/icons-vue'
import type { ComponentConfig, ComponentPropDef } from '../../types/component'
import type { MethodParam, PageMethod } from '../../types/page-method'
import type { DataFieldValue } from '../../types/page-data'
import {
  buildDollarProps,
  normalizePropDefaultValue,
} from '../../utils/component-props'
import ColorPicker from './ColorPicker.vue'

export type EmitLogEntry = {
  id: number
  time: string
  event: string
  args: Record<string, unknown>
}

const props = defineProps<{
  mode: 'page' | 'component'
  canGoBack?: boolean
  hasEntryPage?: boolean
  config?: ComponentConfig | null
  methods?: PageMethod[]
  propValues?: Record<string, unknown>
  emitLogs?: EmitLogEntry[]
}>()

const emit = defineEmits<{
  back: []
  'go-entry': []
  refresh: []
  'update:prop': [name: string, value: unknown]
  'invoke-method': [payload: { name: string; args: unknown[] }]
  'clear-emit-logs': []
}>()

const propDefs = computed(() =>
  (props.config?.props ?? []).filter((item) => item.name.trim()),
)

const exposedMethods = computed(() => {
  const names = props.config?.exposedMethods ?? []
  const list = props.methods ?? []
  return names
    .map((name) => {
      const method = list.find((item) => item.name === name && !item.builtin)
      return {
        name,
        params: method?.params ?? [],
        hasBody: Boolean(method?.body?.trim()),
      }
    })
    .filter((item) => item.name.trim())
})

function propDisplayValue(def: ComponentPropDef): unknown {
  const name = def.name.trim()
  if (props.propValues && name in props.propValues) {
    return props.propValues[name]
  }
  return buildDollarProps(props.config ?? undefined)[name]
}

function onPropInput(def: ComponentPropDef, raw: unknown) {
  const name = def.name.trim()
  if (!name) return
  emit('update:prop', name, normalizePropDefaultValue(def.type, raw))
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null, null, 2)
  } catch {
    return String(value)
  }
}

function onJsonPropBlur(def: ComponentPropDef, text: string) {
  const name = def.name.trim()
  if (!name) return
  const raw = text.trim()
  if (!raw) {
    emit(
      'update:prop',
      name,
      normalizePropDefaultValue(def.type, def.defaultValue),
    )
    return
  }
  try {
    emit('update:prop', name, JSON.parse(raw) as DataFieldValue)
  } catch {
    // keep previous value on invalid json
  }
}

const invokeVisible = ref(false)
const invokeName = ref('')
const invokeParams = ref<MethodParam[]>([])
const invokeDraft = reactive<Record<string, string>>({})

function openInvoke(method: { name: string; params: MethodParam[] }) {
  if (!method.params.length) {
    emit('invoke-method', { name: method.name, args: [] })
    return
  }
  invokeName.value = method.name
  invokeParams.value = method.params
  for (const key of Object.keys(invokeDraft)) delete invokeDraft[key]
  for (const param of method.params) {
    const key = param.name.trim()
    if (!key) continue
    invokeDraft[key] =
      param.type === 'boolean'
        ? 'false'
        : param.type === 'number'
          ? '0'
          : param.type === 'object' || param.type === 'array'
            ? param.type === 'array'
              ? '[]'
              : '{}'
            : ''
  }
  invokeVisible.value = true
}

function parseParamValue(param: MethodParam, raw: string): unknown {
  const text = raw.trim()
  if (param.type === 'boolean') {
    const s = text.toLowerCase()
    return s === 'true' || s === '1'
  }
  if (param.type === 'number') {
    const n = Number(text)
    return Number.isFinite(n) ? n : 0
  }
  if (param.type === 'object' || param.type === 'array' || param.type === 'any') {
    if (!text) return param.type === 'array' ? [] : {}
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }
  return raw
}

function confirmInvoke() {
  const args = invokeParams.value.map((param) =>
    parseParamValue(param, invokeDraft[param.name.trim()] ?? ''),
  )
  emit('invoke-method', { name: invokeName.value, args })
  invokeVisible.value = false
}

watch(
  () => props.mode,
  () => {
    invokeVisible.value = false
  },
)
</script>

<template>
  <aside class="preview-debug">
    <div class="panel-header">调试</div>

    <div v-if="mode === 'page'" class="panel-body">
      <div class="section">
        <div class="section-title">页面导航</div>
        <div class="nav-actions">
          <el-button @click="emit('back')" :disabled="!canGoBack">返回</el-button>
          <el-button @click="emit('go-entry')" :disabled="!hasEntryPage">
            回到入口页
          </el-button>
          <el-button :icon="RefreshRight" @click="emit('refresh')">刷新</el-button>
        </div>
      </div>
    </div>

    <div v-else class="panel-body">
      <div class="section">
        <div class="section-title">Props</div>
        <el-empty
          v-if="!propDefs.length"
          description="暂无 Props"
          :image-size="48"
        />
        <div v-else class="prop-list">
          <div v-for="def in propDefs" :key="def.name" class="prop-row">
            <div class="prop-label">
              <span class="prop-name">{{ def.name }}</span>
              <span class="prop-type">{{ def.type }}</span>
            </div>
            <el-switch
              v-if="def.type === 'boolean'"
              :model-value="propDisplayValue(def) === true"
              @update:model-value="onPropInput(def, $event)"
            />
            <el-input-number
              v-else-if="def.type === 'number'"
              :model-value="Number(propDisplayValue(def) ?? 0)"
              controls-position="right"
              style="width: 100%"
              @update:model-value="onPropInput(def, $event ?? 0)"
            />
            <ColorPicker
              v-else-if="def.type === 'color'"
              :model-value="String(propDisplayValue(def) ?? '')"
              placeholder="#409eff / rgba(...)"
              @update:model-value="onPropInput(def, $event)"
            />
            <el-input
              v-else-if="def.type === 'array' || def.type === 'json'"
              type="textarea"
              :rows="3"
              :model-value="formatJson(propDisplayValue(def))"
              @blur="onJsonPropBlur(def, ($event.target as HTMLTextAreaElement).value)"
            />
            <el-input
              v-else
              :model-value="String(propDisplayValue(def) ?? '')"
              @update:model-value="onPropInput(def, $event)"
            />
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">暴露方法</div>
        <el-empty
          v-if="!exposedMethods.length"
          description="暂无暴露方法"
          :image-size="48"
        />
        <div v-else class="method-list">
          <div
            v-for="method in exposedMethods"
            :key="method.name"
            class="method-row"
          >
            <div class="method-meta">
              <span class="method-name">{{ method.name }}</span>
              <span class="method-params">
                {{
                  method.params.length
                    ? `(${method.params.map((p) => p.name).join(', ')})`
                    : '()'
                }}
              </span>
            </div>
            <el-button
              type="primary"
              link
              :disabled="!method.hasBody"
              @click="openInvoke(method)"
            >
              {{ method.params.length ? '执行…' : '执行' }}
            </el-button>
          </div>
        </div>
      </div>

      <div class="section emit-section">
        <div class="section-title row">
          <span>Emit 日志</span>
          <el-button
            type="danger"
            link
            :icon="Delete"
            :disabled="!(emitLogs && emitLogs.length)"
            @click="emit('clear-emit-logs')"
          >
            清空
          </el-button>
        </div>
        <el-empty
          v-if="!emitLogs?.length"
          description="尚无 emit 触发"
          :image-size="48"
        />
        <ul v-else class="emit-log">
          <li v-for="item in emitLogs" :key="item.id" class="emit-item">
            <div class="emit-head">
              <span class="emit-event">{{ item.event }}</span>
              <span class="emit-time">{{ item.time }}</span>
            </div>
            <pre class="emit-args">{{ formatJson(item.args) }}</pre>
          </li>
        </ul>
      </div>
    </div>

    <el-dialog
      v-model="invokeVisible"
      :title="`执行 ${invokeName}`"
      width="420px"
      destroy-on-close
      append-to-body
    >
      <el-form label-width="88px">
        <el-form-item
          v-for="param in invokeParams"
          :key="param.name"
          :label="param.name"
        >
          <el-select
            v-if="param.type === 'boolean'"
            v-model="invokeDraft[param.name]"
            style="width: 100%"
          >
            <el-option label="true" value="true" />
            <el-option label="false" value="false" />
          </el-select>
          <el-input
            v-else-if="param.type === 'object' || param.type === 'array' || param.type === 'any'"
            v-model="invokeDraft[param.name]"
            type="textarea"
            :rows="3"
            :placeholder="param.type === 'array' ? '[]' : '{}'"
          />
          <el-input
            v-else
            v-model="invokeDraft[param.name]"
            :placeholder="param.type"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="invokeVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmInvoke">执行</el-button>
      </template>
    </el-dialog>
  </aside>
</template>

<style scoped>
.preview-debug {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  border-left: 1px solid #ebeef5;
}

.panel-header {
  flex-shrink: 0;
  height: 48px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  scrollbar-width: none;
  scrollbar-gutter: auto;
}

.panel-body::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.section-title {
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}

.section-title.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.nav-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nav-actions .el-button {
  margin: 0;
  width: 100%;
}

.prop-list,
.method-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prop-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prop-label,
.method-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.prop-name,
.method-name {
  font-size: 13px;
  color: #303133;
  font-weight: 500;
}

.prop-type,
.method-params {
  font-size: 12px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.method-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafafa;
}

.emit-section {
  flex: 1;
  min-height: 120px;
  display: flex;
  flex-direction: column;
}

.emit-log {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow: auto;
  scrollbar-width: none;
  scrollbar-gutter: auto;
}

.emit-log::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.emit-item {
  padding: 8px 10px;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
}

.emit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.emit-event {
  font-size: 12px;
  font-weight: 600;
  color: #7dd3fc;
}

.emit-time {
  font-size: 11px;
  color: #94a3b8;
}

.emit-args {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
