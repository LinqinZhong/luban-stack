import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Input,
  InputNumber,
  Select,
  Table,
  TreeSelect,
} from 'antd'
import { DeleteOutlined, EditOutlined, SettingOutlined } from '@ant-design/icons'
import ArrayFieldsDialog from './ArrayFieldsDialog'
import ComputedBindingDialog from './ComputedBindingDialog'
import ControllerBindingDialog from './ControllerBindingDialog'
import DataFieldTypeTreeSelect, { type TypeSelectPayload } from './DataFieldTypeTreeSelect'
import IconValueSelect from './IconValueSelect'
import ColorPicker from './ColorPicker'
import DateTimeValueInput from './DateTimeValueInput'
import ObjectFieldsDialog from './ObjectFieldsDialog'
import OssResourcePickerDialog from './OssResourcePickerDialog'
import TypeGenericArgsDialog from './TypeGenericArgsDialog'
import {
  createEmptyControllerBinding,
  createEmptyDataField,
  createEmptyOssBinding,
  DATA_SOURCE_BINDING_OPTIONS,
  buildArrayValue,
  buildObjectValue,
  defaultComputeBody,
  defaultControllerFieldValue,
  defaultValue,
  resolveArrayFields,
  resolveObjectFields,
  type ArraySubField,
  type ControllerBindingConfig,
  type DataField,
  type DataFieldType,
  type DataSourceBinding,
  type ObjectSubField,
  type OssBindingConfig,
  type PageData,
} from '../../types/page-data'
import { resolveComputedPageData } from '../../utils/compute-runtime'
import type { DeviceInfo } from '../../utils/device-info'
import type { ColorPalette } from '../../types/color-palette'
import { isReservedDataFieldName } from '../../utils/component-props'
import type { ComponentPropDef, ComponentEventDef } from '../../types/component'
import type { DataTypeLibrary } from '../../types/data-types'
import type { PageMethod } from '../../types/page-method'
import type { PageQueryParamDef } from '../../types/page-query'
import type { ComponentRenderMap } from '../../types/component-render'
import type { ComponentMethodsMap } from '../../utils/widget-ref'
import {
  findDataTypeDef,
  objectFieldsFromTypeRef,
} from '../../utils/named-type-fields'
import { buildWidgetTreeSelectData } from '../../utils/widget-tree'
import { ElMessage } from '../../ui/feedback'
import './DataPoolPanel.css'

export type DataPoolPanelHandle = { addField: () => void }

export default forwardRef<
  DataPoolPanelHandle,
  {
    data: PageData
    xml?: string
    iconOptions?: Array<{ id: string; label: string }>
    getDeviceInfo?: () => DeviceInfo
    colorPalette?: ColorPalette | null
    componentProps?: ComponentPropDef[] | null
    dollarProps?: Record<string, unknown>
    typeLibrary?: DataTypeLibrary | null
    projectPath?: string
    methods?: PageMethod[]
    componentMap?: ComponentRenderMap
    componentMethodsMap?: ComponentMethodsMap
    emitEvents?: ComponentEventDef[]
    pageQueryParams?: PageQueryParamDef[] | null
    routeParams?: Record<string, unknown> | null
    onDataChange?: (data: PageData) => void
  }
