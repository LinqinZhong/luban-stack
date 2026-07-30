<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import {
  createEmptyPageQueryParam,
  type PageQueryParamDef,
} from '../../types/page-query'

const props = defineProps<{
  queryParams: PageQueryParamDef[]
  debugQuery: Record<string, unknown>
}>()

const emit = defineEmits<{
  'update:queryParams': [value: PageQueryParamDef[]]
  'update:debugQuery': [value: Record<string, unknown>]
}>()

const dialogVisible = ref(false)
const editingIndex = ref(-1)
const draft = ref<PageQueryParamDef>(createEmptyPageQueryParam())

const existingNames = computed(() =>
  props.queryParams
    .map((p, i) => (i === editingIndex.value ? '' : p.name.trim()))
    .filter(Boolean),
)

watch(dialogVisible, (open) => {
  if (!open) {
    editingIndex.value = -1
    draft.value = createEmptyPageQueryParam()
  }
})

function openAdd() {
  editingIndex.value = -1
  draft.value = createEmptyPageQueryParam()
  dialogVisible.value = true
}

function openEdit(index: number) {
  const row = props.queryParams[index]
  if (!row) return
  editingIndex.value = index
  draft.value = { ...row }
  dialogVisible.value = true
}

function removeAt(index: number) {
  const next = props.queryParams.filter((_, i) => i !== index)
  emit('update:queryParams', next)
  const removed = props.queryParams[index]?.name?.trim()
  if (removed && Object.prototype.hasOwnProperty.call(props.debugQuery, removed)) {
    const dq = { ...props.debugQuery }
    delete dq[removed]
    emit('update:debugQuery', dq)
  }
}

function saveDraft() {
  const name = draft.value.name.trim()
  if (!name) return
  if (existingNames.value.includes(name)) return
  const row: PageQueryParamDef = {
    name,
    type: draft.value.type,
    remark: draft.value.remark?.trim() || '',
    required: Boolean(draft.value.required),
    defaultValue:
      draft.value.type === 'number'
        ? Number(draft.value.defaultValue ?? 0) || 0
        : draft.value.type === 'boolean'
          ? Boolean(draft.value.defaultValue)
          : String(draft.value.defaultValue ?? ''),
  }
  const next = [...props.queryParams]
  if (editingIndex.value >= 0) {
    const prevName = next[editingIndex.value]?.name
    next[editingIndex.value] = row
    if (prevName && prevName !== name) {
      const dq = { ...props.debugQuery }
      if (Object.prototype.hasOwnProperty.call(dq, prevName)) {
        dq[name] = dq[prevName]
        delete dq[prevName]
        emit('update:debugQuery', dq)
      }
    }
  } else {
    next.push(row)
  }
  emit('update:queryParams', next)
  dialogVisible.value = false
}

function debugValue(name: string): string {
  const v = props.debugQuery[name]
  if (v == null) return ''
  return String(v)
}

function setDebugValue(name: string, raw: string, type: PageQueryParamDef['type']) {
  const dq = { ...props.debugQuery }
  if (type === 'number') {
    const n = Number(raw)
    dq[name] = Number.isFinite(n) ? n : 0
  } else if (type === 'boolean') {
    dq[name] = raw === 'true' || raw === '1'
  } else {
    dq[name] = raw
  }
  emit('update:debugQuery', dq)
}

function typeLabel(t: PageQueryParamDef['type']) {
  if (t === 'number') return '数字'
  if (t === 'boolean') return '布尔'
  return '字符串'
}
</script>

<template>
  <div class="query-params-panel">
    <div class="section-title">
      <span>Query 入参 · $query</span>
      <el-button type="primary" link :icon="Plus" @click="openAdd">添加</el-button>
    </div>
    <p class="hint">
      声明页面 URL / 跳转携带的 query 参数。绑定控制器、条件与模板中可用
      <code>$query.字段名</code>（与 <code>$route</code> 同值）。
    </p>

    <el-empty
      v-if="!queryParams.length"
      description="暂无 Query 入参，点击添加"
      :image-size="48"
    />

    <div v-else class="param-list">
      <div v-for="(row, index) in queryParams" :key="row.name" class="param-card">
        <div class="param-main">
          <div class="param-name">
            {{ row.name }}
            <span v-if="row.required" class="req">*</span>
            <span class="param-type">{{ typeLabel(row.type) }}</span>
          </div>
          <div v-if="row.remark" class="param-remark">{{ row.remark }}</div>
          <el-input
            size="small"
            :model-value="debugValue(row.name)"
            :placeholder="`调试值，默认 ${row.defaultValue ?? ''}`"
            @update:model-value="setDebugValue(row.name, String($event ?? ''), row.type)"
          />
        </div>
        <div class="param-actions">
          <el-button type="primary" link @click="openEdit(index)">编辑</el-button>
          <el-button type="danger" link :icon="Delete" @click="removeAt(index)" />
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingIndex >= 0 ? '编辑 Query 入参' : '添加 Query 入参'"
      width="420px"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form label-width="72px" @submit.prevent>
        <el-form-item label="名称" required>
          <el-input
            v-model="draft.name"
            placeholder="如 id"
            maxlength="64"
          />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="draft.type">
            <el-radio-button value="string">字符串</el-radio-button>
            <el-radio-button value="number">数字</el-radio-button>
            <el-radio-button value="boolean">布尔</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="默认值">
          <el-switch
            v-if="draft.type === 'boolean'"
            :model-value="Boolean(draft.defaultValue)"
            @update:model-value="draft.defaultValue = $event"
          />
          <el-input-number
            v-else-if="draft.type === 'number'"
            :model-value="Number(draft.defaultValue ?? 0)"
            controls-position="right"
            style="width: 100%"
            @update:model-value="draft.defaultValue = Number($event ?? 0)"
          />
          <el-input
            v-else
            :model-value="String(draft.defaultValue ?? '')"
            @update:model-value="draft.defaultValue = $event"
          />
        </el-form-item>
        <el-form-item label="必传">
          <el-switch v-model="draft.required" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="draft.remark" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button
          type="primary"
          :disabled="!draft.name.trim() || existingNames.includes(draft.name.trim())"
          @click="saveDraft"
        >
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.query-params-panel {
  padding: 4px 0 12px;
}
.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}
.hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.hint code {
  font-size: 11px;
  color: #606266;
}
.param-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.param-card {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}
.param-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.param-name {
  font-size: 13px;
  font-weight: 600;
  color: #303133;
}
.req {
  color: #f56c6c;
  margin-left: 2px;
}
.param-type {
  margin-left: 6px;
  font-weight: 400;
  font-size: 12px;
  color: #909399;
}
.param-remark {
  font-size: 12px;
  color: #909399;
}
.param-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}
</style>

