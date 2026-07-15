<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  isValidIconId,
  parseSvgSource,
  type IconDefinition,
  type IconLibrary,
} from '../../types/icon-library'

const props = defineProps<{
  library: IconLibrary
}>()

const emit = defineEmits<{
  'update:library': [library: IconLibrary]
}>()

const icons = computed({
  get: () => props.library.icons,
  set(value: IconDefinition[]) {
    emit('update:library', { icons: value })
  },
})

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const form = reactive({
  id: '',
  label: '',
  viewBox: '0 0 24 24',
  rawSvg: '',
})

function openCreate() {
  editingId.value = null
  form.id = ''
  form.label = ''
  form.viewBox = '0 0 24 24'
  form.rawSvg = ''
  dialogVisible.value = true
}

function openEdit(icon: IconDefinition) {
  editingId.value = icon.id
  form.id = icon.id
  form.label = icon.label
  form.viewBox = icon.viewBox
  form.rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox}">${icon.content}</svg>`
  dialogVisible.value = true
}

async function removeIcon(icon: IconDefinition) {
  try {
    await ElMessageBox.confirm(
      `确定删除图标「${icon.label || icon.id}」吗？引用该图标的控件将显示占位。`,
      '删除图标',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  icons.value = icons.value.filter((item) => item.id !== icon.id)
}

function saveIcon() {
  const id = form.id.trim()
  if (!isValidIconId(id)) {
    ElMessage.error('图标 ID 需以字母开头，仅含字母、数字、下划线和短横线')
    return
  }

  const parsed = parseSvgSource(form.rawSvg)
  if (!parsed?.content) {
    ElMessage.error('请粘贴有效的 SVG 代码')
    return
  }

  const duplicate = icons.value.some(
    (item) => item.id === id && item.id !== editingId.value,
  )
  if (duplicate) {
    ElMessage.error('图标 ID 已存在')
    return
  }

  const next: IconDefinition = {
    id,
    label: form.label.trim() || id,
    viewBox: form.viewBox.trim() || parsed.viewBox || '0 0 24 24',
    content: parsed.content,
  }

  if (editingId.value) {
    icons.value = icons.value.map((item) =>
      item.id === editingId.value ? next : item,
    )
  } else {
    icons.value = [...icons.value, next]
  }

  dialogVisible.value = false
  ElMessage.success(editingId.value ? '已更新图标' : '已添加图标')
}
</script>

<template>
  <div class="icon-library-panel">
    <div class="panel-toolbar">
      <div class="toolbar-text">
        <div class="title">图标库</div>
        <div class="desc">项目级 SVG 符号表，控件通过 iconId 引用，不重复内联代码</div>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreate">添加图标</el-button>
    </div>

    <el-empty
      v-if="!icons.length"
      description="暂无图标，点击添加自定义 SVG"
      :image-size="72"
    />

    <div v-else class="icon-grid">
      <button
        v-for="icon in icons"
        :key="icon.id"
        type="button"
        class="icon-card"
        @click="openEdit(icon)"
      >
        <div class="icon-preview">
          <svg
            class="preview-svg"
            :viewBox="icon.viewBox"
            aria-hidden="true"
            v-html="icon.content"
          />
        </div>
        <div class="icon-meta">
          <div class="icon-label">{{ icon.label }}</div>
          <div class="icon-id">{{ icon.id }}</div>
        </div>
        <el-button
          class="icon-delete"
          type="danger"
          link
          :icon="Delete"
          @click.stop="removeIcon(icon)"
        />
      </button>
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑图标' : '添加图标'"
      width="560px"
      destroy-on-close
    >
      <el-form label-position="top" size="default">
        <el-form-item label="图标 ID" required>
          <el-input
            v-model="form.id"
            :disabled="Boolean(editingId)"
            placeholder="例如：home"
          />
        </el-form-item>
        <el-form-item label="显示名称">
          <el-input v-model="form.label" placeholder="例如：首页" />
        </el-form-item>
        <el-form-item label="viewBox">
          <el-input v-model="form.viewBox" placeholder="0 0 24 24" />
        </el-form-item>
        <el-form-item label="SVG 代码" required>
          <el-input
            v-model="form.rawSvg"
            type="textarea"
            :rows="8"
            placeholder="粘贴完整 <svg>...</svg>，或仅内部 path 等 markup"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveIcon">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.icon-library-panel {
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

.icon-grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  align-content: start;
}

.icon-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 12px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fafbfc;
  cursor: pointer;
  text-align: center;
}

.icon-card:hover {
  border-color: #c6e2ff;
  background: #f0f7ff;
}

.icon-preview {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #303133;
}

.preview-svg {
  width: 32px;
  height: 32px;
  display: block;
}

.icon-meta {
  min-width: 0;
  width: 100%;
}

.icon-label {
  font-size: 13px;
  font-weight: 500;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-id {
  margin-top: 2px;
  font-size: 11px;
  color: #909399;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-delete {
  position: absolute;
  top: 4px;
  right: 4px;
}
</style>
