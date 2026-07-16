<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import ColorPicker from './ColorPicker.vue'
import DynamicStyleStateDialog from './DynamicStyleStateDialog.vue'
import EventBindDialog from './EventBindDialog.vue'
import NumericInput from './NumericInput.vue'
import VisibilityConditionDialog from './VisibilityConditionDialog.vue'
import { countEventBindings, type MethodParam, type PageMethod } from '../../types/page-method'
import {
  findNodeFromXml,
  findParentTagFromXml,
  GRAVITY_OPTIONS,
  IMAGE_LOADING_OPTIONS,
  IMAGE_OBJECT_FIT_OPTIONS,
  INTERACTION_EVENTS,
  ORIENTATION_OPTIONS,
  RELATIVE_BOOL_ATTRS,
  SCROLL_INTERACTION_EVENT,
  setNodeAttribute,
  setNodeAttributes,
  SIZE_OPTIONS,
} from '../../utils/xml-node'
import { ElMessage } from 'element-plus'
import { OVERFLOW_OPTIONS } from '../../utils/xml'
import type { DataField } from '../../types/page-data'
import {
  DYNAMIC_STYLES_ATTR,
  V_IF_ATTR,
  V_SHOW_ATTR,
  createEmptyState,
  createEmptyVisibilityConfig,
  parseDynamicStyles,
  parseVisibilityConditions,
  serializeDynamicStyles,
  serializeVisibilityConditions,
  type DynamicStyleState,
  type DynamicStylesConfig,
  type VisibilityConditionConfig,
} from '../../types/dynamic-styles'
import {
  findNearestRepeatListName,
  listRepeatItemIconOptions,
} from '../../utils/data-field-paths'
import IconValueSelect from './IconValueSelect.vue'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentPropDef } from '../../types/component'
import { DATA_FIELD_TYPE_OPTIONS } from '../../types/page-data'

export type PropsTab = 'style' | 'event' | 'dynamic'

