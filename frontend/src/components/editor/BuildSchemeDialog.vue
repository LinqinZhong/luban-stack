<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Delete, Edit } from '@element-plus/icons-vue'
import FrameworkTypeIcon from '../icons/FrameworkTypeIcon.vue'
import {
  getBuildSchemes,
  saveBuildSchemes,
  getBackendServiceLibrary,
  type BuildScheme,
  type BuildSchemeLibrary,
  type BuildBackendService,
  type BuildBackendType,
  type BuildFrontendApp,
  type BuildFrontendType,
} from '../../api/projects'
import { listPages, type PageSummary } from '../../api/pages'

const props = defineProps<{
  modelValue: boolean
  projectPath: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const loading = ref(false)
const saving = ref(false)
const library = ref<BuildSchemeLibrary>({ schemes: [] })
const selectedId = ref('')
const modules = ref<Array<{ id: string; name: string }>>([])
const pages = ref<PageSummary[]>([])

const backendEditVisible = ref(false)
const frontendEditVisible = ref(false)
const backendEditIndex = ref(-1)
const frontendEditIndex = ref(-1)

const backendDraft = ref<BuildBackendService>({
  name: 'service1',
  type: 'nestjs',
  port: 3030,
  moduleIds: [],
  includeOss: false,
})
const frontendDraft = ref<BuildFrontendApp>({
  name: 'app1',
  type: 'vue3',
  port: 5173,
  wechatAppId: '',
  pageIds: [],
  entryPage: '',
})

const frontendEntryOptions = computed(() =>
  pages.value.filter((p) => frontendDraft.value.pageIds.includes(p.id)),
)

watch(
  () => [...frontendDraft.value.pageIds],
  (ids) => {
    const entry = frontendDraft.value.entryPage?.trim()
    if (entry && ids.includes(entry)) return
    frontendDraft.value.entryPage = ids[0] ?? ''
  },
)

const activeScheme = computed(() =>
  library.value.schemes.find((s) => s.id === selectedId.value) ?? null,
)

const claimedModuleIds = computed(() => {
  const map = new Map<string, string>()
  if (!activeScheme.value) return map
  for (const b of activeScheme.value.backends) {
    for (const mid of b.moduleIds) {
      map.set(mid, b.name)
    }
  }
  return map
})

function uid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

async function load() {
  if (!props.projectPath) return
  loading.value = true
  try {
    const [lib, svcLib, pageLib] = await Promise.all([
      getBuildSchemes(props.projectPath),
      getBackendServiceLibrary(props.projectPath),
      listPages(props.projectPath),
    ])
    library.value = lib
    modules.value = svcLib.services.map((s) => ({ id: s.id, name: s.name }))
    pages.value = pageLib.pages ?? []
    if (!library.value.schemes.length) {
      addScheme()
    } else if (
      !selectedId.value ||
      !library.value.schemes.some((s) => s.id === selectedId.value)
    ) {
      selectedId.value = library.value.schemes[0]!.id
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载构建方案失败')
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load()
  },
)

function addScheme() {
  const scheme: BuildScheme = {
    id: uid('bld'),
    name: `build${library.value.schemes.length + 1}`,
    description: '',
    backends: [],
    frontends: [],
  }
  library.value = { schemes: [...library.value.schemes, scheme] }
  selectedId.value = scheme.id
}

function removeScheme(id: string) {
  library.value = {
    schemes: library.value.schemes.filter((s) => s.id !== id),
  }
  if (selectedId.value === id) {
    selectedId.value = library.value.schemes[0]?.id ?? ''
  }
}

function openBackendEdit(index: number) {
  if (!activeScheme.value) return
  backendEditIndex.value = index
  if (index < 0) {
    backendDraft.value = {
      name: `service${activeScheme.value.backends.length + 1}`,
      type: 'nestjs',
      port: 3030 + activeScheme.value.backends.length,
      moduleIds: [],
      includeOss: activeScheme.value.backends.length === 0,
    }
  } else {
    const b = activeScheme.value.backends[index]!
    backendDraft.value = {
      name: b.name,
      type: b.type ?? 'nestjs',
      port: b.port,
      moduleIds: [...b.moduleIds],
      includeOss: Boolean(b.includeOss),
    }
  }
  backendEditVisible.value = true
}

function moduleDisabled(moduleId: string): boolean {
  const owner = claimedModuleIds.value.get(moduleId)
  if (!owner) return false
  if (backendEditIndex.value < 0) return true
  const editing = activeScheme.value?.backends[backendEditIndex.value]
  return owner !== editing?.name
}

function saveBackendDraft() {
  if (!activeScheme.value) return
  const name = backendDraft.value.name.trim()
  if (!NAME_RE.test(name)) {
    ElMessage.error('服务名须以字母开头，仅含字母、数字、_、-')
    return
  }
  if (!(backendDraft.value.port > 0 && backendDraft.value.port <= 65535)) {
    ElMessage.error('端口无效')
    return
  }
  if (!backendDraft.value.moduleIds.length) {
    ElMessage.error('至少勾选一个模块')
    return
  }
  const type = (backendDraft.value.type || 'nestjs') as BuildBackendType
  if (type !== 'nestjs') {
    ElMessage.error('暂不支持的后端框架')
    return
  }
  const dup = activeScheme.value.backends.some(
    (b, i) => b.name === name && i !== backendEditIndex.value,
  )
  if (dup) {
    ElMessage.error('服务名重复')
    return
  }
  const next: BuildBackendService = {
    name,
    type,
    port: Math.floor(backendDraft.value.port),
    moduleIds: [...backendDraft.value.moduleIds],
    includeOss: Boolean(backendDraft.value.includeOss),
  }
  const backends = [...activeScheme.value.backends]
  if (backendEditIndex.value < 0) backends.push(next)
  else backends[backendEditIndex.value] = next
  // OSS 只能挂一个服务：开启时清掉其它服务的标记
  if (next.includeOss) {
    for (let i = 0; i < backends.length; i++) {
      if (i === (backendEditIndex.value < 0 ? backends.length - 1 : backendEditIndex.value)) {
        continue
      }
      backends[i] = { ...backends[i]!, includeOss: false }
    }
  }
  activeScheme.value.backends = backends
  backendEditVisible.value = false
}

function removeBackend(index: number) {
  if (!activeScheme.value) return
  activeScheme.value.backends = activeScheme.value.backends.filter(
    (_, i) => i !== index,
  )
}

function openFrontendEdit(index: number) {
  if (!activeScheme.value) return
  frontendEditIndex.value = index
  if (index < 0) {
    const firstId = pages.value[0]?.id
    frontendDraft.value = {
      name: `app${activeScheme.value.frontends.length + 1}`,
      type: 'vue3',
      port: 5173,
      wechatAppId: '',
      pageIds: firstId ? [firstId] : [],
      entryPage: firstId ?? '',
    }
  } else {
    const f = activeScheme.value.frontends[index]!
    const pageIds = [...f.pageIds]
    const entry =
      f.entryPage && pageIds.includes(f.entryPage)
        ? f.entryPage
        : (pageIds[0] ?? '')
    frontendDraft.value = {
      name: f.name,
      type: f.type,
      port: f.port ?? 5173,
      wechatAppId: f.wechatAppId ?? '',
      pageIds,
      entryPage: entry,
    }
  }
  frontendEditVisible.value = true
}

function saveFrontendDraft() {
  if (!activeScheme.value) return
  const name = frontendDraft.value.name.trim()
  if (!NAME_RE.test(name)) {
    ElMessage.error('应用名须以字母开头，仅含字母、数字、_、-')
    return
  }
  if (!frontendDraft.value.pageIds.length) {
    ElMessage.error('至少选择一个页面')
    return
  }
  const entryPage = frontendDraft.value.entryPage?.trim() || ''
  if (!entryPage || !frontendDraft.value.pageIds.includes(entryPage)) {
    ElMessage.error('请选择入口页')
    return
  }
  const type = frontendDraft.value.type as BuildFrontendType
  if (type === 'vue3') {
    const port = Number(frontendDraft.value.port)
    if (!(port > 0 && port <= 65535)) {
      ElMessage.error('H5 须配置有效端口')
      return
    }
  }
  if (type === 'mp-wx' && !frontendDraft.value.wechatAppId?.trim()) {
    ElMessage.error('微信小程序须配置 AppID')
    return
  }
  const dup = activeScheme.value.frontends.some(
    (f, i) => f.name === name && i !== frontendEditIndex.value,
  )
  if (dup) {
    ElMessage.error('应用名重复')
    return
  }
  const next: BuildFrontendApp = {
    name,
    type,
    pageIds: [...frontendDraft.value.pageIds],
    entryPage,
  }
  if (type === 'vue3') next.port = Math.floor(Number(frontendDraft.value.port))
  if (type === 'mp-wx')
    next.wechatAppId = frontendDraft.value.wechatAppId?.trim() || ''

  const frontends = [...activeScheme.value.frontends]
  if (frontendEditIndex.value < 0) frontends.push(next)
  else frontends[frontendEditIndex.value] = next
  activeScheme.value.frontends = frontends
  frontendEditVisible.value = false
}

function removeFrontend(index: number) {
  if (!activeScheme.value) return
  activeScheme.value.frontends = activeScheme.value.frontends.filter(
    (_, i) => i !== index,
  )
}

function validateClient(): string | null {
  const names = new Set<string>()
  for (const s of library.value.schemes) {
    if (!NAME_RE.test(s.name)) return `构建名无效：${s.name}`
    if (names.has(s.name)) return `构建名重复：${s.name}`
    names.add(s.name)

    const claimed = new Map<string, string>()
    for (const b of s.backends) {
      for (const mid of b.moduleIds) {
        if (claimed.has(mid)) return `模块 ${mid} 被多个服务勾选`
        claimed.set(mid, b.name)
      }
    }
    for (const m of modules.value) {
      if (!claimed.has(m.id)) return `方案 ${s.name}：模块 ${m.name} 未被勾选`
    }
    if (modules.value.length && !s.backends.length) {
      return `方案 ${s.name}：请添加后端服务并勾选全部模块`
    }
  }
  return null
}

async function handleSave() {
  const err = validateClient()
  if (err) {
    ElMessage.error(err)
    return
  }
  saving.value = true
  try {
    library.value = await saveBuildSchemes({
      projectPath: props.projectPath,
      library: library.value,
    })
    ElMessage.success('构建方案已保存')
    emit('saved')
    visible.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="配置构建方案"
    width="920px"
    destroy-on-close
    append-to-body
    class="build-scheme-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <div v-loading="loading" class="body">
      <aside class="scheme-list">
        <div class="aside-head">
          <span>方案</span>
          <el-button type="primary" link :icon="Plus" @click="addScheme">
            新建
          </el-button>
        </div>
        <div
          v-for="s in library.schemes"
          :key="s.id"
          class="scheme-item"
          :class="{ active: s.id === selectedId }"
          @click="selectedId = s.id"
        >
          <div class="scheme-name">{{ s.name }}</div>
          <el-button
            type="danger"
            link
            :icon="Delete"
            @click.stop="removeScheme(s.id)"
          />
        </div>
        <el-empty
          v-if="!library.schemes.length"
          description="暂无方案"
          :image-size="48"
        />
      </aside>

      <div v-if="activeScheme" class="scheme-editor">
        <el-form label-width="72px" label-position="right" class="scheme-form" @submit.prevent>
          <el-form-item label="名称">
            <el-input
              v-model="activeScheme.name"
              placeholder="纯英文，允许 _ - 数字，字母开头"
            />
          </el-form-item>
          <el-form-item label="说明">
            <el-input
              v-model="activeScheme.description"
              type="textarea"
              :rows="2"
              placeholder="可选"
            />
          </el-form-item>
          <el-form-item label="后端">
            <div class="field-block">
              <div class="field-toolbar">
                <div class="card-actions">
                  <el-button class="add-link" link :icon="Plus" @click="openBackendEdit(-1)">
                    添加服务
                  </el-button>
                </div>
              </div>
              <div
                v-for="(b, i) in activeScheme.backends"
                :key="b.name + i"
                class="card"
              >
                <div class="card-main">
                  <strong>{{ b.name }}</strong>
                  <span class="muted">
                    <FrameworkTypeIcon :type="b.type || 'nestjs'" />
                    <span>
                      {{ b.type === 'nestjs' ? 'Nest.js' : b.type }} :{{ b.port }}
                      · {{ b.moduleIds.length }} 个模块
                      <template v-if="b.includeOss"> · OSS</template>
                    </span>
                  </span>
                </div>
                <div class="card-actions">
                  <el-button type="primary" link :icon="Edit" @click="openBackendEdit(i)">
                    编辑
                  </el-button>
                  <el-button
                    type="danger"
                    link
                    :icon="Delete"
                    @click="removeBackend(i)"
                  />
                </div>
              </div>
              <div v-if="!activeScheme.backends.length" class="field-empty">
                暂无后端服务，请添加
              </div>
            </div>
          </el-form-item>
          <el-form-item label="前端">
            <div class="field-block">
              <div class="field-toolbar">
                <div class="card-actions">
                  <el-button class="add-link" link :icon="Plus" @click="openFrontendEdit(-1)">
                    添加应用
                  </el-button>
                </div>
              </div>
              <div
                v-for="(f, i) in activeScheme.frontends"
                :key="f.name + i"
                class="card"
              >
                <div class="card-main">
                  <strong>{{ f.name }}</strong>
                  <span class="muted">
                    <FrameworkTypeIcon :type="f.type || 'vue3'" />
                    <span>
                      {{ f.type === 'vue3' ? `Vue3 :${f.port}` : '微信小程序' }}
                      · {{ f.pageIds.length }} 页
                    </span>
                  </span>
                </div>
                <div class="card-actions">
                  <el-button type="primary" link :icon="Edit" @click="openFrontendEdit(i)">
                    编辑
                  </el-button>
                  <el-button
                    type="danger"
                    link
                    :icon="Delete"
                    @click="removeFrontend(i)"
                  />
                </div>
              </div>
              <div v-if="!activeScheme.frontends.length" class="field-empty">
                可选：添加 Vue3 / 微信小程序应用
              </div>
            </div>
          </el-form-item>
        </el-form>
      </div>
    </div>

    <template #footer>
      <el-button type="primary" :loading="saving" @click="handleSave">
        保存
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="backendEditVisible"
    :title="backendEditIndex < 0 ? '添加后端服务' : '编辑后端服务'"
    width="480px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form label-width="88px" @submit.prevent>
      <el-form-item label="服务名">
        <el-input v-model="backendDraft.name" placeholder="如 service1" />
      </el-form-item>
      <el-form-item label="端口">
        <el-input-number
          v-model="backendDraft.port"
          :min="1"
          :max="65535"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="框架">
        <el-radio-group v-model="backendDraft.type">
          <el-radio value="nestjs">
            <span class="type-option">
              <FrameworkTypeIcon type="nestjs" />
              Nest.js
            </span>
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="模块">
        <el-checkbox-group v-model="backendDraft.moduleIds" class="module-checks">
          <el-checkbox
            v-for="m in modules"
            :key="m.id"
            :label="m.id"
            :disabled="moduleDisabled(m.id) && !backendDraft.moduleIds.includes(m.id)"
          >
            {{ m.name }}
            <span class="muted">（{{ m.id }}）</span>
          </el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-form-item label="OSS">
        <el-checkbox v-model="backendDraft.includeOss">
          在本服务挂载 OSS 模块
        </el-checkbox>
        <div class="field-hint">
          提供 <code>POST /oss/sign</code>；同一构建方案只能选一个服务
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button type="primary" @click="saveBackendDraft">确定</el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="frontendEditVisible"
    :title="frontendEditIndex < 0 ? '添加前端应用' : '编辑前端应用'"
    width="480px"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <el-form label-width="100px" @submit.prevent>
      <el-form-item label="应用名">
        <el-input v-model="frontendDraft.name" placeholder="如 app1" />
      </el-form-item>
      <el-form-item label="类型">
        <el-radio-group v-model="frontendDraft.type">
          <el-radio value="vue3">
            <span class="type-option">
              <FrameworkTypeIcon type="vue3" />
              Vue3
            </span>
          </el-radio>
          <el-radio value="mp-wx">
            <span class="type-option">
              <FrameworkTypeIcon type="mp-wx" />
              微信小程序
            </span>
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="frontendDraft.type === 'vue3'" label="端口">
        <el-input-number
          v-model="frontendDraft.port"
          :min="1"
          :max="65535"
          controls-position="right"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item v-if="frontendDraft.type === 'mp-wx'" label="微信 AppID">
        <el-input
          v-model="frontendDraft.wechatAppId"
          placeholder="例如 wx1234567890abcdef"
        />
      </el-form-item>
      <el-form-item label="页面">
        <el-select
          v-model="frontendDraft.pageIds"
          multiple
          filterable
          placeholder="选择页面"
          style="width: 100%"
        >
          <el-option
            v-for="p in pages"
            :key="p.id"
            :label="`${p.title || p.id}（${p.id}）`"
            :value="p.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="入口页">
        <el-select
          v-model="frontendDraft.entryPage"
          filterable
          placeholder="从已选页面中选择入口页"
          style="width: 100%"
          :disabled="!frontendDraft.pageIds.length"
        >
          <el-option
            v-for="p in frontendEntryOptions"
            :key="p.id"
            :label="`${p.title || p.id}（${p.id}）`"
            :value="p.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button type="primary" @click="saveFrontendDraft">确定</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.body {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 16px;
  min-height: 420px;
}
.scheme-list {
  border-right: 1px solid #ebeef5;
  padding-right: 12px;
}
.aside-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-weight: 600;
}
.scheme-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.scheme-item:hover {
  background: #f5f7fa;
}
.scheme-item.active {
  background: #ecf5ff;
  color: #409eff;
}
.scheme-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scheme-editor {
  min-width: 0;
}
.scheme-form :deep(.el-form-item) {
  align-items: flex-start;
  margin-bottom: 18px;
}
.scheme-form :deep(.el-form-item__label) {
  color: #606266;
  line-height: 32px;
}
.scheme-form :deep(.el-form-item__content) {
  min-width: 0;
}
.field-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.field-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 32px;
  margin-top: -2px;
  /* 与下方卡片左右内边距一致，保证操作列起点对齐 */
  padding: 0 12px;
}
.field-empty {
  padding: 12px 14px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  color: #909399;
  font-size: 13px;
  background: #fafafa;
}
.field-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
}
.field-hint code {
  font-size: 11px;
  padding: 0 4px;
  border-radius: 3px;
  background: #f2f3f5;
  color: #606266;
}
.card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}
.card-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.card-actions {
  flex-shrink: 0;
  width: 7.5rem;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
}
.add-link,
.add-link:hover,
.add-link:focus {
  color: #303133 !important;
}
.muted {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #909399;
  font-size: 12px;
}
.type-option {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.module-checks {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
</style>
