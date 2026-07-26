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
  interactionEventParams,
  ORIENTATION_OPTIONS,
  RELATIVE_BOOL_ATTRS,
  SCROLL_INTERACTION_EVENTS,
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
import ApiPropBindField from './ApiPropBindField.vue'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentPropDef } from '../../types/component'
import { DATA_FIELD_TYPE_OPTIONS, COMPOSABLE_FIELD_TYPE_OPTIONS, type DataFieldType } from '../../types/page-data'
import {
  isStatusBarNodeId,
  normalizeStatusBarConfig,
  statusBarCoverIsOn,
  type StatusBarConfig,
} from '../../utils/status-bar'
import {
  parseSlotOutletNodeId,
} from '../../utils/slot-outlet'

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
  /** 当前工程路径（后端 API 参数绑定） */
  projectPath?: string
  /** 数据类型库（事件自定义代码 $props / 具名类型 ambient） */
  typeLibrary?: import('../../types/data-types').DataTypeLibrary | null
  /** 自增请求：切换到动态并打开重复弹窗 */
  openRepeatRequest?: number
  /** 页面状态栏配置 */
  statusBarConfig?: Partial<StatusBarConfig> | null
  /** 画布场景：H5 下提示状态栏不可控 */
  canvasScene?: 'h5' | 'miniprogram'
}>()

const emit = defineEmits<{
  'update:xml': [xml: string]
  'update:tab': [tab: PropsTab]
  'update:status-bar': [config: StatusBarConfig]
}>()

const isStatusBarSelected = computed(() => isStatusBarNodeId(props.selectedId))
const slotOutletInfo = computed(() => parseSlotOutletNodeId(props.selectedId))
const isSlotOutletSelected = computed(() => Boolean(slotOutletInfo.value))

const statusBarForm = reactive({
  textStyle: 'black',
  backgroundColor: '#ffffff',
  cover: 'false',
})

watch(
  () => props.statusBarConfig,
  (cfg) => {
    const next = normalizeStatusBarConfig(cfg)
    statusBarForm.textStyle = next.textStyle
    statusBarForm.backgroundColor = next.backgroundColor
    statusBarForm.cover =
      typeof next.cover === 'boolean' ? (next.cover ? 'true' : 'false') : String(next.cover)
  },
  { immediate: true, deep: true },
)

function commitStatusBar() {
  const coverRaw = statusBarForm.cover.trim()
  let cover: boolean | string = false
  if (looksLikeDataBinding(coverRaw)) cover = coverRaw
  else if (coverRaw === 'true' || coverRaw === '1') cover = true
  else if (coverRaw === 'false' || coverRaw === '0' || !coverRaw) cover = false
  else cover = coverRaw

  emit('update:status-bar', {
    textStyle: statusBarForm.textStyle.trim() || 'black',
    backgroundColor: statusBarForm.backgroundColor.trim() || '#ffffff',
    cover,
  })
}

function commitStatusBarTextStyleStatic(value: string) {
  statusBarForm.textStyle = value
  commitStatusBar()
}

function commitStatusBarCoverSwitch(on: boolean) {
  statusBarForm.cover = on ? 'true' : 'false'
  commitStatusBar()
}

const statusBarTextStyleIsBinding = computed(() =>
  looksLikeDataBinding(statusBarForm.textStyle),
)
const statusBarCoverIsBinding = computed(() =>
  looksLikeDataBinding(statusBarForm.cover),
)

