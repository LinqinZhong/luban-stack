<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import ColorPicker from './ColorPicker.vue'
import NumericInput from './NumericInput.vue'
import {
  findNodeFromXml,
  findParentTagFromXml,
  GRAVITY_OPTIONS,
  IMAGE_LOADING_OPTIONS,
  IMAGE_OBJECT_FIT_OPTIONS,
  INTERACTION_EVENTS,
  ORIENTATION_OPTIONS,
  RELATIVE_BOOL_ATTRS,
  setNodeAttribute,
  setNodeAttributes,
  SIZE_OPTIONS,
  type InteractionEventKey,
} from '../../utils/xml-node'

export type PropsTab = 'style' | 'event' | 'dynamic'

const props = defineProps<{
  tab: PropsTab
  xml: string
  selectedId: string
  dataFields?: Array<{ name: string; type: string }>
  /** 自增请求：切换到动态并打开重复弹窗 */
  openRepeatRequest?: number
}>()

const emit = defineEmits<{
  'update:xml': [xml: string]
  'update:tab': [tab: PropsTab]
}>()

const selectedNode = computed(() =>
  props.selectedId ? findNodeFromXml(props.xml, props.selectedId) : null,
)

/** 根节点不可配置重复（v-for） */
const isRootNode = computed(() => Boolean(props.selectedId) && !props.selectedId.includes('/'))

const parentTag = computed(() =>
  props.selectedId ? findParentTagFromXml(props.xml, props.selectedId) : null,
)

const isRelativeChild = computed(() => parentTag.value === 'RelativeLayout')

const eventForm = reactive<Record<InteractionEventKey, string>>({
  onClick: '',
  onLongClick: '',
  onAppear: '',
})

const layoutForm = reactive({
  widthMode: 'wrap_content' as string,
  widthValue: 100,
  heightMode: 'wrap_content' as string,
  heightValue: 40,
  margin: '',
  marginLeft: '',
  marginRight: '',
  marginTop: '',
  marginBottom: '',
  padding: '',
  paddingLeft: '',
  paddingRight: '',
  paddingTop: '',
  paddingBottom: '',
  background: '',
  borderRadius: '',
  borderWidth: '',
  borderColor: '',
  gravity: '',
  orientation: 'vertical',
  gap: '',
  text: '',
  textSize: '',
  textColor: '',
  src: '',
  alt: '',
  title: '',
  objectFit: 'cover',
  loading: '',
  layout_alignParentLeft: false,
  layout_alignParentRight: false,
  layout_alignParentTop: false,
  layout_alignParentBottom: false,
  layout_centerInParent: false,
  layout_centerHorizontal: false,
  layout_centerVertical: false,
  layout_marginLeft: '',
  layout_marginTop: '',
  layout_marginRight: '',
  layout_marginBottom: '',
})

function parseSizeMode(value: string | undefined, fallbackValue: number) {
  if (!value || value === 'wrap_content') {
    return { mode: 'wrap_content', value: fallbackValue }
  }
  if (value === 'match_parent') {
    return { mode: 'match_parent', value: fallbackValue }
  }
  const num = Number(String(value).replace(/px$/i, ''))
  return {
    mode: 'fixed',
    value: Number.isFinite(num) ? num : fallbackValue,
  }
}

function sizeToAttr(mode: string, value: number | string): string {
  if (mode === 'match_parent' || mode === 'wrap_content') return mode
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : '0'
}

