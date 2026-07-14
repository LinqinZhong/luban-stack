<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Coin,
  Document,
  EditPen,
  Plus,
  View,
} from '@element-plus/icons-vue'
import {
  createPage,
  getPage,
  listPages,
  savePageData,
  savePageXml,
  type PageDetail,
  type PageSummary,
} from '../api/pages'
import DataPoolPanel from '../components/editor/DataPoolPanel.vue'
import PropsPanel, { type PropsTab } from '../components/editor/PropsPanel.vue'
import PageCanvas from '../components/xml/PageCanvas.vue'
import WidgetTree from '../components/xml/WidgetTree.vue'
import { useProjectStore } from '../stores/project'
import {
  appendWidget,
  canDeleteNode,
  moveWidget,
  removeWidget,
  WIDGET_OPTIONS,
  type MovePosition,
  type WidgetTag,
} from '../utils/xml-node'
import type { PageData } from '../types/page-data'

type WorkspaceMode = 'preview' | 'edit' | 'datapool'

const projectStore = useProjectStore()

const pages = ref<PageSummary[]>([])
const activePageId = ref('')
const activePage = ref<PageDetail | null>(null)
const selectedNodeId = ref('')
const workspaceMode = ref<WorkspaceMode>('preview')
const propsTab = ref<PropsTab>('style')
const openRepeatRequest = ref(0)
const loadingPages = ref(false)
const loadingPage = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const addWidgetVisible = ref(false)

const createForm = reactive({
  id: '',
  name: '',
  title: '',
})

const createRules = {
  id: [
    { required: true, message: '请输入页面 ID', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_-]+$/,
      message: '仅支持字母、数字、下划线和短横线',
      trigger: 'blur',
    },
  ],
  name: [{ required: true, message: '请输入页面名称', trigger: 'blur' }],
}

const createFormRef = ref()

const canvasWidth = computed(
  () => projectStore.config?.canvas.width ?? 375,
)

const isEditMode = computed(() => workspaceMode.value === 'edit')
const isDataPoolMode = computed(() => workspaceMode.value === 'datapool')

const canDeleteSelected = computed(
  () => isEditMode.value && canDeleteNode(selectedNodeId.value),
)

const modeTabs = [
  { key: 'preview' as const, label: '预览', icon: View },
  { key: 'edit' as const, label: '编辑', icon: EditPen },
  { key: 'datapool' as const, label: '数据池', icon: Coin },
]

async function loadPages(selectId?: string) {
  if (!projectStore.path) return

  loadingPages.value = true
  try {
    const result = await listPages(projectStore.path)
    pages.value = result.pages

    const nextId =
      selectId ||
      (activePageId.value && result.pages.some((p) => p.id === activePageId.value)
        ? activePageId.value
        : result.pages[0]?.id)

    if (nextId) {
      await openPage(nextId)
    } else {
      activePageId.value = ''
      activePage.value = null
      selectedNodeId.value = ''
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载页面列表失败')
  } finally {
    loadingPages.value = false
  }
}

async function openPage(pageId: string) {
  if (!projectStore.path) return

  activePageId.value = pageId
  selectedNodeId.value = ''
  loadingPage.value = true
  try {
    activePage.value = await getPage(projectStore.path, pageId)
  } catch (err) {
    activePage.value = null
    ElMessage.error(err instanceof Error ? err.message : '打开页面失败')
  } finally {
    loadingPage.value = false
  }
}

function openCreateDialog() {
  createForm.id = ''
  createForm.name = ''
  createForm.title = ''
  createVisible.value = true
}

async function handleCreatePage() {
  const form = createFormRef.value
  if (!form || !projectStore.path) return

  await form.validate(async (valid: boolean) => {
    if (!valid) return

    creating.value = true
    try {
      const page = await createPage({
        projectPath: projectStore.path,
        id: createForm.id.trim(),
        name: createForm.name.trim(),
        title: createForm.title.trim() || undefined,
      })
      ElMessage.success(`已创建页面：${page.config.name}`)
      createVisible.value = false
      await loadPages(page.id)
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '创建页面失败')
    } finally {
      creating.value = false
    }
  })
}

async function handleXmlUpdate(xml: string) {
  if (!projectStore.path || !activePage.value) return

  activePage.value = {
    ...activePage.value,
    xml,
  }

  try {
    const saved = await savePageXml({
      projectPath: projectStore.path,
      pageId: activePage.value.id,
      xml,
    })
    activePage.value = saved
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  }
}

