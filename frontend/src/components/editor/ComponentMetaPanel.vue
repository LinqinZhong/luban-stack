<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { DATA_FIELD_TYPE_OPTIONS } from '../../types/page-data'
import {
  METHOD_PARAM_TYPE_OPTIONS,
  type PageMethod,
} from '../../types/page-method'
import {
  createEmptyComponentEvent,
  createEmptyComponentProp,
  type ComponentConfig,
  type ComponentEventDef,
  type ComponentPropDef,
} from '../../types/component'
import { SIZE_OPTIONS } from '../../utils/xml-node'
import NumericInput from './NumericInput.vue'
import ComponentPropDialog from './ComponentPropDialog.vue'

const props = defineProps<{
  config: ComponentConfig
  methods: PageMethod[]
  iconOptions?: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{
  'update:config': [config: ComponentConfig]
}>()

const draft = reactive<ComponentConfig>({
  name: '',
  title: '',
  width: 'match_parent',
  height: 'wrap_content',
  props: [],
  events: [],
  exposedMethods: [],
})

const widthMode = reactive({ mode: 'match_parent', value: 200 })
const heightMode = reactive({ mode: 'wrap_content', value: 80 })

const propDialogVisible = ref(false)
const editingPropIndex = ref(-1)
const editingProp = ref<ComponentPropDef | null>(null)

watch(
  () => props.config,
  (config) => {
    draft.name = config.name
    draft.title = config.title || config.name
    draft.width = config.width
    draft.height = config.height
    draft.props = config.props.map((item) => ({
      ...item,
      required: Boolean(item.required),
    }))
    draft.events = config.events.map((item) => ({
      ...item,
      params: item.params.map((p) => ({ ...p })),
    }))
    draft.exposedMethods = [...config.exposedMethods]
    Object.assign(widthMode, parseSize(config.width, 200))
    Object.assign(heightMode, parseSize(config.height, 80))
  },
  { immediate: true, deep: true },
)

function parseSize(value: string | undefined, fallback: number) {
  if (!value || value === 'wrap_content') return { mode: 'wrap_content', value: fallback }
  if (value === 'match_parent') return { mode: 'match_parent', value: fallback }
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) return { mode: 'fixed', value: n }
  if (Number.isFinite(n)) return { mode: 'fixed', value: fallback }
  return { mode: 'wrap_content', value: fallback }
}

function sizeToAttr(mode: string, value: number | string, fallback = 0) {
  if (mode === 'wrap_content' || mode === 'match_parent') return mode
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return String(fallback)
  return String(num)
}

function onWidthModeChange() {
  if (widthMode.mode === 'fixed') {
    const n = Number(widthMode.value)
    if (!Number.isFinite(n) || n <= 0) widthMode.value = 200
  }
  commit()
}

function onHeightModeChange() {
  if (heightMode.mode === 'fixed') {
    const n = Number(heightMode.value)
    if (!Number.isFinite(n) || n <= 0) heightMode.value = 80
  }
  commit()
}

function commit() {
  draft.width = sizeToAttr(widthMode.mode, widthMode.value, 200)
  draft.height = sizeToAttr(heightMode.mode, heightMode.value, 80)
  emit('update:config', {
    name: draft.name.trim(),
    title: (draft.title || draft.name).trim(),
    width: draft.width,
    height: draft.height,
    props: draft.props.map((item) => ({
      ...item,
      name: item.name.trim(),
      required: Boolean(item.required),
    })),
    events: draft.events.map((item) => ({
      name: item.name.trim(),
      params: item.params.map((p) => ({
        ...p,
        name: p.name.trim(),
      })),
    })),
    exposedMethods: [...draft.exposedMethods],
  })
}

function openAddProp() {
  editingPropIndex.value = -1
  editingProp.value = createEmptyComponentProp()
  propDialogVisible.value = true
}

function openEditProp(index: number) {
  editingPropIndex.value = index
  editingProp.value = { ...draft.props[index] }
  propDialogVisible.value = true
}

function removeProp(index: number) {
  draft.props.splice(index, 1)
  commit()
}

function saveProp(prop: ComponentPropDef) {
  if (editingPropIndex.value >= 0) {
    draft.props[editingPropIndex.value] = { ...prop }
  } else {
    draft.props.push({ ...prop })
  }
  commit()
}

function propExistingNames(): string[] {
  return draft.props
    .map((item, index) => (index === editingPropIndex.value ? '' : item.name))
    .filter(Boolean)
}

function propTypeLabel(type: string): string {
  return DATA_FIELD_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type
}

function propSummary(row: ComponentPropDef): string {
  const parts = [propTypeLabel(row.type)]
  if (row.required) parts.push('必填')
  if (row.twoWay) parts.push('model')
  else parts.push('props')
  return parts.join(' · ')
}

function addEvent() {
  draft.events.push(createEmptyComponentEvent())
  commit()
}

function removeEvent(index: number) {
  draft.events.splice(index, 1)
  commit()
}

function addEventParam(event: ComponentEventDef) {
  event.params.push({ name: '', type: 'any' })
  commit()
}