const props = defineProps<{
  tab: PropsTab
  xml: string
  selectedId: string
  dataFields?: DataField[]
  iconOptions?: Array<{ id: string; label: string }>
  methods?: PageMethod[]
  /** 当前组件的事件方法定义（绑定 emit 时用） */
  emitEvents?: import('../../types/component').ComponentEventDef[]
  /** 编辑组件资源时的参数定义（条件/动态样式可选 $props；传数组含空） */
  componentProps?: ComponentPropDef[] | null
  /** 当前路由参数（可选 $route） */
  routeParams?: Record<string, unknown> | null
  /** 页面中引用的组件（用于配置组件入参） */
  componentMap?: ComponentRenderMap
  /** 各组件方法列表（引用类型 ambient / 暴露方法签名） */
  componentMethodsMap?: import('../../utils/widget-ref').ComponentMethodsMap
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

const isRelativeChild = computed(
  () =>
    (parentTag.value === 'RelativeLayout' || parentTag.value === 'Modal') &&
    selectedNode.value?.tag !== 'Modal',
)

const isComponentNode = computed(() => selectedNode.value?.tag === 'Component')

const selectedComponentDetail = computed(() => {
  if (!isComponentNode.value || !selectedNode.value) return null
  const id = selectedNode.value.attrs.componentId?.trim()
  if (!id || !props.componentMap) return null
  return props.componentMap[id] ?? null
})

/** 事件 Tab 展示的事件：普通控件为内置交互；Component 为其「事件方法」定义 */
const selectableEvents = computed(() => {
  if (isComponentNode.value) {
    const events = selectedComponentDetail.value?.config.events ?? []
    return events
      .map((item) => {
        const name = item.name.trim()
        if (!name) return null
        const params = (item.params ?? [])
          .filter((p) => p.name.trim())
          .map((p) => `${p.name.trim()}: ${p.type}`)
          .join(', ')
        return {
          key: name,
          label: params ? `${name}(${params})` : name,
        }
      })
      .filter((item): item is { key: string; label: string } => Boolean(item))
  }
  const list = INTERACTION_EVENTS.map((item) => ({
    key: item.key,
    label: item.label,
  }))
  // 可滚动布局才展示滚动事件
  const overflow = selectedNode.value?.attrs.overflow?.trim().toLowerCase()
  const tag = selectedNode.value?.tag
  if (
    overflow === 'scroll' &&
    (tag === 'LinearLayout' || tag === 'RelativeLayout')
  ) {
    list.push({
      key: SCROLL_INTERACTION_EVENT.key,
      label: SCROLL_INTERACTION_EVENT.label,
    })
  }
  return list
})

const eventForm = reactive<Record<string, string>>({})

function syncEventForm() {
  const node = selectedNode.value
  const keys = selectableEvents.value.map((item) => item.key)
  for (const key of Object.keys(eventForm)) {
    if (!keys.includes(key)) delete eventForm[key]
  }
  for (const key of keys) {
    eventForm[key] = node?.attrs[key] ?? ''
  }
}

const layoutForm = reactive({
  name: '',
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
  borderTopLeftRadius: '',
  borderTopRightRadius: '',
  borderBottomRightRadius: '',
  borderBottomLeftRadius: '',
  borderWidth: '',
  borderColor: '',
  overflow: 'hidden',
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
  iconId: '',
  size: '',
  color: '',
  autoplay: false,
  circular: true,
  indicatorDots: true,
  interval: '3000',
  duration: '280',
  current: '0',
  indicatorColor: '',
  indicatorActiveColor: '',
  closeOnClick: true,
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
  layoutForm.name = node.attrs.name ?? ''
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
  layoutForm.borderTopLeftRadius = node.attrs.borderTopLeftRadius ?? ''
  layoutForm.borderTopRightRadius = node.attrs.borderTopRightRadius ?? ''
  layoutForm.borderBottomRightRadius = node.attrs.borderBottomRightRadius ?? ''
  layoutForm.borderBottomLeftRadius = node.attrs.borderBottomLeftRadius ?? ''
  layoutForm.borderWidth = node.attrs.borderWidth ?? ''
  layoutForm.borderColor = node.attrs.borderColor ?? ''
  layoutForm.overflow = node.attrs.overflow || 'hidden'
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
  layoutForm.iconId = node.attrs.iconId ?? ''
  layoutForm.size = node.attrs.size ?? ''
  layoutForm.color = node.attrs.color ?? ''
  layoutForm.autoplay = node.attrs.autoplay === 'true'
  layoutForm.circular =
    node.attrs.circular == null ||
    node.attrs.circular === '' ||
    node.attrs.circular === 'true'
  layoutForm.indicatorDots =
    node.attrs.indicatorDots == null ||
    node.attrs.indicatorDots === '' ||
    node.attrs.indicatorDots === 'true'
  layoutForm.interval = node.attrs.interval ?? '3000'
  layoutForm.duration = node.attrs.duration ?? '280'
  layoutForm.current = node.attrs.current ?? '0'
  layoutForm.indicatorColor = node.attrs.indicatorColor ?? ''
  layoutForm.indicatorActiveColor = node.attrs.indicatorActiveColor ?? ''
  layoutForm.closeOnClick =
    node.attrs.closeOnClick == null ||
    node.attrs.closeOnClick === '' ||
    node.attrs.closeOnClick === 'true'

  for (const item of RELATIVE_BOOL_ATTRS) {
    layoutForm[item.key] = node.attrs[item.key] === 'true'
  }
  layoutForm.layout_marginLeft = node.attrs.layout_marginLeft ?? ''
  layoutForm.layout_marginTop = node.attrs.layout_marginTop ?? ''
  layoutForm.layout_marginRight = node.attrs.layout_marginRight ?? ''
  layoutForm.layout_marginBottom = node.attrs.layout_marginBottom ?? ''
}

watch(
  [selectedNode, selectableEvents],
  () => {
    syncEventForm()
    syncLayoutForm()
    void nextTick(() => stripModalLayoutAttrsIfNeeded())
  },
  { immediate: true },
)

watch(
  () => props.xml,
  () => {
    if (props.tab === 'style') syncLayoutForm()
    if (props.tab === 'event') syncEventForm()
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

function eventBindingSummary(key: string): string {
  const count = countEventBindings(eventForm[key])
  if (!count) return '未配置'
  return `已绑定 ${count} 个方法`
}

const eventBindVisible = ref(false)
const eventBindKey = ref('onClick')
const eventBindLabel = ref('')
const eventBindParams = ref<MethodParam[]>([])

function openEventBind(key: string, label: string) {
  eventBindKey.value = key
  eventBindLabel.value = label
  if (isComponentNode.value) {
    const def = (selectedComponentDetail.value?.config.events ?? []).find(
      (item) => item.name.trim() === key,
    )
    eventBindParams.value = (def?.params ?? [])
      .filter((item) => item.name.trim())
      .map((item) => ({ name: item.name.trim(), type: item.type }))
  } else if (key === 'onScroll') {
    eventBindParams.value = [
      { name: 'scrollTop', type: 'number' },
      { name: 'scrollLeft', type: 'number' },
      { name: 'scrollHeight', type: 'number' },
      { name: 'scrollWidth', type: 'number' },
      { name: 'clientHeight', type: 'number' },
      { name: 'clientWidth', type: 'number' },
    ]
  } else {
    eventBindParams.value = []
  }
  eventBindVisible.value = true
}

function handleEventBindSave(value: string) {
  eventForm[eventBindKey.value] = value
  commitAttr(eventBindKey.value, value)
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

const showIconProps = computed(() => selectedNode.value?.tag === 'Icon')

const showSwiperProps = computed(() => selectedNode.value?.tag === 'Swiper')
const showModalProps = computed(() => selectedNode.value?.tag === 'Modal')

/** Modal 始终全屏，不展示也不写入宽高 / margin */
const showSizeProps = computed(() => selectedNode.value?.tag !== 'Modal')
const showMarginProps = computed(() => selectedNode.value?.tag !== 'Modal')

const MODAL_IGNORED_LAYOUT_ATTRS = [
  'width',
  'height',
  'margin',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'gravity',
] as const

function stripModalLayoutAttrsIfNeeded() {
  const node = selectedNode.value
  if (!node || node.tag !== 'Modal' || !props.selectedId) return
  const stale = MODAL_IGNORED_LAYOUT_ATTRS.filter((key) => node.attrs[key])
  if (!stale.length) return
  let next = props.xml
  for (const key of stale) {
    next = setNodeAttribute(next, props.selectedId, key, '')
  }
  emit('update:xml', next)
}

/** 在线组件可配置的参数定义（过滤空名） */
const componentPropDefs = computed(() =>
  (selectedComponentDetail.value?.config.props ?? []).filter((item) =>
    item.name.trim(),
  ),
)

const componentPropForm = reactive<Record<string, string>>({})

function syncComponentPropForm() {
  const node = selectedNode.value
  const defs = componentPropDefs.value
  for (const key of Object.keys(componentPropForm)) {
    delete componentPropForm[key]
  }
  if (!node || node.tag !== 'Component') return
  for (const def of defs) {
    const name = def.name.trim()
    componentPropForm[name] = node.attrs[name] ?? ''
  }
}

watch(
  [selectedNode, componentPropDefs, () => props.xml],
  () => {
    syncComponentPropForm()
  },
  { immediate: true, deep: true },
)

function propTypeLabel(type: string): string {
  return DATA_FIELD_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type
}

function propDefaultPreview(def: ComponentPropDef): string {
  const v = def.defaultValue
  if (v == null || v === '') return '空'
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return ''
    }
  }
  return String(v)
}

function looksLikeDataBinding(raw: string | undefined): boolean {
  return /\{[^{}]+\}/.test(String(raw ?? ''))
}

function commitComponentProp(name: string) {
  commitAttr(name, componentPropForm[name] ?? '')
}

const iconSelectOptions = computed(() => {
  const library = props.iconOptions ?? []
  const repeatList = findNearestRepeatListName(props.xml, props.selectedId)
  const itemIcons = listRepeatItemIconOptions(props.dataFields ?? [], repeatList)
  // 重复项图标放前面，方便选择；库图标在后
  const seen = new Set<string>()
  const merged: Array<{ id: string; label: string }> = []
  for (const opt of [...itemIcons, ...library]) {
    if (!opt.id || seen.has(opt.id)) continue
    seen.add(opt.id)
    merged.push(opt)
  }
  return merged
})

const showLinearProps = computed(() => selectedNode.value?.tag === 'LinearLayout')

const showLayoutContainerProps = computed(
  () =>
    selectedNode.value?.tag === 'LinearLayout' ||
    selectedNode.value?.tag === 'RelativeLayout' ||
    selectedNode.value?.tag === 'Swiper' ||
    selectedNode.value?.tag === 'Modal' ||
    selectedNode.value?.tag === 'Image',
)

/** 溢出策略：布局容器 + Swiper（Swiper 无 scroll） */
const showOverflowProps = computed(
  () =>
    selectedNode.value?.tag === 'LinearLayout' ||
    selectedNode.value?.tag === 'RelativeLayout' ||
    selectedNode.value?.tag === 'Swiper',
)

const overflowOptionsForNode = computed(() => {
  if (selectedNode.value?.tag === 'Swiper') {
    return OVERFLOW_OPTIONS.filter((item) => item.value !== 'scroll')
  }
  return OVERFLOW_OPTIONS
})

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

const dynamicStylesConfig = computed<DynamicStylesConfig>(() =>
  parseDynamicStyles(selectedNode.value?.attrs[DYNAMIC_STYLES_ATTR]),
)

const styleStateDialogVisible = ref(false)
const editingStyleState = ref<DynamicStyleState | null>(null)

function commitDynamicStyles(config: DynamicStylesConfig) {
  if (!props.selectedId || !selectedNode.value) return
  try {
    const next = setNodeAttribute(
      props.xml,
      props.selectedId,
      DYNAMIC_STYLES_ATTR,
      serializeDynamicStyles(config),
    )
    emit('update:xml', next)
  } catch (err) {
    console.error(err)
  }
}

function addStyleState() {
  const states = [...dynamicStylesConfig.value.states]
  const state = createEmptyState(states.length + 1)
  states.push(state)
  commitDynamicStyles({ states })
  editingStyleState.value = state
  styleStateDialogVisible.value = true
}

function openStyleState(state: DynamicStyleState) {
  editingStyleState.value = {
    ...state,
    scenarios: state.scenarios.map((scene) => ({
      ...scene,
      conditions: scene.conditions.map((cond) => ({ ...cond })),
    })),
    styles: { ...state.styles },
  }
  styleStateDialogVisible.value = true
}

function saveStyleState(state: DynamicStyleState) {
  const states = dynamicStylesConfig.value.states.map((item) =>
    item.id === state.id ? state : item,
  )
  if (!states.some((item) => item.id === state.id)) {
    states.push(state)
  }
  commitDynamicStyles({ states })
}

function removeStyleState(stateId: string) {
  commitDynamicStyles({
    states: dynamicStylesConfig.value.states.filter((item) => item.id !== stateId),
  })
}

const showIfConfig = computed(() =>
  parseVisibilityConditions(selectedNode.value?.attrs[V_SHOW_ATTR]),
)

const mountIfConfig = computed(() =>
  parseVisibilityConditions(selectedNode.value?.attrs[V_IF_ATTR]),
)

function visibilitySummary(config: VisibilityConditionConfig): string {
  const scenes = config.scenarios.filter((scene) =>
    scene.conditions.some((cond) => cond.field.trim()),
  )
  if (!scenes.length) return '未配置'
  const condCount = scenes.reduce(
    (sum, scene) =>
      sum + scene.conditions.filter((cond) => cond.field.trim()).length,
    0,
  )
  return `${scenes.length} 个场景 · ${condCount} 个条件`
}

const showIfSummary = computed(() => visibilitySummary(showIfConfig.value))
const mountIfSummary = computed(() => visibilitySummary(mountIfConfig.value))

const visibilityDialogVisible = ref(false)
const visibilityDialogKind = ref<'show' | 'mount'>('show')
const editingVisibilityConfig = ref<VisibilityConditionConfig | null>(null)

const visibilityDialogTitle = computed(() =>
  visibilityDialogKind.value === 'show'
    ? '编辑显示条件 · v-show'
    : '编辑挂载条件 · v-if',
)

function openVisibilityDialog(kind: 'show' | 'mount') {
  visibilityDialogKind.value = kind
  const config = kind === 'show' ? showIfConfig.value : mountIfConfig.value
  editingVisibilityConfig.value = config.scenarios.length
    ? {
        scenarios: config.scenarios.map((scene) => ({
          ...scene,
          conditions: scene.conditions.map((cond) => ({ ...cond })),
        })),
      }
    : createEmptyVisibilityConfig()
  visibilityDialogVisible.value = true
}

function commitVisibilityAttr(attr: string, config: VisibilityConditionConfig) {
  if (!props.selectedId || !selectedNode.value) return
  try {
    const next = setNodeAttribute(
      props.xml,
      props.selectedId,
      attr,
      serializeVisibilityConditions(config),
    )
    emit('update:xml', next)
  } catch (err) {
    console.error(err)
  }
}

function saveVisibilityConfig(config: VisibilityConditionConfig) {
  const attr = visibilityDialogKind.value === 'show' ? V_SHOW_ATTR : V_IF_ATTR
  commitVisibilityAttr(attr, config)
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

          <div class="section-title">基本</div>
          <el-form label-position="top" size="small">
            <el-form-item label="name">
              <el-input
                v-model="layoutForm.name"
                clearable
                placeholder="控件命名，显示在控件树"
                @change="commitAttr('name', layoutForm.name)"
              />
            </el-form-item>
          </el-form>

          <template v-if="showSizeProps">
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
          </template>

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

            <template v-if="showMarginProps">
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
            </template>
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
            <el-form-item v-if="!showModalProps" label="gravity">
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
              <el-form-item label="borderRadius 统一圆角">
                <NumericInput
                  v-model="layoutForm.borderRadius"
                  placeholder="四角共用；分角优先"
                  @change="commitAttr('borderRadius', layoutForm.borderRadius)"
                />
              </el-form-item>
              <div class="quad-grid">
                <el-form-item label="上左">
                  <NumericInput
                    v-model="layoutForm.borderTopLeftRadius"
                    @change="
                      commitAttr('borderTopLeftRadius', layoutForm.borderTopLeftRadius)
                    "
                  />
                </el-form-item>
                <el-form-item label="上右">
                  <NumericInput
                    v-model="layoutForm.borderTopRightRadius"
                    @change="
                      commitAttr('borderTopRightRadius', layoutForm.borderTopRightRadius)
                    "
                  />
                </el-form-item>
                <el-form-item label="下右">
                  <NumericInput
                    v-model="layoutForm.borderBottomRightRadius"
                    @change="
                      commitAttr(
                        'borderBottomRightRadius',
                        layoutForm.borderBottomRightRadius,
                      )
                    "
                  />
                </el-form-item>
                <el-form-item label="下左">
                  <NumericInput
                    v-model="layoutForm.borderBottomLeftRadius"
                    @change="
                      commitAttr(
                        'borderBottomLeftRadius',
                        layoutForm.borderBottomLeftRadius,
                      )
                    "
                  />
                </el-form-item>
              </div>
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
            <el-form-item v-if="showOverflowProps" label="overflow 溢出">
              <el-select
                v-model="layoutForm.overflow"
                @change="commitAttr('overflow', layoutForm.overflow === 'hidden' ? '' : layoutForm.overflow)"
              >
                <el-option
                  v-for="opt in overflowOptionsForNode"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
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

          <template v-if="showIconProps">
            <div class="section-title">图标</div>
            <el-form label-position="top" size="small">
              <el-form-item label="iconId">
                <IconValueSelect
                  v-model="layoutForm.iconId"
                  :options="iconSelectOptions"
                  placeholder="选择图标或重复项字段"
                  @change="commitAttr('iconId', layoutForm.iconId)"
                />
                <p v-if="iconSelectOptions.some((o) => o.id.startsWith('{item.'))" class="hint">
                  当前在重复列表内，可选 for 项下的图标字段（如
                  <code>{'{item.icon}'}</code>）
                </p>
              </el-form-item>
              <el-form-item label="size">
                <NumericInput
                  v-model="layoutForm.size"
                  placeholder="例如：24"
                  :min="1"
                  :max="500"
                  @change="commitAttr('size', layoutForm.size)"
                />
              </el-form-item>
              <el-form-item label="color">
                <ColorPicker
                  v-model="layoutForm.color"
                  placeholder="#303133"
                  @change="commitAttr('color', layoutForm.color)"
                />
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

          <template v-if="showSwiperProps">
            <div class="section-title">滑动窗口</div>
            <el-form label-position="top" size="small">
              <el-form-item label="autoplay 自动播放">
                <el-switch
                  v-model="layoutForm.autoplay"
                  @change="commitAttr('autoplay', layoutForm.autoplay ? 'true' : '')"
                />
              </el-form-item>
              <el-form-item label="interval 间隔(ms)">
                <NumericInput
                  v-model="layoutForm.interval"
                  placeholder="3000"
                  :min="800"
                  :max="60000"
                  @change="commitAttr('interval', layoutForm.interval)"
                />
              </el-form-item>
              <el-form-item label="circular 循环">
                <el-switch
                  v-model="layoutForm.circular"
                  @change="commitAttr('circular', layoutForm.circular ? 'true' : 'false')"
                />
              </el-form-item>
              <el-form-item label="indicatorDots 指示点">
                <el-switch
                  v-model="layoutForm.indicatorDots"
                  @change="
                    commitAttr('indicatorDots', layoutForm.indicatorDots ? 'true' : 'false')
                  "
                />
              </el-form-item>
              <el-form-item label="indicatorColor">
                <ColorPicker
                  v-model="layoutForm.indicatorColor"
                  placeholder="rgba(0,0,0,0.25)"
                  @change="commitAttr('indicatorColor', layoutForm.indicatorColor)"
                />
              </el-form-item>
              <el-form-item label="indicatorActiveColor">
                <ColorPicker
                  v-model="layoutForm.indicatorActiveColor"
                  placeholder="#409eff"
                  @change="commitAttr('indicatorActiveColor', layoutForm.indicatorActiveColor)"
                />
              </el-form-item>
              <el-form-item label="duration 动画(ms)">
                <NumericInput
                  v-model="layoutForm.duration"
                  placeholder="280"
                  :min="0"
                  :max="3000"
                  @change="commitAttr('duration', layoutForm.duration)"
                />
              </el-form-item>
              <el-form-item label="current 初始页">
                <NumericInput
                  v-model="layoutForm.current"
                  placeholder="0"
                  :min="0"
                  :max="99"
                  @change="commitAttr('current', layoutForm.current)"
                />
              </el-form-item>
              <p class="hint">每个直接子控件为一页；预览时可左右滑动切换。</p>
            </el-form>
          </template>

          <template v-if="showModalProps">
            <div class="section-title">弹层 Modal</div>
            <el-form label-position="top" size="small">
              <el-form-item label="closeOnClick 点击空白关闭">
                <el-switch
                  v-model="layoutForm.closeOnClick"
                  @change="
                    commitAttr('closeOnClick', layoutForm.closeOnClick ? 'true' : 'false')
                  "
                />
              </el-form-item>
              <p class="hint">
                全屏弹层，子控件使用相对布局定位。用上方 name 作为标识；数据池「引用」指向本弹层后可
                <code>.show()</code> / <code>.hide()</code>。一屏仅显示栈顶；开启
                closeOnClick 后点击空白可关闭。
              </p>
            </el-form>
          </template>

          <template v-if="isRelativeChild">
            <div class="section-title">相对布局定位</div>
            <el-form label-position="top" size="small">
              <p v-if="parentTag === 'Modal'" class="hint">
                贴边：贴父底/顶 + 宽度 match_parent；侧栏：贴父左/右 + 高度 match_parent。
                抽屉圆角用外观里的「上左/上右/下左/下右」分角。
              </p>
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

          <el-empty
            v-if="isComponentNode && !selectableEvents.length"
            description="该组件暂无事件方法，请先在组件设置中添加"
            :image-size="48"
          />
          <el-form v-else label-position="top" size="small">
            <el-form-item
              v-for="event in selectableEvents"
              :key="event.key"
              :label="event.label"
            >
              <div class="event-row">
                <span class="event-summary">{{ eventBindingSummary(event.key) }}</span>
                <el-button
                  type="primary"
                  link
                  @click="openEventBind(event.key, event.label)"
                >
                  配置
                </el-button>
              </div>
            </el-form-item>
          </el-form>

          <EventBindDialog
            v-model="eventBindVisible"
            :event-label="eventBindLabel"
            :event-key="eventBindKey"
            :event-params="eventBindParams"
            :raw-value="eventForm[eventBindKey]"
            :methods="methods ?? []"
            :emit-events="emitEvents"
            :data-fields="props.dataFields ?? []"
            :xml="xml"
            :component-map="componentMap"
            :component-methods-map="componentMethodsMap"
            :icon-options="iconOptions"
            @save="handleEventBindSave"
          />
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

          <template v-if="isComponentNode">
            <div class="section-title">组件参数 · $props</div>
            <el-alert
              v-if="!selectedComponentDetail"
              type="warning"
              :closable="false"
              show-icon
              title="未找到组件定义，请确认 componentId 是否有效"
              style="margin-bottom: 12px"
            />
            <template v-else-if="!componentPropDefs.length">
              <el-empty
                description="该组件暂无参数，请先在组件设置中添加"
                :image-size="48"
              />
            </template>
            <template v-else>
              <el-form label-position="top" size="small">
                <el-form-item
                  v-for="def in componentPropDefs"
                  :key="def.name"
                  :label="`${def.name}${def.required ? ' *' : ''} · ${propTypeLabel(def.type)}${def.twoWay ? ' · model' : ''}`"
                >
                  <IconValueSelect
                    v-if="def.type === 'icon'"
                    v-model="componentPropForm[def.name]"
                    :options="iconSelectOptions"
                    allow-create
                    clearable
                    :placeholder="`默认：${propDefaultPreview(def)}`"
                    @change="commitComponentProp(def.name)"
                  />
                  <template v-else-if="def.type === 'color'">
                    <ColorPicker
                      v-if="!looksLikeDataBinding(componentPropForm[def.name])"
                      v-model="componentPropForm[def.name]"
                      placeholder="#409eff / rgba(...)"
                      @change="commitComponentProp(def.name)"
                    />
                    <el-input
                      v-else
                      v-model="componentPropForm[def.name]"
                      clearable
                      placeholder="颜色值或 {数据池字段}"
                      @change="commitComponentProp(def.name)"
                    />
                    <p class="hint">可填色值，或绑定数据池：<code>{'{titleBarColor}'}</code></p>
                  </template>
                  <el-input
                    v-else
                    v-model="componentPropForm[def.name]"
                    clearable
                    :placeholder="`默认：${propDefaultPreview(def)}；可用 {item.字段} 或 {数据池字段}`"
                    @change="commitComponentProp(def.name)"
                  />
                  <p v-if="def.remark" class="prop-remark">{{ def.remark }}</p>
                </el-form-item>
              </el-form>
              <p class="hint">
                写入当前 Component 节点属性；组件内部用
                <code>{'{$props.字段名}'}</code>
                读取。留空则使用组件默认值。
              </p>
            </template>
          </template>

          <el-alert
            v-if="isRootNode"
            type="info"
            :closable="false"
            show-icon
            title="根节点不支持列表重复配置"
            style="margin-bottom: 12px"
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

          <div class="section-title">显示条件 · v-show</div>
          <div class="visibility-row">
            <span class="visibility-summary">{{ showIfSummary }}</span>
            <el-button type="primary" link @click="openVisibilityDialog('show')">
              配置
            </el-button>
          </div>
          <p class="hint">
            场景之间为「或」、场景内为「且」。不成立时隐藏但仍保留节点（类似
            <code>v-show</code>）。
          </p>

          <div class="section-title">挂载条件 · v-if</div>
          <div class="visibility-row">
            <span class="visibility-summary">{{ mountIfSummary }}</span>
            <el-button type="primary" link @click="openVisibilityDialog('mount')">
              配置
            </el-button>
          </div>
          <p class="hint">
            场景之间为「或」、场景内为「且」。不成立时不渲染（类似
            <code>v-if</code>）。
          </p>

          <div class="section-title">动态样式</div>
          <div class="dyn-style-list">
            <div
              v-for="(state, index) in dynamicStylesConfig.states"
              :key="state.id"
              class="dyn-style-item"
            >
              <span class="dyn-style-name">状态{{ index + 1 }} · {{ state.name }}</span>
              <div class="dyn-style-actions">
                <el-button type="primary" link @click="openStyleState(state)">编辑</el-button>
                <el-button type="danger" link :icon="Delete" @click="removeStyleState(state.id)" />
              </div>
            </div>
            <el-button type="primary" plain :icon="Plus" class="add-state-btn" @click="addStyleState">
              添加状态
            </el-button>
          </div>
          <p class="hint">
            按数据池字段与条件命中状态后，覆盖对应样式。样式编辑与「样式」页共用组件，仅填写需覆盖的属性。
          </p>
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

    <DynamicStyleStateDialog
      v-model="styleStateDialogVisible"
      :state="editingStyleState"
      :node-tag="selectedNode?.tag"
      :data-fields="props.dataFields"
      :component-props="props.componentProps"
      :route-params="props.routeParams"
      :selected-node-id="selectedId"
      :xml="xml"
      @save="saveStyleState"
    />

    <VisibilityConditionDialog
      v-model="visibilityDialogVisible"
      :title="visibilityDialogTitle"
      :config="editingVisibilityConfig"
      :data-fields="props.dataFields"
      :component-props="props.componentProps"
      :route-params="props.routeParams"
      :selected-node-id="selectedId"
      :xml="xml"
      @save="saveVisibilityConfig"
    />
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

.repeat-row,
.event-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.visibility-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin-bottom: 4px;
}

.visibility-summary,
.event-summary,
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

.prop-remark {
  margin: 4px 0 0;
  font-size: 12px;
  color: #909399;
}

.dyn-style-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dyn-style-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafbfc;
}

.dyn-style-name {
  min-width: 0;
  flex: 1;
  font-size: 13px;
  color: #303133;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dyn-style-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.add-state-btn {
  width: 100%;
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
