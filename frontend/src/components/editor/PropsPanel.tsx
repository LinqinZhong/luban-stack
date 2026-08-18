import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Switch,
} from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import BackLink from './BackLink'
import DynamicStyleStateDialog from './DynamicStyleStateDialog'
import EventBindDialog from './EventBindDialog'
import AttrBindField from './AttrBindField'
import VisibilityConditionDialog from './VisibilityConditionDialog'
import OssResourcePickerDialog from './OssResourcePickerDialog'
import { countEventBindings, type MethodParam, type PageMethod } from '../../types/page-method'
import {
  findNodeFromXml,
  findParentTagFromXml,
  GRAVITY_OPTIONS,
  IMAGE_LOADING_OPTIONS,
  IMAGE_OBJECT_FIT_OPTIONS,
  INTERACTION_EVENTS,
  interactionEventParams,
  normalizePressFeedbackMode,
  ORIENTATION_OPTIONS,
  PRESS_FEEDBACK_OPTIONS,
  pressFeedbackHasRipple,
  RELATIVE_BOOL_ATTRS,
  SCROLL_INTERACTION_EVENTS,
  setNodeAttribute,
  setNodeAttributes,
  SIZE_OPTIONS,
} from '../../utils/xml-node'
import { ElMessage } from '../../ui/feedback'
import { OVERFLOW_OPTIONS } from '../../utils/xml'
import {
  DATA_FIELD_TYPE_OPTIONS,
  type DataField,
  type DataFieldType,
  type OssBindingConfig,
} from '../../types/page-data'
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
import IconValueSelect from './IconValueSelect'
import ApiPropBindField from './ApiPropBindField'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentEventDef, ComponentPropDef } from '../../types/component'
import type { PageQueryParamDef } from '../../types/page-query'
import PageQueryParamsPanel from './PageQueryParamsPanel'
import {
  isStatusBarNodeId,
  normalizeStatusBarConfig,
  type StatusBarConfig,
} from '../../utils/status-bar'
import { parseSlotOutletNodeId } from '../../utils/slot-outlet'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import type { DataTypeLibrary } from '../../types/data-types'
import './PropsPanel.css'

export type PropsTab = 'style' | 'event' | 'dynamic'

type RelativeBoolKey = (typeof RELATIVE_BOOL_ATTRS)[number]['key']

interface SlotParamRow {
  name: string
  type: DataFieldType
  typeRef?: string
  itemType?: DataFieldType
  itemTypeRef?: string
  itemItemType?: DataFieldType
  itemItemTypeRef?: string
}

type LayoutForm = {
  name: string
  widthMode: string
  widthValue: string
  heightMode: string
  heightValue: string
  margin: string
  marginLeft: string
  marginRight: string
  marginTop: string
  marginBottom: string
  padding: string
  paddingLeft: string
  paddingRight: string
  paddingTop: string
  paddingBottom: string
  background: string
  borderRadius: string
  borderTopLeftRadius: string
  borderTopRightRadius: string
  borderBottomRightRadius: string
  borderBottomLeftRadius: string
  borderWidth: string
  borderColor: string
  overflow: string
  zIndex: string
  gravity: string
  orientation: string
  gap: string
  text: string
  textSize: string
  textColor: string
  pressFeedback: string
  pressRippleColor: string
  value: string
  placeholder: string
  src: string
  alt: string
  title: string
  objectFit: string
  loading: string
  iconId: string
  size: string
  color: string
  contentShadow: string
  rotateX: string
  rotateY: string
  rotateZ: string
  autoplay: boolean
  circular: boolean
  indicatorDots: boolean
  interval: string
  duration: string
  current: string
  indicatorColor: string
  indicatorActiveColor: string
  active: string
  windowKey: string
  closeOnClick: boolean
  layout_alignParentLeft: boolean
  layout_alignParentRight: boolean
  layout_alignParentTop: boolean
  layout_alignParentBottom: boolean
  layout_centerInParent: boolean
  layout_centerHorizontal: boolean
  layout_centerVertical: boolean
  layout_marginLeft: string
  layout_marginTop: string
  layout_marginRight: string
  layout_marginBottom: string
}

type StatusBarForm = {
  textStyle: string
  backgroundColor: string
  cover: string
  navigationBar: string
}

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

function createLayoutForm(): LayoutForm {
  return {
    name: '',
    widthMode: 'wrap_content',
    widthValue: '100',
    heightMode: 'wrap_content',
    heightValue: '40',
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
    pressFeedback: 'none',
    pressRippleColor: '',
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
    contentShadow: '',
    rotateX: '',
    rotateY: '',
    rotateZ: '',
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
  }
}

function parseSizeMode(value: string | undefined, fallbackValue: number) {
  if (!value || value === 'wrap_content') {
    return { mode: 'wrap_content', value: String(fallbackValue) }
  }
  if (value === 'match_parent') {
    return { mode: 'match_parent', value: String(fallbackValue) }
  }
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
        const itemType =
          typeof row.itemType === 'string'
            ? (row.itemType as DataFieldType)
            : undefined
        const itemTypeRef =
          typeof row.itemTypeRef === 'string' && row.itemTypeRef.trim()
            ? row.itemTypeRef.trim()
            : undefined
        const itemItemType =
          typeof row.itemItemType === 'string'
            ? (row.itemItemType as DataFieldType)
            : undefined
        const itemItemTypeRef =
          typeof row.itemItemTypeRef === 'string' && row.itemItemTypeRef.trim()
            ? row.itemItemTypeRef.trim()
            : undefined
        return {
          name,
          type,
          typeRef,
          itemType,
          itemTypeRef,
          itemItemType,
          itemItemTypeRef,
        } satisfies SlotParamRow
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
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
        ...(row.itemType ? { itemType: row.itemType } : {}),
        ...(row.itemTypeRef?.trim()
          ? { itemTypeRef: row.itemTypeRef.trim() }
          : {}),
        ...(row.itemItemType ? { itemItemType: row.itemItemType } : {}),
        ...(row.itemItemTypeRef?.trim()
          ? { itemItemTypeRef: row.itemItemTypeRef.trim() }
          : {}),
      }))
      .filter((row) => row.name),
  )
}

function parseInputValueBinding(raw: string | undefined): string {
  const m = (raw ?? '').trim().match(/^\{([A-Za-z_$][\w.$]*)\}$/)
  return m?.[1] ?? ''
}

function looksLikeDataBinding(raw: string | undefined): boolean {
  return /\{[^{}]+\}/.test(String(raw ?? ''))
}

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

function boolPropModel(
  rawValue: string | undefined,
  def: { name: string; defaultValue?: unknown },
): boolean {
  const raw = (rawValue ?? '').trim()
  if (raw === 'true' || raw === '1') return true
  if (raw === 'false' || raw === '0') return false
  return def.defaultValue === true || def.defaultValue === 'true' || def.defaultValue === 1
}