function removeEventParam(event: ComponentEventDef, index: number) {
  event.params.splice(index, 1)
  commit()
}

const customMethodOptions = () =>
  props.methods.filter((item) => !item.builtin).map((item) => item.name)
</script>

<template>
  <div class="component-meta">
    <div class="panel-header">组件设置</div>
    <div class="panel-body">
      <div class="section-title">基本</div>
      <el-form label-position="top" size="small">
        <el-form-item label="名称">
          <el-input v-model="draft.name" @change="commit" />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="draft.title" @change="commit" />
        </el-form-item>
      </el-form>

      <div class="section-title">默认尺寸</div>
      <el-form label-position="top" size="small">
        <el-form-item label="宽度 width">
          <div class="size-row">
            <el-select v-model="widthMode.mode" @change="onWidthModeChange">
              <el-option
                v-for="opt in SIZE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <NumericInput
              v-if="widthMode.mode === 'fixed'"
              v-model="widthMode.value"
              @change="commit"
            />
          </div>
        </el-form-item>
        <el-form-item label="高度 height">
          <div class="size-row">
            <el-select v-model="heightMode.mode" @change="onHeightModeChange">
              <el-option
                v-for="opt in SIZE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <NumericInput
              v-if="heightMode.mode === 'fixed'"
              v-model="heightMode.value"
              @change="commit"
            />
          </div>
        </el-form-item>
      </el-form>

      <div class="section-title">
        <span>参数（Props / Model）</span>
        <el-button type="primary" link :icon="Plus" @click="openAddProp">添加</el-button>
      </div>
      <p class="hint">点击条目编辑。模板中用 <code>{$props.字段名}</code> 读取。</p>
      <div v-if="!draft.props.length" class="empty">暂无参数</div>
      <div
        v-for="(row, index) in draft.props"
        :key="`${row.name}-${index}`"
        class="prop-item"
      >
        <button type="button" class="prop-main" @click="openEditProp(index)">
          <span class="prop-name">{{ row.name || '未命名' }}</span>
          <span class="prop-meta">{{ propSummary(row) }}</span>
        </button>
        <el-button type="danger" link :icon="Delete" @click="removeProp(index)" />
      </div>

      <div class="section-title">
        <span>事件方法</span>
        <el-button type="primary" link :icon="Plus" @click="addEvent">添加</el-button>
      </div>
      <p class="hint">组件对外抛出的事件，父页面可绑定。</p>
      <div v-if="!draft.events.length" class="empty">暂无事件</div>
      <div v-for="(event, eIndex) in draft.events" :key="eIndex" class="card">
        <div class="card-row">
          <el-input
            v-model="event.name"
            placeholder="事件名，如 onChange"
            @change="commit"
          />
          <el-button type="danger" link :icon="Delete" @click="removeEvent(eIndex)" />
        </div>
        <div class="params">
          <div
            v-for="(param, pIndex) in event.params"
            :key="pIndex"
            class="param-row"
          >
            <el-input
              v-model="param.name"
              placeholder="参数名"
              @change="commit"
            />
            <el-select v-model="param.type" style="width: 120px" @change="commit">
              <el-option
                v-for="opt in METHOD_PARAM_TYPE_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <el-button
              type="danger"
              link
              :icon="Delete"
              @click="removeEventParam(event, pIndex)"
            />
          </div>
          <el-button type="primary" link :icon="Plus" @click="addEventParam(event)">
            添加参数
          </el-button>
        </div>
      </div>

      <div class="section-title">暴露方法</div>
      <p class="hint">从组件方法中多选，供父页面调用。</p>
      <el-select
        v-model="draft.exposedMethods"
        multiple
        filterable
        clearable
        placeholder="选择要暴露的方法"
        style="width: 100%"
        @change="commit"
      >
        <el-option
          v-for="name in customMethodOptions()"
          :key="name"
          :label="name"
          :value="name"
        />
      </el-select>
      <p v-if="!customMethodOptions().length" class="hint">
        请先在「方法」模式中添加自定义方法。
      </p>
    </div>

    <ComponentPropDialog
      v-model="propDialogVisible"
      :prop="editingProp"
      :existing-names="propExistingNames()"
      :icon-options="iconOptions"
      @save="saveProp"
    />
  </div>
</template>

<style scoped>
.component-meta {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
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
  padding: 12px;
}

.section-title {
  margin: 12px 0 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
}

.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: #94a3b8;
}

.hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.empty {
  font-size: 12px;
  color: #c0c4cc;
  margin-bottom: 8px;
}

.prop-item {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.prop-main {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  padding: 0;
}

.prop-name {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prop-meta {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.card {
  padding: 10px;
  margin-bottom: 8px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.card-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.card-row:last-child {
  margin-bottom: 0;
}

.params {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.param-row {
  display: grid;
  grid-template-columns: 1fr 120px 28px;
  gap: 6px;
  align-items: center;
}

.size-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

:deep(.el-select) {
  width: 100%;
}
</style>