const selectedNode = computed(() =>
  props.selectedId &&
  !isStatusBarSelected.value &&
  !isSlotOutletSelected.value
    ? findNodeFromXml(props.xml, props.selectedId)
    : null,
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

const isSlotNode = computed(() => selectedNode.value?.tag === 'Slot')

/** 挂在 Component 下的插槽内容节点 */
const isSlotContentNode = computed(
  () => parentTag.value === 'Component' && !isComponentNode.value,
)

interface SlotParamRow {
  name: string
  type: DataFieldType
  typeRef?: string
}

function parseSlotParams(raw: string | undefined): SlotParamRow[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const row = item as Record<string, unknown>
        const name = typeof row.name === 'string' ? row.name.trim() : ''
        if (!name) return null
        const type = (
          typeof row.type === 'string' ? row.type : 'string'
        ) as DataFieldType
        const typeRef =
          typeof row.typeRef === 'string' && row.typeRef.trim()
            ? row.typeRef.trim()
            : undefined
        return { name, type, typeRef } satisfies SlotParamRow
      })
      .filter((item): item is SlotParamRow => Boolean(item))
  } catch {
    return []
  }
}

function serializeSlotParams(rows: SlotParamRow[]): string {
  return JSON.stringify(
    rows
      .map((row) => ({
        name: row.name.trim(),
        type: row.type,
        ...(row.typeRef?.trim() ? { typeRef: row.typeRef.trim() } : {}),
      }))
      .filter((row) => row.name),
  )
}

const slotParamRows = ref<SlotParamRow[]>([])

function syncSlotParamRows() {
  if (!isSlotNode.value || !selectedNode.value) {
    slotParamRows.value = []
    return
  }
  slotParamRows.value = parseSlotParams(selectedNode.value.attrs.params)
}

function commitSlotParams() {
  commitAttr('params', serializeSlotParams(slotParamRows.value))
}

function addSlotParam() {
  slotParamRows.value.push({ name: '', type: 'string' })
  commitSlotParams()
}

function removeSlotParam(index: number) {
  slotParamRows.value.splice(index, 1)
  commitSlotParams()
}

function commitSlotName(value: string) {
  const name = value.trim() || 'default'
  layoutForm.name = name
  commitAttr('name', name)
}

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
  // 可滚动布局才展示滚动 / 触底 / 触顶 / 触摸
  const overflow = selectedNode.value?.attrs.overflow?.trim().toLowerCase()
  const tag = selectedNode.value?.tag
  if (
    overflow === 'scroll' &&
    (tag === 'LinearLayout' || tag === 'RelativeLayout')
  ) {
    for (const item of SCROLL_INTERACTION_EVENTS) {
      const params = item.params
        .map((p) => `${p.name}: ${p.type}`)
        .join(', ')
      list.push({
        key: item.key,
        label: params ? `${item.label}(${params})` : `${item.label} (${item.key})`,
      })
    }
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
  widthValue: '100' as string,
  heightMode: 'wrap_content' as string,
  heightValue: '40' as string,
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
  overflow: 'visible',
  zIndex: '',
  gravity: '',
  orientation: 'vertical',
  gap: '',
  text: '',
  textSize: '',
  textColor: '',
  value: '',
  placeholder: '',
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
  active: '',
  windowKey: '',
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
    return { mode: 'wrap_content', value: String(fallbackValue) }
  }
  if (value === 'match_parent') {
    return { mode: 'match_parent', value: String(fallbackValue) }
  }
  // 固定值：保留原始字符串（支持 {offsetTop} 等变量）
  return {
    mode: 'fixed',
    value: String(value).replace(/px$/i, ''),
  }
}

function sizeToAttr(mode: string, value: number | string): string {
  if (mode === 'match_parent' || mode === 'wrap_content') return mode
  const raw = String(value ?? '').trim()
  if (!raw) return '0'
  if (/\{[^{}]+\}/.test(raw)) return raw
  const num = Number(raw.replace(/px$/i, ''))
  return Number.isFinite(num) ? String(num) : raw
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
  layoutForm.overflow = node.attrs.overflow || 'visible'
  layoutForm.zIndex = node.attrs.zIndex ?? ''
  layoutForm.gravity = node.attrs.gravity ?? ''
  layoutForm.orientation = node.attrs.orientation || 'vertical'
  layoutForm.gap = node.attrs.gap ?? ''
  layoutForm.text = node.attrs.text ?? node.text ?? ''
  layoutForm.textSize = node.attrs.textSize ?? ''
  layoutForm.textColor = node.attrs.textColor ?? ''
  layoutForm.value = node.attrs.value ?? ''
  layoutForm.placeholder = node.attrs.placeholder ?? ''
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
  layoutForm.active = node.attrs.active ?? ''
  layoutForm.windowKey = node.attrs.windowKey ?? ''
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
    syncSlotParamRows()
    void nextTick(() => stripModalLayoutAttrsIfNeeded())
  },
  { immediate: true },
)