>(function DataPoolPanel(props, ref) {
  const fields = props.data.fields
  function setFields(value: DataField[]) {
    props.onDataChange?.({ fields: value })
  }

  const [objectDialogVisible, setObjectDialogVisible] = useState(false)
  const [arrayDialogVisible, setArrayDialogVisible] = useState(false)
  const [computeDialogVisible, setComputeDialogVisible] = useState(false)
  const [controllerDialogVisible, setControllerDialogVisible] = useState(false)
  const [ossPickerVisible, setOssPickerVisible] = useState(false)
  const [editingIndex, setEditingIndex] = useState(-1)

  const [genericDialogVisible, setGenericDialogVisible] = useState(false)
  const [genericFieldIndex, setGenericFieldIndex] = useState(-1)
  const [genericNames, setGenericNames] = useState<string[]>([])
  const [genericTypeName, setGenericTypeName] = useState('')
  const [genericArgsDraft, setGenericArgsDraft] = useState<Record<string, string>>({})

  const unboundValueStash = useRef<Record<string, unknown>>({})

  const typeOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of props.typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        if (!t.name.trim()) continue
        const kind =
          t.kind === 'enum'
            ? '枚举'
            : t.category === 'dto'
              ? 'DTO'
              : t.category === 'vo'
                ? 'VO'
                : t.category === 'entity'
                  ? '实体'
                  : t.kind === 'interface'
                    ? '对象'
                    : t.kind
        opts.push({
          id: t.id,
          label: `${t.name}（${kind}）${t.remark ? ` · ${t.remark}` : ''}`,
        })
      }
    }
    return opts
  }, [props.typeLibrary])

  function leafNamedTypeRef(field: {
    type?: DataFieldType
    typeRef?: string
    itemType?: DataFieldType
    itemTypeRef?: string
    itemItemType?: DataFieldType
    itemItemTypeRef?: string
  }): string {
    if (field.type === 'array') {
      if (field.itemType === 'array') return field.itemItemTypeRef || ''
      return field.itemTypeRef || ''
    }
    return field.typeRef || ''
  }

  function genericNamesOf(typeRef: string): string[] {
    return (findDataTypeDef(props.typeLibrary, typeRef)?.generics ?? [])
      .map((g) => g.name.trim())
      .filter(Boolean)
  }

  function formatFieldTypeWithGenerics(row: DataField): string {
    const named = leafNamedTypeRef(row)
    const def = findDataTypeDef(props.typeLibrary, named)
    if (!def?.name) return ''
    const names = genericNamesOf(named)
    const args = row.genericArgs ?? {}
    const leafLabel = names.length
      ? `${def.name}<${names
          .map((n) => {
            const ref = (args[n] ?? '').trim()
            if (!ref) return 'any'
            return findDataTypeDef(props.typeLibrary, ref)?.name || ref
          })
          .join(', ')}>`
      : def.name
    if (row.type === 'array') {
      if (row.itemType === 'array') return `${leafLabel}[][]`
      return `${leafLabel}[]`
    }
    return leafLabel
  }

  function typeSelectLabel(row: DataField): string {
    return formatFieldTypeWithGenerics(row)
  }

  function openFieldGenerics(index: number) {
    const row = fields[index]
    if (!row) return
    const named = leafNamedTypeRef(row)
    const names = genericNamesOf(named)
    if (!names.length) return
    setGenericFieldIndex(index)
    setGenericNames(names)
    setGenericTypeName(findDataTypeDef(props.typeLibrary, named)?.name ?? '')
    const prev = row.genericArgs ?? {}
    const next: Record<string, string> = {}
    for (const n of names) next[n] = prev[n] ?? ''
    setGenericArgsDraft(next)
    setGenericDialogVisible(true)
  }

  function saveFieldGenerics(args: Record<string, string>) {
    if (genericFieldIndex < 0) return
    updateField(genericFieldIndex, { genericArgs: { ...args } })
  }

  function updateField(index: number, patch: Partial<DataField>) {
    if (typeof patch.name === 'string' && isReservedDataFieldName(patch.name)) {
      ElMessage.warning('字段名「$props」为组件入参保留字，请换用其他名称')
      return
    }
    const next = fields.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    )
    setFields(next)
  }

  function unboundValueStashKey(index: number): string {
    const name = fields[index]?.name?.trim()
    return name ? `n:${name}` : `i:${index}`
  }

  function hasUnboundValue(row: DataField): boolean {
    return !row.binding && row.value !== null
  }

  function setUnboundValueEnabled(index: number, enabled: boolean) {
    const row = fields[index]
    if (!row || row.binding) return
    const key = unboundValueStashKey(index)
    if (enabled) {
      const restored = unboundValueStash.current[key]
      updateField(index, {
        value:
          restored !== undefined
            ? (restored as DataField['value'])
            : defaultValue(row.type),
      })
      delete unboundValueStash.current[key]
    } else {
      if (row.value !== null) {
        unboundValueStash.current[key] = row.value
      }
      updateField(index, { value: null })
    }
  }

  function handleTypeChange(index: number, payload: TypeSelectPayload) {
    if (payload.cleared || payload.type === 'void' || payload.type === 'generic') return
    const type = payload.type
    const itemType =
      payload.itemType === 'generic' ? undefined : payload.itemType
    const itemItemType =
      payload.itemItemType === 'generic' ? undefined : payload.itemItemType
    const { typeRef, itemTypeRef, itemItemTypeRef } = payload
    const named = leafNamedTypeRef({
      type,
      typeRef,
      itemType,
      itemTypeRef,
      itemItemType,
      itemItemTypeRef,
    })
    const names = genericNamesOf(named)
    const prev = fields[index]
    const sameLeaf = leafNamedTypeRef(prev ?? {}) === named
    const genericArgs: Record<string, string> | undefined = names.length
      ? Object.fromEntries(
          names.map((n) => [
            n,
            sameLeaf ? (prev?.genericArgs?.[n] ?? '') : '',
          ]),
        )
      : undefined
    updateField(index, {
      type,
      typeRef,
      genericArgs,
      itemType: type === 'array' ? itemType || 'string' : undefined,
      itemTypeRef: type === 'array' ? itemTypeRef : undefined,
      itemItemType:
        type === 'array' && itemType === 'array' ? itemItemType || 'string' : undefined,
      itemItemTypeRef:
        type === 'array' && itemType === 'array' ? itemItemTypeRef : undefined,
      value: prev?.value === null ? null : defaultValue(type),
      arrayFields: undefined,
      objectFields: undefined,
      ...(type === 'ref'
        ? {
            binding: '' as const,
            computeBody: '',
            controllerBinding: undefined,
            ossBinding: undefined,
          }
        : type !== 'resource' && prev?.binding === 'oss'
          ? {
              binding: '' as const,
              ossBinding: undefined,
            }
          : {}),
    })
    if (names.length) {
      setGenericFieldIndex(index)
      setGenericNames(names)
      setGenericTypeName(findDataTypeDef(props.typeLibrary, named)?.name ?? '')
      const prevArgs = sameLeaf ? (prev?.genericArgs ?? {}) : {}
      const nextArgs: Record<string, string> = {}
      for (const n of names) nextArgs[n] = prevArgs[n] ?? ''
      setGenericArgsDraft(nextArgs)
      setGenericDialogVisible(true)
    }
  }

  const widgetRefOptions = useMemo(
    () => buildWidgetTreeSelectData(props.xml ?? ''),
    [props.xml],
  )

  function colorSafeString(value: unknown): string {
    if (value == null) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return ''
  }

  function addField() {
    setFields([...fields, createEmptyDataField()])
  }

  useImperativeHandle(ref, () => ({ addField }))

  function removeField(index: number) {
    const key = unboundValueStashKey(index)
    delete unboundValueStash.current[key]
    setFields(fields.filter((_, i) => i !== index))
  }

  function openObjectEditor(index: number) {
    setEditingIndex(index)
    setObjectDialogVisible(true)
  }

  function openArrayEditor(index: number) {
    setEditingIndex(index)
    setArrayDialogVisible(true)
  }

  function saveObjectFields(objectFields: ObjectSubField[]) {
    if (editingIndex < 0) return
    updateField(editingIndex, {
      value: buildObjectValue(objectFields),
      objectFields,
      arrayFields: undefined,
    })
  }

  function saveArrayFields(arrayFields: ArraySubField[]) {
    if (editingIndex < 0) return
    updateField(editingIndex, {
      value: buildArrayValue(arrayFields ?? []),
      arrayFields: arrayFields ?? [],
      objectFields: undefined,
    })
  }

  const editingObjectFields = useMemo(() => {
    const field = fields[editingIndex]
    if (!field || field.type !== 'json') return []
    const existing = resolveObjectFields(field.objectFields, field.value)
    if (field.typeRef) {
      return objectFieldsFromTypeRef(field.typeRef, props.typeLibrary, existing)
    }
    return existing
  }, [fields, editingIndex, props.typeLibrary])

  const editingObjectTypeRef = fields[editingIndex]?.typeRef || ''

  const editingArrayFields = useMemo(() => {
    const field = fields[editingIndex]
    if (!field || field.type !== 'array') return []
    return resolveArrayFields(field.arrayFields, field.value)
  }, [fields, editingIndex])

  function objectFieldCount(row: DataField) {
    if (row.objectFields?.length) return row.objectFields.length
    if (row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
      return Object.keys(row.value).length
    }
    return 0
  }

  function arrayItemCount(row: DataField) {
    if (row.arrayFields?.length) return row.arrayFields.length
    return Array.isArray(row.value) ? row.value.length : 0
  }

  const resolvedData = useMemo(
    () =>
      resolveComputedPageData(props.data, {
        getDeviceInfo: props.getDeviceInfo,
        dollarProps: props.dollarProps,
        dollarQuery: props.routeParams ?? undefined,
        colorPalette: props.colorPalette,
      }),
    [props.data, props.getDeviceInfo, props.dollarProps, props.routeParams, props.colorPalette],
  )

  function resolvedField(row: DataField): DataField | undefined {
    const name = row.name.trim()
    if (!name) return undefined
    return resolvedData.fields.find((item) => item.name.trim() === name)
  }

  function computedValueSummary(row: DataField): string {
    const field = resolvedField(row)
    if (!field) return '计算结果为空'
    if (field.type === 'array' || Array.isArray(field.value)) {
      return `${Array.isArray(field.value) ? field.value.length : 0} 项`
    }
    if (field.type === 'json' && field.value && typeof field.value === 'object') {
      return `${Object.keys(field.value as object).length} 个字段`
    }
    if (field.type === 'boolean') return String(Boolean(field.value))
    if (field.value == null || field.value === '') return '（空）'
    return String(field.value)
  }

  const editingField = editingIndex >= 0 ? fields[editingIndex] ?? null : null

  const siblingFieldsForCompute =
    editingIndex < 0
      ? []
      : fields.filter((item, i) => i !== editingIndex && item.name.trim())

  function openComputeEditor(index: number) {
    setEditingIndex(index)
    setComputeDialogVisible(true)
  }

  function openControllerEditor(index: number) {
    setEditingIndex(index)
    setControllerDialogVisible(true)
  }

  function openOssPicker(index: number) {
    setEditingIndex(index)
    setOssPickerVisible(true)
  }

  function controllerBindingSummary(row: DataField): string {
    const cfg = row.controllerBinding
    if (!cfg?.serviceId || !cfg.controllerId || !cfg.apiId) return '未配置 API'
    return '已绑定'
  }

  function ossBindingSummary(row: DataField): string {
    const cfg = row.ossBinding
    if (!cfg?.url) return '未选择资源'
    const key = cfg.objectKey || cfg.url
    const short = key.length > 28 ? `…${key.slice(-28)}` : key
    return short
  }

  function bindingOptionsFor(row: DataField) {
    return DATA_SOURCE_BINDING_OPTIONS.map((opt) => ({
      ...opt,
      disabled: opt.disabled || (opt.value === 'oss' && row.type !== 'resource'),
    }))
  }

  function handleBindingChange(index: number, binding: DataSourceBinding) {
    const field = fields[index]
    if (!field || field.type === 'ref') return
    if (binding === 'computed') {
      updateField(index, {
        binding: 'computed',
        computeBody: field.computeBody?.trim()
          ? field.computeBody
          : defaultComputeBody(field.type),
        controllerBinding: undefined,
        ossBinding: undefined,
      })
      openComputeEditor(index)
      return
    }
    if (binding === 'controller') {
      updateField(index, {
        binding: 'controller',
        computeBody: '',
        value: defaultControllerFieldValue(field.type),
        controllerBinding:
          field.controllerBinding ?? createEmptyControllerBinding(field.type),
        ossBinding: undefined,
      })
      openControllerEditor(index)
      return
    }
    if (binding === 'oss') {
      if (field.type !== 'resource') {
        ElMessage.warning('对象存储仅可用于「资源」类型')
        return
      }
      updateField(index, {
        binding: 'oss',
        computeBody: '',
        controllerBinding: undefined,
        ossBinding: field.ossBinding ?? createEmptyOssBinding(),
      })
      openOssPicker(index)
      return
    }
    updateField(index, {
      binding: '',
      controllerBinding: undefined,
      ossBinding: undefined,
    })
  }

  function saveComputeBody(body: string) {
    if (editingIndex < 0) return
    updateField(editingIndex, {
      binding: 'computed',
      computeBody: body,
      controllerBinding: undefined,
      ossBinding: undefined,
    })
  }

  function saveControllerBinding(config: ControllerBindingConfig) {
    if (editingIndex < 0) return
    updateField(editingIndex, {
      binding: 'controller',
      computeBody: '',
      controllerBinding: config,
      ossBinding: undefined,
    })
  }

  function saveOssBinding(config: OssBindingConfig) {
    if (editingIndex < 0) return
    updateField(editingIndex, {
      binding: 'oss',
      type: 'resource',
      computeBody: '',
      controllerBinding: undefined,
      ossBinding: config,
      value: config.url,
    })
  }

  function renderValueCell(row: DataField, index: number) {
    if (row.binding === 'computed') {
      return (
        <div className="complex-value">
          <span className="value-preview">计算 · {computedValueSummary(row)}</span>
          <Button type="link" icon={<EditOutlined />} onClick={() => openComputeEditor(index)}>
            编辑逻辑
          </Button>
        </div>
      )
    }
    if (row.binding === 'controller') {
      return (
        <div className="complex-value">
          <span className="value-preview">控制器 · {controllerBindingSummary(row)}</span>
          <Button type="link" icon={<SettingOutlined />} onClick={() => openControllerEditor(index)}>
            配置
          </Button>
        </div>
      )
    }
    if (row.binding === 'oss') {
      return (
        <div className="complex-value">
          <span className="value-preview" title={String(row.value ?? '')}>
            对象存储 · {ossBindingSummary(row)}
          </span>
          <Button type="link" icon={<SettingOutlined />} onClick={() => openOssPicker(index)}>
            选择
          </Button>
        </div>
      )
    }
    return (
      <div className="value-cell">
        <Checkbox
          checked={hasUnboundValue(row)}
          title="勾选=有值；不勾选=null"
          onChange={(e) => setUnboundValueEnabled(index, e.target.checked)}
        />
        {!hasUnboundValue(row) ? (
          <span className="null-hint">null</span>
        ) : row.type === 'resource' ? (
          <div className="resource-value">
            <Input
              value={colorSafeString(row.value)}
              placeholder="资源地址"
              onChange={(e) => updateField(index, { value: e.target.value })}
            />
            <Button type="link" onClick={() => openOssPicker(index)}>
              对象存储
            </Button>
          </div>
        ) : row.type === 'string' ? (
          <Input
            value={String(row.value ?? '')}
            placeholder="值"
            onChange={(e) => updateField(index, { value: e.target.value })}
          />
        ) : row.type === 'number' ? (
          <InputNumber
            value={Number(row.value ?? 0)}
            controls
            onChange={(v) => updateField(index, { value: Number(v ?? 0) })}
          />
        ) : row.type === 'boolean' ? (
          <Select
            value={row.value === true}
            style={{ width: '100%' }}
            options={[
              { label: 'true', value: true },
              { label: 'false', value: false },
            ]}
            onChange={(v) => updateField(index, { value: v === true })}
          />
        ) : row.type === 'time' || row.type === 'date' || row.type === 'datetime' ? (
          <DateTimeValueInput
            kind={row.type}
            size="default"
            value={colorSafeString(row.value)}
            onChange={(v) => updateField(index, { value: v })}
          />
        ) : row.type === 'icon' ? (
          <IconValueSelect
            value={colorSafeString(row.value)}
            options={props.iconOptions}
            onChange={(v) => updateField(index, { value: v })}
          />
        ) : row.type === 'color' ? (
          <ColorPicker
            value={colorSafeString(row.value)}
            placeholder="#409eff / rgba(...)"
            onChange={(v) => updateField(index, { value: v })}
          />
        ) : row.type === 'ref' ? (
          <TreeSelect
            value={colorSafeString(row.value) || undefined}
            treeData={widgetRefOptions}
            showSearch
            allowClear
            treeDefaultExpandAll
            placeholder="选择控件节点"
            style={{ width: '100%' }}
            fieldNames={{ label: 'label', value: 'value', children: 'children' }}
            onChange={(v) =>
              updateField(index, { value: v == null ? '' : String(v) })
            }
          />
        ) : row.type === 'json' ? (
          <div className="complex-value">
            <span className="value-preview">{objectFieldCount(row)} 个字段</span>
            <Button type="link" icon={<EditOutlined />} onClick={() => openObjectEditor(index)}>
              编辑
            </Button>
          </div>
        ) : row.type === 'array' ? (
          <div className="complex-value">
            <span className="value-preview">{arrayItemCount(row)} 项</span>
            <Button type="link" icon={<EditOutlined />} onClick={() => openArrayEditor(index)}>
              编辑
            </Button>
          </div>
        ) : (
          <Input
            value={colorSafeString(row.value)}
            placeholder="值"
            onChange={(e) => updateField(index, { value: e.target.value })}
          />
        )}
      </div>
    )
  }

  const columns = [
    {
      title: '字段名',
      minWidth: 140,
      render: (_: unknown, row: DataField, index: number) => (
        <Input
          value={row.name}
          placeholder="例如：username"
          onChange={(e) => updateField(index, { name: e.target.value })}
        />
      ),
    },
    {
      title: '数据类型',
      minWidth: 200,
      render: (_: unknown, row: DataField, index: number) => (
        <div className="type-cell">
          <DataFieldTypeTreeSelect
            className="type-cell-select"
            type={row.type}
            typeRef={row.typeRef}
            itemType={row.itemType}
            itemTypeRef={row.itemTypeRef}
            itemItemType={row.itemItemType}
            itemItemTypeRef={row.itemItemTypeRef}
            library={props.typeLibrary}
            labelOverride={typeSelectLabel(row) || null}
            allowRef
            excludeTypes={['api']}
            onChange={(event) => handleTypeChange(index, event)}
          />
          {genericNamesOf(leafNamedTypeRef(row)).length ? (
            <Button
              type="link"
              className="type-generic-btn"
              onClick={() => openFieldGenerics(index)}
            >
              泛型
            </Button>
          ) : null}
        </div>
      ),
    },
    {
      title: '备注',
      minWidth: 140,
      render: (_: unknown, row: DataField, index: number) => (
        <Input
          value={row.remark}
          placeholder="备注"
          onChange={(e) => updateField(index, { remark: e.target.value })}
        />
      ),
    },
    {
      title: '绑定数据源',
      minWidth: 140,
      render: (_: unknown, row: DataField, index: number) =>
        row.type === 'ref' ? (
          <div className="binding-disabled">不可绑定</div>
        ) : (
          <Select
            value={row.binding || ''}
            placeholder="无"
            style={{ width: '100%' }}
            options={bindingOptionsFor(row).map((opt) => ({
              label: opt.label,
              value: opt.value,
              disabled: opt.disabled,
            }))}
            onChange={(v) =>
              handleBindingChange(index, (v ?? '') as DataSourceBinding)
            }
          />
        ),
    },
    {
      title: '值',
      minWidth: 220,
      render: (_: unknown, row: DataField, index: number) => renderValueCell(row, index),
    },
    {
      title: '操作',
      width: 88,
      fixed: 'right' as const,
      align: 'center' as const,
      render: (_: unknown, _row: DataField, index: number) => (
        <Button type="link" danger icon={<DeleteOutlined />} onClick={() => removeField(index)}>
          删除
        </Button>
      ),
    },
  ]

  return (
    <div className="data-pool">
      <div className="data-pool-table">
        <Table
          dataSource={fields}
          columns={columns}
          rowKey={(row) => String(fields.indexOf(row))}
          bordered
          pagination={false}
          locale={{ emptyText: '暂无数据字段，点击添加字段' }}
          size="small"
        />
      </div>

      <ObjectFieldsDialog
        open={objectDialogVisible}
        onOpenChange={setObjectDialogVisible}
        fields={editingObjectFields}
        iconOptions={props.iconOptions}
        typeLibrary={props.typeLibrary}
        typeRef={editingObjectTypeRef}
        schemaLocked={Boolean(editingObjectTypeRef)}
        projectPath={props.projectPath}
        valueName={fields[editingIndex]?.name?.trim() || 'value'}
        onSave={saveObjectFields}
      />
      <ArrayFieldsDialog
        open={arrayDialogVisible}
        onOpenChange={setArrayDialogVisible}
        fields={editingArrayFields}
        iconOptions={props.iconOptions}
        typeLibrary={props.typeLibrary}
        defaultItemType={fields[editingIndex]?.itemType}
        defaultItemTypeRef={fields[editingIndex]?.itemTypeRef}
        defaultNestedItemType={fields[editingIndex]?.itemItemType}
        defaultNestedItemTypeRef={fields[editingIndex]?.itemItemTypeRef}
        projectPath={props.projectPath}
        onSave={saveArrayFields}
      />
      <ComputedBindingDialog
        open={computeDialogVisible}
        onOpenChange={setComputeDialogVisible}
        field={editingField}
        siblingFields={siblingFieldsForCompute}
        componentProps={props.componentProps}
        pageQueryParams={props.pageQueryParams}
        typeLibrary={props.typeLibrary}
        colorPalette={props.colorPalette}
        onSave={saveComputeBody}
      />
      <ControllerBindingDialog
        open={controllerDialogVisible}
        onOpenChange={setControllerDialogVisible}
        field={editingField}
        projectPath={props.projectPath || ''}
        methods={props.methods}
        dataFields={fields}
        xml={props.xml}
        componentMap={props.componentMap}
        componentMethodsMap={props.componentMethodsMap}
        iconOptions={props.iconOptions}
        componentProps={props.componentProps}
        emitEvents={props.emitEvents}
        typeLibrary={props.typeLibrary}
        pageQueryParams={props.pageQueryParams}
        onSave={saveControllerBinding}
      />
      <OssResourcePickerDialog
        open={ossPickerVisible}
        onOpenChange={setOssPickerVisible}
        projectPath={props.projectPath}
        initial={editingField?.ossBinding}
        onConfirm={saveOssBinding}
      />
      <TypeGenericArgsDialog
        open={genericDialogVisible}
        onOpenChange={setGenericDialogVisible}
        typeName={genericTypeName}
        genericNames={genericNames}
        args={genericArgsDraft}
        typeOptions={typeOptions}
        onSave={saveFieldGenerics}
      />
    </div>
  )
})
