<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Back, HomeFilled, RefreshRight } from '@element-plus/icons-vue'
import type { ComponentConfig } from '../../types/component'
import type { MethodParam, PageMethod } from '../../types/page-method'

const props = defineProps<{
  mode: 'page' | 'component'
  canGoBack?: boolean
  hasEntryPage?: boolean
  config?: ComponentConfig | null
  methods?: PageMethod[]
}>()

const emit = defineEmits<{
  back: []
  'go-entry': []
  refresh: []
  'invoke-method': [payload: { name: string; args: unknown[] }]
}>()

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

const invokeVisible = ref(false)
const invokeName = ref('')
const invokeParams = ref<MethodParam[]>([])
const invokeDraft = reactive<Record<string, string>>({})

function openInvoke(method: { name: string; params: MethodParam[]; hasBody: boolean }) {
  if (!method.hasBody) return
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
</script>

<template>
  <div class="preview-canvas-toolbar" @mousedown.stop @click.stop>
    <!-- 页面：圆形导航按钮 -->
    <div v-if="mode === 'page'" class="page-actions">
      <el-tooltip content="返回" placement="left">
        <button
          type="button"
          class="circle-btn"
          :disabled="!canGoBack"
          @click="emit('back')"
        >
          <el-icon :size="18"><Back /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="回到入口页" placement="left">
        <button
          type="button"
          class="circle-btn"
          :disabled="!hasEntryPage"
          @click="emit('go-entry')"
        >
          <el-icon :size="18"><HomeFilled /></el-icon>
        </button>
      </el-tooltip>
      <el-tooltip content="刷新" placement="left">
        <button type="button" class="circle-btn is-primary" @click="emit('refresh')">
          <el-icon :size="18"><RefreshRight /></el-icon>
        </button>
      </el-tooltip>
    </div>

    <!-- 组件：圆角矩形暴露方法，最多 5 个可视，悬停出滚动条 -->
    <div v-else-if="exposedMethods.length" class="method-actions">
      <el-tooltip
        v-for="method in exposedMethods"
        :key="method.name"
        :content="
          method.hasBody
            ? method.params.length
              ? `${method.name}（需填入参）`
              : method.name
            : '方法体为空'
        "
        placement="left"
      >
        <button
          type="button"
          class="method-btn"
          :disabled="!method.hasBody"
          @click="openInvoke(method)"
        >
          {{ method.name }}
        </button>
      </el-tooltip>
    </div>

    <el-dialog
      v-model="invokeVisible"
      :title="`执行 ${invokeName}`"
      width="420px"
      destroy-on-close
      append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
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
            v-else
            v-model="invokeDraft[param.name]"
            :placeholder="param.type"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="confirmInvoke">执行</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.preview-canvas-toolbar {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}

.preview-canvas-toolbar > * {
  pointer-events: auto;
}

.page-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.circle-btn {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #dcdfe6;
  border-radius: 50%;
  background: #fff;
  color: #606266;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.circle-btn:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.18);
}

.circle-btn.is-primary {
  border-color: #b3d8ff;
  color: #409eff;
  background: #ecf5ff;
}

.circle-btn.is-primary:hover:not(:disabled) {
  border-color: #409eff;
  background: #d9ecff;
}

.circle-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}

.method-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 最多 5 个按钮可视：5×36 + 4×8 */
  max-height: calc(5 * 36px + 4 * 8px);
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 2px;
  scrollbar-width: none;
}

.method-actions::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.method-actions:hover {
  scrollbar-width: thin;
  scrollbar-color: #c0c4cc transparent;
}

.method-actions:hover::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.method-actions:hover::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.method-actions:hover::-webkit-scrollbar-track {
  background: transparent;
}

.method-btn {
  min-width: 72px;
  height: 36px;
  padding: 0 16px;
  border: 1px solid #dcdfe6;
  border-radius: 10px;
  background: #fff;
  color: #303133;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.method-btn:hover:not(:disabled) {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.18);
}

.method-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
