<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { FolderOpened, FolderAdd, Folder, ArrowUp } from '@element-plus/icons-vue'
import {
  browseProjectDirectory,
  createProject,
  getProjectMeta,
  openProject,
  type BrowseEntry,
  type ProjectMeta,
} from '../api/projects'
import { useProjectStore } from '../stores/project'

const router = useRouter()
const projectStore = useProjectStore()

const meta = ref<ProjectMeta | null>(null)
const openDialogVisible = ref(false)
const createDialogVisible = ref(false)
const folderPickerVisible = ref(false)
const folderPickerMode = ref<'open' | 'create'>('open')
const loading = ref(false)
const browsing = ref(false)

const openPath = ref('')
const browsePath = ref('')
const browseParent = ref<string | null>(null)
const browseEntries = ref<BrowseEntry[]>([])

const createForm = reactive({
  path: '',
  name: '',
  author: '',
  version: '0.1.0',
  canvasWidth: 375,
})

const createRules = {
  path: [{ required: true, message: '请选择项目文件夹', trigger: 'blur' }],
  name: [{ required: true, message: '请输入项目名称', trigger: 'blur' }],
  version: [{ required: true, message: '请输入版本号', trigger: 'blur' }],
  canvasWidth: [{ required: true, message: '请输入画布宽度', trigger: 'blur' }],
}

const createFormRef = ref()

const engineVersionLabel = computed(
  () => meta.value?.engineVersion ?? '1.0.0',
)

async function loadMeta() {
  try {
    meta.value = await getProjectMeta()
    createForm.canvasWidth = meta.value.defaultCanvasWidth
  } catch {
    // keep defaults
  }
}

async function loadBrowse(dirPath?: string) {
  browsing.value = true
  try {
    const result = await browseProjectDirectory(dirPath)
    browsePath.value = result.path
    browseParent.value = result.parent
    browseEntries.value = result.entries
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '无法浏览文件夹')
  } finally {
    browsing.value = false
  }
}

function openFolderPicker(mode: 'open' | 'create') {
  folderPickerMode.value = mode
  folderPickerVisible.value = true
  void loadBrowse()
}

function selectBrowseEntry(entry: BrowseEntry) {
  void loadBrowse(entry.path)
}

function confirmFolderPick() {
  if (!browsePath.value) {
    ElMessage.warning('请先进入一个文件夹')
    return
  }

  if (folderPickerMode.value === 'open') {
    openPath.value = browsePath.value
  } else {
    createForm.path = browsePath.value
  }
  folderPickerVisible.value = false
}

async function handleOpenProject() {
  if (!openPath.value.trim()) {
    ElMessage.warning('请选择或输入项目路径')
    return
  }

  loading.value = true
  try {
    const result = await openProject(openPath.value.trim())
    projectStore.setProject(result.path, result.config)
    ElMessage.success(`已打开项目：${result.config.name}`)
    openDialogVisible.value = false
    await router.push('/workspace')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '打开项目失败')
  } finally {
    loading.value = false
  }
}

async function handleCreateProject() {
  const form = createFormRef.value
  if (!form) return

  await form.validate(async (valid: boolean) => {
    if (!valid) return

    loading.value = true
    try {
      const result = await createProject({
        path: createForm.path.trim(),
        name: createForm.name.trim(),
        author: createForm.author.trim(),
        version: createForm.version.trim(),
        canvasWidth: Number(createForm.canvasWidth),
        engineVersion: engineVersionLabel.value,
      })
      projectStore.setProject(result.path, result.config)
      ElMessage.success(`已创建项目：${result.config.name}`)
      createDialogVisible.value = false
      await router.push('/workspace')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '创建项目失败')
    } finally {
      loading.value = false
    }
  })
}

function goWorkspaceIfReady() {
  if (projectStore.hasProject) {
    void router.push('/workspace')
  }
}

onMounted(() => {
  void loadMeta()
})
</script>