watch(
  () => props.xml,
  () => {
    if (props.tab === 'style') {
      syncLayoutForm()
      syncSlotParamRows()
    }
    if (props.tab === 'event') syncEventForm()
  },
)

function commitAttr(name: string, value: string) {
  if (!props.selectedId || !selectedNode.value) return
  try {
    const text = value == null ? '' : String(value).trim()
    const next = setNodeAttribute(props.xml, props.selectedId, name, text)
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
  } else {
    eventBindParams.value = interactionEventParams(key)
  }
  eventBindVisible.value = true
}

function handleEventBindSave(value: string) {
  eventForm[eventBindKey.value] = value
  commitAttr(eventBindKey.value, value)
}

function commitWidth(value?: string) {
  if (value !== undefined) layoutForm.widthValue = value
  commitAttr('width', sizeToAttr(layoutForm.widthMode, layoutForm.widthValue))
}

function commitHeight(value?: string) {
  if (value !== undefined) layoutForm.heightValue = value
  commitAttr('height', sizeToAttr(layoutForm.heightMode, layoutForm.heightValue))
}

function commitRelativeBool(key: (typeof RELATIVE_BOOL_ATTRS)[number]['key']) {
  commitAttr(key, layoutForm[key] ? 'true' : '')
}

const showTextProps = computed(
  () => selectedNode.value?.tag === 'Text' || selectedNode.value?.tag === 'Button',
)

const showInputProps = computed(() => selectedNode.value?.tag === 'Input')

const showImageProps = computed(() => selectedNode.value?.tag === 'Image')

const showIconProps = computed(() => selectedNode.value?.tag === 'Icon')

const showSwiperProps = computed(() => selectedNode.value?.tag === 'Swiper')
const showMultiWindowProps = computed(() => selectedNode.value?.tag === 'MultiWindow')
const showModalProps = computed(() => selectedNode.value?.tag === 'Modal')
const isMultiWindowChild = computed(() => parentTag.value === 'MultiWindow')

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

function boolPropModel(def: { name: string; defaultValue?: unknown }): boolean {
  const raw = (componentPropForm[def.name] ?? '').trim()
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  // 留空：展示组件默认值
  return def.defaultValue === true || def.defaultValue === 'true' || def.defaultValue === 1
}

function commitComponentBoolProp(name: string, checked: boolean) {
  componentPropForm[name] = checked ? 'true' : 'false'
  commitComponentProp(name)
}

function clearComponentProp(name: string) {
  componentPropForm[name] = ''
  commitComponentProp(name)
}

