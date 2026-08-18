import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Modal, Select } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import {
  CUSTOM_EVENT_METHOD,
  buildEmitAmbientDeclarations,
  buildLocalMethodsAmbientDeclarations,
  buildTypeLibraryAmbientDeclarations,
  dataFieldsToAmbientVars,
  isCustomEventMethod,
  parseEventBindings,
  serializeEventBindings,
  type EventMethodBinding,
  type MethodParam,
  type PageMethod,
} from '../../types/page-method'
import type { ComponentEventDef, ComponentPropDef } from '../../types/component'
import {
  DATA_FIELD_TYPE_OPTIONS,
  buildArrayValue,
  buildObjectValue,
  createEmptyDataField,
  defaultValue,
  resolveArrayFields,
  resolveObjectFields,
  type ArraySubField,
  type DataField,
  type DataFieldType,
  type ObjectSubField,
} from '../../types/page-data'
import ObjectFieldsDialog from './ObjectFieldsDialog'
import ArrayFieldsDialog from './ArrayFieldsDialog'
import TsCodeEditor from './TsCodeEditor'
import type { ComponentRenderMap } from '../../types/component-render'
import {
  buildRefAmbientDeclarations,
  type ComponentMethodsMap,
} from '../../utils/widget-ref'
import {
  buildDollarPropsAmbientDeclaration,
  buildUpdatePropsAmbientDeclarations,
} from '../../utils/component-props'
import { buildDollarColorAmbientDeclaration } from '../../types/color-palette'
import { useColorPaletteState } from '../../composables/useColorPalette'
import type { DataTypeLibrary } from '../../types/data-types'
import './EventBindDialog.css'

type NavigateParamRow = { key: string; value: string }