export default function PropsPanel({
  tab,
  xml,
  selectedId,
  dataFields,
  iconOptions,
  methods,
  emitEvents,
  componentProps,
  routeParams,
  componentMap,
  componentMethodsMap,
  projectPath,
  typeLibrary,
  openRepeatRequest,
  statusBarConfig,
  pageQueryParams,
  pageDebugQuery,
  isPageResource,
  canvasScene,
  backLabel,
  onXmlChange,
  onTabChange,
  onStatusBarChange,
  onPageQueryParamsChange,
  onPageDebugQueryChange,
  onBack,
}: {
  tab: PropsTab
  xml: string
  selectedId: string
  dataFields?: DataField[]
  iconOptions?: Array<{ id: string; label: string }>
  methods?: PageMethod[]
  emitEvents?: ComponentEventDef[]
  componentProps?: ComponentPropDef[] | null
  routeParams?: Record<string, unknown> | null
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  projectPath?: string
  typeLibrary?: DataTypeLibrary | null
  openRepeatRequest?: number
  statusBarConfig?: Partial<StatusBarConfig> | null
  pageQueryParams?: PageQueryParamDef[] | null
  pageDebugQuery?: Record<string, unknown> | null
  isPageResource?: boolean
  canvasScene?: 'h5' | 'miniprogram'
  backLabel?: string
  onXmlChange?: (xml: string) => void
  onTabChange?: (tab: PropsTab) => void
  onStatusBarChange?: (config: StatusBarConfig) => void
  onPageQueryParamsChange?: (value: PageQueryParamDef[]) => void
  onPageDebugQueryChange?: (value: Record<string, unknown>) => void
  onBack?: () => void
}) {
  const isStatusBarSelected = isStatusBarNodeId(selectedId)
  const slotOutletInfo = parseSlotOutletNodeId(selectedId)
  const isSlotOutletSelected = Boolean(slotOutletInfo)

  const [statusBarForm, setStatusBarForm] = useState<StatusBarForm>({
    textStyle: 'black',
    backgroundColor: '#ffffff',
    cover: 'false',
    navigationBar: 'true',
  })
  const statusBarFormRef = useRef(statusBarForm)
  statusBarFormRef.current = statusBarForm

  useEffect(() => {
    const next = normalizeStatusBarConfig(statusBarConfig)
    setStatusBarForm({
      textStyle: next.textStyle,
      backgroundColor: next.backgroundColor,
      cover:
        typeof next.cover === 'boolean' ? (next.cover ? 'true' : 'false') : String(next.cover),
      navigationBar:
        typeof next.navigationBar === 'boolean'
          ? next.navigationBar
            ? 'true'
            : 'false'
          : String(next.navigationBar),
    })
  }, [statusBarConfig])

  function commitStatusBar(form: StatusBarForm = statusBarFormRef.current) {
    const coverRaw = form.cover.trim()
    let cover: boolean | string = false
    if (looksLikeDataBinding(coverRaw)) cover = coverRaw
    else if (coverRaw === 'true' || coverRaw === '1') cover = true
    else if (coverRaw === 'false' || coverRaw === '0' || !coverRaw) cover = false
    else cover = coverRaw

    const navRaw = form.navigationBar.trim()
    let navigationBar: boolean | string = true
    if (looksLikeDataBinding(navRaw)) navigationBar = navRaw
    else if (navRaw === 'true' || navRaw === '1') navigationBar = true
    else if (navRaw === 'false' || navRaw === '0') navigationBar = false
    else if (!navRaw) navigationBar = true
    else navigationBar = navRaw

    onStatusBarChange?.({
      textStyle: form.textStyle.trim() || 'black',
      backgroundColor: form.backgroundColor.trim() || '#ffffff',
      cover,
      navigationBar,
    })
  }

  function patchStatusBar<K extends keyof StatusBarForm>(key: K, value: StatusBarForm[K]) {
    const next = { ...statusBarFormRef.current, [key]: value }
    statusBarFormRef.current = next
    setStatusBarForm(next)
    commitStatusBar(next)
  }

  const selectedNode = useMemo(
    () =>
      selectedId && !isStatusBarSelected && !isSlotOutletSelected
        ? findNodeFromXml(xml, selectedId)
        : null,
    [selectedId, isStatusBarSelected, isSlotOutletSelected, xml],
  )

  const isRootNode = Boolean(selectedId) && !selectedId.includes('/')

  const parentTag = selectedId ? findParentTagFromXml(xml, selectedId) : null

  const isRelativeChild =
    (parentTag === 'RelativeLayout' || parentTag === 'Modal') &&
    selectedNode?.tag !== 'Modal'

  const isComponentNode = selectedNode?.tag === 'Component'

  const isSlotNode = selectedNode?.tag === 'Slot'

  const isSlotContentNode = parentTag === 'Component' && !isComponentNode

  const [slotParamRows, setSlotParamRows] = useState<SlotParamRow[]>([])
  const slotParamRowsRef = useRef(slotParamRows)
  slotParamRowsRef.current = slotParamRows

  const selectedComponentDetail = useMemo(() => {
    if (!isComponentNode || !selectedNode) return null
    const id = selectedNode.attrs.componentId?.trim()
    if (!id || !componentMap) return null
    return componentMap[id] ?? null
  }, [isComponentNode, selectedNode, componentMap])

  const selectableEvents = useMemo(() => {
    if (isComponentNode) {
      const events = selectedComponentDetail?.config.events ?? []
      return events
        .map((item) => {
          const name = item.name.trim()
          if (!name) return null
          return {
            key: name,
            label: name,
          }
        })
        .filter((item): item is { key: string; label: string } => Boolean(item))
    }
    const list: { key: string; label: string }[] = INTERACTION_EVENTS.map((item) => ({
      key: item.key,
      label: item.label,
    }))
    const overflow = selectedNode?.attrs.overflow?.trim().toLowerCase()
    const tag = selectedNode?.tag
    if (
      overflow === 'scroll' &&
      (tag === 'LinearLayout' || tag === 'RelativeLayout')
    ) {
      for (const item of SCROLL_INTERACTION_EVENTS) {
        list.push({
          key: item.key,
          label: item.label,
        })
      }
    }
    return list
  }, [isComponentNode, selectedComponentDetail, selectedNode])

  const [eventForm, setEventForm] = useState<Record<string, string>>({})
  const eventFormRef = useRef(eventForm)
  eventFormRef.current = eventForm

  const [layoutForm, setLayoutForm] = useState<LayoutForm>(createLayoutForm)
  const layoutFormRef = useRef(layoutForm)
  layoutFormRef.current = layoutForm

  function syncEventForm() {
    const node = selectedNode
    const keys = selectableEvents.map((item) => item.key)
    const next: Record<string, string> = {}
    for (const key of keys) {
      next[key] = node?.attrs[key] ?? ''
    }
    eventFormRef.current = next
    setEventForm(next)
  }

  function syncLayoutForm() {
    const node = selectedNode
    if (!node) return

    const width = parseSizeMode(node.attrs.width, 100)
    const height = parseSizeMode(node.attrs.height, 40)
    const next = createLayoutForm()

    next.widthMode = width.mode
    next.widthValue = width.value
    next.heightMode = height.mode
    next.heightValue = height.value
    next.name = node.attrs.name ?? ''
    next.margin = node.attrs.margin ?? ''
    next.marginLeft = node.attrs.marginLeft ?? ''
    next.marginRight = node.attrs.marginRight ?? ''
    next.marginTop = node.attrs.marginTop ?? ''
    next.marginBottom = node.attrs.marginBottom ?? ''
    next.padding = node.attrs.padding ?? ''
    next.paddingLeft = node.attrs.paddingLeft ?? ''
    next.paddingRight = node.attrs.paddingRight ?? ''
    next.paddingTop = node.attrs.paddingTop ?? ''
    next.paddingBottom = node.attrs.paddingBottom ?? ''
    next.background = node.attrs.background ?? ''
    next.borderRadius = node.attrs.borderRadius ?? ''
    next.borderTopLeftRadius = node.attrs.borderTopLeftRadius ?? ''
    next.borderTopRightRadius = node.attrs.borderTopRightRadius ?? ''
    next.borderBottomRightRadius = node.attrs.borderBottomRightRadius ?? ''
    next.borderBottomLeftRadius = node.attrs.borderBottomLeftRadius ?? ''
    next.borderWidth = node.attrs.borderWidth ?? ''
    next.borderColor = node.attrs.borderColor ?? ''
    next.overflow = node.attrs.overflow || 'visible'
    next.zIndex = node.attrs.zIndex ?? ''
    next.gravity = node.attrs.gravity ?? ''
    next.orientation = node.attrs.orientation || 'vertical'
    next.gap = node.attrs.gap ?? ''
    next.text = node.attrs.text ?? node.text ?? ''
    next.textSize = node.attrs.textSize ?? ''
    next.textColor = node.attrs.textColor ?? ''
    next.pressFeedback = normalizePressFeedbackMode(node.attrs.pressFeedback)
    next.pressRippleColor = node.attrs.pressRippleColor ?? ''
    next.value = node.attrs.value ?? ''
    next.placeholder = node.attrs.placeholder ?? ''
    next.src = node.attrs.src ?? ''
    next.alt = node.attrs.alt ?? ''
    next.title = node.attrs.title ?? ''
    next.objectFit = node.attrs.objectFit || 'cover'
    next.loading = node.attrs.loading ?? ''
    next.iconId = node.attrs.iconId ?? ''
    next.size = node.attrs.size ?? ''
    next.color = node.attrs.color ?? ''
    next.contentShadow = node.attrs.contentShadow ?? ''
    next.rotateX = node.attrs.rotateX ?? ''
    next.rotateY = node.attrs.rotateY ?? ''
    next.rotateZ = node.attrs.rotateZ ?? ''
    next.autoplay = node.attrs.autoplay === 'true'
    next.circular =
      node.attrs.circular == null ||
      node.attrs.circular === '' ||
      node.attrs.circular === 'true'
    next.indicatorDots =
      node.attrs.indicatorDots == null ||
      node.attrs.indicatorDots === '' ||
      node.attrs.indicatorDots === 'true'
    next.interval = node.attrs.interval ?? '3000'
    next.duration = node.attrs.duration ?? '280'
    next.current = node.attrs.current ?? '0'
    next.indicatorColor = node.attrs.indicatorColor ?? ''
    next.indicatorActiveColor = node.attrs.indicatorActiveColor ?? ''
    next.active = node.attrs.active ?? ''
    next.windowKey = node.attrs.windowKey ?? ''
    next.closeOnClick =
      node.attrs.closeOnClick == null ||
      node.attrs.closeOnClick === '' ||
      node.attrs.closeOnClick === 'true'

    for (const item of RELATIVE_BOOL_ATTRS) {
      next[item.key] = node.attrs[item.key] === 'true'
    }
    next.layout_marginLeft = node.attrs.layout_marginLeft ?? ''
    next.layout_marginTop = node.attrs.layout_marginTop ?? ''
    next.layout_marginRight = node.attrs.layout_marginRight ?? ''
    next.layout_marginBottom = node.attrs.layout_marginBottom ?? ''

    layoutFormRef.current = next
    setLayoutForm(next)
  }

  function syncSlotParamRows() {
    if (!isSlotNode || !selectedNode) {
      slotParamRowsRef.current = []
      setSlotParamRows([])
      return
    }
    const next = parseSlotParams(selectedNode.attrs.params)
    slotParamRowsRef.current = next
    setSlotParamRows(next)
  }

  function commitAttr(name: string, value: string) {
    if (!selectedId || !selectedNode) return
    try {
      const text = value == null ? '' : String(value).trim()
      const next = setNodeAttribute(xml, selectedId, name, text)
      onXmlChange?.(next)
    } catch (err) {
      console.error(err)
    }
  }

  function commitSlotParams(rows: SlotParamRow[] = slotParamRowsRef.current) {
    commitAttr('params', serializeSlotParams(rows))
  }

  function addSlotParam() {
    const next = [...slotParamRowsRef.current, { name: '', type: 'string' as DataFieldType }]
    slotParamRowsRef.current = next
    setSlotParamRows(next)
    commitSlotParams(next)
  }

  function removeSlotParam(index: number) {
    const next = slotParamRowsRef.current.filter((_, i) => i !== index)
    slotParamRowsRef.current = next
    setSlotParamRows(next)
    commitSlotParams(next)
  }

  function handleSlotParamTypeChange(index: number, payload: TypeSelectPayload) {
    const rows = slotParamRowsRef.current
    const row = rows[index]
    if (!row || payload.cleared || payload.type === 'void' || payload.type === 'generic') {
      return
    }
    const next = rows.map((item, i) =>
      i === index
        ? {
            ...item,
            type: payload.type as DataFieldType,
            typeRef: payload.typeRef,
            itemType: payload.itemType === 'generic' ? undefined : payload.itemType,
            itemTypeRef: payload.itemTypeRef,
            itemItemType:
              payload.itemItemType === 'generic' ? undefined : payload.itemItemType,
            itemItemTypeRef: payload.itemItemTypeRef,
          }
        : item,
    )
    slotParamRowsRef.current = next
    setSlotParamRows(next)
    commitSlotParams(next)
  }

  function commitSlotName(value: string) {
    const name = value.trim() || 'default'
    const next = { ...layoutFormRef.current, name }
    layoutFormRef.current = next
    setLayoutForm(next)
    commitAttr('name', name)
  }

  function stripModalLayoutAttrsIfNeeded() {
    const node = selectedNode
    if (!node || node.tag !== 'Modal' || !selectedId) return
    const stale = MODAL_IGNORED_LAYOUT_ATTRS.filter((key) => node.attrs[key])
    if (!stale.length) return
    let next = xml
    for (const key of stale) {
      next = setNodeAttribute(next, selectedId, key, '')
    }
    onXmlChange?.(next)
  }

  const selectableEventKey = selectableEvents.map((item) => item.key).join(',')

  useEffect(() => {
    syncEventForm()
    syncLayoutForm()
    syncSlotParamRows()
    queueMicrotask(() => stripModalLayoutAttrsIfNeeded())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, selectableEventKey])

  useEffect(() => {
    if (tab === 'style') {
      syncLayoutForm()
      syncSlotParamRows()
    }
    if (tab === 'event') syncEventForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml])

  function eventBindingSummary(key: string): string {
    const count = countEventBindings(eventForm[key])
    if (!count) return '未配置'
    return `已绑定 ${count} 个方法`
  }

  const [eventBindVisible, setEventBindVisible] = useState(false)
  const [imageOssPickerVisible, setImageOssPickerVisible] = useState(false)
  const [eventBindKey, setEventBindKey] = useState('onClick')
  const [eventBindLabel, setEventBindLabel] = useState('')
  const [eventBindParams, setEventBindParams] = useState<MethodParam[]>([])

  function openEventBind(key: string, label: string) {
    setEventBindKey(key)
    setEventBindLabel(label)
    if (isComponentNode) {
      const def = (selectedComponentDetail?.config.events ?? []).find(
        (item) => item.name.trim() === key,
      )
      setEventBindParams(
        (def?.params ?? [])
          .filter((item) => item.name.trim())
          .map((item) => ({ name: item.name.trim(), type: item.type })),
      )
    } else {
      setEventBindParams(interactionEventParams(key))
    }
    setEventBindVisible(true)
  }

  function handleEventBindSave(value: string) {
    const next = { ...eventFormRef.current, [eventBindKey]: value }
    eventFormRef.current = next
    setEventForm(next)
    commitAttr(eventBindKey, value)
  }

  function commitWidth(value?: string) {
    const form = layoutFormRef.current
    const widthValue = value !== undefined ? value : form.widthValue
    if (value !== undefined) {
      const next = { ...form, widthValue: value }
      layoutFormRef.current = next
      setLayoutForm(next)
    }
    commitAttr('width', sizeToAttr(layoutFormRef.current.widthMode, widthValue))
  }

  function commitHeight(value?: string) {
    const form = layoutFormRef.current
    const heightValue = value !== undefined ? value : form.heightValue
    if (value !== undefined) {
      const next = { ...form, heightValue: value }
      layoutFormRef.current = next
      setLayoutForm(next)
    }
    commitAttr('height', sizeToAttr(layoutFormRef.current.heightMode, heightValue))
  }

  function patchLayout<K extends keyof LayoutForm>(key: K, value: LayoutForm[K]) {
    const next = { ...layoutFormRef.current, [key]: value }
    layoutFormRef.current = next
    setLayoutForm(next)
    return next
  }

  function commitLayoutAttr<K extends keyof LayoutForm>(key: K, value: LayoutForm[K], attr?: string) {
    patchLayout(key, value)
    commitAttr(attr ?? String(key), String(value ?? ''))
  }

  function commitRelativeBool(key: RelativeBoolKey, checked: boolean) {
    patchLayout(key, checked)
    commitAttr(key, checked ? 'true' : '')
  }

  const showTextProps =
    selectedNode?.tag === 'Text' || selectedNode?.tag === 'Button'

  const showButtonProps = selectedNode?.tag === 'Button'

  const showPressRippleColor =
    showButtonProps &&
    pressFeedbackHasRipple(normalizePressFeedbackMode(layoutForm.pressFeedback))

  function commitPressFeedback(value?: string) {
    const mode = normalizePressFeedbackMode(value ?? layoutFormRef.current.pressFeedback)
    patchLayout('pressFeedback', mode)
    commitAttr('pressFeedback', mode === 'none' ? '' : mode)
  }

  const showInputProps = selectedNode?.tag === 'Input'

  const showImageProps = selectedNode?.tag === 'Image'

  function openImageOssPicker() {
    if (!projectPath?.trim()) {
      ElMessage.warning('未打开项目，无法选择对象存储资源')
      return
    }
    setImageOssPickerVisible(true)
  }

  function onImageOssPicked(config: OssBindingConfig) {
    const url = (config.url || '').trim()
    patchLayout('src', url)
    commitAttr('src', url)
  }

  const showIconProps = selectedNode?.tag === 'Icon'

  const showRotateProps = (() => {
    const tag = selectedNode?.tag
    return tag === 'Text' || tag === 'Image' || tag === 'Icon'
  })()

  const showSwiperProps = selectedNode?.tag === 'Swiper'
  const showMultiWindowProps = selectedNode?.tag === 'MultiWindow'
  const showModalProps = selectedNode?.tag === 'Modal'
  const isMultiWindowChild = parentTag === 'MultiWindow'

  const showSizeProps = selectedNode?.tag !== 'Modal'
  const showMarginProps = selectedNode?.tag !== 'Modal'

  const componentPropDefs = useMemo(
    () =>
      (selectedComponentDetail?.config.props ?? []).filter((item) => item.name.trim()),
    [selectedComponentDetail],
  )

  const [componentPropForm, setComponentPropForm] = useState<Record<string, string>>({})
  const componentPropFormRef = useRef(componentPropForm)
  componentPropFormRef.current = componentPropForm

  function syncComponentPropForm() {
    const node = selectedNode
    const defs = componentPropDefs
    const next: Record<string, string> = {}
    if (node && node.tag === 'Component') {
      for (const def of defs) {
        const name = def.name.trim()
        next[name] = node.attrs[name] ?? ''
      }
    }
    componentPropFormRef.current = next
    setComponentPropForm(next)
  }

  useEffect(() => {
    syncComponentPropForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, componentPropDefs, xml])

  function commitComponentProp(name: string, value?: string) {
    const nextValue = value !== undefined ? value : (componentPropFormRef.current[name] ?? '')
    const next = { ...componentPropFormRef.current, [name]: nextValue }
    componentPropFormRef.current = next
    setComponentPropForm(next)
    commitAttr(name, nextValue)
  }

  function commitComponentBoolProp(name: string, checked: boolean) {
    commitComponentProp(name, checked ? 'true' : 'false')
  }

  function clearComponentProp(name: string) {
    commitComponentProp(name, '')
  }

  const nearestRepeatListName = useMemo(
    () => findNearestRepeatListName(xml, selectedId),
    [xml, selectedId],
  )

  const iconSelectOptions = useMemo(() => {
    const library = iconOptions ?? []
    const repeatList = nearestRepeatListName
    const itemIcons = listRepeatItemIconOptions(
      dataFields ?? [],
      repeatList,
      componentProps,
    )
    const seen = new Set<string>()
    const merged: Array<{ id: string; label: string }> = []
    for (const opt of [...itemIcons, ...library]) {
      if (!opt.id || seen.has(opt.id)) continue
      seen.add(opt.id)
      merged.push(opt)
    }
    return merged
  }, [iconOptions, nearestRepeatListName, dataFields, componentProps])

  const attrBindShared = useMemo(
    () => ({
      dataFields: dataFields ?? [],
      componentProps,
      routeParams,
      pageQueryParams,
      repeatListName: nearestRepeatListName,
      iconOptions: iconSelectOptions,
      typeLibrary,
      projectPath,
    }),
    [
      dataFields,
      componentProps,
      routeParams,
      pageQueryParams,
      nearestRepeatListName,
      iconSelectOptions,
      typeLibrary,
      projectPath,
    ],
  )

  const showLinearProps = selectedNode?.tag === 'LinearLayout'

  const showLayoutContainerProps =
    selectedNode?.tag === 'LinearLayout' ||
    selectedNode?.tag === 'RelativeLayout' ||
    selectedNode?.tag === 'Swiper' ||
    selectedNode?.tag === 'MultiWindow' ||
    selectedNode?.tag === 'Modal' ||
    selectedNode?.tag === 'Image' ||
    selectedNode?.tag === 'Input'

  const showOverflowProps =
    selectedNode?.tag === 'LinearLayout' ||
    selectedNode?.tag === 'RelativeLayout' ||
    selectedNode?.tag === 'Swiper' ||
    selectedNode?.tag === 'MultiWindow'

  const overflowOptionsForNode = useMemo(() => {
    if (
      selectedNode?.tag === 'Swiper' ||
      selectedNode?.tag === 'MultiWindow'
    ) {
      return OVERFLOW_OPTIONS.filter((item) => item.value !== 'scroll')
    }
    return OVERFLOW_OPTIONS
  }, [selectedNode])

  const arrayFieldOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = []
    for (const field of dataFields ?? []) {
      if (field.type !== 'array' || !field.name.trim()) continue
      const name = field.name.trim()
      const remark = field.remark?.trim()
      options.push({
        value: name,
        label: remark ? `数据池 · ${name} · ${remark}` : `数据池 · ${name}`,
      })
    }
    for (const def of componentProps ?? []) {
      if (def.type !== 'array' || !def.name.trim()) continue
      const name = def.name.trim()
      const remark = def.remark?.trim()
      options.push({
        value: `$props.${name}`,
        label: remark ? `$props · ${name} · ${remark}` : `$props · ${name}`,
      })
    }
    return options
  }, [dataFields, componentProps])

  const stringFieldOptions = useMemo(
    () =>
      (dataFields ?? [])
        .filter((field) => field.type === 'string' && field.name.trim())
        .map((field) => {
          const name = field.name.trim()
          const remark = field.remark?.trim()
          return {
            value: name,
            label: remark ? `${name} · ${remark}` : name,
          }
        }),
    [dataFields],
  )

  const activeFieldOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = []
    for (const field of dataFields ?? []) {
      if (
        (field.type !== 'string' && field.type !== 'number') ||
        !field.name.trim()
      ) {
        continue
      }
      const name = field.name.trim()
      const remark = field.remark?.trim()
      const typeLabel = field.type === 'number' ? '数字' : '字符串'
      options.push({
        value: name,
        label: remark
          ? `数据池 · ${name} · ${remark}（${typeLabel}）`
          : `数据池 · ${name}（${typeLabel}）`,
      })
    }
    for (const def of componentProps ?? []) {
      if (
        (def.type !== 'string' && def.type !== 'number') ||
        !def.name.trim()
      ) {
        continue
      }
      const name = def.name.trim()
      const remark = def.remark?.trim()
      const typeLabel = def.type === 'number' ? '数字' : '字符串'
      options.push({
        value: `$props.${name}`,
        label: remark
          ? `$props · ${name} · ${remark}（${typeLabel}）`
          : `$props · ${name}（${typeLabel}）`,
      })
    }
    return options
  }, [dataFields, componentProps])

  const modelSummary = (() => {
    const field = parseInputValueBinding(selectedNode?.attrs.value)
    return field || '未配置'
  })()

  const activeSummary = (() => {
    const field = parseInputValueBinding(selectedNode?.attrs.active)
    if (field) return field
    const literal = selectedNode?.attrs.active?.trim()
    return literal || '未配置'
  })()

  const [modelDialogVisible, setModelDialogVisible] = useState(false)
  const [modelForm, setModelForm] = useState({ field: '' })
  const modelFormRef = useRef(modelForm)
  modelFormRef.current = modelForm

  const [activeDialogVisible, setActiveDialogVisible] = useState(false)
  const [activeForm, setActiveForm] = useState({ field: '' })
  const activeFormRef = useRef(activeForm)
  activeFormRef.current = activeForm

  function openModelDialog() {
    if (!selectedNode || selectedNode.tag !== 'Input') return
    const next = { field: parseInputValueBinding(selectedNode.attrs.value) }
    modelFormRef.current = next
    setModelForm(next)
    setModelDialogVisible(true)
  }

  function openActiveDialog() {
    if (!selectedNode || selectedNode.tag !== 'MultiWindow') return
    const next = { field: parseInputValueBinding(selectedNode.attrs.active) }
    activeFormRef.current = next
    setActiveForm(next)
    setActiveDialogVisible(true)
  }

  function saveModelConfig() {
    if (!selectedId || !selectedNode || selectedNode.tag !== 'Input') {
      return
    }
    const name = modelFormRef.current.field.trim()
    try {
      const next = setNodeAttribute(
        xml,
        selectedId,
        'value',
        name ? `{${name}}` : '',
      )
      onXmlChange?.(next)
      setModelDialogVisible(false)
    } catch (err) {
      console.error(err)
    }
  }

  function saveActiveConfig() {
    if (
      !selectedId ||
      !selectedNode ||
      selectedNode.tag !== 'MultiWindow'
    ) {
      return
    }
    const name = activeFormRef.current.field.trim()
    try {
      const nextXml = setNodeAttribute(
        xml,
        selectedId,
        'active',
        name ? `{${name}}` : '',
      )
      onXmlChange?.(nextXml)
      patchLayout('active', name ? `{${name}}` : '')
      setActiveDialogVisible(false)
    } catch (err) {
      console.error(err)
    }
  }

  function clearModelConfig() {
    if (!selectedId || !selectedNode || selectedNode.tag !== 'Input') {
      return
    }
    try {
      const next = setNodeAttribute(xml, selectedId, 'value', '')
      onXmlChange?.(next)
      setModelDialogVisible(false)
    } catch (err) {
      console.error(err)
    }
  }

  function clearActiveConfig() {
    if (
      !selectedId ||
      !selectedNode ||
      selectedNode.tag !== 'MultiWindow'
    ) {
      return
    }
    try {
      const next = setNodeAttribute(xml, selectedId, 'active', '')
      onXmlChange?.(next)
      patchLayout('active', '')
      setActiveDialogVisible(false)
    } catch (err) {
      console.error(err)
    }
  }

  const repeatSummary = (() => {
    const node = selectedNode
    if (!node) return ''
    const list = node.attrs.repeat?.trim()
    if (!list) return '未配置'
    const index = node.attrs.repeatIndex?.trim()
    return index ? `${list}[${index}]` : list
  })()

  const [repeatDialogVisible, setRepeatDialogVisible] = useState(false)
  const [repeatForm, setRepeatForm] = useState({ list: '', index: '' })
  const repeatFormRef = useRef(repeatForm)
  repeatFormRef.current = repeatForm

  function openRepeatDialog() {
    const node = selectedNode
    if (!node || isRootNode) return
    const next = {
      list: node.attrs.repeat ?? '',
      index: node.attrs.repeatIndex ?? '',
    }
    repeatFormRef.current = next
    setRepeatForm(next)
    setRepeatDialogVisible(true)
  }

  const prevOpenRepeatRequest = useRef(openRepeatRequest)
  useEffect(() => {
    if (prevOpenRepeatRequest.current === openRepeatRequest) return
    prevOpenRepeatRequest.current = openRepeatRequest
    if (!openRepeatRequest) return
    onTabChange?.('dynamic')
    queueMicrotask(() => openRepeatDialog())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRepeatRequest])

  function saveRepeatConfig() {
    if (!selectedId || !selectedNode || isRootNode) return
    try {
      const next = setNodeAttributes(xml, selectedId, {
        repeat: repeatFormRef.current.list.trim(),
        repeatIndex: repeatFormRef.current.index.trim(),
      })
      onXmlChange?.(next)
      setRepeatDialogVisible(false)
    } catch (err) {
      console.error(err)
    }
  }

  function clearRepeatConfig() {
    if (!selectedId || !selectedNode || isRootNode) return
    try {
      const next = setNodeAttributes(xml, selectedId, {
        repeat: '',
        repeatIndex: '',
      })
      onXmlChange?.(next)
      setRepeatDialogVisible(false)
    } catch (err) {
      console.error(err)
    }
  }

  const dynamicStylesConfig = useMemo<DynamicStylesConfig>(
    () => parseDynamicStyles(selectedNode?.attrs[DYNAMIC_STYLES_ATTR]),
    [selectedNode],
  )

  const [styleStateDialogVisible, setStyleStateDialogVisible] = useState(false)
  const [editingStyleState, setEditingStyleState] = useState<DynamicStyleState | null>(null)

  function commitDynamicStyles(config: DynamicStylesConfig) {
    if (!selectedId || !selectedNode) return
    try {
      const next = setNodeAttribute(
        xml,
        selectedId,
        DYNAMIC_STYLES_ATTR,
        serializeDynamicStyles(config),
      )
      onXmlChange?.(next)
    } catch (err) {
      console.error(err)
    }
  }

  function addStyleState() {
    const states = [...dynamicStylesConfig.states]
    const state = createEmptyState(states.length + 1)
    states.push(state)
    commitDynamicStyles({ states })
    setEditingStyleState(state)
    setStyleStateDialogVisible(true)
  }

  function openStyleState(state: DynamicStyleState) {
    setEditingStyleState({
      ...state,
      scenarios: state.scenarios.map((scene) => ({
        ...scene,
        conditions: scene.conditions.map((cond) => ({ ...cond })),
      })),
      styles: { ...state.styles },
    })
    setStyleStateDialogVisible(true)
  }

  function saveStyleState(state: DynamicStyleState) {
    const states = dynamicStylesConfig.states.map((item) =>
      item.id === state.id ? state : item,
    )
    if (!states.some((item) => item.id === state.id)) {
      states.push(state)
    }
    commitDynamicStyles({ states })
  }

  function removeStyleState(stateId: string) {
    commitDynamicStyles({
      states: dynamicStylesConfig.states.filter((item) => item.id !== stateId),
    })
  }

  const showIfConfig = useMemo(
    () => parseVisibilityConditions(selectedNode?.attrs[V_SHOW_ATTR]),
    [selectedNode],
  )

  const mountIfConfig = useMemo(
    () => parseVisibilityConditions(selectedNode?.attrs[V_IF_ATTR]),
    [selectedNode],
  )

  const showIfSummary = visibilitySummary(showIfConfig)
  const mountIfSummary = visibilitySummary(mountIfConfig)

  const [visibilityDialogVisible, setVisibilityDialogVisible] = useState(false)
  const [visibilityDialogKind, setVisibilityDialogKind] = useState<'show' | 'mount'>('show')
  const [editingVisibilityConfig, setEditingVisibilityConfig] =
    useState<VisibilityConditionConfig | null>(null)

  const visibilityDialogTitle =
    visibilityDialogKind === 'show' ? '编辑显示条件' : '编辑挂载条件'

  function openVisibilityDialog(kind: 'show' | 'mount') {
    setVisibilityDialogKind(kind)
    const config = kind === 'show' ? showIfConfig : mountIfConfig
    setEditingVisibilityConfig(
      config.scenarios.length
        ? {
            scenarios: config.scenarios.map((scene) => ({
              ...scene,
              conditions: scene.conditions.map((cond) => ({ ...cond })),
            })),
          }
        : createEmptyVisibilityConfig(),
    )
    setVisibilityDialogVisible(true)
  }

  function commitVisibilityAttr(attr: string, config: VisibilityConditionConfig) {
    if (!selectedId || !selectedNode) return
    try {
      const next = setNodeAttribute(
        xml,
        selectedId,
        attr,
        serializeVisibilityConditions(config),
      )
      onXmlChange?.(next)
    } catch (err) {
      console.error(err)
    }
  }

  function saveVisibilityConfig(config: VisibilityConditionConfig) {
    const attr = visibilityDialogKind === 'show' ? V_SHOW_ATTR : V_IF_ATTR
    commitVisibilityAttr(attr, config)
  }

  const panelBodyRef = useRef<HTMLDivElement | null>(null)
  const sectionNavRef = useRef<HTMLElement | null>(null)
  const [activeSectionId, setActiveSectionId] = useState('')
  const scrollingToSection = useRef(false)
  const scrollSpyRaf = useRef(0)

  const styleNavItems = useMemo(() => {
    if (!selectedNode || isStatusBarSelected || isSlotOutletSelected) {
      return [] as Array<{ id: string; label: string }>
    }
    const items: Array<{ id: string; label: string }> = [
      { id: 'basic', label: '基本' },
    ]
    if (isSlotNode) items.push({ id: 'slot-params', label: '传参' })
    if (showSizeProps) items.push({ id: 'size', label: '尺寸' })
    items.push({ id: 'spacing', label: '间距' })
    items.push({ id: 'appearance', label: '外观' })
    if (showTextProps) items.push({ id: 'text', label: '内容' })
    if (showInputProps) items.push({ id: 'input', label: '输入' })
    if (showImageProps) items.push({ id: 'image', label: '图片' })
    if (showIconProps) items.push({ id: 'icon', label: '图标' })
    if (showRotateProps) items.push({ id: 'rotate', label: '旋转' })
    if (showLinearProps) items.push({ id: 'linear', label: '线性布局' })
    if (showSwiperProps) items.push({ id: 'swiper', label: '滑动窗口' })
    if (showMultiWindowProps) items.push({ id: 'multi-window', label: '多窗口' })
    if (isMultiWindowChild) items.push({ id: 'window-key', label: '窗口项名' })
    if (showModalProps) items.push({ id: 'modal', label: '弹层' })
    if (isRelativeChild) items.push({ id: 'relative', label: '相对定位' })
    return items
  }, [
    selectedNode,
    isStatusBarSelected,
    isSlotOutletSelected,
    isSlotNode,
    showSizeProps,
    showTextProps,
    showInputProps,
    showImageProps,
    showIconProps,
    showRotateProps,
    showLinearProps,
    showSwiperProps,
    showMultiWindowProps,
    isMultiWindowChild,
    showModalProps,
    isRelativeChild,
  ])

  const dynamicNavItems = useMemo(() => {
    if (!selectedNode || isStatusBarSelected || isSlotOutletSelected) {
      return [] as Array<{ id: string; label: string }>
    }
    const items: Array<{ id: string; label: string }> = []
    if (isComponentNode) items.push({ id: 'dyn-props', label: '组件参数' })
    items.push({ id: 'dyn-repeat', label: '列表渲染' })
    if (showInputProps) items.push({ id: 'dyn-model', label: '双向绑定' })
    if (showMultiWindowProps) {
      items.push({ id: 'dyn-active', label: '激活项' })
    }
    items.push({ id: 'dyn-vshow', label: '显示条件' })
    items.push({ id: 'dyn-vif', label: '挂载条件' })
    items.push({ id: 'dyn-styles', label: '动态样式' })
    return items
  }, [
    selectedNode,
    isStatusBarSelected,
    isSlotOutletSelected,
    isComponentNode,
    showInputProps,
    showMultiWindowProps,
  ])

  const currentNavItems = tab === 'style' ? styleNavItems : tab === 'dynamic' ? dynamicNavItems : []

  function updateActiveSectionFromScroll() {
    if (scrollingToSection.current) return
    const root = panelBodyRef.current
    const items = currentNavItems
    if (!root || !items.length) {
      setActiveSectionId('')
      return
    }
    const navH = sectionNavRef.current?.offsetHeight ?? 0
    const threshold = root.getBoundingClientRect().top + navH + 10
    let current = items[0]!.id
    for (const item of items) {
      const el = root.querySelector<HTMLElement>(
        `[data-section-id="${item.id}"]`,
      )
      if (!el) continue
      if (el.getBoundingClientRect().top <= threshold) {
        current = item.id
      }
    }
    setActiveSectionId(current)
  }

  function onPanelBodyScroll() {
    if (scrollSpyRaf.current) cancelAnimationFrame(scrollSpyRaf.current)
    scrollSpyRaf.current = requestAnimationFrame(() => {
      scrollSpyRaf.current = 0
      updateActiveSectionFromScroll()
    })
  }

  function scrollToSection(id: string) {
    const root = panelBodyRef.current
    const el = root?.querySelector<HTMLElement>(`[data-section-id="${id}"]`)
    if (!root || !el) return

    scrollingToSection.current = true
    setActiveSectionId(id)
    const navH = sectionNavRef.current?.offsetHeight ?? 0
    const elRect = el.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const top = elRect.top - rootRect.top - navH - 6 + root.scrollTop
    root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })

    window.setTimeout(() => {
      scrollingToSection.current = false
      updateActiveSectionFromScroll()
    }, 420)
  }

  const currentNavKey = currentNavItems.map((item) => item.id).join(',')

  useEffect(() => {
    queueMicrotask(() => {
      if (
        currentNavItems.length &&
        !currentNavItems.some((i) => i.id === activeSectionId)
      ) {
        setActiveSectionId(currentNavItems[0]!.id)
      }
      updateActiveSectionFromScroll()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedId, currentNavKey])

  useEffect(() => {
    return () => {
      if (scrollSpyRaf.current) cancelAnimationFrame(scrollSpyRaf.current)
    }
  }, [])

  function renderSectionNav(
    items: Array<{ id: string; label: string }>,
    ariaLabel: string,
  ) {
    if (items.length <= 1) return null
    return (
      <nav
        ref={sectionNavRef}
        className="prop-section-nav"
        aria-label={ariaLabel}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`prop-section-nav-item${activeSectionId === item.id ? ' active' : ''}`}
            onClick={() => scrollToSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    )
  }

  function renderStyleBody() {
    if (isSlotOutletSelected) {
      return (
        <div className="layout-form">
          <div className="node-brief">
            <div className="node-tag">Slot</div>
            <div className="node-id">{selectedId}</div>
          </div>
          <section className="prop-section" data-section-id="slot">
            <div className="section-title">插槽</div>
            <Form layout="vertical" size="small">
              <Form.Item label="插槽名称">
                <Input value={slotOutletInfo?.slotName || 'default'} disabled />
              </Form.Item>
            </Form>
            <p className="hint">
              在此选中插槽后添加控件，内容会注入到该插槽。也可从控件树将节点拖入插槽。
            </p>
          </section>
        </div>
      )
    }

    if (isStatusBarSelected) {
      return (
        <div className="layout-form">
          <div className="node-brief">
            <div className="node-tag">StatusBar</div>
            <div className="node-id">系统状态栏</div>
          </div>

          {canvasScene !== 'miniprogram' ? (
            <Alert
              className="status-bar-tip"
              type="warning"
              showIcon
              closable={false}
              message="H5 场景不支持控制状态栏"
              description="状态栏样式参考微信小程序（navigationBarTextStyle / 背景色），仅在「微信小程序」场景下生效。请切换到右下角「微信小程序」预览。"
            />
          ) : null}

          <div className="section-title">风格</div>
          <Form layout="vertical" size="small" disabled={canvasScene !== 'miniprogram'}>
            <Form.Item label="文字样式 textStyle">
              <AttrBindField
                {...attrBindShared}
                value={statusBarForm.textStyle}
                placeholder="black / white / 绑定"
                onChange={(v) => patchStatusBar('textStyle', v)}
              />
            </Form.Item>
            <Form.Item label="背景色 backgroundColor">
              <AttrBindField
                {...attrBindShared}
                value={statusBarForm.backgroundColor}
                placeholder="色值 / 绑定"
                valueType="color"
                onChange={(v) => patchStatusBar('backgroundColor', v)}
              />
            </Form.Item>
            <Form.Item label="与页面重叠 cover">
              <AttrBindField
                {...attrBindShared}
                value={statusBarForm.cover}
                placeholder="true / false / 绑定"
                valueType="boolean"
                onChange={(v) => patchStatusBar('cover', v)}
              />
              <p className="hint">开启后状态栏浮在页面之上（沉浸式）。</p>
            </Form.Item>
            <Form.Item label="显示标题栏 navigationBar">
              <AttrBindField
                {...attrBindShared}
                value={statusBarForm.navigationBar}
                placeholder="true / false / 绑定"
                valueType="boolean"
                onChange={(v) => patchStatusBar('navigationBar', v)}
              />
              <p className="hint">
                开启后预览显示微信原生标题栏区域；关闭则隐藏，导出为
                <code>navigationStyle: custom</code>（适合自绘标题栏）。
              </p>
            </Form.Item>
          </Form>
        </div>
      )
    }

    if (!selectedNode && isPageResource) {
      return (
        <div className="layout-form">
          <PageQueryParamsPanel
            queryParams={pageQueryParams ?? []}
            debugQuery={pageDebugQuery ?? {}}
            onQueryParamsChange={onPageQueryParamsChange}
            onDebugQueryChange={onPageDebugQueryChange}
          />
        </div>
      )
    }

    if (!selectedNode) {
      return (
        <Empty description="请在控件树中选择节点" styles={{ image: { height: 64 } }} />
      )
    }

    return (
      <div className="layout-form">
        <div className="node-brief">
          <div className="node-tag">{selectedNode.tag}</div>
          <div className="node-id">{selectedId}</div>
        </div>

        {renderSectionNav(styleNavItems, '属性分区')}

        <section className="prop-section" data-section-id="basic">
          <div className="section-title">基本</div>
          <Form layout="vertical" size="small">
            {isSlotNode ? (
              <Form.Item label="插槽名称">
                <Input
                  value={layoutForm.name}
                  allowClear
                  placeholder="默认 default"
                  onChange={(e) => patchLayout('name', e.target.value)}
                  onBlur={() => commitSlotName(layoutFormRef.current.name)}
                  onPressEnter={() => commitSlotName(layoutFormRef.current.name)}
                />
              </Form.Item>
            ) : (
              <Form.Item label="name">
                <Input
                  value={layoutForm.name}
                  allowClear
                  placeholder="控件命名，显示在控件树"
                  onChange={(e) => patchLayout('name', e.target.value)}
                  onBlur={() => commitAttr('name', layoutFormRef.current.name)}
                  onPressEnter={() => commitAttr('name', layoutFormRef.current.name)}
                />
              </Form.Item>
            )}
            {isSlotContentNode ? (
              <Form.Item label="注入插槽 slot">
                <Input
                  value={selectedNode.attrs.slot || 'default'}
                  allowClear
                  placeholder="默认 default"
                  onChange={(e) =>
                    commitAttr('slot', (e.target.value ?? '').trim() || 'default')
                  }
                />
                <p className="hint">对应组件内 Slot 的 name</p>
              </Form.Item>
            ) : null}
          </Form>
        </section>

        {isSlotNode ? (
          <section className="prop-section" data-section-id="slot-params">
            <div className="section-title">传参（作用域）</div>
            <Form layout="vertical" size="small">
              <div className="slot-param-list">
                {slotParamRows.map((row, index) => (
                  <div key={index} className="slot-param-row">
                    <Input
                      value={row.name}
                      placeholder="参数名"
                      onChange={(e) => {
                        const name = e.target.value
                        const next = slotParamRowsRef.current.map((item, i) =>
                          i === index ? { ...item, name } : item,
                        )
                        slotParamRowsRef.current = next
                        setSlotParamRows(next)
                      }}
                      onBlur={() => commitSlotParams()}
                      onPressEnter={() => commitSlotParams()}
                    />
                    <DataFieldTypeTreeSelect
                      className="slot-param-type"
                      type={row.type}
                      typeRef={row.typeRef}
                      itemType={row.itemType}
                      itemTypeRef={row.itemTypeRef}
                      itemItemType={row.itemItemType}
                      itemItemTypeRef={row.itemItemTypeRef}
                      library={typeLibrary}
                      composable
                      size="small"
                      onChange={(payload) => handleSlotParamTypeChange(index, payload)}
                    />
                    <Button
                      type="link"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeSlotParam(index)}
                    />
                  </div>
                ))}
                <Button type="link" icon={<PlusOutlined />} onClick={addSlotParam}>
                  添加传参
                </Button>
                {!slotParamRows.length ? (
                  <p className="hint">
                    声明作用域参数（如 item）。导出为
                    <code>{'<slot :item="item" />'}</code>
                    ，父侧
                    <code>{'#default="{ item }"'}</code>。
                    画布上插槽内容使用宿主组件的数据池与 $props。
                  </p>
                ) : (
                  <p className="hint">
                    导出时父侧会解构这些参数；画布插槽内容走宿主 $props / 数据池。
                  </p>
                )}
              </div>
            </Form>
          </section>
        ) : null}

        {showSizeProps ? (
          <section className="prop-section" data-section-id="size">
            <div className="section-title">尺寸</div>
            <Form layout="vertical" size="small">
              <Form.Item label="宽度 width">
                <div className="size-row">
                  <Select
                    value={layoutForm.widthMode}
                    options={[...SIZE_OPTIONS]}
                    onChange={(mode) => {
                      patchLayout('widthMode', mode)
                      commitWidth()
                    }}
                  />
                  {layoutForm.widthMode === 'fixed' ? (
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.widthValue}
                      placeholder="数字或 {变量}"
                      onChange={commitWidth}
                    />
                  ) : null}
                </div>
              </Form.Item>

              <Form.Item label="高度 height">
                <div className="size-row">
                  <Select
                    value={layoutForm.heightMode}
                    options={[...SIZE_OPTIONS]}
                    onChange={(mode) => {
                      patchLayout('heightMode', mode)
                      commitHeight()
                    }}
                  />
                  {layoutForm.heightMode === 'fixed' ? (
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.heightValue}
                      placeholder="数字或 {变量}"
                      onChange={commitHeight}
                    />
                  ) : null}
                </div>
              </Form.Item>
            </Form>
          </section>
        ) : null}

        <section className="prop-section" data-section-id="spacing">
          <div className="section-title">间距</div>
          <Form layout="vertical" size="small">
            <Form.Item label="padding">
              <AttrBindField
                {...attrBindShared}
                value={layoutForm.padding}
                placeholder="数据池 / 常量 / 自定义"
                valueType="number"
                onChange={(v) => commitLayoutAttr('padding', v)}
              />
            </Form.Item>
            <div className="quad-grid">
              <Form.Item label="上">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.paddingTop}
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('paddingTop', v)}
                />
              </Form.Item>
              <Form.Item label="右">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.paddingRight}
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('paddingRight', v)}
                />
              </Form.Item>
              <Form.Item label="下">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.paddingBottom}
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('paddingBottom', v)}
                />
              </Form.Item>
              <Form.Item label="左">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.paddingLeft}
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('paddingLeft', v)}
                />
              </Form.Item>
            </div>

            {showMarginProps ? (
              <>
                <Form.Item label="margin">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.margin}
                    placeholder="数据池 / 常量 / 自定义"
                    valueType="number"
                    onChange={(v) => commitLayoutAttr('margin', v)}
                  />
                </Form.Item>
                <div className="quad-grid">
                  <Form.Item label="上">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.marginTop}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('marginTop', v)}
                    />
                  </Form.Item>
                  <Form.Item label="右">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.marginRight}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('marginRight', v)}
                    />
                  </Form.Item>
                  <Form.Item label="下">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.marginBottom}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('marginBottom', v)}
                    />
                  </Form.Item>
                  <Form.Item label="左">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.marginLeft}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('marginLeft', v)}
                    />
                  </Form.Item>
                </div>
              </>
            ) : null}
          </Form>
        </section>

        <section className="prop-section" data-section-id="appearance">
          <div className="section-title">外观</div>
          <Form layout="vertical" size="small">
            <Form.Item label="background">
              <AttrBindField
                {...attrBindShared}
                value={layoutForm.background}
                placeholder="transparent"
                valueType="color"
                onChange={(v) => commitLayoutAttr('background', v)}
              />
            </Form.Item>
            <Form.Item label="层级 zIndex">
              <AttrBindField
                {...attrBindShared}
                value={layoutForm.zIndex}
                placeholder="如 10，越大越靠上"
                valueType="number"
                onChange={(v) => commitLayoutAttr('zIndex', v)}
              />
            </Form.Item>
            {!showModalProps ? (
              <Form.Item label="gravity">
                <Select
                  value={layoutForm.gravity}
                  allowClear
                  placeholder="默认"
                  options={GRAVITY_OPTIONS.map((opt) => ({
                    label: opt.label,
                    value: opt.value,
                  }))}
                  onChange={(v) => {
                    const next = v ?? ''
                    patchLayout('gravity', next)
                    commitAttr('gravity', next)
                  }}
                />
              </Form.Item>
            ) : null}
            {showLayoutContainerProps ? (
              <>
                <Form.Item label="borderRadius 统一圆角">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.borderRadius}
                    placeholder="四角共用；分角优先"
                    valueType="number"
                    onChange={(v) => commitLayoutAttr('borderRadius', v)}
                  />
                </Form.Item>
                <div className="quad-grid">
                  <Form.Item label="上左">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.borderTopLeftRadius}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('borderTopLeftRadius', v)}
                    />
                  </Form.Item>
                  <Form.Item label="上右">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.borderTopRightRadius}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('borderTopRightRadius', v)}
                    />
                  </Form.Item>
                  <Form.Item label="下右">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.borderBottomRightRadius}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('borderBottomRightRadius', v)}
                    />
                  </Form.Item>
                  <Form.Item label="下左">
                    <AttrBindField
                      {...attrBindShared}
                      value={layoutForm.borderBottomLeftRadius}
                      valueType="number"
                      onChange={(v) => commitLayoutAttr('borderBottomLeftRadius', v)}
                    />
                  </Form.Item>
                </div>
                <Form.Item label="borderWidth">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.borderWidth}
                    placeholder="边框宽度"
                    valueType="number"
                    onChange={(v) => commitLayoutAttr('borderWidth', v)}
                  />
                </Form.Item>
                <Form.Item label="borderColor">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.borderColor}
                    placeholder="#dcdfe6"
                    valueType="color"
                    onChange={(v) => commitLayoutAttr('borderColor', v)}
                  />
                </Form.Item>
              </>
            ) : null}
            {showOverflowProps ? (
              <Form.Item label="overflow 溢出">
                <Select
                  value={layoutForm.overflow}
                  options={overflowOptionsForNode}
                  onChange={(v) => {
                    patchLayout('overflow', v)
                    commitAttr('overflow', v === 'visible' ? '' : v)
                  }}
                />
              </Form.Item>
            ) : null}
          </Form>
        </section>

        {showTextProps ? (
          <section className="prop-section" data-section-id="text">
            <div className="section-title">内容</div>
            <Form layout="vertical" size="small">
              <Form.Item label="text">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.text}
                  placeholder="数据池 / 常量 / 自定义"
                  onChange={(v) => commitLayoutAttr('text', v)}
                />
              </Form.Item>
              <Form.Item label="textSize">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.textSize}
                  placeholder="例如：16"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('textSize', v)}
                />
              </Form.Item>
              <Form.Item label="textColor">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.textColor}
                  placeholder="#303133"
                  valueType="color"
                  onChange={(v) => commitLayoutAttr('textColor', v)}
                />
              </Form.Item>
              {showButtonProps ? (
                <Form.Item label="按压反馈">
                  <Select
                    value={layoutForm.pressFeedback}
                    style={{ width: '100%' }}
                    options={[...PRESS_FEEDBACK_OPTIONS]}
                    onChange={(val) => commitPressFeedback(val)}
                  />
                </Form.Item>
              ) : null}
              {showPressRippleColor ? (
                <Form.Item label="波纹颜色">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.pressRippleColor}
                    placeholder="默认 rgba(0,0,0,0.22)"
                    valueType="color"
                    onChange={(v) => commitLayoutAttr('pressRippleColor', v)}
                  />
                </Form.Item>
              ) : null}
            </Form>
          </section>
        ) : null}

        {showInputProps ? (
          <section className="prop-section" data-section-id="input">
            <div className="section-title">输入</div>
            <Form layout="vertical" size="small">
              <Form.Item label="value">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.value}
                  placeholder="静态值，或在「动态」配置双向绑定"
                  onChange={(v) => commitLayoutAttr('value', v)}
                />
              </Form.Item>
              <Form.Item label="placeholder">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.placeholder}
                  placeholder="占位提示"
                  onChange={(v) => commitLayoutAttr('placeholder', v)}
                />
              </Form.Item>
              <Form.Item label="textSize">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.textSize}
                  placeholder="例如：14"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('textSize', v)}
                />
              </Form.Item>
              <Form.Item label="textColor">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.textColor}
                  placeholder="#303133"
                  valueType="color"
                  onChange={(v) => commitLayoutAttr('textColor', v)}
                />
              </Form.Item>
            </Form>
          </section>
        ) : null}

        {showImageProps ? (
          <section className="prop-section" data-section-id="image">
            <div className="section-title">图片</div>
            <Form layout="vertical" size="small">
              <Form.Item label="src">
                <div className="image-src-row">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.src}
                    placeholder="图片 URL / 绑定"
                    onChange={(v) => commitLayoutAttr('src', v)}
                  />
                  <Button type="link" onClick={openImageOssPicker}>
                    对象存储
                  </Button>
                </div>
              </Form.Item>
              <Form.Item label="alt">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.alt}
                  placeholder="替代文本"
                  onChange={(v) => commitLayoutAttr('alt', v)}
                />
              </Form.Item>
              <Form.Item label="title">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.title}
                  placeholder="悬停提示"
                  onChange={(v) => commitLayoutAttr('title', v)}
                />
              </Form.Item>
              <Form.Item label="objectFit">
                <Select
                  value={layoutForm.objectFit || undefined}
                  allowClear
                  placeholder="默认 cover"
                  options={[...IMAGE_OBJECT_FIT_OPTIONS]}
                  onChange={(v) => {
                    const next = v ?? ''
                    patchLayout('objectFit', next)
                    commitAttr('objectFit', next)
                  }}
                />
              </Form.Item>
              <Form.Item label="loading">
                <Select
                  value={layoutForm.loading || undefined}
                  allowClear
                  placeholder="默认 eager"
                  options={[...IMAGE_LOADING_OPTIONS]}
                  onChange={(v) => {
                    const next = v ?? ''
                    patchLayout('loading', next)
                    commitAttr('loading', next)
                  }}
                />
              </Form.Item>
            </Form>
          </section>
        ) : null}

        {showIconProps ? (
          <section className="prop-section" data-section-id="icon">
            <div className="section-title">图标</div>
            <Form layout="vertical" size="small">
              <Form.Item label="iconId">
                <IconValueSelect
                  value={layoutForm.iconId}
                  options={iconSelectOptions}
                  placeholder="选择图标或重复项字段"
                  onChange={(v) => commitLayoutAttr('iconId', v ?? '')}
                />
                {iconSelectOptions.some((o) => o.id.startsWith('{item.')) ? (
                  <p className="hint">
                    当前在重复列表内，可选 for 项下的图标字段（如
                    <code>{'{item.icon}'}</code>）
                  </p>
                ) : null}
              </Form.Item>
              <Form.Item label="size">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.size}
                  placeholder="例如：24"
                  onChange={(v) => commitLayoutAttr('size', v)}
                />
              </Form.Item>
              <Form.Item label="color">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.color}
                  placeholder="#303133"
                  valueType="color"
                  onChange={(v) => commitLayoutAttr('color', v)}
                />
              </Form.Item>
              <Form.Item label="圆角 borderRadius">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.borderRadius}
                  placeholder="例如：4 / 50%"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('borderRadius', v)}
                />
              </Form.Item>
              <Form.Item label="内容阴影">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.contentShadow}
                  placeholder="如 0 2px 8px rgba(0,0,0,.2)"
                  onChange={(v) => commitLayoutAttr('contentShadow', v)}
                />
              </Form.Item>
            </Form>
          </section>
        ) : null}

        {showRotateProps ? (
          <section className="prop-section" data-section-id="rotate">
            <div className="section-title">旋转</div>
            <Form layout="vertical" size="small">
              <Form.Item label="rotateX（度）">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.rotateX}
                  placeholder="0"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('rotateX', v)}
                />
              </Form.Item>
              <Form.Item label="rotateY（度）">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.rotateY}
                  placeholder="0"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('rotateY', v)}
                />
              </Form.Item>
              <Form.Item label="rotateZ（度）">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.rotateZ}
                  placeholder="0"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('rotateZ', v)}
                />
              </Form.Item>
            </Form>
          </section>
        ) : null}

        {showLinearProps ? (
          <section className="prop-section" data-section-id="linear">
            <div className="section-title">线性布局</div>
            <Form layout="vertical" size="small">
              <Form.Item label="orientation">
                <Select
                  value={layoutForm.orientation}
                  options={[...ORIENTATION_OPTIONS]}
                  onChange={(v) => {
                    patchLayout('orientation', v)
                    commitAttr('orientation', v)
                  }}
                />
              </Form.Item>
              <Form.Item label="gap">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.gap}
                  placeholder="子项间距"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('gap', v)}
                />
              </Form.Item>
            </Form>
          </section>
        ) : null}

        {showSwiperProps ? (
          <section className="prop-section" data-section-id="swiper">
            <div className="section-title">滑动窗口</div>
            <Form layout="vertical" size="small">
              <Form.Item label="autoplay 自动播放">
                <Switch
                  checked={layoutForm.autoplay}
                  onChange={(checked) => {
                    patchLayout('autoplay', checked)
                    commitAttr('autoplay', checked ? 'true' : '')
                  }}
                />
              </Form.Item>
              <Form.Item label="interval 间隔(ms)">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.interval}
                  placeholder="3000"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('interval', v)}
                />
              </Form.Item>
              <Form.Item label="circular 循环">
                <Switch
                  checked={layoutForm.circular}
                  onChange={(checked) => {
                    patchLayout('circular', checked)
                    commitAttr('circular', checked ? 'true' : 'false')
                  }}
                />
              </Form.Item>
              <Form.Item label="indicatorDots 指示点">
                <Switch
                  checked={layoutForm.indicatorDots}
                  onChange={(checked) => {
                    patchLayout('indicatorDots', checked)
                    commitAttr('indicatorDots', checked ? 'true' : 'false')
                  }}
                />
              </Form.Item>
              <Form.Item label="indicatorColor">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.indicatorColor}
                  placeholder="rgba(0,0,0,0.25)"
                  valueType="color"
                  onChange={(v) => commitLayoutAttr('indicatorColor', v)}
                />
              </Form.Item>
              <Form.Item label="indicatorActiveColor">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.indicatorActiveColor}
                  placeholder="#409eff"
                  valueType="color"
                  onChange={(v) => commitLayoutAttr('indicatorActiveColor', v)}
                />
              </Form.Item>
              <Form.Item label="duration 动画(ms)">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.duration}
                  placeholder="280"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('duration', v)}
                />
              </Form.Item>
              <Form.Item label="current 初始页">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.current}
                  placeholder="0"
                  valueType="number"
                  onChange={(v) => commitLayoutAttr('current', v)}
                />
              </Form.Item>
              <p className="hint">每个直接子控件为一页；预览时可左右滑动切换。</p>
            </Form>
          </section>
        ) : null}

        {showMultiWindowProps ? (
          <section className="prop-section" data-section-id="multi-window">
            <div className="section-title">多窗口</div>
            <Form layout="vertical" size="small">
              <p className="hint">
                按数据池激活项切换显示窗口。在「动态」中绑定激活项；点击画布右侧「新建窗口」添加子窗口，并为每个窗口设置项名
                <code>windowKey</code>。
              </p>
            </Form>
          </section>
        ) : null}

        {isMultiWindowChild ? (
          <section className="prop-section" data-section-id="window-key">
            <div className="section-title">窗口项名</div>
            <Form layout="vertical" size="small">
              <Form.Item label="windowKey">
                <AttrBindField
                  {...attrBindShared}
                  value={layoutForm.windowKey}
                  placeholder="与激活项匹配，如 home"
                  onChange={(v) => {
                    patchLayout('windowKey', v)
                    commitAttr('windowKey', v.trim())
                  }}
                />
              </Form.Item>
              <p className="hint">
                当激活项等于该值时显示本窗口。支持字符串或数字（按字符串比较）。
              </p>
            </Form>
          </section>
        ) : null}

        {showModalProps ? (
          <section className="prop-section" data-section-id="modal">
            <div className="section-title">弹层 Modal</div>
            <Form layout="vertical" size="small">
              <Form.Item label="closeOnClick 点击空白关闭">
                <Switch
                  checked={layoutForm.closeOnClick}
                  onChange={(checked) => {
                    patchLayout('closeOnClick', checked)
                    commitAttr('closeOnClick', checked ? 'true' : 'false')
                  }}
                />
              </Form.Item>
              <p className="hint">
                全屏弹层，子控件使用相对布局定位。用上方 name 作为标识；数据池「引用」指向本弹层后可
                <code>.show()</code> / <code>.hide()</code>。一屏仅显示栈顶；开启
                closeOnClick 后点击空白可关闭。
              </p>
            </Form>
          </section>
        ) : null}

        {isRelativeChild ? (
          <section className="prop-section" data-section-id="relative">
            <div className="section-title">相对布局定位</div>
            <Form layout="vertical" size="small">
              {parentTag === 'Modal' ? (
                <p className="hint">
                  贴边：贴父底/顶 + 宽度 match_parent；侧栏：贴父左/右 + 高度 match_parent。
                  抽屉圆角用外观里的「上左/上右/下左/下右」分角。
                </p>
              ) : null}
              {RELATIVE_BOOL_ATTRS.map((item) => (
                <Form.Item key={item.key} label={item.label}>
                  <Switch
                    checked={layoutForm[item.key]}
                    onChange={(checked) => commitRelativeBool(item.key, checked)}
                  />
                </Form.Item>
              ))}

              <div className="quad-grid">
                <Form.Item label="layout_marginTop">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.layout_marginTop}
                    onChange={(v) => commitLayoutAttr('layout_marginTop', v)}
                  />
                </Form.Item>
                <Form.Item label="layout_marginRight">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.layout_marginRight}
                    onChange={(v) => commitLayoutAttr('layout_marginRight', v)}
                  />
                </Form.Item>
                <Form.Item label="layout_marginBottom">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.layout_marginBottom}
                    onChange={(v) => commitLayoutAttr('layout_marginBottom', v)}
                  />
                </Form.Item>
                <Form.Item label="layout_marginLeft">
                  <AttrBindField
                    {...attrBindShared}
                    value={layoutForm.layout_marginLeft}
                    onChange={(v) => commitLayoutAttr('layout_marginLeft', v)}
                  />
                </Form.Item>
              </div>
            </Form>
          </section>
        ) : null}
      </div>
    )
  }

  function renderEventBody() {
    if (isStatusBarSelected) {
      return (
        <Empty description="状态栏不支持事件绑定" styles={{ image: { height: 64 } }} />
      )
    }
    if (isSlotOutletSelected) {
      return (
        <Empty
          description="插槽本身不支持事件绑定，请选中插槽内的控件"
          styles={{ image: { height: 64 } }}
        />
      )
    }
    if (!selectedNode) {
      return (
        <Empty description="请在控件树中选择节点" styles={{ image: { height: 64 } }} />
      )
    }
    return (
      <div className="interact-form">
        <div className="node-brief">
          <div className="node-tag">{selectedNode.tag}</div>
          <div className="node-id">{selectedId}</div>
        </div>

        <div className="section-title">事件列表</div>

        {isComponentNode && !selectableEvents.length ? (
          <Empty
            description="该组件暂无事件方法，请先在组件设置中添加"
            styles={{ image: { height: 48 } }}
          />
        ) : (
          <div className="event-list">
            {selectableEvents.map((event) => (
              <div key={event.key} className="event-card">
                <div className="event-main">
                  <div className="event-name">{event.label}</div>
                  <div className="event-key">{event.key}</div>
                </div>
                <div className="event-actions">
                  <span className="event-summary">{eventBindingSummary(event.key)}</span>
                  <Button type="link" onClick={() => openEventBind(event.key, event.label)}>
                    配置
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <EventBindDialog
          open={eventBindVisible}
          onOpenChange={setEventBindVisible}
          eventLabel={eventBindLabel}
          eventKey={eventBindKey}
          eventParams={eventBindParams}
          rawValue={eventForm[eventBindKey]}
          methods={methods ?? []}
          emitEvents={emitEvents}
          dataFields={dataFields ?? []}
          xml={xml}
          componentMap={componentMap}
          componentMethodsMap={componentMethodsMap}
          iconOptions={iconOptions}
          componentProps={componentProps}
          typeLibrary={typeLibrary}
          projectPath={projectPath}
          onSave={handleEventBindSave}
        />
      </div>
    )
  }

  function renderComponentPropField(def: ComponentPropDef) {
    const name = def.name
    if (def.type === 'icon') {
      return (
        <IconValueSelect
          value={componentPropForm[name] ?? ''}
          options={iconSelectOptions}
          allowCreate
          placeholder={`默认：${propDefaultPreview(def)}`}
          onChange={(v) => commitComponentProp(name, v ?? '')}
        />
      )
    }
    if (def.type === 'api') {
      return (
        <ApiPropBindField
          value={componentPropForm[name] ?? ''}
          projectPath={projectPath || ''}
          apiParams={def.apiParams}
          apiReturnType={def.apiReturnType}
          dataFields={dataFields ?? []}
          componentProps={componentProps}
          pageQueryParams={pageQueryParams}
          typeLibrary={typeLibrary}
          onChange={(v) => commitComponentProp(name, v)}
        />
      )
    }
    if (def.type === 'boolean') {
      return (
        <>
          <div className="bool-prop-row">
            <Switch
              checked={boolPropModel(componentPropForm[name], def)}
              onChange={(checked) => commitComponentBoolProp(name, checked)}
            />
            {(componentPropForm[name] ?? '').trim() ? (
              <Button type="link" onClick={() => clearComponentProp(name)}>
                恢复默认（{propDefaultPreview(def)}）
              </Button>
            ) : (
              <span className="bool-prop-hint">当前用默认：{propDefaultPreview(def)}</span>
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            <AttrBindField
              {...attrBindShared}
              value={componentPropForm[name] ?? ''}
              placeholder="true / false / 绑定"
              valueType={def.type}
              typeRef={def.typeRef}
              itemType={def.itemType}
              itemTypeRef={def.itemTypeRef}
              onChange={(v) => commitComponentProp(name, v)}
            />
          </div>
        </>
      )
    }
    return (
      <AttrBindField
        {...attrBindShared}
        value={componentPropForm[name] ?? ''}
        placeholder={
          def.type === 'color' ? '颜色常量 / 绑定' : `默认：${propDefaultPreview(def)}`
        }
        valueType={def.type}
        typeRef={def.typeRef}
        itemType={def.itemType}
        itemTypeRef={def.itemTypeRef}
        onChange={(v) => commitComponentProp(name, v)}
      />
    )
  }

  function renderDynamicBody() {
    if (isStatusBarSelected) {
      return (
        <Empty description="状态栏不支持动态样式" styles={{ image: { height: 64 } }} />
      )
    }
    if (isSlotOutletSelected) {
      return (
        <Empty
          description="插槽本身不支持动态样式，请选中插槽内的控件"
          styles={{ image: { height: 64 } }}
        />
      )
    }
    if (!selectedNode) {
      return (
        <Empty description="请在控件树中选择节点" styles={{ image: { height: 64 } }} />
      )
    }
    return (
      <div className="dynamic-form">
        <div className="node-brief">
          <div className="node-tag">{selectedNode.tag}</div>
          <div className="node-id">{selectedId}</div>
        </div>

        {renderSectionNav(dynamicNavItems, '动态分区')}

        {isComponentNode ? (
          <section className="prop-section" data-section-id="dyn-props">
            <div className="section-title">组件参数 · $props</div>
            {!selectedComponentDetail ? (
              <Alert
                type="warning"
                closable={false}
                showIcon
                message="未找到组件定义，请确认 componentId 是否有效"
                style={{ marginBottom: 12 }}
              />
            ) : !componentPropDefs.length ? (
              <Empty
                description="该组件暂无参数，请先在组件设置中添加"
                styles={{ image: { height: 48 } }}
              />
            ) : (
              <>
                <Form layout="vertical" size="small">
                  {componentPropDefs.map((def) => (
                    <Form.Item
                      key={def.name}
                      label={`${def.name}${def.required ? ' *' : ''} · ${propTypeLabel(def.type)}${def.twoWay ? ' · 可更新' : ''}`}
                    >
                      {renderComponentPropField(def)}
                      {def.type === 'api' ? (
                        <p className="hint">
                          点击「配置」选择后端服务 → 控制器 → API，并可绑定额外入参。组件内调用
                          <code>$props.{def.name}(args)</code>
                        </p>
                      ) : null}
                      {def.remark ? <p className="prop-remark">{def.remark}</p> : null}
                    </Form.Item>
                  ))}
                </Form>
                <p className="hint">
                  写入当前 Component 节点属性；组件内部用
                  <code>{'{$props.字段名}'}</code>
                  读取。留空则使用组件默认值。
                </p>
              </>
            )}
          </section>
        ) : null}

        {isRootNode ? (
          <Alert
            type="info"
            closable={false}
            showIcon
            message="根节点不支持列表重复配置"
            style={{ marginBottom: 12 }}
          />
        ) : (
          <section className="prop-section" data-section-id="dyn-repeat">
            <div className="section-title">列表渲染</div>
            <Form layout="vertical" size="small">
              <Form.Item label="重复">
                <div className="repeat-row">
                  <span className="repeat-summary">{repeatSummary}</span>
                  <Button type="link" onClick={openRepeatDialog}>
                    配置
                  </Button>
                </div>
              </Form.Item>
            </Form>
            <p className="hint">
              预览时按绑定数组展开当前节点。可选数据池数组，或组件
              <code>$props</code>
              中的数组参数。文本中写
              <code>{'{item.字段名}'}</code>
              才会替换为列表项数据，其他内容原样显示；也可用
              <code>{'{index}'}</code>。
            </p>
          </section>
        )}

        {showInputProps ? (
          <section className="prop-section" data-section-id="dyn-model">
            <div className="section-title">双向绑定</div>
            <div className="visibility-row">
              <span className="visibility-summary">{modelSummary}</span>
              <Button type="link" onClick={openModelDialog}>
                配置
              </Button>
            </div>
            <p className="hint">
              仅可选数据池中的字符串字段，写入
              <code>{'{字段名}'}</code>
              。预览时输入框与数据池互相同步。
            </p>
          </section>
        ) : null}

        {showMultiWindowProps ? (
          <section className="prop-section" data-section-id="dyn-active">
            <div className="section-title">激活项</div>
            <div className="visibility-row">
              <span className="visibility-summary">{activeSummary}</span>
              <Button type="link" onClick={openActiveDialog}>
                配置
              </Button>
            </div>
            <p className="hint">
              从数据池或
              <code>$props</code>
              选择字符串或数字字段，写入
              <code>{'{字段名}'}</code>
              /
              <code>{'{$props.字段名}'}</code>
              。预览时显示
              <code>windowKey</code>
              与激活值匹配的窗口。
            </p>
          </section>
        ) : null}

        <section className="prop-section" data-section-id="dyn-vshow">
          <div className="section-title">显示条件</div>
          <div className="visibility-row">
            <span className="visibility-summary">{showIfSummary}</span>
            <Button type="link" onClick={() => openVisibilityDialog('show')}>
              配置
            </Button>
          </div>
          <p className="hint">
            场景之间为「或」、场景内为「且」。不成立时隐藏节点，但仍保留在树中。
          </p>
        </section>

        <section className="prop-section" data-section-id="dyn-vif">
          <div className="section-title">挂载条件</div>
          <div className="visibility-row">
            <span className="visibility-summary">{mountIfSummary}</span>
            <Button type="link" onClick={() => openVisibilityDialog('mount')}>
              配置
            </Button>
          </div>
          <p className="hint">
            场景之间为「或」、场景内为「且」。不成立时不创建、不渲染该节点。
          </p>
        </section>

        <section className="prop-section" data-section-id="dyn-styles">
          <div className="section-title">动态样式</div>
          <div className="dyn-style-list">
            {dynamicStylesConfig.states.map((state, index) => (
              <div key={state.id} className="dyn-style-item">
                <span className="dyn-style-name">
                  状态{index + 1} · {state.name}
                </span>
                <div className="dyn-style-actions">
                  <Button type="link" onClick={() => openStyleState(state)}>
                    编辑
                  </Button>
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeStyleState(state.id)}
                  />
                </div>
              </div>
            ))}
            <Button
              type="primary"
              ghost
              icon={<PlusOutlined />}
              className="add-state-btn"
              onClick={addStyleState}
            >
              添加状态
            </Button>
          </div>
          <p className="hint">
            按数据池字段与条件命中状态后，覆盖对应样式。样式编辑与「样式」页共用组件，仅填写需覆盖的属性。
          </p>
        </section>
      </div>
    )
  }

  return (
    <aside className="props-panel">
      <div className="panel-header">
        {backLabel ? (
          <BackLink label={backLabel} onClick={() => onBack?.()} />
        ) : (
          <span>属性</span>
        )}
        <Radio.Group
          value={tab}
          size="small"
          className="panel-tabs"
          onChange={(e) => onTabChange?.(e.target.value as PropsTab)}
        >
          <Radio.Button value="style">样式</Radio.Button>
          <Radio.Button value="event">事件</Radio.Button>
          <Radio.Button value="dynamic">动态</Radio.Button>
        </Radio.Group>
      </div>

      <div ref={panelBodyRef} className="panel-body" onScroll={onPanelBodyScroll}>
        {tab === 'style'
          ? renderStyleBody()
          : tab === 'event'
            ? renderEventBody()
            : renderDynamicBody()}
      </div>

      <Modal
        open={repeatDialogVisible}
        title="重复配置"
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setRepeatDialogVisible(false)}
        footer={
          <>
            <Button onClick={clearRepeatConfig}>清除</Button>
            <Button type="primary" onClick={saveRepeatConfig}>
              确定
            </Button>
          </>
        }
      >
        <Form layout="vertical">
          <Form.Item label="绑定数组">
            <Select
              value={repeatForm.list || undefined}
              allowClear
              showSearch
              placeholder="选择数据池或 $props 数组字段"
              style={{ width: '100%' }}
              options={arrayFieldOptions}
              onChange={(v) => {
                const next = { ...repeatFormRef.current, list: v ?? '' }
                repeatFormRef.current = next
                setRepeatForm(next)
              }}
            />
          </Form.Item>
          <Form.Item label="索引">
            <Input
              value={repeatForm.index}
              allowClear
              placeholder="可不填，按数组项顺序"
              onChange={(e) => {
                const next = { ...repeatFormRef.current, index: e.target.value }
                repeatFormRef.current = next
                setRepeatForm(next)
              }}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={modelDialogVisible}
        title="双向绑定"
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setModelDialogVisible(false)}
        footer={
          <>
            <Button onClick={clearModelConfig}>清除</Button>
            <Button type="primary" onClick={saveModelConfig}>
              确定
            </Button>
          </>
        }
      >
        <Form layout="vertical">
          <Form.Item label="数据池字段">
            <Select
              value={modelForm.field || undefined}
              allowClear
              showSearch
              placeholder="选择字符串类型字段"
              style={{ width: '100%' }}
              options={stringFieldOptions}
              onChange={(v) => {
                const next = { field: v ?? '' }
                modelFormRef.current = next
                setModelForm(next)
              }}
            />
          </Form.Item>
        </Form>
        <p className="hint" style={{ marginTop: 0 }}>
          将写入属性
          <code>{'value="{字段名}"'}</code>
          。预览输入会写回该字段；数据池变更也会刷新输入框。
        </p>
      </Modal>

      <Modal
        open={activeDialogVisible}
        title="绑定激活项"
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setActiveDialogVisible(false)}
        footer={
          <>
            <Button onClick={clearActiveConfig}>清除</Button>
            <Button type="primary" onClick={saveActiveConfig}>
              确定
            </Button>
          </>
        }
      >
        <Form layout="vertical">
          <Form.Item label="激活字段">
            <Select
              value={activeForm.field || undefined}
              allowClear
              showSearch
              placeholder="选择数据池或 $props 字符串/数字字段"
              style={{ width: '100%' }}
              options={activeFieldOptions}
              onChange={(v) => {
                const next = { field: v ?? '' }
                activeFormRef.current = next
                setActiveForm(next)
              }}
            />
          </Form.Item>
        </Form>
        <p className="hint" style={{ marginTop: 0 }}>
          将写入属性
          <code>{'active="{字段名}"'}</code>
          或
          <code>{'active="{$props.字段名}"'}</code>
          。窗口的
          <code>windowKey</code>
          与该字段值相等时显示。
        </p>
      </Modal>

      <DynamicStyleStateDialog
        open={styleStateDialogVisible}
        onOpenChange={setStyleStateDialogVisible}
        state={editingStyleState}
        nodeTag={selectedNode?.tag}
        dataFields={dataFields}
        componentProps={componentProps}
        routeParams={routeParams}
        pageQueryParams={pageQueryParams}
        selectedNodeId={selectedId}
        xml={xml}
        onSave={saveStyleState}
      />

      <VisibilityConditionDialog
        open={visibilityDialogVisible}
        onOpenChange={setVisibilityDialogVisible}
        title={visibilityDialogTitle}
        config={editingVisibilityConfig}
        dataFields={dataFields}
        componentProps={componentProps}
        routeParams={routeParams}
        selectedNodeId={selectedId}
        xml={xml}
        onSave={saveVisibilityConfig}
      />
      <OssResourcePickerDialog
        open={imageOssPickerVisible}
        onOpenChange={setImageOssPickerVisible}
        projectPath={projectPath}
        onConfirm={onImageOssPicked}
      />
    </aside>
  )
}