function syncLayoutForm() {
  const node = selectedNode.value
  if (!node) return

  const width = parseSizeMode(node.attrs.width, 100)
  const height = parseSizeMode(node.attrs.height, 40)

  layoutForm.widthMode = width.mode
  layoutForm.widthValue = width.value
  layoutForm.heightMode = height.mode
  layoutForm.heightValue = height.value
  layoutForm.margin = node.attrs.margin ?? ''
  layoutForm.marginLeft = node.attrs.marginLeft ?? ''
  layoutForm.marginRight = node.attrs.marginRight ?? ''
  layoutForm.marginTop = node.attrs.marginTop ?? ''
  layoutForm.marginBottom = node.attrs.marginBottom ?? ''
  layoutForm.padding = node.attrs.padding ?? ''
  layoutForm.paddingLeft = node.attrs.paddingLeft ?? ''
  layoutForm.paddingRight = node.attrs.paddingRight ?? ''
  layoutForm.paddingTop = node.attrs.paddingTop ?? ''
  layoutForm.paddingBottom = node.attrs.paddingBottom ?? ''
  layoutForm.background = node.attrs.background ?? ''
  layoutForm.borderRadius = node.attrs.borderRadius ?? ''
  layoutForm.borderWidth = node.attrs.borderWidth ?? ''
  layoutForm.borderColor = node.attrs.borderColor ?? ''
  layoutForm.gravity = node.attrs.gravity ?? ''
  layoutForm.orientation = node.attrs.orientation || 'vertical'
  layoutForm.gap = node.attrs.gap ?? ''
  layoutForm.text = node.attrs.text ?? node.text ?? ''
  layoutForm.textSize = node.attrs.textSize ?? ''
  layoutForm.textColor = node.attrs.textColor ?? ''
  layoutForm.src = node.attrs.src ?? ''
  layoutForm.alt = node.attrs.alt ?? ''
  layoutForm.title = node.attrs.title ?? ''
  layoutForm.objectFit = node.attrs.objectFit || 'cover'
  layoutForm.loading = node.attrs.loading ?? ''

  for (const item of RELATIVE_BOOL_ATTRS) {
    layoutForm[item.key] = node.attrs[item.key] === 'true'
  }
  layoutForm.layout_marginLeft = node.attrs.layout_marginLeft ?? ''
  layoutForm.layout_marginTop = node.attrs.layout_marginTop ?? ''
  layoutForm.layout_marginRight = node.attrs.layout_marginRight ?? ''
  layoutForm.layout_marginBottom = node.attrs.layout_marginBottom ?? ''
}

watch(
  selectedNode,
  (node) => {
    for (const event of INTERACTION_EVENTS) {
      eventForm[event.key] = node?.attrs[event.key] ?? ''
    }
    syncLayoutForm()
  },
  { immediate: true },
)

watch(
  () => props.xml,
  () => {
    if (props.tab === 'style') syncLayoutForm()
  },
)

function commitAttr(name: string, value: string) {
  if (!props.selectedId || !selectedNode.value) return
  try {
    const next = setNodeAttribute(props.xml, props.selectedId, name, value.trim())
    emit('update:xml', next)
  } catch (err) {
    console.error(err)
  }
}

function commitEvent(key: InteractionEventKey) {
  commitAttr(key, eventForm[key])
}

function commitWidth() {
  const value = Number(layoutForm.widthValue)
  commitAttr(
    'width',
    sizeToAttr(layoutForm.widthMode, Number.isFinite(value) ? value : 100),
  )
}

function commitHeight() {
  const value = Number(layoutForm.heightValue)
  commitAttr(
    'height',
    sizeToAttr(layoutForm.heightMode, Number.isFinite(value) ? value : 40),
  )
}

function commitRelativeBool(key: (typeof RELATIVE_BOOL_ATTRS)[number]['key']) {
  commitAttr(key, layoutForm[key] ? 'true' : '')
}

const showTextProps = computed(
  () => selectedNode.value?.tag === 'Text' || selectedNode.value?.tag === 'Button',
)

const showImageProps = computed(() => selectedNode.value?.tag === 'Image')

const showLinearProps = computed(() => selectedNode.value?.tag === 'LinearLayout')

const showLayoutContainerProps = computed(
  () =>
    selectedNode.value?.tag === 'LinearLayout' ||
    selectedNode.value?.tag === 'RelativeLayout' ||
    selectedNode.value?.tag === 'Image',
)

const arrayFieldOptions = computed(() =>
  (props.dataFields ?? [])
    .filter((field) => field.type === 'array' && field.name.trim())
    .map((field) => field.name.trim()),
)

const repeatSummary = computed(() => {
  const node = selectedNode.value
  if (!node) return ''
  const list = node.attrs.repeat?.trim()
  if (!list) return '未配置'
  const index = node.attrs.repeatIndex?.trim()
  return index ? `${list}[${index}]` : list
})

const repeatDialogVisible = ref(false)
const repeatForm = reactive({
  list: '',
  index: '',
})

function openRepeatDialog() {
  const node = selectedNode.value
  if (!node || isRootNode.value) return
  repeatForm.list = node.attrs.repeat ?? ''
  repeatForm.index = node.attrs.repeatIndex ?? ''
  repeatDialogVisible.value = true
}

watch(
  () => props.openRepeatRequest,
  async (request) => {
    if (!request) return
    emit('update:tab', 'dynamic')
    await nextTick()
    openRepeatDialog()
  },
)

function saveRepeatConfig() {
  if (!props.selectedId || !selectedNode.value || isRootNode.value) return
  try {
    const next = setNodeAttributes(props.xml, props.selectedId, {
      repeat: repeatForm.list.trim(),
      repeatIndex: repeatForm.index.trim(),
    })
    emit('update:xml', next)
    repeatDialogVisible.value = false
  } catch (err) {
    console.error(err)
  }
}