function EmitEventSelect({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  const [search, setSearch] = useState('')
  const selectOptions = useMemo(() => {
    const base = options.map((name) => ({ value: name, label: name }))
    if (search && !base.some((o) => o.value === search)) {
      return [{ value: search, label: search }, ...base]
    }
    return base
  }, [options, search])

  return (
    <Select
      value={value || undefined}
      showSearch
      placeholder="选择或输入事件名"
      style={{ width: '100%' }}
      options={selectOptions}
      filterOption={(input, option) =>
        String(option?.label ?? '')
          .toLowerCase()
          .includes(input.toLowerCase())
      }
      onSearch={setSearch}
      onChange={(next) => onChange((next as string) ?? '')}
    />
  )
}

export default function EventBindDialog({
  open,
  onOpenChange,
  eventLabel,
  rawValue,
  methods,
  dataFields,
  xml,
  componentMap,
  componentMethodsMap,
  iconOptions,
  emitEvents,
  eventParams,
  eventKey,
  typeLibrary,
  componentProps,
  projectPath,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  eventLabel: string
  rawValue: string
  methods: PageMethod[]
  dataFields?: DataField[]
  xml?: string
  componentMap?: ComponentRenderMap
  componentMethodsMap?: ComponentMethodsMap
  iconOptions?: Array<{ id: string; label: string }>
  emitEvents?: ComponentEventDef[]
  eventParams?: MethodParam[]
  eventKey?: string
  typeLibrary?: DataTypeLibrary | null
  componentProps?: ComponentPropDef[] | null
  projectPath?: string | null
  onSave?: (value: string) => void
}) {
  const colorPalette = useColorPaletteState()
  const [draft, setDraft] = useState<EventMethodBinding[]>([])
  const [objectDialogVisible, setObjectDialogVisible] = useState(false)
  const [arrayDialogVisible, setArrayDialogVisible] = useState(false)
  const [editingBindingId, setEditingBindingId] = useState('')
  const [editingObjectFields, setEditingObjectFields] = useState<ObjectSubField[]>(
    [],
  )
  const [editingArrayFields, setEditingArrayFields] = useState<ArraySubField[]>(
    [],
  )
  const [navigateParamDrafts, setNavigateParamDrafts] = useState<
    Map<string, NavigateParamRow[]>
  >(() => new Map())

  const methodMap = useMemo(() => {
    const map = new Map<string, PageMethod>()
    for (const item of methods) map.set(item.name, item)
    return map
  }, [methods])

  const fieldOptions = useMemo(
    () => (dataFields ?? []).filter((item) => item.name.trim()),
    [dataFields],
  )

  const typeLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const opt of DATA_FIELD_TYPE_OPTIONS) map.set(opt.value, opt.label)
    return map
  }, [])

  useEffect(() => {
    if (!open) {
      setNavigateParamDrafts(new Map())
      return
    }
    setNavigateParamDrafts(new Map())
    const list = parseEventBindings(rawValue)
    setDraft(
      list.length
        ? list.map((item) => ({
            ...item,
            args: { ...item.args },
            body: item.body ?? '',
          }))
        : [],
    )
  }, [open, rawValue])

  function createId() {
    return `bind_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  }

  function patchBinding(
    id: string,
    updater: (binding: EventMethodBinding) => EventMethodBinding,
  ) {
    setDraft((prev) => prev.map((item) => (item.id === id ? updater(item) : item)))
  }

  function addBinding() {
    const first = methods[0]
    setDraft((prev) => [
      ...prev,
      {
        id: createId(),
        method: first?.name ?? '',
        args: {},
        body: '',
      },
    ])
  }

  function removeBinding(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  function onMethodChange(binding: EventMethodBinding) {
    if (isCustomEventMethod(binding.method)) {
      binding.args = {}
      if (binding.body == null) binding.body = ''
      setNavigateParamDrafts((prev) => {
        const next = new Map(prev)
        next.delete(binding.id)
        return next
      })
      return
    }
    const method = methodMap.get(binding.method)
    const nextArgs: Record<string, string> = {}
    for (const param of paramsOf(binding.method, binding)) {
      nextArgs[param.name] = binding.args[param.name] ?? ''
    }
    if (method?.name === 'emit' && binding.args.event) {
      nextArgs.event = binding.args.event
    }
    if (method?.name === 'showToast' && !nextArgs.duration) {
      nextArgs.duration = 'short'
    }
    binding.args = nextArgs
    setNavigateParamDrafts((prev) => {
      const next = new Map(prev)
      next.delete(binding.id)
      if (method?.name === 'navigateTo') {
        next.set(binding.id, parseNavigateParams(nextArgs.params))
      }
      return next
    })
  }

  function isEmit(methodName: string) {
    return methodName === 'emit'
  }

  function isCustom(methodName: string) {
    return isCustomEventMethod(methodName)
  }

  function emitEventOptions() {
    return (emitEvents ?? [])
      .map((item) => item.name.trim())
      .filter(Boolean)
  }

  const customFnName = useMemo(() => {
    const key = (eventKey ?? '').trim()
    return /^[A-Za-z_$][\w$]*$/.test(key) ? key : 'handler'
  }, [eventKey])

  const customParams = useMemo<MethodParam[]>(
    () =>
      (eventParams ?? [])
        .filter((item) => item.name.trim())
        .map((item) => ({
          name: item.name.trim(),
          type: item.type,
          ...(item.tsType?.trim() ? { tsType: item.tsType.trim() } : {}),
        })),
    [eventParams],
  )

  const eventParamHints = useMemo(
    () =>
      customParams.map((item) => ({
        name: item.name,
        type: item.tsType?.trim() || item.type,
        sample: `{${item.name}}`,
      })),
    [customParams],
  )

  const customAmbientVars = useMemo(
    () => dataFieldsToAmbientVars(dataFields, typeLibrary),
    [dataFields, typeLibrary],
  )

  const customAmbientExtra = useMemo(() => {
    const lines = [
      'declare function navigateTo(to: string, params?: Record<string, unknown>): void;',
      'declare function navigateBack(): void;',
      'declare function setData(prop: string, value: any): void;',
      "declare function showToast(message: string, duration?: 'short' | 'long'): void;",
      'interface MenuButtonBoundingClientRect { width: number; height: number; top: number; right: number; bottom: number; left: number }',
      "interface DeviceInfo { statusBarHeight: number; userAgent: string; menuButton: MenuButtonBoundingClientRect | null; platform: 'h5' | 'miniprogram' }",
      'declare function getDeviceInfo(): DeviceInfo;',
      buildDollarColorAmbientDeclaration(colorPalette),
    ]
    const typeLib = buildTypeLibraryAmbientDeclarations(typeLibrary)
    const propsAmbient = buildDollarPropsAmbientDeclaration(
      componentProps,
      typeLibrary,
    )
    const updatePropsAmbient = buildUpdatePropsAmbientDeclarations(
      componentProps,
      typeLibrary,
    )
    const localMethodsAmbient = buildLocalMethodsAmbientDeclarations(
      methods,
      typeLibrary,
    )
    const base = emitEvents?.length
      ? `${lines.join('\n')}\n${buildEmitAmbientDeclarations(emitEvents, typeLibrary)}`
      : `${lines.join('\n')}\n`
    return `${typeLib ? `${typeLib}\n` : ''}${propsAmbient}\n${updatePropsAmbient}${localMethodsAmbient}${buildRefAmbientDeclarations(
      dataFields,
      xml,
      componentMap,
      componentMethodsMap,
    )}${base}`
  }, [
    colorPalette,
    typeLibrary,
    componentProps,
    methods,
    emitEvents,
    dataFields,
    xml,
    componentMap,
    componentMethodsMap,
  ])

  function paramsOf(methodName: string, binding?: EventMethodBinding) {
    if (isCustom(methodName)) return []
    if (isEmit(methodName)) {
      const eventName = (binding?.args.event ?? '').trim()
      const eventDef = (emitEvents ?? []).find(
        (item) => item.name.trim() === eventName,
      )
      const rest = (eventDef?.params ?? [])
        .filter((item) => item.name.trim() && !item.name.trim().startsWith('...'))
        .map((item) => ({ name: item.name.trim(), type: item.type }))
      return [{ name: 'event', type: 'string' as const }, ...rest]
    }
    return (methodMap.get(methodName)?.params ?? []).filter(
      (item) => !item.name.trim().startsWith('...'),
    )
  }

  function isSetData(methodName: string) {
    return methodName === 'setData'
  }

  function isShowToast(methodName: string) {
    return methodName === 'showToast'
  }

  function isNavigateTo(methodName: string) {
    return methodName === 'navigateTo'
  }

  function parseNavigateParams(raw: string | undefined): NavigateParamRow[] {
    if (!raw?.trim()) return []
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed as Record<string, unknown>).map(
          ([key, value]) => ({
            key,
            value:
              typeof value === 'string'
                ? value
                : value == null
                  ? ''
                  : JSON.stringify(value),
          }),
        )
      }
    } catch {
      // ignore
    }
    const text = raw.trim()
    if (!text.startsWith('{') && text.includes('=')) {
      return text
        .split(/[&,]/)
        .map((part) => {
          const i = part.indexOf('=')
          if (i < 0) return { key: part.trim(), value: '' }
          return {
            key: part.slice(0, i).trim(),
            value: part.slice(i + 1).trim(),
          }
        })
        .filter((row) => row.key)
    }
    return []
  }

  function serializeNavigateParams(rows: NavigateParamRow[]): string {
    const obj: Record<string, string> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (!key) continue
      obj[key] = row.value
    }
    return Object.keys(obj).length ? JSON.stringify(obj) : ''
  }

  function ensureNavigateParams(binding: EventMethodBinding): NavigateParamRow[] {
    const rows = navigateParamDrafts.get(binding.id)
    if (rows) return rows
    return parseNavigateParams(binding.args.params)
  }

  function setNavigateRows(bindingId: string, rows: NavigateParamRow[]) {
    setNavigateParamDrafts((prev) => {
      const next = new Map(prev)
      next.set(bindingId, rows)
      return next
    })
  }

  function setArg(binding: EventMethodBinding, key: string, value: string) {
    const nextArgs = { ...binding.args, [key]: value }
    binding.args = nextArgs
    patchBinding(binding.id, (item) => ({ ...item, args: nextArgs }))
  }

  function syncNavigateParams(binding: EventMethodBinding, rows?: NavigateParamRow[]) {
    const nextRows = rows ?? ensureNavigateParams(binding)
    setArg(binding, 'params', serializeNavigateParams(nextRows))
  }

  function addNavigateParam(binding: EventMethodBinding) {
    const rows = [...ensureNavigateParams(binding), { key: '', value: '' }]
    setNavigateRows(binding.id, rows)
  }

  function removeNavigateParam(binding: EventMethodBinding, index: number) {
    const rows = ensureNavigateParams(binding).filter((_, i) => i !== index)
    setNavigateRows(binding.id, rows)
    syncNavigateParams(binding, rows)
  }

  function updateNavigateParam(
    binding: EventMethodBinding,
    index: number,
    field: 'key' | 'value',
    value: string,
  ) {
    const rows = ensureNavigateParams(binding).map((row, i) =>
      i === index ? { ...row, [field]: value } : row,
    )
    const row = rows[index]
    if (!row) return
    setNavigateRows(binding.id, rows)
    syncNavigateParams(binding, rows)
  }

  function onEmitEventChange(binding: EventMethodBinding) {
    const nextArgs: Record<string, string> = {
      event: binding.args.event ?? '',
    }
    for (const param of paramsOf('emit', binding)) {
      if (param.name === 'event') continue
      nextArgs[param.name] = binding.args[param.name] ?? ''
    }
    binding.args = nextArgs
    patchBinding(binding.id, (item) => ({ ...item, args: nextArgs }))
  }

  function findField(propName: string | undefined): DataField | undefined {
    const name = propName?.trim()
    if (!name) return undefined
    return fieldOptions.find((item) => item.name === name)
  }

  function fieldType(propName: string | undefined): DataFieldType {
    return findField(propName)?.type ?? 'string'
  }

  function fieldTypeLabel(type: DataFieldType) {
    return typeLabelMap.get(type) ?? type
  }

  function serializeArgValue(type: DataFieldType, value: unknown): string {
    if (
      type === 'string' ||
      type === 'time' ||
      type === 'date' ||
      type === 'datetime' ||
      type === 'icon' ||
      type === 'color' ||
      type === 'ref' ||
      type === 'resource'
    )
      return String(value ?? '')
    if (type === 'number') {
      const n = Number(value)
      return Number.isFinite(n) ? String(n) : '0'
    }
    if (type === 'boolean') return value ? 'true' : 'false'
    try {
      return JSON.stringify(value ?? defaultValue(type))
    } catch {
      return type === 'array' ? '[]' : '{}'
    }
  }

  function parseArgValue(type: DataFieldType, raw: string | undefined): unknown {
    const text = raw ?? ''
    if (
      type === 'string' ||
      type === 'time' ||
      type === 'date' ||
      type === 'datetime' ||
      type === 'icon' ||
      type === 'color' ||
      type === 'ref' ||
      type === 'resource'
    )
      return text
    if (type === 'number') {
      const n = Number(text)
      return Number.isFinite(n) ? n : 0
    }
    if (type === 'boolean') return text === 'true' || text === '1'
    if (!text.trim()) return defaultValue(type)
    try {
      return JSON.parse(text)
    } catch {
      return defaultValue(type)
    }
  }

  function onPropChange(binding: EventMethodBinding) {
    const field = findField(binding.args.prop)
    const type = field?.type ?? 'string'
    const initial = field ? field.value : defaultValue(type)
    setArg(binding, 'value', serializeArgValue(type, initial))
  }

  function getStringValue(binding: EventMethodBinding) {
    return binding.args.value ?? ''
  }

  function complexPreview(binding: EventMethodBinding) {
    const type = fieldType(binding.args.prop)
    const value = parseArgValue(type, binding.args.value)
    if (
      type === 'json' &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return `${Object.keys(value as object).length} 个字段`
    }
    if (type === 'array' && Array.isArray(value)) {
      return `${value.length} 项`
    }
    return type === 'array' ? '0 项' : '0 个字段'
  }

  function openObjectEditor(binding: EventMethodBinding) {
    const field = findField(binding.args.prop) ?? createEmptyDataField()
    const value = parseArgValue('json', binding.args.value)
    setEditingBindingId(binding.id)
    setEditingObjectFields(
      resolveObjectFields(field.objectFields, value).map((item) => ({
        ...item,
      })),
    )
    setObjectDialogVisible(true)
  }

  function openArrayEditor(binding: EventMethodBinding) {
    const field = findField(binding.args.prop) ?? createEmptyDataField()
    const value = parseArgValue('array', binding.args.value)
    setEditingBindingId(binding.id)
    setEditingArrayFields(
      resolveArrayFields(field.arrayFields, value).map((item) => ({ ...item })),
    )
    setArrayDialogVisible(true)
  }

  function findEditingBinding() {
    return draft.find((item) => item.id === editingBindingId)
  }

  function saveObjectFields(objectFields: ObjectSubField[]) {
    const binding = findEditingBinding()
    if (!binding) return
    setArg(binding, 'value', serializeArgValue('json', buildObjectValue(objectFields)))
  }

  function saveArrayFields(arrayFields: ArraySubField[]) {
    const binding = findEditingBinding()
    if (!binding) return
    setArg(binding, 'value', serializeArgValue('array', buildArrayValue(arrayFields)))
  }

  function handleSave() {
    const next = draft.map((binding) => {
      if (!isNavigateTo(binding.method)) return binding
      const rows =
        navigateParamDrafts.get(binding.id) ??
        parseNavigateParams(binding.args.params)
      return {
        ...binding,
        args: { ...binding.args, params: serializeNavigateParams(rows) },
      }
    })
    onSave?.(serializeEventBindings(next))
    onOpenChange?.(false)
  }

  function handleClear() {
    onSave?.('')
    onOpenChange?.(false)
  }

  const methodSelectOptions = [
    ...methods.map((method) => ({
      value: method.name,
      label: method.builtin ? `${method.name}（预置）` : method.name,
    })),
    { value: CUSTOM_EVENT_METHOD, label: '自定义' },
  ]

  return (
    <>
      <Modal
        open={open}
        title={`配置事件 · ${eventLabel}`}
        width={720}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => onOpenChange?.(false)}
        footer={
          <>
            <Button onClick={handleClear}>清除</Button>
            <Button type="primary" onClick={handleSave}>
              保存
            </Button>
          </>
        }
      >
        <p className="hint">
          可绑定多个方法，按列表顺序触发；可为目标方法填写参数。末尾「自定义」可直接编写方法体。
        </p>

        {eventParamHints.length ? (
          <div className="event-params">
            <span className="event-params-label">事件形参</span>
            <div className="event-params-list">
              {eventParamHints.map((item) => (
                <code
                  key={item.name}
                  className="event-param-chip"
                  title={`${item.name}: ${item.type}`}
                >
                  {item.sample}
                  <span className="event-param-type">{item.type}</span>
                </code>
              ))}
            </div>
            <p className="event-params-hint">
              参数值中可直接写形参，例如 <code>{eventParamHints[0]?.sample}</code>
            </p>
          </div>
        ) : null}

        <div className="bind-list">
          {draft.map((binding, index) => (
            <div key={binding.id} className="bind-card">
              <div className="bind-header">
                <Select
                  value={binding.method || undefined}
                  showSearch
                  placeholder="选择方法"
                  style={{ flex: 1 }}
                  optionFilterProp="label"
                  options={methodSelectOptions}
                  onChange={(method) => {
                    patchBinding(binding.id, (item) => {
                      const next = {
                        ...item,
                        method: (method as string) ?? '',
                        args: { ...item.args },
                      }
                      onMethodChange(next)
                      return next
                    })
                  }}
                />
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeBinding(index)}
                />
              </div>

              {isCustom(binding.method) ? (
                <div className="custom-body">
                  <p className="arg-hint">
                    编写 TypeScript 方法体；可调用 navigateTo / setData / updateProps /
                    showToast，以及本页/组件已定义的自定义方法；数据池字段可按名引用。Modal
                    引用 .show()/.hide()，组件引用为其「暴露方法」。
                  </p>
                  <TsCodeEditor
                    value={binding.body ?? ''}
                    functionName={customFnName}
                    params={customParams}
                    returnType="void"
                    ambientVars={customAmbientVars}
                    ambientExtra={customAmbientExtra}
                    onChange={(value) =>
                      patchBinding(binding.id, (item) => ({
                        ...item,
                        body: value,
                      }))
                    }
                  />
                </div>
              ) : paramsOf(binding.method, binding).length ? (
                <div className="args">
                  {isSetData(binding.method) ? (
                    <>
                      <div className="arg-row">
                        <label>
                          prop <span className="type">string · 数据池字段</span>
                        </label>
                        <Select
                          value={binding.args.prop || undefined}
                          showSearch
                          allowClear
                          placeholder="选择数据池字段"
                          style={{ width: '100%' }}
                          optionFilterProp="label"
                          options={fieldOptions.map((field) => ({
                            value: field.name,
                            label: `${field.name}（${fieldTypeLabel(field.type)}）`,
                          }))}
                          onChange={(value) => {
                            const nextArgs = {
                              ...binding.args,
                              prop: (value as string) ?? '',
                            }
                            const next = { ...binding, args: nextArgs }
                            onPropChange(next)
                          }}
                        />
                      </div>

                      <div className="arg-row">
                        <label>
                          value
                          <span className="type">
                            {fieldTypeLabel(fieldType(binding.args.prop))} · 支持变量
                          </span>
                        </label>

                        {fieldType(binding.args.prop) === 'json' ? (
                          <>
                            <div className="complex-value">
                              <span className="value-preview">
                                {complexPreview(binding)}
                              </span>
                              <Button
                                type="link"
                                onClick={() => openObjectEditor(binding)}
                              >
                                编辑对象
                              </Button>
                            </div>
                            <Input
                              className="expr-input"
                              value={getStringValue(binding)}
                              placeholder="或写变量 / 表达式，如 {scrollTop}"
                              onChange={(e) =>
                                setArg(binding, 'value', e.target.value ?? '')
                              }
                            />
                          </>
                        ) : fieldType(binding.args.prop) === 'array' ? (
                          <>
                            <div className="complex-value">
                              <span className="value-preview">
                                {complexPreview(binding)}
                              </span>
                              <Button
                                type="link"
                                onClick={() => openArrayEditor(binding)}
                              >
                                编辑数组
                              </Button>
                            </div>
                            <Input
                              className="expr-input"
                              value={getStringValue(binding)}
                              placeholder="或写变量 / 表达式，如 {item.list}"
                              onChange={(e) =>
                                setArg(binding, 'value', e.target.value ?? '')
                              }
                            />
                          </>
                        ) : (
                          <Input
                            value={getStringValue(binding)}
                            placeholder={
                              eventParamHints.length
                                ? `值或变量，如 ${eventParamHints[0].sample} / {item.xxx}`
                                : '值或变量，如 {item.xxx} / {index}'
                            }
                            onChange={(e) =>
                              setArg(binding, 'value', e.target.value ?? '')
                            }
                          />
                        )}
                        <p className="arg-hint">
                          支持变量：
                          {eventParamHints.length ? (
                            <>
                              {eventParamHints.map((item) => (
                                <code key={item.name}>{item.sample}</code>
                              ))}
                              、
                            </>
                          ) : null}
                          <code>{'{item.字段}'}</code>、<code>{'{index}'}</code>
                        </p>
                      </div>
                    </>
                  ) : isShowToast(binding.method) ? (
                    <>
                      <div className="arg-row">
                        <label>
                          message <span className="type">string · 提示内容</span>
                        </label>
                        <Input
                          value={binding.args.message ?? ''}
                          placeholder="Toast 内容，支持 {item.xxx}"
                          onChange={(e) =>
                            setArg(binding, 'message', e.target.value)
                          }
                        />
                      </div>
                      <div className="arg-row">
                        <label>
                          duration <span className="type">显示时长</span>
                        </label>
                        <Select
                          value={binding.args.duration || 'short'}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'short', label: '短（默认）' },
                            { value: 'long', label: '长' },
                          ]}
                          onChange={(value) =>
                            setArg(binding, 'duration', (value as string) || 'short')
                          }
                        />
                      </div>
                    </>
                  ) : isNavigateTo(binding.method) ? (
                    <>
                      <div className="arg-row">
                        <label>
                          to <span className="type">string · 页面 id</span>
                        </label>
                        <Input
                          value={binding.args.to ?? ''}
                          placeholder="目标页面 id"
                          onChange={(e) => setArg(binding, 'to', e.target.value)}
                        />
                      </div>
                      <div className="arg-row">
                        <label>
                          params <span className="type">object · 路由参数</span>
                        </label>
                        <div className="param-kv-list">
                          {ensureNavigateParams(binding).map((row, rowIndex) => (
                            <div key={rowIndex} className="param-kv-row">
                              <Input
                                value={row.key}
                                placeholder="参数名"
                                onChange={(e) =>
                                  updateNavigateParam(
                                    binding,
                                    rowIndex,
                                    'key',
                                    e.target.value ?? '',
                                  )
                                }
                              />
                              <Input
                                value={row.value}
                                placeholder="值，如 {id}"
                                onChange={(e) =>
                                  updateNavigateParam(
                                    binding,
                                    rowIndex,
                                    'value',
                                    e.target.value ?? '',
                                  )
                                }
                              />
                              <Button
                                type="link"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() =>
                                  removeNavigateParam(binding, rowIndex)
                                }
                              />
                            </div>
                          ))}
                          <Button
                            type="link"
                            icon={<PlusOutlined />}
                            onClick={() => addNavigateParam(binding)}
                          >
                            添加参数
                          </Button>
                        </div>
                        <p className="arg-hint">
                          值支持事件形参 / 变量：<code>{'{id}'}</code>、
                          <code>{'{item.xxx}'}</code>
                        </p>
                      </div>
                    </>
                  ) : isEmit(binding.method) ? (
                    <>
                      <div className="arg-row">
                        <label>
                          event <span className="type">string · 事件名</span>
                        </label>
                        {emitEventOptions().length ? (
                          <EmitEventSelect
                            value={binding.args.event ?? ''}
                            options={emitEventOptions()}
                            onChange={(value) => {
                              const next = {
                                ...binding,
                                args: { ...binding.args, event: value },
                              }
                              onEmitEventChange(next)
                            }}
                          />
                        ) : (
                          <Input
                            value={binding.args.event ?? ''}
                            placeholder="如 onClick"
                            onChange={(e) => {
                              const next = {
                                ...binding,
                                args: { ...binding.args, event: e.target.value },
                              }
                              onEmitEventChange(next)
                            }}
                          />
                        )}
                      </div>
                      {paramsOf('emit', binding)
                        .filter((p) => p.name !== 'event')
                        .map((param) => (
                          <div key={param.name} className="arg-row">
                            <label>
                              {param.name}{' '}
                              <span className="type">{param.type}</span>
                            </label>
                            <Input
                              value={binding.args[param.name] ?? ''}
                              placeholder={`参数 ${param.name}，支持 {item.xxx}`}
                              onChange={(e) =>
                                setArg(binding, param.name, e.target.value)
                              }
                            />
                          </div>
                        ))}
                      <p className="arg-hint">向父页面抛出：emit(event, ...参数)</p>
                    </>
                  ) : (
                    paramsOf(binding.method, binding).map((param) => (
                      <div key={param.name} className="arg-row">
                        <label>
                          {param.name} <span className="type">{param.type}</span>
                        </label>
                        <Input
                          value={binding.args[param.name] ?? ''}
                          placeholder={`参数 ${param.name}，支持 {item.xxx}`}
                          onChange={(e) =>
                            setArg(binding, param.name, e.target.value)
                          }
                        />
                      </div>
                    ))
                  )}
                </div>
              ) : (
                <div className="no-args">无参数</div>
              )}
            </div>
          ))}
        </div>

        <Button type="link" icon={<PlusOutlined />} onClick={addBinding}>
          添加绑定
        </Button>
      </Modal>

      <ObjectFieldsDialog
        open={objectDialogVisible}
        onOpenChange={setObjectDialogVisible}
        fields={editingObjectFields}
        iconOptions={iconOptions}
        projectPath={projectPath}
        onSave={saveObjectFields}
      />
      <ArrayFieldsDialog
        open={arrayDialogVisible}
        onOpenChange={setArrayDialogVisible}
        fields={editingArrayFields}
        iconOptions={iconOptions}
        projectPath={projectPath}
        onSave={saveArrayFields}
      />
    </>
  )
}