const iconSelectOptions = computed(() => {
  const library = props.iconOptions ?? []
  const repeatList = findNearestRepeatListName(props.xml, props.selectedId)
  const itemIcons = listRepeatItemIconOptions(
    props.dataFields ?? [],
    repeatList,
    props.componentProps,
  )
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
    selectedNode.value?.tag === 'MultiWindow' ||
    selectedNode.value?.tag === 'Modal' ||
    selectedNode.value?.tag === 'Image' ||
    selectedNode.value?.tag === 'Input',
)

/** 溢出策略：布局容器 + Swiper / MultiWindow（无 scroll） */
const showOverflowProps = computed(
  () =>
    selectedNode.value?.tag === 'LinearLayout' ||
    selectedNode.value?.tag === 'RelativeLayout' ||
    selectedNode.value?.tag === 'Swiper' ||
    selectedNode.value?.tag === 'MultiWindow',
)

const overflowOptionsForNode = computed(() => {
  if (
    selectedNode.value?.tag === 'Swiper' ||
    selectedNode.value?.tag === 'MultiWindow'
  ) {
    return OVERFLOW_OPTIONS.filter((item) => item.value !== 'scroll')
  }
  return OVERFLOW_OPTIONS
})

const arrayFieldOptions = computed(() => {
  const options: Array<{ value: string; label: string }> = []
  for (const field of props.dataFields ?? []) {
    if (field.type !== 'array' || !field.name.trim()) continue
    const name = field.name.trim()
    const remark = field.remark?.trim()
    options.push({
      value: name,
      label: remark ? `数据池 · ${name} · ${remark}` : `数据池 · ${name}`,
    })
  }
  for (const def of props.componentProps ?? []) {
    if (def.type !== 'array' || !def.name.trim()) continue
    const name = def.name.trim()
    const remark = def.remark?.trim()
    options.push({
      value: `$props.${name}`,
      label: remark ? `$props · ${name} · ${remark}` : `$props · ${name}`,
    })
  }
  return options
})

/** Input 双向绑定：仅数据池顶层 string 字段 */
const stringFieldOptions = computed(() =>
  (props.dataFields ?? [])
    .filter((field) => field.type === 'string' && field.name.trim())
    .map((field) => {
      const name = field.name.trim()
      const remark = field.remark?.trim()
      return {
        value: name,
        label: remark ? `${name} · ${remark}` : name,
      }
    }),
)

/** MultiWindow 激活项：string / number 顶层字段 */
const activeFieldOptions = computed(() =>
  (props.dataFields ?? [])
    .filter(
      (field) =>
        (field.type === 'string' || field.type === 'number') && field.name.trim(),
    )
    .map((field) => {
      const name = field.name.trim()
      const remark = field.remark?.trim()
      const typeLabel = field.type === 'number' ? '数字' : '字符串'
      return {
        value: name,
        label: remark ? `${name} · ${remark}（${typeLabel}）` : `${name}（${typeLabel}）`,
      }
    }),
)

function parseInputValueBinding(raw: string | undefined): string {
  const m = (raw ?? '').trim().match(/^\{([A-Za-z_][\w]*)\}$/)
  return m?.[1] ?? ''
}

const modelSummary = computed(() => {
  const field = parseInputValueBinding(selectedNode.value?.attrs.value)
  return field || '未配置'
})

const activeSummary = computed(() => {
  const field = parseInputValueBinding(selectedNode.value?.attrs.active)
  if (field) return field
  const literal = selectedNode.value?.attrs.active?.trim()
  return literal || '未配置'
})

const modelDialogVisible = ref(false)
const modelForm = reactive({
  field: '',
})

const activeDialogVisible = ref(false)
const activeForm = reactive({
  field: '',
})

function openModelDialog() {
  if (!selectedNode.value || selectedNode.value.tag !== 'Input') return
  modelForm.field = parseInputValueBinding(selectedNode.value.attrs.value)
  modelDialogVisible.value = true
}

function openActiveDialog() {
  if (!selectedNode.value || selectedNode.value.tag !== 'MultiWindow') return
  activeForm.field = parseInputValueBinding(selectedNode.value.attrs.active)
  activeDialogVisible.value = true
}

function saveModelConfig() {
  if (!props.selectedId || !selectedNode.value || selectedNode.value.tag !== 'Input') {
    return
  }
  const name = modelForm.field.trim()
  try {
    const next = setNodeAttribute(
      props.xml,
      props.selectedId,
      'value',
      name ? `{${name}}` : '',
    )
    emit('update:xml', next)
    modelDialogVisible.value = false
  } catch (err) {
    console.error(err)
  }
}

function saveActiveConfig() {
  if (
    !props.selectedId ||
    !selectedNode.value ||
    selectedNode.value.tag !== 'MultiWindow'
  ) {
    return
  }
  const name = activeForm.field.trim()
  try {
    const next = setNodeAttribute(
      props.xml,
      props.selectedId,
      'active',
      name ? `{${name}}` : '',
    )
    emit('update:xml', next)
    layoutForm.active = name ? `{${name}}` : ''
    activeDialogVisible.value = false
  } catch (err) {
    console.error(err)
  }
}

function clearModelConfig() {
  if (!props.selectedId || !selectedNode.value || selectedNode.value.tag !== 'Input') {
    return
  }
  try {
    const next = setNodeAttribute(props.xml, props.selectedId, 'value', '')
    emit('update:xml', next)
    modelDialogVisible.value = false
  } catch (err) {
    console.error(err)
  }
}

function clearActiveConfig() {
  if (
    !props.selectedId ||
    !selectedNode.value ||
    selectedNode.value.tag !== 'MultiWindow'
  ) {
    return
  }
  try {
    const next = setNodeAttribute(props.xml, props.selectedId, 'active', '')
    emit('update:xml', next)
    layoutForm.active = ''
    activeDialogVisible.value = false
  } catch (err) {
    console.error(err)
  }
}

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
        <div v-if="isSlotOutletSelected" class="layout-form">
          <div class="node-brief">
            <div class="node-tag">Slot</div>
            <div class="node-id">{{ selectedId }}</div>
          </div>
          <div class="section-title">插槽</div>
          <el-form label-position="top" size="small">
            <el-form-item label="插槽名称">
              <el-input :model-value="slotOutletInfo?.slotName || 'default'" disabled />
            </el-form-item>
          </el-form>
          <p class="hint">
            在此选中插槽后添加控件，内容会注入到该插槽。也可从控件树将节点拖入插槽。
          </p>
        </div>
        <div v-else-if="isStatusBarSelected" class="layout-form">
          <div class="node-brief">
            <div class="node-tag">StatusBar</div>
            <div class="node-id">系统状态栏</div>
          </div>

          <el-alert
            v-if="canvasScene !== 'miniprogram'"
            class="status-bar-tip"
            type="warning"
            show-icon
            :closable="false"
            title="H5 场景不支持控制状态栏"
            description="状态栏样式参考微信小程序（navigationBarTextStyle / 背景色），仅在「微信小程序」场景下生效。请切换到右下角「微信小程序」预览。"
          />

          <div class="section-title">风格</div>
          <el-form label-position="top" size="small" :disabled="canvasScene !== 'miniprogram'">
            <el-form-item label="文字样式 textStyle">
              <el-radio-group
                v-if="!statusBarTextStyleIsBinding"
                :model-value="
                  statusBarForm.textStyle === 'white' ? 'white' : 'black'
                "
                @change="commitStatusBarTextStyleStatic(String($event))"
              >
                <el-radio-button value="black">black 黑字</el-radio-button>
                <el-radio-button value="white">white 白字</el-radio-button>
              </el-radio-group>
              <el-input
                v-model="statusBarForm.textStyle"
                clearable
                placeholder="black / white，或 {数据池字段}"
                style="margin-top: 8px"
                @change="commitStatusBar"
              />
              <p class="hint">可填 black / white，或绑定数据池：<code>{'{titleTextStyle}'}</code></p>
            </el-form-item>
            <el-form-item label="背景色 backgroundColor">
              <ColorPicker
                v-if="!looksLikeDataBinding(statusBarForm.backgroundColor)"
                v-model="statusBarForm.backgroundColor"
                placeholder="#ffffff / transparent"
                @change="commitStatusBar"
              />
              <el-input
                v-else
                v-model="statusBarForm.backgroundColor"
                clearable
                placeholder="色值或 {数据池字段}"
                @change="commitStatusBar"
              />
              <p class="hint">可填色值，或绑定数据池：<code>{'{titleBarColor}'}</code></p>
            </el-form-item>
            <el-form-item label="与页面重叠 cover">
              <div v-if="!statusBarCoverIsBinding" class="bool-prop-row">
                <el-switch
                  :model-value="statusBarCoverIsOn(statusBarForm.cover)"
                  @update:model-value="commitStatusBarCoverSwitch"
                />
              </div>
              <el-input
                v-model="statusBarForm.cover"
                clearable
                placeholder="true / false，或 {数据池字段}"
                :style="statusBarCoverIsBinding ? undefined : { marginTop: '8px' }"
                @change="commitStatusBar"
              />
              <p class="hint">
                开启后状态栏浮在页面之上（沉浸式）。可绑定：<code>{'{immersive}'}</code>
              </p>
            </el-form-item>
          </el-form>
        </div>
        <el-empty
          v-else-if="!selectedNode"
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
            <el-form-item v-if="isSlotNode" label="插槽名称">
              <el-input
                v-model="layoutForm.name"
                clearable
                placeholder="默认 default"
                @change="commitSlotName"
              />
            </el-form-item>
            <el-form-item v-else label="name">
              <el-input
                v-model="layoutForm.name"
                clearable
                placeholder="控件命名，显示在控件树"
                @change="commitAttr('name', layoutForm.name)"
              />
            </el-form-item>
            <el-form-item v-if="isSlotContentNode" label="注入插槽 slot">
              <el-input
                :model-value="selectedNode.attrs.slot || 'default'"
                clearable
                placeholder="默认 default"
                @change="(v: string) => commitAttr('slot', (v ?? '').trim() || 'default')"
              />
              <p class="hint">对应组件内 Slot 的 name</p>
            </el-form-item>
          </el-form>

          <template v-if="isSlotNode">
            <div class="section-title">传参（作用域）</div>
            <el-form label-position="top" size="small">
              <div class="slot-param-list">
                <div
                  v-for="(row, index) in slotParamRows"
                  :key="index"
                  class="slot-param-row"
                >
                  <el-input
                    v-model="row.name"
                    placeholder="参数名"
                    @change="commitSlotParams"
                  />
                  <el-select
                    v-model="row.type"
                    style="width: 120px"
                    @change="commitSlotParams"
                  >
                    <el-option
                      v-for="opt in COMPOSABLE_FIELD_TYPE_OPTIONS"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                  </el-select>
                  <el-button
                    type="danger"
                    link
                    :icon="Delete"
                    @click="removeSlotParam(index)"
                  />
                </div>
                <el-button type="primary" link :icon="Plus" @click="addSlotParam">
                  添加传参
                </el-button>
                <p v-if="!slotParamRows.length" class="hint">
                  声明作用域参数（如 item）。导出为
                  <code>&lt;slot :item="item" /&gt;</code>
                  ，父侧
                  <code>#default="{ item }"</code>。
                  画布上插槽内容使用宿主组件的数据池与 $props。
                </p>
                <p v-else class="hint">
                  导出时父侧会解构这些参数；画布插槽内容走宿主 $props / 数据池。
                </p>
              </div>
            </el-form>
          </template>

          <template v-if="showSizeProps">
            <div class="section-title">尺寸</div>
            <el-form label-position="top" size="small">
              <el-form-item label="宽度 width">
                <div class="size-row">
                  <el-select v-model="layoutForm.widthMode" @change="() => commitWidth()">
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
                    placeholder="数字或 {变量}"
                    @change="commitWidth"
                  />
                </div>
              </el-form-item>

              <el-form-item label="高度 height">
                <div class="size-row">
                  <el-select v-model="layoutForm.heightMode" @change="() => commitHeight()">
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
                    placeholder="数字或 {变量}"
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
                placeholder="例如：16 或 {padding}"
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
                  placeholder="例如：8 或 {margin}"
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
            <el-form-item label="层级 zIndex">
              <NumericInput
                v-model="layoutForm.zIndex"
                placeholder="如 10，越大越靠上"
                @change="commitAttr('zIndex', layoutForm.zIndex)"
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
                @change="commitAttr('overflow', layoutForm.overflow === 'visible' ? '' : layoutForm.overflow)"
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

          <template v-if="showInputProps">
            <div class="section-title">输入</div>
            <el-form label-position="top" size="small">
              <el-form-item label="value">
                <el-input
                  v-model="layoutForm.value"
                  clearable
                  placeholder="静态值，或在「动态」配置双向绑定"
                  @change="commitAttr('value', layoutForm.value)"
                />
              </el-form-item>
              <el-form-item label="placeholder">
                <el-input
                  v-model="layoutForm.placeholder"
                  clearable
                  placeholder="占位提示"
                  @change="commitAttr('placeholder', layoutForm.placeholder)"
                />
              </el-form-item>
              <el-form-item label="textSize">
                <NumericInput
                  v-model="layoutForm.textSize"
                  placeholder="例如：14"
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

          <template v-if="showMultiWindowProps">
            <div class="section-title">多窗口</div>
            <el-form label-position="top" size="small">
              <p class="hint">
                按数据池激活项切换显示窗口。在「动态」中绑定激活项；点击画布右侧「新建窗口」添加子窗口，并为每个窗口设置项名
                <code>windowKey</code>。
              </p>
            </el-form>
          </template>

          <template v-if="isMultiWindowChild">
            <div class="section-title">窗口项名</div>
            <el-form label-position="top" size="small">
              <el-form-item label="windowKey">
                <el-input
                  v-model="layoutForm.windowKey"
                  clearable
                  placeholder="与激活项匹配，如 home"
                  @change="commitAttr('windowKey', layoutForm.windowKey.trim())"
                />
              </el-form-item>
              <p class="hint">
                当激活项等于该值时显示本窗口。支持字符串或数字（按字符串比较）。
              </p>
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
          v-if="isStatusBarSelected"
          description="状态栏不支持事件绑定"
          :image-size="64"
        />
        <el-empty
          v-else-if="isSlotOutletSelected"
          description="插槽本身不支持事件绑定，请选中插槽内的控件"
          :image-size="64"
        />
        <el-empty
          v-else-if="!selectedNode"
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
            :component-props="componentProps"
            :type-library="typeLibrary"
            @save="handleEventBindSave"
          />
        </div>
      </template>

      <template v-else>
        <el-empty
          v-if="isStatusBarSelected"
          description="状态栏不支持动态样式"
          :image-size="64"
        />
        <el-empty
          v-else-if="isSlotOutletSelected"
          description="插槽本身不支持动态样式，请选中插槽内的控件"
          :image-size="64"
        />
        <el-empty
          v-else-if="!selectedNode"
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
                  <ApiPropBindField
                    v-else-if="def.type === 'api'"
                    v-model="componentPropForm[def.name]"
                    :project-path="projectPath || ''"
                    :api-params="def.apiParams"
                    :api-return-type="def.apiReturnType"
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
                  <template v-else-if="def.type === 'boolean'">
                    <div class="bool-prop-row">
                      <el-switch
                        :model-value="boolPropModel(def)"
                        @update:model-value="commitComponentBoolProp(def.name, $event)"
                      />
                      <el-button
                        v-if="(componentPropForm[def.name] ?? '').trim()"
                        type="primary"
                        link
                        @click="clearComponentProp(def.name)"
                      >
                        恢复默认（{{ propDefaultPreview(def) }}）
                      </el-button>
                      <span v-else class="bool-prop-hint">当前用默认：{{ propDefaultPreview(def) }}</span>
                    </div>
                    <el-input
                      v-model="componentPropForm[def.name]"
                      clearable
                      placeholder="也可填 true / false，或 {数据池字段}"
                      style="margin-top: 8px"
                      @change="commitComponentProp(def.name)"
                    />
                  </template>
                  <el-input
                    v-else
                    v-model="componentPropForm[def.name]"
                    clearable
                    :placeholder="`默认：${propDefaultPreview(def)}；可用 {item.字段} 或 {数据池字段}`"
                    @change="commitComponentProp(def.name)"
                  />
                  <p v-if="def.type === 'api'" class="hint">
                    选择后端服务 → 控制器 → API。匹配：必填入参名/类型一致；可选入参可省略；出参类型须一致。组件内调用
                    <code>$props.{{ def.name }}(args)</code>
                  </p>
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
              类似 Vue 的 v-for：预览时按绑定数组展开当前节点。可选数据池数组，或组件
              <code>$props</code>
              中的数组参数。文本中写
              <code>{'{item.字段名}'}</code>
              才会替换为列表项数据，其他内容原样显示；也可用
              <code>{'{index}'}</code>。
            </p>
          </template>

          <template v-if="showInputProps">
            <div class="section-title">双向绑定</div>
            <div class="visibility-row">
              <span class="visibility-summary">{{ modelSummary }}</span>
              <el-button type="primary" link @click="openModelDialog">
                配置
              </el-button>
            </div>
            <p class="hint">
              仅可选数据池中的字符串字段，写入
              <code>{'{字段名}'}</code>
              。预览时输入框与数据池互相同步。
            </p>
          </template>

          <template v-if="showMultiWindowProps">
            <div class="section-title">激活项</div>
            <div class="visibility-row">
              <span class="visibility-summary">{{ activeSummary }}</span>
              <el-button type="primary" link @click="openActiveDialog">
                配置
              </el-button>
            </div>
            <p class="hint">
              从数据池选择字符串或数字字段，写入
              <code>{'{字段名}'}</code>
              。预览时显示
              <code>windowKey</code>
              与激活值匹配的窗口。
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
            placeholder="选择数据池或 $props 数组字段"
            style="width: 100%"
          >
            <el-option
              v-for="opt in arrayFieldOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
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

    <el-dialog
      v-model="modelDialogVisible"
      title="双向绑定"
      width="420px"
      destroy-on-close
      append-to-body
    >
      <el-form label-position="top" size="default">
        <el-form-item label="数据池字段">
          <el-select
            v-model="modelForm.field"
            clearable
            filterable
            placeholder="选择字符串类型字段"
            style="width: 100%"
          >
            <el-option
              v-for="opt in stringFieldOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="hint" style="margin-top: 0">
        将写入属性
        <code>value="{'{字段名}'}"</code>
        。预览输入会写回该字段；数据池变更也会刷新输入框。
      </p>
      <template #footer>
        <el-button @click="clearModelConfig">清除</el-button>
        <el-button @click="modelDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveModelConfig">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="activeDialogVisible"
      title="绑定激活项"
      width="420px"
      destroy-on-close
      append-to-body
    >
      <el-form label-position="top" size="default">
        <el-form-item label="数据池字段">
          <el-select
            v-model="activeForm.field"
            clearable
            filterable
            placeholder="选择字符串或数字类型字段"
            style="width: 100%"
          >
            <el-option
              v-for="opt in activeFieldOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="hint" style="margin-top: 0">
        将写入属性
        <code>active="{'{字段名}'}"</code>
        。窗口的
        <code>windowKey</code>
        与该字段值相等时显示。
      </p>
      <template #footer>
        <el-button @click="clearActiveConfig">清除</el-button>
        <el-button @click="activeDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveActiveConfig">确定</el-button>
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
  width: var(--workspace-right-width, 300px);
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

.status-bar-tip {
  margin-bottom: 12px;
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

.bool-prop-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;
}

.bool-prop-hint {
  font-size: 12px;
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

.slot-param-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slot-param-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.slot-param-row .el-input {
  flex: 1;
  min-width: 0;
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
