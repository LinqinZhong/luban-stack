<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import DataFieldPathSelect from './DataFieldPathSelect.vue'
import {
  STYLE_CONDITION_OP_OPTIONS,
  createEmptyCondition,
  createEmptyScenario,
  createEmptyVisibilityConfig,
  type StyleCondition,
  type StyleScenario,
  type VisibilityConditionConfig,
} from '../../types/dynamic-styles'
import type { DataField } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import { findNearestRepeatListName } from '../../utils/data-field-paths'

const props = defineProps<{
  modelValue: boolean
  title: string
  config: VisibilityConditionConfig | null
  dataFields?: DataField[]
  /** 编辑组件时传入（含空数组），字段树展示 $props */
  componentProps?: ComponentPropDef[] | null
  /** 路由参数（含空对象），字段树展示 $route */
  routeParams?: Record<string, unknown> | null
  selectedNodeId?: string
  xml?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  save: [config: VisibilityConditionConfig]
}>()

const draft = reactive<{
  scenarios: StyleScenario[]
}>({
  scenarios: [],
})

const activeSceneId = ref('')

const visible = computed({
  get: () => props.modelValue,
  set(value: boolean) {
    emit('update:modelValue', value)
  },
})

const repeatListName = computed(() => {
  if (!props.xml || !props.selectedNodeId) return null
  return findNearestRepeatListName(props.xml, props.selectedNodeId)
})

const activeScene = computed(() =>
  draft.scenarios.find((item) => item.id === activeSceneId.value) ?? null,
)

const needsValue = (op: StyleCondition['op']) =>
  op !== 'empty' && op !== 'notEmpty'

watch(
  () => [props.modelValue, props.config] as const,
  ([open, config]) => {
    if (!open) return
    const source = config?.scenarios?.length
      ? config
      : createEmptyVisibilityConfig()
    draft.scenarios = source.scenarios.map((scene) => ({
      ...scene,
      conditions: scene.conditions.map((cond) => ({ ...cond })),
    }))
    if (!draft.scenarios.length) {
      draft.scenarios = [createEmptyScenario(1)]
    }
    activeSceneId.value = draft.scenarios[0]?.id ?? ''
  },
)

function addScenario() {
  const scene = createEmptyScenario(draft.scenarios.length + 1)
  draft.scenarios.push(scene)
  activeSceneId.value = scene.id
}

function removeScenario(sceneId: string) {
  if (draft.scenarios.length <= 1) {
    ElMessage.warning('至少保留一个场景')
    return
  }
  draft.scenarios = draft.scenarios.filter((item) => item.id !== sceneId)
  if (activeSceneId.value === sceneId) {
    activeSceneId.value = draft.scenarios[0]?.id ?? ''
  }
}

function addCondition() {
  if (!activeScene.value) return
  activeScene.value.conditions.push(createEmptyCondition())
}

function removeCondition(index: number) {
  if (!activeScene.value) return
  if (activeScene.value.conditions.length <= 1) {
    activeScene.value.conditions = [createEmptyCondition()]
    return
  }
  activeScene.value.conditions.splice(index, 1)
}

function handleSave() {
  emit('save', {
    scenarios: draft.scenarios.map((scene, index) => ({
      id: scene.id,
      name: scene.name.trim() || `场景${index + 1}`,
      conditions: scene.conditions.map((cond) => ({ ...cond })),
    })),
  })
  visible.value = false
}

function handleClear() {
  emit('save', { scenarios: [] })
  visible.value = false
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="720px"
    destroy-on-close
    append-to-body
  >
    <p class="block-hint">
      同一场景内条件为「且」；多个场景为「或」。字段支持树形选择；选中数组后可填下标。
      <template v-if="repeatListName">
        当前在重复「{{ repeatListName }}」内，可选 <code>index</code> /
        <code>item.xxx</code>。
      </template>
    </p>

    <div class="scene-tabs">
      <el-radio-group v-model="activeSceneId" size="small">
        <el-radio-button
          v-for="scene in draft.scenarios"
          :key="scene.id"
          :value="scene.id"
        >
          {{ scene.name }}
        </el-radio-button>
      </el-radio-group>
      <el-button type="primary" link :icon="Plus" @click="addScenario">
        添加场景
      </el-button>
    </div>

    <div v-if="activeScene" class="scene-panel">
      <div class="scene-header">
        <el-input
          v-model="activeScene.name"
          size="small"
          placeholder="场景名称"
          style="max-width: 200px"
        />
        <el-button
          type="danger"
          link
          :icon="Delete"
          :disabled="draft.scenarios.length <= 1"
          @click="removeScenario(activeScene.id)"
        >
          删除场景
        </el-button>
      </div>

      <el-table :data="activeScene.conditions" border size="small" class="cond-table">
        <el-table-column label="字段" min-width="240">
          <template #default="{ row }">
            <DataFieldPathSelect
              v-model="row.field"
              :fields="props.dataFields"
              :component-props="props.componentProps"
              :route-params="props.routeParams"
              :repeat-list-name="repeatListName"
            />
          </template>
        </el-table-column>
        <el-table-column label="条件" width="130">
          <template #default="{ row }">
            <el-select v-model="row.op" style="width: 100%">
              <el-option
                v-for="opt in STYLE_CONDITION_OP_OPTIONS"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="值" min-width="120">
          <template #default="{ row }">
            <el-input
              v-model="row.value"
              :disabled="!needsValue(row.op)"
              placeholder="比较值"
            />
          </template>
        </el-table-column>
        <el-table-column label="" width="56" align="center">
          <template #default="{ $index }">
            <el-button
              type="danger"
              link
              :icon="Delete"
              @click="removeCondition($index)"
            />
          </template>
        </el-table-column>
      </el-table>
      <el-button class="add-cond" type="primary" link :icon="Plus" @click="addCondition">
        添加条件
      </el-button>
    </div>

    <template #footer>
      <el-button @click="handleClear">清除</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="handleSave">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.block-hint {
  margin: 0 0 12px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.block-hint code {
  font-size: 11px;
  color: #606266;
}

.scene-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.scene-panel {
  margin-bottom: 8px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
}

.scene-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 8px;
}

.cond-table {
  width: 100%;
}

.add-cond {
  margin-top: 8px;
}
</style>