async function handleDataUpdate(data: PageData) {
  if (!projectStore.path || !activePage.value) return

  activePage.value = {
    ...activePage.value,
    data,
  }

  if (dataSaveTimer) clearTimeout(dataSaveTimer)
  dataSaveTimer = setTimeout(async () => {
    if (!projectStore.path || !activePage.value) return
    try {
      const saved = await savePageData({
        projectPath: projectStore.path,
        pageId: activePage.value.id,
        data: activePage.value.data,
      })
      activePage.value = saved
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '保存数据池失败')
    }
  }, 400)
}

let dataSaveTimer: ReturnType<typeof setTimeout> | null = null

function openAddWidgetDialog() {
  if (!activePage.value) return
  addWidgetVisible.value = true
}

async function handleOpenRepeatConfig(nodeId: string) {
  if (!isEditMode.value || !nodeId) return
  selectedNodeId.value = nodeId
  propsTab.value = 'dynamic'
  await nextTick()
  openRepeatRequest.value += 1
}

async function handleAddWidget(tag: WidgetTag) {
  if (!activePage.value) return

  try {
    const { xml, newNodeId } = appendWidget(
      activePage.value.xml,
      selectedNodeId.value,
      tag,
    )
    addWidgetVisible.value = false
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success(`已添加 ${tag}`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加控件失败')
  }
}

async function handleDeleteWidget() {
  if (!activePage.value || !canDeleteNode(selectedNodeId.value)) return

  const node = selectedNodeId.value
  try {
    await ElMessageBox.confirm(
      '删除后无法恢复，确定要删除该控件吗？',
      '删除控件',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }

  try {
    const { xml, parentId } = removeWidget(activePage.value.xml, node)
    selectedNodeId.value = parentId
    await handleXmlUpdate(xml)
    ElMessage.success('已删除控件')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除控件失败')
  }
}

async function handleMoveWidget(payload: {
  sourceId: string
  targetId: string
  position: MovePosition
}) {
  if (!activePage.value || !isEditMode.value) return

  try {
    const { xml, newNodeId } = moveWidget(
      activePage.value.xml,
      payload.sourceId,
      payload.targetId,
      payload.position,
    )
    selectedNodeId.value = newNodeId
    await handleXmlUpdate(xml)
    ElMessage.success('已调整控件结构')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '移动控件失败')
  }
}

onMounted(() => {
  void loadPages()
})
</script>

<template>
  <div class="workspace">
    <aside class="side-panel">
      <div class="pages-section">
        <div class="section-header">
          <span>页面</span>
          <el-button type="primary" :icon="Plus" size="small" @click="openCreateDialog">
            新建
          </el-button>
        </div>

        <div class="pages-body">
          <el-skeleton v-if="loadingPages && !pages.length" :rows="4" animated />
          <el-empty v-else-if="!pages.length" description="暂无页面，点击新建" :image-size="64" />
          <div v-else class="page-list">
            <button
              v-for="page in pages"
              :key="page.id"
              type="button"
              class="page-item"
              :class="{ active: page.id === activePageId }"
              @click="openPage(page.id)"
            >
              <el-icon><Document /></el-icon>
              <div class="page-meta">
                <div class="page-name">{{ page.name }}</div>
                <div class="page-id">{{ page.id }}</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      <WidgetTree
        v-if="activePage && !isDataPoolMode"
        :xml="activePage.xml"
        :selected-id="selectedNodeId"
        :editable="isEditMode"
        @select="selectedNodeId = $event"
        @open-repeat="handleOpenRepeatConfig"
        @move="handleMoveWidget"
      />
    </aside>

    <section class="center-panel">
      <div class="preview-header">
        <template v-if="activePage">
          <span class="preview-title">{{ activePage.config.title || activePage.config.name }}</span>
          <span class="preview-sub">
            {{ activePage.id }}/{{ isDataPoolMode ? 'data.json' : 'index.xml' }}
          </span>
        </template>
        <span v-else class="preview-title">页面预览</span>
      </div>

      <div class="preview-body">
        <el-skeleton v-if="loadingPage" :rows="8" animated />
        <el-empty
          v-else-if="!activePage"
          description="请选择或新建一个页面"
        />
        <DataPoolPanel
          v-else-if="isDataPoolMode"
          :data="activePage.data ?? { fields: [] }"
          @update:data="handleDataUpdate"
        />
        <PageCanvas
          v-else
          :xml="activePage.xml"
          :canvas-width="canvasWidth"
          :selected-id="selectedNodeId"
          :selectable="isEditMode"
          :show-add-button="isEditMode"
          :show-delete-button="canDeleteSelected"
          :expand-repeat="workspaceMode === 'preview'"
          :page-data="activePage.data ?? { fields: [] }"
          @select="selectedNodeId = $event"
          @open-repeat="handleOpenRepeatConfig"
          @add="openAddWidgetDialog"
          @delete="handleDeleteWidget"
        />
      </div>

      <div class="mode-tabs">
        <el-tooltip
          v-for="tab in modeTabs"
          :key="tab.key"
          :content="tab.label"
          placement="top"
        >
          <button
            type="button"
            class="mode-tab"
            :class="{ active: workspaceMode === tab.key }"
            @click="workspaceMode = tab.key"
          >
            <el-icon :size="18"><component :is="tab.icon" /></el-icon>
          </button>
        </el-tooltip>
      </div>
    </section>

    <PropsPanel
      v-if="activePage && isEditMode"
      v-model:tab="propsTab"
      :xml="activePage.xml"
      :selected-id="selectedNodeId"
      :data-fields="activePage.data?.fields ?? []"
      :open-repeat-request="openRepeatRequest"
      @update:xml="handleXmlUpdate"
    />
    <aside v-else class="props-placeholder">
      <div class="panel-header">属性</div>
      <el-empty
        :description="activePage && isDataPoolMode ? '数据池模式下请在中间区域编辑' : '打开页面后可编辑'"
        :image-size="64"
      />
    </aside>

    <el-dialog v-model="createVisible" title="新建页面" width="480px" destroy-on-close>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="88px">
        <el-form-item label="页面 ID" prop="id">
          <el-input v-model="createForm.id" placeholder="例如：home" />
        </el-form-item>
        <el-form-item label="页面名称" prop="name">
          <el-input v-model="createForm.name" placeholder="例如：首页" />
        </el-form-item>
        <el-form-item label="页面标题">
          <el-input v-model="createForm.title" placeholder="可选，默认与名称相同" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreatePage">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="addWidgetVisible"
      title="添加控件"
      width="480px"
      destroy-on-close
    >
      <p class="add-hint">
        将添加到当前选中的布局容器；若选中的是 Text/Button，则添加到其父布局。
      </p>
      <div class="widget-options">
        <button
          v-for="item in WIDGET_OPTIONS"
          :key="item.tag"
          type="button"
          class="widget-option"
          @click="handleAddWidget(item.tag)"
        >
          <div class="widget-option-title">{{ item.label }}</div>
          <div class="widget-option-desc">{{ item.description }}</div>
        </button>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.side-panel {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: #fff;
  border-right: 1px solid #ebeef5;
}

.pages-section {
  display: flex;
  flex-direction: column;
  flex: 0 0 42%;
  min-height: 160px;
  max-height: 50%;
  overflow: hidden;
}

.section-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid #ebeef5;
  font-weight: 600;
  color: #303133;
}

.pages-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.page-list {
  display: flex;
  flex-direction: column;
}

.page-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: #303133;
}

.page-item:hover {
  background: #f5f7fa;
}

.page-item.active {
  background: #ecf5ff;
  color: #409eff;
}

.page-meta {
  min-width: 0;
}

.page-name {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
}

.page-id {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}

.center-panel {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 48px;
  padding: 0 16px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}

.preview-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  line-height: 1;
}

.preview-sub {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1;
}

.preview-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.mode-tabs {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 48px;
  background: #fff;
  border-top: 1px solid #ebeef5;
}

.mode-tab {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}

.mode-tab:hover {
  background: #f5f7fa;
  color: #303133;
}

.mode-tab.active {
  background: #ecf5ff;
  color: #409eff;
}

.props-placeholder {
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

.add-hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: #64748b;
}

.widget-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.widget-option {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
  text-align: left;
  cursor: pointer;
}

.widget-option:hover {
  border-color: #409eff;
  background: #ecf5ff;
}

.widget-option-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.widget-option-desc {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