function clearRepeatConfig() {
  if (!props.selectedId || !selectedNode.value || isRootNode.value) return
  try {
    const next = setNodeAttributes(props.xml, props.selectedId, {
      repeat: '',
      repeatIndex: '',
    })
    emit('update:xml', next)
    repeatDialogVisible.value = false
  } catch (err) {
    console.error(err)
  }
}
</script>

<template>
  <aside class="props-panel">
    <div class="panel-header">
      <span>属性</span>
      <el-radio-group
        :model-value="tab"
        size="small"
        class="panel-tabs"
        @update:model-value="emit('update:tab', $event as PropsTab)"
      >
        <el-radio-button value="style">样式</el-radio-button>
        <el-radio-button value="event">事件</el-radio-button>
        <el-radio-button value="dynamic">动态</el-radio-button>
      </el-radio-group>
    </div>

    <div class="panel-body">
      <template v-if="tab === 'style'">
        <el-empty
          v-if="!selectedNode"
          description="请在控件树中选择节点"
          :image-size="64"
        />
        <div v-else class="layout-form">
          <div class="node-brief">
            <div class="node-tag">{{ selectedNode.tag }}</div>
            <div class="node-id">{{ selectedId }}</div>
          </div>

          <div class="section-title">尺寸</div>
          <el-form label-position="top" size="small">
            <el-form-item label="宽度 width">
              <div class="size-row">
                <el-select v-model="layoutForm.widthMode" @change="commitWidth">
                  <el-option
                    v-for="opt in SIZE_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <NumericInput
                  v-if="layoutForm.widthMode === 'fixed'"
                  v-model="layoutForm.widthValue"
                  :min="1"
                  :max="5000"
                  @change="commitWidth"
                />
              </div>
            </el-form-item>

            <el-form-item label="高度 height">
              <div class="size-row">
                <el-select v-model="layoutForm.heightMode" @change="commitHeight">
                  <el-option
                    v-for="opt in SIZE_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <NumericInput
                  v-if="layoutForm.heightMode === 'fixed'"
                  v-model="layoutForm.heightValue"
                  :min="1"
                  :max="5000"
                  @change="commitHeight"
                />
              </div>
            </el-form-item>
          </el-form>

          <div class="section-title">间距</div>
          <el-form label-position="top" size="small">
            <el-form-item label="padding">
              <NumericInput
                v-model="layoutForm.padding"
                placeholder="例如：16"
                @change="commitAttr('padding', layoutForm.padding)"
              />
            </el-form-item>
            <div class="quad-grid">
              <el-form-item label="上">
                <NumericInput
                  v-model="layoutForm.paddingTop"
                  @change="commitAttr('paddingTop', layoutForm.paddingTop)"
                />
              </el-form-item>
              <el-form-item label="右">
                <NumericInput
                  v-model="layoutForm.paddingRight"
                  @change="commitAttr('paddingRight', layoutForm.paddingRight)"
                />
              </el-form-item>
              <el-form-item label="下">
                <NumericInput
                  v-model="layoutForm.paddingBottom"
                  @change="commitAttr('paddingBottom', layoutForm.paddingBottom)"
                />
              </el-form-item>
              <el-form-item label="左">
                <NumericInput
                  v-model="layoutForm.paddingLeft"
                  @change="commitAttr('paddingLeft', layoutForm.paddingLeft)"
                />
              </el-form-item>
            </div>

            <el-form-item label="margin">
              <NumericInput
                v-model="layoutForm.margin"
                placeholder="例如：8"
                @change="commitAttr('margin', layoutForm.margin)"
              />
            </el-form-item>
            <div class="quad-grid">
              <el-form-item label="上">
                <NumericInput
                  v-model="layoutForm.marginTop"
                  @change="commitAttr('marginTop', layoutForm.marginTop)"
                />
              </el-form-item>
              <el-form-item label="右">
                <NumericInput
                  v-model="layoutForm.marginRight"
                  @change="commitAttr('marginRight', layoutForm.marginRight)"
                />
              </el-form-item>
              <el-form-item label="下">
                <NumericInput
                  v-model="layoutForm.marginBottom"
                  @change="commitAttr('marginBottom', layoutForm.marginBottom)"
                />
              </el-form-item>
              <el-form-item label="左">
                <NumericInput
                  v-model="layoutForm.marginLeft"
                  @change="commitAttr('marginLeft', layoutForm.marginLeft)"
                />
              </el-form-item>
            </div>
          </el-form>

          <div class="section-title">外观</div>
          <el-form label-position="top" size="small">
            <el-form-item label="background">
              <ColorPicker
                v-model="layoutForm.background"
                placeholder="transparent"
                @change="commitAttr('background', layoutForm.background)"
              />
            </el-form-item>
            <el-form-item label="gravity">
              <el-select
                v-model="layoutForm.gravity"
                clearable
                placeholder="默认"
                @change="commitAttr('gravity', layoutForm.gravity)"
              >
                <el-option
                  v-for="opt in GRAVITY_OPTIONS"
                  :key="opt.value || 'default'"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
            <template v-if="showLayoutContainerProps">
              <el-form-item label="borderRadius">
                <NumericInput
                  v-model="layoutForm.borderRadius"
                  placeholder="圆角"
                  @change="commitAttr('borderRadius', layoutForm.borderRadius)"
                />
              </el-form-item>
              <el-form-item label="borderWidth">
                <NumericInput
                  v-model="layoutForm.borderWidth"
                  placeholder="边框宽度"
                  @change="commitAttr('borderWidth', layoutForm.borderWidth)"
                />
              </el-form-item>
              <el-form-item label="borderColor">
                <ColorPicker
                  v-model="layoutForm.borderColor"
                  placeholder="#dcdfe6"
                  @change="commitAttr('borderColor', layoutForm.borderColor)"
                />
              </el-form-item>
            </template>
          </el-form>

          <template v-if="showTextProps">
            <div class="section-title">内容</div>
            <el-form label-position="top" size="small">
              <el-form-item label="text">
                <el-input
                  v-model="layoutForm.text"
                  clearable
                  @change="commitAttr('text', layoutForm.text)"
                />
              </el-form-item>
              <el-form-item label="textSize">
                <NumericInput
                  v-model="layoutForm.textSize"
                  placeholder="例如：16"
                  :min="1"
                  :max="200"
                  @change="commitAttr('textSize', layoutForm.textSize)"
                />
              </el-form-item>
              <el-form-item label="textColor">
                <ColorPicker
                  v-model="layoutForm.textColor"
                  placeholder="#303133"
                  @change="commitAttr('textColor', layoutForm.textColor)"
                />
              </el-form-item>
            </el-form>
          </template>

          <template v-if="showImageProps">
            <div class="section-title">图片</div>
            <el-form label-position="top" size="small">
              <el-form-item label="src">
                <el-input
                  v-model="layoutForm.src"
                  clearable
                  placeholder="图片 URL"
                  @change="commitAttr('src', layoutForm.src)"
                />
              </el-form-item>
              <el-form-item label="alt">
                <el-input
                  v-model="layoutForm.alt"
                  clearable
                  placeholder="替代文本"
                  @change="commitAttr('alt', layoutForm.alt)"
                />
              </el-form-item>
              <el-form-item label="title">
                <el-input
                  v-model="layoutForm.title"
                  clearable
                  placeholder="悬停提示"
                  @change="commitAttr('title', layoutForm.title)"
                />
              </el-form-item>
              <el-form-item label="objectFit">
                <el-select
                  v-model="layoutForm.objectFit"
                  clearable
                  placeholder="默认 cover"
                  @change="commitAttr('objectFit', layoutForm.objectFit)"
                >
                  <el-option
                    v-for="opt in IMAGE_OBJECT_FIT_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="loading">
                <el-select
                  v-model="layoutForm.loading"
                  clearable
                  placeholder="默认 eager"
                  @change="commitAttr('loading', layoutForm.loading)"
                >
                  <el-option
                    v-for="opt in IMAGE_LOADING_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-form-item>
            </el-form>
          </template>

          <template v-if="showLinearProps">
            <div class="section-title">线性布局</div>
            <el-form label-position="top" size="small">
              <el-form-item label="orientation">
                <el-select
                  v-model="layoutForm.orientation"
                  @change="commitAttr('orientation', layoutForm.orientation)"
                >
                  <el-option
                    v-for="opt in ORIENTATION_OPTIONS"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="gap">
                <NumericInput
                  v-model="layoutForm.gap"
                  placeholder="子项间距"
                  @change="commitAttr('gap', layoutForm.gap)"
                />
              </el-form-item>
            </el-form>
          </template>

          <template v-if="isRelativeChild">
            <div class="section-title">相对布局定位</div>
            <el-form label-position="top" size="small">
              <el-form-item
                v-for="item in RELATIVE_BOOL_ATTRS"
                :key="item.key"
                :label="item.label"
              >
                <el-switch
                  v-model="layoutForm[item.key]"
                  @change="commitRelativeBool(item.key)"
                />
              </el-form-item>

              <div class="quad-grid">
                <el-form-item label="layout_marginTop">
                  <NumericInput
                    v-model="layoutForm.layout_marginTop"
                    @change="commitAttr('layout_marginTop', layoutForm.layout_marginTop)"
                  />
                </el-form-item>
                <el-form-item label="layout_marginRight">
                  <NumericInput
                    v-model="layoutForm.layout_marginRight"
                    @change="commitAttr('layout_marginRight', layoutForm.layout_marginRight)"
                  />
                </el-form-item>
                <el-form-item label="layout_marginBottom">
                  <NumericInput
                    v-model="layoutForm.layout_marginBottom"
                    @change="commitAttr('layout_marginBottom', layoutForm.layout_marginBottom)"
                  />
                </el-form-item>
                <el-form-item label="layout_marginLeft">
                  <NumericInput
                    v-model="layoutForm.layout_marginLeft"
                    @change="commitAttr('layout_marginLeft', layoutForm.layout_marginLeft)"
                  />
                </el-form-item>
              </div>
            </el-form>
          </template>
        </div>
      </template>

      <template v-else-if="tab === 'event'">
        <el-empty
          v-if="!selectedNode"
          description="请在控件树中选择节点"
          :image-size="64"
        />
        <div v-else class="interact-form">
          <div class="node-brief">
            <div class="node-tag">{{ selectedNode.tag }}</div>
            <div class="node-id">{{ selectedId }}</div>
          </div>

          <div class="section-title">事件列表</div>

          <el-form label-position="top" size="small">
            <el-form-item
              v-for="event in INTERACTION_EVENTS"
              :key="event.key"
              :label="event.label"
            >
              <el-input
                v-model="eventForm[event.key]"
                placeholder="例如：navigate:login"
                clearable
                @change="commitEvent(event.key)"
              />
            </el-form-item>
          </el-form>
        </div>
      </template>

      <template v-else>
        <el-empty
          v-if="!selectedNode"
          description="请在控件树中选择节点"
          :image-size="64"
        />
        <div v-else class="dynamic-form">
          <div class="node-brief">
            <div class="node-tag">{{ selectedNode.tag }}</div>
            <div class="node-id">{{ selectedId }}</div>
          </div>

          <el-alert
            v-if="isRootNode"
            type="info"
            :closable="false"
            show-icon
            title="根节点不支持重复配置"
          />
          <template v-else>
            <div class="section-title">列表渲染</div>
            <el-form label-position="top" size="small">
              <el-form-item label="重复">
                <div class="repeat-row">
                  <span class="repeat-summary">{{ repeatSummary }}</span>
                  <el-button type="primary" link @click="openRepeatDialog">配置</el-button>
                </div>
              </el-form-item>
            </el-form>
            <p class="hint">
              类似 Vue 的 v-for：预览时按绑定数组展开当前节点。文本中写
              <code>{'{item.字段名}'}</code>
              才会替换为列表项数据，其他内容原样显示；也可用
              <code>{'{index}'}</code>。
            </p>
          </template>
        </div>
      </template>
    </div>

    <el-dialog
      v-model="repeatDialogVisible"
      title="重复配置"
      width="420px"
      destroy-on-close
      append-to-body
    >
      <el-form label-position="top" size="default">
        <el-form-item label="绑定数组">
          <el-select
            v-model="repeatForm.list"
            clearable
            filterable
            placeholder="选择数据池中的数组字段"
          >
            <el-option
              v-for="name in arrayFieldOptions"
              :key="name"
              :label="name"
              :value="name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="索引">
          <el-input
            v-model="repeatForm.index"
            clearable
            placeholder="可不填，按数组项顺序"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="clearRepeatConfig">清除</el-button>
        <el-button @click="repeatDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRepeatConfig">确定</el-button>
      </template>
    </el-dialog>
  </aside>
</template>

<style scoped>
.props-panel {
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
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.panel-tabs {
  flex-shrink: 0;
}

.panel-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.layout-form,
.interact-form,
.dynamic-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.repeat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.repeat-summary {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #94a3b8;
}

.node-brief {
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 6px;
}

.node-tag {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.node-id {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
  word-break: break-all;
}

.section-title {
  margin: 8px 0;
  font-size: 13px;
  font-weight: 600;
  color: #606266;
}

.size-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.quad-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 8px;
}

:deep(.el-form-item) {
  margin-bottom: 12px;
}

:deep(.el-select) {
  width: 100%;
}
</style>