<template>
  <div class="welcome">
    <div class="panel">
      <div class="brand">
        <h1>Voider</h1>
        <p>H5 低代码开发工具</p>
      </div>

      <div class="actions">
        <el-button type="primary" size="large" :icon="FolderOpened" @click="openDialogVisible = true">
          打开项目
        </el-button>
        <el-button size="large" :icon="FolderAdd" @click="createDialogVisible = true">
          新建项目
        </el-button>
      </div>

      <div v-if="projectStore.hasProject" class="recent">
        <p>
          最近项目：
          <strong>{{ projectStore.config?.name }}</strong>
        </p>
        <p class="path">{{ projectStore.path }}</p>
        <el-button link type="primary" @click="goWorkspaceIfReady">继续编辑</el-button>
      </div>
    </div>

    <el-dialog v-model="openDialogVisible" title="打开项目" width="560px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false">
      <p class="hint">选择包含 voider.json 的项目文件夹</p>
      <div class="path-row">
        <el-input v-model="openPath" placeholder="项目文件夹路径" clearable />
        <el-button :icon="Folder" @click="openFolderPicker('open')">浏览</el-button>
      </div>
      <template #footer>
        <el-button type="primary" :loading="loading" @click="handleOpenProject">打开</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="createDialogVisible" title="新建项目" width="560px" destroy-on-close :close-on-click-modal="false" :close-on-press-escape="false">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="项目路径" prop="path">
          <div class="path-row full">
            <el-input v-model="createForm.path" placeholder="将在此文件夹创建 voider.json" clearable />
            <el-button :icon="Folder" @click="openFolderPicker('create')">浏览</el-button>
          </div>
        </el-form-item>
        <el-form-item label="项目名称" prop="name">
          <el-input v-model="createForm.name" placeholder="例如：活动页" />
        </el-form-item>
        <el-form-item label="作者" prop="author">
          <el-input v-model="createForm.author" placeholder="可选" />
        </el-form-item>
        <el-form-item label="版本号" prop="version">
          <el-input v-model="createForm.version" placeholder="0.1.0" />
        </el-form-item>
        <el-form-item label="画布宽度" prop="canvasWidth">
          <el-input-number v-model="createForm.canvasWidth" :min="1" :max="5000" />
          <span class="unit">px</span>
        </el-form-item>
        <el-form-item label="引擎版本">
          <el-input :model-value="engineVersionLabel" disabled />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="loading" @click="handleCreateProject">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="folderPickerVisible"
      title="选择文件夹"
      width="640px"
      append-to-body
      destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
      <div class="browser-toolbar">
        <el-button
          :icon="ArrowUp"
          :disabled="!browseParent && browsePath !== ''"
          @click="loadBrowse(browseParent ?? undefined)"
        >
          上级
        </el-button>
        <el-input :model-value="browsePath || '此电脑'" readonly />
      </div>

      <el-skeleton v-if="browsing" :rows="6" animated />
      <el-empty v-else-if="!browseEntries.length" description="没有可进入的子文件夹" />
      <div v-else class="browser-list">
        <button
          v-for="entry in browseEntries"
          :key="entry.path"
          type="button"
          class="browser-item"
          @dblclick="selectBrowseEntry(entry)"
          @click="browsePath = entry.path"
        >
          <el-icon><Folder /></el-icon>
          <span>{{ entry.name }}</span>
        </button>
      </div>
      <template #footer>
        <el-button type="primary" @click="confirmFolderPick">选择当前文件夹</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.welcome {
  height: 100%;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(circle at top left, #dbeafe 0%, transparent 40%),
    radial-gradient(circle at bottom right, #e2e8f0 0%, transparent 45%),
    linear-gradient(160deg, #f8fafc 0%, #eef2f7 100%);
}

.panel {
  width: min(480px, 100%);
  padding: 48px 40px;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid #e5e7eb;
}

.brand h1 {
  margin: 0;
  font-size: 42px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #0f172a;
}

.brand p {
  margin: 8px 0 0;
  color: #64748b;
  font-size: 15px;
}

.actions {
  display: flex;
  gap: 12px;
  margin-top: 36px;
}

.recent {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid #e5e7eb;
  color: #475569;
  font-size: 14px;
}

.recent p {
  margin: 0 0 6px;
}

.path {
  color: #94a3b8;
  word-break: break-all;
  font-size: 12px;
}

.hint {
  margin: 0 0 12px;
  color: #64748b;
  font-size: 13px;
}

.path-row {
  display: flex;
  gap: 8px;
}

.path-row.full {
  width: 100%;
}

.unit {
  margin-left: 8px;
  color: #94a3b8;
}

.browser-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.browser-list {
  max-height: 360px;
  overflow: auto;
  border: 1px solid #ebeef5;
}

.browser-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid #f2f3f5;
  background: #fff;
  text-align: left;
  cursor: pointer;
  color: #303133;
}

.browser-item:hover,
.browser-item:focus {
  background: #f5f7fa;
}
</style>
