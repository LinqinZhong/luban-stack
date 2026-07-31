<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Delete, EditPen, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  isValidPaletteColorName,
  type ColorPalette,
  type PaletteColor,
} from '../../types/color-palette'
import ColorPicker from './ColorPicker.vue'

const props = defineProps<{
  library: ColorPalette
}>()

const emit = defineEmits<{
  'update:library': [library: ColorPalette]
}>()

const colors = computed({
  get: () => props.library.colors,
  set(value: PaletteColor[]) {
    emit('update:library', { colors: value })
  },
})

const dialogVisible = ref(false)
const editingName = ref<string | null>(null)
const form = reactive({
  name: '',
  description: '',
  value: '#409eff',
})

function openCreate() {
  editingName.value = null
  form.name = ''
  form.description = ''
  form.value = '#409eff'
  dialogVisible.value = true
}

function openEdit(color: PaletteColor) {
  editingName.value = color.name
  form.name = color.name
  form.description = color.description
  form.value = color.value
  dialogVisible.value = true
}

async function removeColor(color: PaletteColor) {
  try {
    await ElMessageBox.confirm(
      `确定删除颜色「${color.description || color.name}」吗？引用该 key 的控件将无法解析为调色板色值。`,
      '删除颜色',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  colors.value = colors.value.filter((item) => item.name !== color.name)
  ElMessage.success('已删除颜色')
}

function saveColor() {
  const name = form.name.trim()
  if (!isValidPaletteColorName(name)) {
    ElMessage.error('颜色名称需以字母开头，仅含字母、数字、下划线和短横线')
    return
  }

  const value = form.value.trim()
  if (!value) {
    ElMessage.error('请填写颜色值')
    return
  }

  const duplicate = colors.value.some(
    (item) => item.name === name && item.name !== editingName.value,
  )
  if (duplicate) {
    ElMessage.error('颜色名称已存在')
    return
  }

  const next: PaletteColor = {
    name,
    description: form.description.trim(),
    value,
  }

  if (editingName.value) {
    colors.value = colors.value.map((item) =>
      item.name === editingName.value ? next : item,
    )
  } else {
    colors.value = [...colors.value, next]
  }

  dialogVisible.value = false
  ElMessage.success(editingName.value ? '已更新颜色' : '已添加颜色')
}
</script>

<template>
  <div class="color-palette-panel">
    <div class="panel-toolbar">
      <div class="toolbar-text">
        <div class="title">调色板</div>
        <div class="desc">
          项目级颜色 token。选择颜色时填入名称 key，构建时生成 CSS 变量
          <code>var(--name)</code>
        </div>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">添加颜色</el-button>
    </div>

    <el-empty
      v-if="!colors.length"
      description="暂无颜色，点击添加"
      :image-size="72"
    />

    <div v-else class="color-grid">
      <div v-for="color in colors" :key="color.name" class="color-card">
        <div class="color-main">
          <div
            class="color-swatch"
            :class="{ checker: color.value === 'transparent' }"
            :style="
              color.value === 'transparent'
                ? undefined
                : { background: color.value }
            "
          />
          <div class="color-meta">
            <div class="color-name" :title="color.name">{{ color.name }}</div>
            <div
              class="color-desc"
              :title="color.description || color.value"
            >
              {{ color.description || color.value }}
            </div>
            <div class="color-value" :title="color.value">{{ color.value }}</div>
          </div>
        </div>
        <div class="color-actions">
          <el-tooltip content="编辑" placement="top">
            <el-button
              :icon="EditPen"
              text
              circle
              @click.stop="openEdit(color)"
            />
          </el-tooltip>
          <el-tooltip content="删除" placement="top">
            <el-button
              :icon="Delete"
              text
              circle
              type="danger"
              @click.stop="removeColor(color)"
            />
          </el-tooltip>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingName ? '编辑颜色' : '添加颜色'"
      width="440px"
      destroy-on-close
      :close-on-click-modal="false"
      :close-on-press-escape="false"
    >
      <el-form label-position="top" size="default">
        <el-form-item label="颜色名称（英文）" required>
          <el-input
            v-model="form.name"
            :disabled="Boolean(editingName)"
            placeholder="例如：primary"
          />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" placeholder="例如：主色" />
        </el-form-item>
        <el-form-item label="颜色值" required>
          <ColorPicker
            v-model="form.value"
            hide-palette
            placeholder="#409eff / rgba(...)"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" @click="saveColor">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.color-palette-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px;
  box-sizing: border-box;
  background: #fff;
}

.panel-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.toolbar-text .title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.toolbar-text .desc {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}

.toolbar-text .desc code {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  background: #f4f4f5;
  color: #606266;
}

.color-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  align-content: start;
}

.color-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  box-sizing: border-box;
  min-width: 0;
}

.color-card:hover {
  border-color: #dcdfe6;
}

.color-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.color-swatch {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  box-sizing: border-box;
}

.color-swatch.checker {
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 10px 10px;
  background-position:
    0 0,
    0 5px,
    5px -5px,
    -5px 0;
}

.color-meta {
  min-width: 0;
  flex: 1;
}

.color-name {
  font-size: 14px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #606266;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-value {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.color-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
}
</style>
