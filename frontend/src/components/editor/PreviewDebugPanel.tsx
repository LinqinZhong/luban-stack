import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Switch,
  Tooltip,
} from 'antd'
import {
  AimOutlined,
  ApiOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons'
import type { ComponentConfig, ComponentPropDef } from '../../types/component'
import type {
  ArraySubField,
  DataField,
  DataFieldType,
  DataFieldValue,
  ObjectSubField,
  PageData,
} from '../../types/page-data'
import {
  arrayTypeLabel,
  buildObjectValue,
  resolveArrayFields,
  resolveObjectFields,
  valueToObjectFields,
} from '../../types/page-data'
import type { DataTypeLibrary, InterfaceField } from '../../types/data-types'
import {
  hasConfiguredPropDefault,
  normalizePropDefaultValue,
  resolveUnpassedPropValue,
} from '../../utils/component-props'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
  fillNamedInterfaceDefaults,
  objectFieldsFromTypeRef,
} from '../../utils/named-type-fields'
import ColorPicker from './ColorPicker'
import DateTimeValueInput from './DateTimeValueInput'
import ApiPropBindField from './ApiPropBindField'
import ObjectFieldsDialog from './ObjectFieldsDialog'
import type { ControllerFetchLogEntry } from '../../utils/controller-binding-runtime'
import './PreviewDebugPanel.css'

export type EmitLogEntry = {
  id: number
  time: string
  event: string
  args: Record<string, unknown>
}

type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'array'

type ObjectFieldForm = {
  name: string
  remark: string
  kind: FieldKind
  enumOptions: string[]
  nestedFields?: ObjectFieldForm[]
  itemFields?: ObjectFieldForm[]
  itemKind?: FieldKind
  itemEnumOptions?: string[]
}

const MAX_OBJECT_FIELD_DEPTH = 3

type PropFormModel = {
  def: ComponentPropDef
  mode: 'scalar' | 'object' | 'json' | 'array' | 'api'
  typeLabel: string
  fields: ObjectFieldForm[]
  itemKind?: FieldKind
  itemEnumOptions?: string[]
}

type DataFieldUpdateMeta = {
  objectFields?: ObjectSubField[]
  arrayFields?: ArraySubField[]
}

type DataFieldFormModel = {
  field: DataField
  mode: 'scalar' | 'object' | 'json' | 'array'
  typeLabel: string
  fields: ObjectFieldForm[]
  itemKind?: FieldKind
  itemEnumOptions?: string[]
  readonly: boolean
}

function DynamicBindIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M5.2 3.2C3.7 3.2 2.5 4.4 2.5 5.9v.7c0 1.1.9 2 2 2h1.2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M10.8 12.8c1.5 0 2.7-1.2 2.7-2.7v-.7c0-1.1-.9-2-2-2H10.3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M5.5 8h5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ExpandChevron() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4.2 2.35 8.4 6 4.2 9.65"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ComputedFieldIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="2.25"
        y="1.25"
        width="11.5"
        height="13.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <rect x="4" y="3" width="8" height="2.5" rx="0.5" fill="currentColor" opacity="0.35" />
      <rect x="4" y="7" width="2" height="1.75" rx="0.35" fill="currentColor" />
      <rect x="7" y="7" width="2" height="1.75" rx="0.35" fill="currentColor" />
      <rect x="10" y="7" width="2" height="1.75" rx="0.35" fill="currentColor" />
      <rect x="4" y="9.75" width="2" height="1.75" rx="0.35" fill="currentColor" />
      <rect x="7" y="9.75" width="2" height="1.75" rx="0.35" fill="currentColor" />
      <rect x="10" y="9.75" width="2" height="1.75" rx="0.35" fill="currentColor" />
      <rect x="4" y="12.5" width="5" height="1.75" rx="0.35" fill="currentColor" />
      <rect x="10" y="12.5" width="2" height="1.75" rx="0.35" fill="currentColor" />
    </svg>
  )
}

export default function PreviewDebugPanel({
  mode,
  config,
  propValues,
  propOverrides,
  pageData,
  emitLogs,
  controllerFetchLogs,
  typeLibrary,
  projectPath,
  inspectLabel,
  inspectComponentId,
  hostAttrs,
  onRefresh,
  onPropChange,
  onDataFieldChange,
  onClearEmitLogs,
  onLocateRef,
  onEditComponent,
}: {
  mode: 'page' | 'component'
  config?: ComponentConfig | null
  propValues?: Record<string, unknown>
  propOverrides?: Record<string, unknown>
  pageData?: PageData | null
  emitLogs?: EmitLogEntry[]
  controllerFetchLogs?: Record<string, ControllerFetchLogEntry[]>
  typeLibrary?: DataTypeLibrary | null
  projectPath?: string
  inspectLabel?: string
  inspectComponentId?: string
  hostAttrs?: Record<string, string> | null
  onRefresh?: () => void
  onPropChange?: (name: string, value: unknown) => void
  onDataFieldChange?: (
    name: string,
    value: DataFieldValue,
    meta?: DataFieldUpdateMeta,
  ) => void
  onClearEmitLogs?: () => void
  onLocateRef?: (nodePath: string) => void
  onEditComponent?: (componentId: string) => void
}) {
  const [debugTab, setDebugTab] = useState<'data' | 'log'>('data')
  const [fetchLogDialogVisible, setFetchLogDialogVisible] = useState(false)
  const [fetchLogFieldName, setFetchLogFieldName] = useState('')
  const [expandedInlineFieldName, setExpandedInlineFieldName] = useState('')
  const [expandedInlinePropName, setExpandedInlinePropName] = useState('')

  const dataFieldNullStash = useRef<Record<string, DataFieldValue>>({})
  const propNullStash = useRef<Record<string, unknown>>({})
  const propObjectFieldsStash = useRef<Record<string, ObjectSubField[]>>({})

  const [itemDialogVisible, setItemDialogVisible] = useState(false)
  const [itemDialogTitle, setItemDialogTitle] = useState('')
  const [itemEditDef, setItemEditDef] = useState<ComponentPropDef | null>(null)
  const [itemEditDataField, setItemEditDataField] = useState<DataField | null>(
    null,
  )
  const [itemEditNestedKey, setItemEditNestedKey] = useState('')
  const [itemEditIndex, setItemEditIndex] = useState(-1)
  const [itemEditFields, setItemEditFields] = useState<ObjectFieldForm[]>([])
  const [itemEditIsObject, setItemEditIsObject] = useState(true)
  const [itemEditKind, setItemEditKind] = useState<FieldKind>('string')
  const [itemEditEnumOptions, setItemEditEnumOptions] = useState<string[]>([])
  const [itemEditDraft, setItemEditDraft] = useState<Record<string, unknown>>({})
  const [itemEditScalar, setItemEditScalar] = useState<unknown>('')
  const [itemEditReadonly, setItemEditReadonly] = useState(false)

  const [objectItemDialogVisible, setObjectItemDialogVisible] = useState(false)
  const [objectItemFields, setObjectItemFields] = useState<ObjectSubField[]>([])
  const [objectItemTypeRef, setObjectItemTypeRef] = useState('')
  const [objectEditKind, setObjectEditKind] = useState<
    'array-item' | 'prop-object' | 'data-object'
  >('array-item')

  const itemEditDefRef = useRef(itemEditDef)
  itemEditDefRef.current = itemEditDef
  const itemEditDataFieldRef = useRef(itemEditDataField)
  itemEditDataFieldRef.current = itemEditDataField
  const itemEditNestedKeyRef = useRef(itemEditNestedKey)
  itemEditNestedKeyRef.current = itemEditNestedKey
  const itemEditIndexRef = useRef(itemEditIndex)
  itemEditIndexRef.current = itemEditIndex
  const objectEditKindRef = useRef(objectEditKind)
  objectEditKindRef.current = objectEditKind
  const objectItemTypeRefRef = useRef(objectItemTypeRef)
  objectItemTypeRefRef.current = objectItemTypeRef
  const itemEditReadonlyRef = useRef(itemEditReadonly)
  itemEditReadonlyRef.current = itemEditReadonly
  const itemEditIsObjectRef = useRef(itemEditIsObject)
  itemEditIsObjectRef.current = itemEditIsObject
  const itemEditScalarRef = useRef(itemEditScalar)
  itemEditScalarRef.current = itemEditScalar
  const itemEditDraftRef = useRef(itemEditDraft)
  itemEditDraftRef.current = itemEditDraft

  const showPropSection = mode === 'component' && debugTab === 'data'

  useEffect(() => {
    setDebugTab('data')
  }, [mode])

  const prevEmitLen = useRef(emitLogs?.length ?? 0)
  useEffect(() => {
    const len = emitLogs?.length ?? 0
    if (mode === 'component' && len > prevEmitLen.current) {
      setDebugTab('log')
    }
    prevEmitLen.current = len
  }, [emitLogs?.length, mode])

  const dataFields = useMemo(
    () => (pageData?.fields ?? []).filter((item) => item.name.trim()),
    [pageData],
  )

  function locateRefField(field: DataField) {
    const path = field.value == null ? '' : String(field.value).trim()
    if (!path) return
    onLocateRef?.(path)
  }

  function isComputedField(field: DataField): boolean {
    return field.binding === 'computed'
  }

  function isApiBoundField(field: DataField): boolean {
    return field.binding === 'controller' || field.type === 'api'
  }

  const fetchLogEntries = useMemo(() => {
    const name = fetchLogFieldName.trim()
    if (!name) return [] as ControllerFetchLogEntry[]
    return controllerFetchLogs?.[name] ?? []
  }, [fetchLogFieldName, controllerFetchLogs])

  function openControllerFetchLogs(field: DataField) {
    const name = field.name.trim()
    if (!name) return
    setFetchLogFieldName(name)
    setFetchLogDialogVisible(true)
  }

  function formatFetchLogJson(value: unknown): string {
    if (value === undefined) return 'undefined'
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  function isReadonlyDataField(field: DataField): boolean {
    return isComputedField(field) || field.type === 'ref' || field.type === 'api'
  }

  function supportsNullToggle(field: DataField): boolean {
    return !isReadonlyDataField(field)
  }

  function isDataFieldPresent(field: DataField): boolean {
    return field.value != null
  }

  function fieldKindFromType(
    type: string | undefined,
    typeRef?: string,
  ): { kind: FieldKind; enumOptions: string[] } {
    if (typeRef) {
      const def = findDataTypeDef(typeLibrary, typeRef)
      if (def?.kind === 'enum') {
        return {
          kind: 'enum',
          enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
        }
      }
      if (def?.kind === 'number') return { kind: 'number', enumOptions: [] }
      if (def?.kind === 'boolean') return { kind: 'boolean', enumOptions: [] }
      if (def?.kind === 'interface') return { kind: 'json', enumOptions: [] }
    }
    if (type === 'number') return { kind: 'number', enumOptions: [] }
    if (type === 'boolean') return { kind: 'boolean', enumOptions: [] }
    if (type === 'array') return { kind: 'array', enumOptions: [] }
    if (type === 'json') return { kind: 'json', enumOptions: [] }
    return { kind: 'string', enumOptions: [] }
  }

  function namedTypeLabel(typeRef: string): string {
    if (!typeRef) return ''
    return findDataTypeDef(typeLibrary, typeRef)?.name || typeRef
  }

  function atomTypeLabel(type: string | undefined, typeRef?: string): string {
    if (typeRef) return namedTypeLabel(typeRef)
    if (type === 'json') return 'object'
    if (type === 'number') return 'number'
    if (type === 'boolean') return 'boolean'
    if (type === 'array') return '[]'
    return type || 'string'
  }

  function objectFieldsOf(typeRef: string, depth = 0): ObjectFieldForm[] {
    if (depth >= MAX_OBJECT_FIELD_DEPTH) return []
    const def = findDataTypeDef(typeLibrary, typeRef)
    if (!def || def.kind !== 'interface') return []
    return def.fields
      .map((f: InterfaceField) => {
        const name = f.name.trim()
        if (!name) return null
        const mapped = typeExprToDataFieldType(f.type, typeLibrary)
        const info = fieldKindFromType(mapped.type, mapped.typeRef)
        const base: ObjectFieldForm = {
          name,
          remark: f.remark?.trim() || '',
          kind: info.kind,
          enumOptions: info.enumOptions,
        }
        return enrichObjectFieldForm(base, mapped, depth)
      })
      .filter((x): x is ObjectFieldForm => Boolean(x))
  }

  function enrichObjectFieldForm(
    base: ObjectFieldForm,
    mapped: {
      type?: string
      typeRef?: string
      itemType?: string
      itemTypeRef?: string
    },
    depth: number,
  ): ObjectFieldForm {
    if (depth >= MAX_OBJECT_FIELD_DEPTH) return base
    if (mapped.type === 'array') {
      const row: ObjectFieldForm = { ...base, kind: 'array' }
      const itemRef = mapped.itemTypeRef?.trim() || ''
      if (itemRef) {
        const itemFields = objectFieldsOf(itemRef, depth + 1)
        if (itemFields.length) {
          row.itemFields = itemFields
          return row
        }
        const named = findDataTypeDef(typeLibrary, itemRef)
        if (named?.kind === 'enum') {
          row.itemKind = 'enum'
          row.itemEnumOptions = named.enumMembers.map((m) => m.name).filter(Boolean)
          return row
        }
      }
      const info = fieldKindFromType(mapped.itemType, itemRef || undefined)
      row.itemKind = info.kind
      row.itemEnumOptions = info.enumOptions
      return row
    }
    if (mapped.type === 'json' && mapped.typeRef?.trim()) {
      const nested = objectFieldsOf(mapped.typeRef.trim(), depth + 1)
      if (nested.length) return { ...base, kind: 'json', nestedFields: nested }
    }
    return base
  }

  function objectFieldsFromSubFields(
    subs:
      | Array<{
          name: string
          type?: string
          remark?: string
          typeRef?: string
          itemType?: string
          itemTypeRef?: string
        }>
      | undefined,
    depth = 0,
  ): ObjectFieldForm[] {
    if (!subs?.length) return []
    return subs
      .map((f) => {
        const name = f.name.trim()
        if (!name) return null
        const info = fieldKindFromType(f.type, f.typeRef)
        const base: ObjectFieldForm = {
          name,
          remark: f.remark?.trim() || '',
          kind: info.kind,
          enumOptions: info.enumOptions,
        }
        return enrichObjectFieldForm(
          base,
          {
            type: f.type,
            typeRef: f.typeRef,
            itemType: f.itemType,
            itemTypeRef: f.itemTypeRef,
          },
          depth,
        )
      })
      .filter((x): x is ObjectFieldForm => Boolean(x))
  }

  function objectFieldsFromPlainValue(value: unknown): ObjectFieldForm[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    return objectFieldsFromSubFields(
      valueToObjectFields(value as Record<string, unknown>).map((f) => ({
        name: f.name,
        type: f.type,
        typeRef: f.typeRef,
        itemType: f.itemType,
        itemTypeRef: f.itemTypeRef,
      })),
    )
  }

  function mergeObjectFieldForms(...lists: ObjectFieldForm[][]): ObjectFieldForm[] {
    const map = new Map<string, ObjectFieldForm>()
    for (const list of lists) {
      for (const f of list) {
        if (!f.name || map.has(f.name)) continue
        map.set(f.name, f)
      }
    }
    return [...map.values()]
  }

  function inferArrayItemObjectFields(items: unknown[]): ObjectFieldForm[] {
    let out: ObjectFieldForm[] = []
    for (const item of items) {
      out = mergeObjectFieldForms(out, objectFieldsFromPlainValue(item))
    }
    return out
  }

  function resolveDataObjectFields(field: DataField): ObjectFieldForm[] {
    const ref = field.typeRef?.trim() || ''
    if (ref) {
      const fromType = objectFieldsOf(ref)
      if (fromType.length) return fromType
    }
    return objectFieldsFromSubFields(
      (field.objectFields ?? []).map((f) => ({
        name: f.name,
        type: f.type,
        typeRef: f.typeRef,
      })),
    )
  }

  function defaultPresentDataFieldValue(form: DataFieldFormModel): DataFieldValue {
    const field = form.field
    if (field.type === 'array') return []
    if (field.type === 'number') return 0
    if (field.type === 'boolean') return false
    if (field.type === 'map') return {}
    if (field.type === 'json') {
      const ref = field.typeRef?.trim()
      if (ref && typeLibrary) {
        const filled = fillNamedInterfaceDefaults({}, ref, typeLibrary)
        if (filled && typeof filled === 'object') {
          return filled as DataFieldValue
        }
      }
      if (form.fields.length) {
        const out: Record<string, unknown> = {}
        for (const f of form.fields) {
          out[f.name] =
            f.kind === 'number'
              ? 0
              : f.kind === 'boolean'
                ? false
                : f.kind === 'array'
                  ? []
                  : f.kind === 'json'
                    ? {}
                    : ''
        }
        return out
      }
      return {}
    }
    return ''
  }

  function onDataFieldInput(
    field: DataField,
    raw: unknown,
    meta?: DataFieldUpdateMeta,
  ) {
    if (isReadonlyDataField(field)) return
    const name = field.name.trim()
    if (!name) return
    onDataFieldChange?.(name, raw as DataFieldValue, meta)
  }

  function setDataFieldPresent(form: DataFieldFormModel, present: boolean) {
    if (form.readonly || !supportsNullToggle(form.field)) return
    const name = form.field.name.trim()
    if (!name) return
    if (present) {
      const restored = dataFieldNullStash.current[name]
      const next =
        restored !== undefined ? restored : defaultPresentDataFieldValue(form)
      delete dataFieldNullStash.current[name]
      onDataFieldInput(form.field, next)
    } else {
      if (form.field.value != null) {
        dataFieldNullStash.current[name] = form.field.value as DataFieldValue
      }
      onDataFieldInput(form.field, null)
    }
  }

  function dataFieldTypeLabel(field: DataField): string {
    return field.type
  }

  function dataFieldRemark(field: DataField): string {
    return field.remark?.trim() || ''
  }

  function resolveDataFieldForm(field: DataField): DataFieldFormModel {
    const readonly = isReadonlyDataField(field)
    if (field.type === 'array') {
      if (field.value == null) {
        const ref = field.itemTypeRef?.trim() || ''
        return {
          field,
          mode: 'json',
          typeLabel: arrayTypeLabel(ref ? namedTypeLabel(ref) : ''),
          fields: [],
          readonly,
        }
      }
      if (field.itemType === 'array') {
        return {
          field,
          mode: 'json',
          typeLabel: arrayTypeLabel(
            atomTypeLabel(field.itemItemType, field.itemItemTypeRef),
            2,
          ),
          fields: [],
          readonly,
        }
      }
      const ref = field.itemTypeRef?.trim() || ''
      if (ref) {
        const fields = objectFieldsOf(ref)
        if (fields.length) {
          return {
            field,
            mode: 'array',
            typeLabel: arrayTypeLabel(namedTypeLabel(ref)),
            fields,
            readonly,
          }
        }
        const named = findDataTypeDef(typeLibrary, ref)
        if (named?.kind === 'enum') {
          return {
            field,
            mode: 'array',
            typeLabel: arrayTypeLabel(named.name || ref),
            fields: [],
            itemKind: 'enum',
            itemEnumOptions: named.enumMembers.map((m) => m.name).filter(Boolean),
            readonly,
          }
        }
      }
      const itemType = field.itemType || 'string'
      const itemKind: FieldKind =
        itemType === 'number'
          ? 'number'
          : itemType === 'boolean'
            ? 'boolean'
            : itemType === 'json'
              ? 'json'
              : 'string'
      const sampleObjFields = field.arrayFields?.[0]?.objectFields
      const inferredFromMeta = objectFieldsFromSubFields(
        sampleObjFields?.map((f) => ({
          name: f.name,
          type: f.type,
          typeRef: f.typeRef,
        })),
      )
      const inferred =
        inferredFromMeta.length > 0
          ? inferredFromMeta
          : itemType === 'json' || itemType === 'map'
            ? inferArrayItemObjectFields(
                Array.isArray(field.value) ? field.value : [],
              )
            : []
      return {
        field,
        mode: 'array',
        typeLabel: arrayTypeLabel(atomTypeLabel(itemType, ref)),
        fields: inferred,
        itemKind: inferred.length ? undefined : itemKind,
        itemEnumOptions: [],
        readonly,
      }
    }

    if (field.type === 'json') {
      const ref = field.typeRef?.trim() || ''
      if (field.value == null) {
        return {
          field,
          mode: 'json',
          typeLabel: ref ? namedTypeLabel(ref) : 'object',
          fields: [],
          readonly,
        }
      }
      const fields = resolveDataObjectFields(field)
      if (fields.length) {
        return {
          field,
          mode: 'object',
          typeLabel: ref ? namedTypeLabel(ref) : 'object',
          fields,
          readonly,
        }
      }
      return {
        field,
        mode: 'json',
        typeLabel: ref ? namedTypeLabel(ref) : 'object',
        fields: [],
        readonly,
      }
    }

    if (field.type === 'ref' || field.type === 'api') {
      return {
        field,
        mode: 'scalar',
        typeLabel: dataFieldTypeLabel(field),
        fields: [],
        readonly: true,
      }
    }

    return {
      field,
      mode: 'scalar',
      typeLabel: field.type,
      fields: [],
      readonly,
    }
  }

  const dataFieldForms = dataFields.map(resolveDataFieldForm)

  function isInlineExpandableField(_field: DataField): boolean {
    return true
  }

  function toggleInlineExpand(form: DataFieldFormModel) {
    const name = form.field.name.trim()
    if (!name) return
    setExpandedInlineFieldName((cur) => (cur === name ? '' : name))
  }

  function isInlineExpanded(form: DataFieldFormModel): boolean {
    return expandedInlineFieldName === form.field.name.trim()
  }

  const fillDefaultsReadyRef = useRef(false)
  useEffect(() => {
    if (!fillDefaultsReadyRef.current) {
      fillDefaultsReadyRef.current = true
      return
    }
    if (!typeLibrary) return
    for (const field of dataFields) {
      if (field.type !== 'json' || !field.typeRef?.trim()) continue
      if (isReadonlyDataField(field)) continue
      // null = 未加载；勿填成空对象，否则 !goodsInfo 等 loading 判断失效
      if (field.value == null) continue
      const filled = fillNamedInterfaceDefaults(
        field.value,
        field.typeRef,
        typeLibrary,
      )
      if (filled === field.value) continue
      try {
        if (JSON.stringify(filled) === JSON.stringify(field.value)) continue
      } catch {
        // fall through
      }
      onDataFieldInput(field, filled as DataFieldValue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFields])

  function getDataArrayItems(field: DataField): unknown[] {
    return Array.isArray(field.value) ? field.value : []
  }

  function dataObjectFieldValue(field: DataField, fieldName: string): unknown {
    const obj = field.value
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return (obj as Record<string, unknown>)[fieldName]
    }
    return undefined
  }

  function setDataObjectField(
    form: DataFieldFormModel,
    fieldName: string,
    value: unknown,
  ) {
    if (form.readonly) return
    const cur = form.field.value
    const base =
      cur && typeof cur === 'object' && !Array.isArray(cur)
        ? { ...(cur as Record<string, unknown>) }
        : buildObjectDefault(form.fields)
    base[fieldName] = value
    onDataFieldInput(form.field, base)
  }

  const propDefs = (config?.props ?? []).filter((item) => item.name.trim())

  function isPropDynamic(def: ComponentPropDef): boolean {
    const name = def.name.trim()
    if (!name) return false
    const raw = hostAttrs?.[name]
    if (typeof raw !== 'string') return false
    return /\{[^{}]+\}/.test(raw.trim())
  }

  function propHostBinding(def: ComponentPropDef): string {
    const name = def.name.trim()
    return String(hostAttrs?.[name] ?? '').trim()
  }

  function propDisplayValue(def: ComponentPropDef): unknown {
    const name = def.name.trim()
    if (propValues && name in propValues) {
      return propValues[name]
    }
    return resolveUnpassedPropValue(def)
  }

  function supportsPropNullToggle(def: ComponentPropDef): boolean {
    if (isPropDynamic(def)) return false
    if (def.type === 'api') return false
    return !def.required
  }

  function isPropPresent(def: ComponentPropDef): boolean {
    if (!supportsPropNullToggle(def)) return true
    const name = def.name.trim()
    if (!name) return false
    const raw = propOverrides
    if (!raw || !(name in raw)) return false
    return raw[name] !== null
  }

  function unpassedPropHint(def: ComponentPropDef): string {
    const fallback = resolveUnpassedPropValue(def)
    if (fallback === null) return 'null（未传且无默认值）'
    if (typeof fallback === 'object') {
      try {
        return `未传，使用默认值：${JSON.stringify(fallback)}`
      } catch {
        return '未传，使用默认值'
      }
    }
    return `未传，使用默认值：${String(fallback)}`
  }

  function resolvePropForm(def: ComponentPropDef): PropFormModel {
    if (def.type === 'array') {
      if (def.itemType === 'array') {
        return {
          def,
          mode: 'json',
          typeLabel: arrayTypeLabel(
            atomTypeLabel(def.itemItemType, def.itemItemTypeRef),
            2,
          ),
          fields: [],
        }
      }
      const ref = def.itemTypeRef?.trim() || ''
      if (ref) {
        const fields = objectFieldsOf(ref)
        if (fields.length) {
          return {
            def,
            mode: 'array',
            typeLabel: arrayTypeLabel(namedTypeLabel(ref)),
            fields,
          }
        }
        const named = findDataTypeDef(typeLibrary, ref)
        if (named?.kind === 'enum') {
          return {
            def,
            mode: 'array',
            typeLabel: arrayTypeLabel(named.name || ref),
            fields: [],
            itemKind: 'enum',
            itemEnumOptions: named.enumMembers.map((m) => m.name).filter(Boolean),
          }
        }
      }
      const itemType = def.itemType || 'string'
      const itemKind: FieldKind =
        itemType === 'number'
          ? 'number'
          : itemType === 'boolean'
            ? 'boolean'
            : itemType === 'json'
              ? 'json'
              : 'string'
      const inferred =
        itemType === 'json' || itemType === 'map'
          ? inferArrayItemObjectFields(
              (() => {
                const raw = propDisplayValue(def)
                return Array.isArray(raw) ? raw : []
              })(),
            )
          : []
      return {
        def,
        mode: 'array',
        typeLabel: arrayTypeLabel(atomTypeLabel(itemType, ref)),
        fields: inferred,
        itemKind: inferred.length ? undefined : itemKind,
        itemEnumOptions: [],
      }
    }

    if (def.type === 'json') {
      const ref = def.typeRef?.trim() || ''
      if (ref) {
        const fields = objectFieldsOf(ref)
        if (fields.length) {
          return {
            def,
            mode: 'object',
            typeLabel: namedTypeLabel(ref),
            fields,
          }
        }
      }
      return {
        def,
        mode: 'json',
        typeLabel: ref ? namedTypeLabel(ref) : 'object',
        fields: [],
      }
    }

    if (def.type === 'api') {
      const n = def.apiParams?.length ?? 0
      return {
        def,
        mode: 'api',
        typeLabel: n ? `后端API · ${n} 形参` : '后端API',
        fields: [],
      }
    }

    return {
      def,
      mode: 'scalar',
      typeLabel: def.type,
      fields: [],
    }
  }

  const propForms = propDefs.map(resolvePropForm)

  function isPropInlineExpandable(def: ComponentPropDef): boolean {
    if (def.type === 'boolean') return supportsPropNullToggle(def)
    return true
  }

  function togglePropInlineExpand(form: PropFormModel) {
    const name = form.def.name.trim()
    if (!name) return
    setExpandedInlinePropName((cur) => (cur === name ? '' : name))
  }

  function isPropInlineExpanded(form: PropFormModel): boolean {
    return expandedInlinePropName === form.def.name.trim()
  }

  function propRemark(def: ComponentPropDef): string {
    return def.remark?.trim() || ''
  }

  function defaultForKind(kind: FieldKind): unknown {
    switch (kind) {
      case 'number':
        return 0
      case 'boolean':
        return false
      case 'array':
        return []
      case 'json':
        return {}
      default:
        return ''
    }
  }

  function buildObjectDefault(fields: ObjectFieldForm[]): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const f of fields) out[f.name] = defaultForKind(f.kind)
    return out
  }

  function defaultPresentPropValue(form: PropFormModel): unknown {
    const def = form.def
    if (hasConfiguredPropDefault(def)) {
      return normalizePropDefaultValue(def.type, def.defaultValue)
    }
    if (def.type === 'array') return []
    if (def.type === 'number') return 0
    if (def.type === 'boolean') return false
    if (def.type === 'map' || def.type === 'json') {
      if (form.fields.length) return buildObjectDefault(form.fields)
      return {}
    }
    return ''
  }

  function onPropInput(def: ComponentPropDef, raw: unknown) {
    if (isPropDynamic(def)) return
    const name = def.name.trim()
    if (!name) return
    if (raw === null) {
      onPropChange?.(name, null)
      return
    }
    onPropChange?.(name, normalizePropDefaultValue(def.type, raw))
  }

  function setPropPresent(form: PropFormModel, present: boolean) {
    if (!supportsPropNullToggle(form.def)) return
    const name = form.def.name.trim()
    if (!name) return
    if (present) {
      const restored = propNullStash.current[name]
      const next =
        restored !== undefined ? restored : defaultPresentPropValue(form)
      delete propNullStash.current[name]
      onPropInput(form.def, next)
    } else {
      const cur = propDisplayValue(form.def)
      if (isPropPresent(form.def) && cur != null) propNullStash.current[name] = cur
      onPropInput(form.def, null)
    }
  }

  useEffect(() => {
    setExpandedInlinePropName('')
    propNullStash.current = {}
  }, [inspectComponentId, inspectLabel, config?.name])

  function formatJson(value: unknown): string {
    try {
      return JSON.stringify(value ?? null, null, 2)
    } catch {
      return String(value)
    }
  }

  function getArrayItems(def: ComponentPropDef): unknown[] {
    const v = propDisplayValue(def)
    return Array.isArray(v) ? v : []
  }

  function summarizeItem(item: unknown, fields: ObjectFieldForm[]): string {
    if (item == null) return '空'
    if (!fields.length) {
      if (typeof item === 'object') return formatJson(item)
      return String(item)
    }
    if (typeof item !== 'object' || Array.isArray(item)) {
      return String(item)
    }
    const obj = item as Record<string, unknown>
    const parts: string[] = []
    for (const f of fields.slice(0, 3)) {
      const v = obj[f.name]
      if (v === undefined || v === '') continue
      const text = typeof v === 'object' ? formatJson(v) : String(v)
      parts.push(`${f.name}: ${text}`)
    }
    return parts.length ? parts.join(' · ') : '（空）'
  }

  function setObjectField(
    def: ComponentPropDef,
    fieldName: string,
    value: unknown,
  ) {
    const cur = propDisplayValue(def)
    const base =
      cur && typeof cur === 'object' && !Array.isArray(cur)
        ? { ...(cur as Record<string, unknown>) }
        : buildObjectDefault(
            propForms.find((f) => f.def.name === def.name)?.fields ?? [],
          )
    base[fieldName] = value
    onPropInput(def, base)
  }

  function objectFieldValue(def: ComponentPropDef, fieldName: string): unknown {
    const obj = propDisplayValue(def)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return (obj as Record<string, unknown>)[fieldName]
    }
    return undefined
  }

  function getNestedArrayItems(
    owner: ComponentPropDef | DataField,
    fieldName: string,
    isProp: boolean,
  ): unknown[] {
    const raw = isProp
      ? objectFieldValue(owner as ComponentPropDef, fieldName)
      : dataObjectFieldValue(owner as DataField, fieldName)
    return Array.isArray(raw) ? raw : []
  }

  function fieldKindToDataType(kind: FieldKind): DataFieldType {
    if (kind === 'number') return 'number'
    if (kind === 'boolean') return 'boolean'
    if (kind === 'array') return 'array'
    if (kind === 'json') return 'json'
    return 'string'
  }

  function shouldUseObjectItemEditor(
    fields: ObjectFieldForm[],
    itemKind?: FieldKind,
    current?: unknown,
  ): boolean {
    if (fields.length > 0) return true
    if (itemKind === 'json') return true
    return Boolean(
      current && typeof current === 'object' && !Array.isArray(current),
    )
  }

  function objectFormsToSubFields(
    forms: ObjectFieldForm[],
    current?: unknown,
  ): ObjectSubField[] {
    const values =
      current && typeof current === 'object' && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {}
    if (forms.length) {
      return forms.map((f) => {
        const type = fieldKindToDataType(f.kind)
        const raw = values[f.name]
        return {
          name: f.name,
          type,
          value:
            raw !== undefined
              ? (raw as DataFieldValue)
              : (defaultForKind(f.kind) as DataFieldValue),
        }
      })
    }
    return resolveObjectFields(
      undefined,
      current && typeof current === 'object' ? current : {},
    )
  }

  function beginItemDialog(options: {
    def?: ComponentPropDef | null
    dataField?: DataField | null
    nestedKey?: string
    index: number
    fields: ObjectFieldForm[]
    itemKind?: FieldKind
    itemEnumOptions?: string[]
    title: string
    readonly?: boolean
    current?: unknown
  }) {
    setItemEditDef(options.def ?? null)
    setItemEditDataField(options.dataField ?? null)
    setItemEditNestedKey(options.nestedKey?.trim() || '')
    setItemEditReadonly(Boolean(options.readonly))
    setItemEditIndex(options.index)
    setItemEditFields(options.fields)
    const isObject = options.fields.length > 0
    setItemEditIsObject(isObject)
    setItemEditKind(options.itemKind || 'string')
    setItemEditEnumOptions(options.itemEnumOptions || [])
    setItemDialogTitle(options.title)
    if (isObject) {
      const base = buildObjectDefault(options.fields)
      const current = options.current
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        setItemEditDraft({ ...base, ...(current as Record<string, unknown>) })
      } else {
        setItemEditDraft(base)
      }
    } else {
      setItemEditDraft({})
      setItemEditScalar(
        options.current !== undefined
          ? options.current
          : defaultForKind(options.itemKind || 'string'),
      )
    }
    setItemDialogVisible(true)
  }

  function beginObjectItemEditor(options: {
    def?: ComponentPropDef | null
    dataField?: DataField | null
    nestedKey?: string
    index: number
    fields: ObjectFieldForm[]
    typeRef?: string
    current?: unknown
    readonly?: boolean
    objectFieldsMeta?: ObjectSubField[]
  }) {
    setObjectEditKind('array-item')
    setItemEditDef(options.def ?? null)
    setItemEditDataField(options.dataField ?? null)
    setItemEditNestedKey(options.nestedKey?.trim() || '')
    setItemEditIndex(options.index)
    setItemEditReadonly(Boolean(options.readonly))
    const typeRef = options.typeRef?.trim() || ''
    setObjectItemTypeRef(typeRef)
    const existing =
      options.objectFieldsMeta?.length
        ? resolveObjectFields(options.objectFieldsMeta, options.current)
        : objectFormsToSubFields(options.fields, options.current)
    setObjectItemFields(
      typeRef
        ? objectFieldsFromTypeRef(typeRef, typeLibrary, existing)
        : existing,
    )
    setObjectItemDialogVisible(true)
  }

  function openPropObjectEditor(def: ComponentPropDef) {
    if (isPropDynamic(def)) return
    setObjectEditKind('prop-object')
    setItemEditDef(def)
    setItemEditDataField(null)
    setItemEditReadonly(false)
    const typeRef = def.typeRef?.trim() || ''
    setObjectItemTypeRef(typeRef)
    const current = propDisplayValue(def)
    const stash = propObjectFieldsStash.current[def.name]
    const existing = resolveObjectFields(
      stash,
      current && typeof current === 'object' && !Array.isArray(current)
        ? current
        : {},
    )
    setObjectItemFields(
      typeRef
        ? objectFieldsFromTypeRef(typeRef, typeLibrary, existing)
        : existing,
    )
    setObjectItemDialogVisible(true)
  }

  function openDataObjectEditor(field: DataField) {
    if (isReadonlyDataField(field)) return
    setObjectEditKind('data-object')
    setItemEditDef(null)
    setItemEditDataField(field)
    setItemEditReadonly(false)
    const typeRef = field.typeRef?.trim() || ''
    setObjectItemTypeRef(typeRef)
    const existing = resolveObjectFields(field.objectFields, field.value)
    setObjectItemFields(
      typeRef
        ? objectFieldsFromTypeRef(typeRef, typeLibrary, existing)
        : existing,
    )
    setObjectItemDialogVisible(true)
  }

  function applyArrayItemValue(value: unknown) {
    const nestedKey = itemEditNestedKeyRef.current
    if (itemEditDataFieldRef.current) {
      const field = itemEditDataFieldRef.current
      if (nestedKey) {
        const next = [...getNestedArrayItems(field, nestedKey, false)]
        if (itemEditIndexRef.current >= 0) next[itemEditIndexRef.current] = value
        else next.push(value)
        const form = dataFieldForms.find((f) => f.field.name === field.name)
        if (form) setDataObjectField(form, nestedKey, next)
      } else {
        const next = [...getDataArrayItems(field)]
        if (itemEditIndexRef.current >= 0) next[itemEditIndexRef.current] = value
        else next.push(value)
        onDataFieldInput(field, next)
      }
      return
    }
    const def = itemEditDefRef.current
    if (!def) return
    if (nestedKey) {
      const next = [...getNestedArrayItems(def, nestedKey, true)]
      if (itemEditIndexRef.current >= 0) next[itemEditIndexRef.current] = value
      else next.push(value)
      setObjectField(def, nestedKey, next)
    } else {
      const next = [...getArrayItems(def)]
      if (itemEditIndexRef.current >= 0) next[itemEditIndexRef.current] = value
      else next.push(value)
      onPropInput(def, next)
    }
  }

  function saveObjectItemFields(fields: ObjectSubField[]) {
    if (itemEditReadonlyRef.current) {
      setObjectItemDialogVisible(false)
      return
    }
    const value = buildObjectValue(fields)
    if (objectEditKindRef.current === 'prop-object' && itemEditDefRef.current) {
      propObjectFieldsStash.current[itemEditDefRef.current.name] = fields
      onPropInput(itemEditDefRef.current, value)
    } else if (
      objectEditKindRef.current === 'data-object' &&
      itemEditDataFieldRef.current
    ) {
      onDataFieldInput(itemEditDataFieldRef.current, value, {
        objectFields: fields,
      })
    } else if (
      objectEditKindRef.current === 'array-item' &&
      itemEditDataFieldRef.current &&
      !itemEditNestedKeyRef.current
    ) {
      const field = itemEditDataFieldRef.current
      const next = [...getDataArrayItems(field)]
      if (itemEditIndexRef.current >= 0) next[itemEditIndexRef.current] = value
      else next.push(value)
      const nextArrayFields = [
        ...resolveArrayFields(field.arrayFields, getDataArrayItems(field)),
      ]
      const itemMeta: ArraySubField = {
        type: 'json',
        typeRef: objectItemTypeRefRef.current || undefined,
        objectFields: fields,
      }
      if (itemEditIndexRef.current >= 0) {
        while (nextArrayFields.length <= itemEditIndexRef.current) {
          nextArrayFields.push({ type: 'json', objectFields: [] })
        }
        nextArrayFields[itemEditIndexRef.current] = itemMeta
      } else {
        nextArrayFields.push(itemMeta)
      }
      onDataFieldInput(field, next, { arrayFields: nextArrayFields })
    } else {
      applyArrayItemValue(value)
    }
    setObjectItemDialogVisible(false)
  }

  function objectValueFieldCount(value: unknown): number {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.keys(value as Record<string, unknown>).length
    }
    return 0
  }

  function openAddArrayItem(form: PropFormModel) {
    const fields =
      form.fields.length > 0
        ? form.fields
        : inferArrayItemObjectFields(getArrayItems(form.def))
    if (shouldUseObjectItemEditor(fields, form.itemKind)) {
      beginObjectItemEditor({
        def: form.def,
        index: -1,
        fields,
        typeRef: form.def.itemTypeRef,
      })
      return
    }
    beginItemDialog({
      def: form.def,
      index: -1,
      fields,
      itemKind: fields.length ? undefined : form.itemKind,
      itemEnumOptions: form.itemEnumOptions,
      title: `添加 · ${form.def.name}`,
    })
  }

  function openEditArrayItem(form: PropFormModel, index: number) {
    const current = getArrayItems(form.def)[index]
    const fields = mergeObjectFieldForms(
      form.fields,
      objectFieldsFromPlainValue(current),
    )
    if (shouldUseObjectItemEditor(fields, form.itemKind, current)) {
      beginObjectItemEditor({
        def: form.def,
        index,
        fields,
        typeRef: form.def.itemTypeRef,
        current,
      })
      return
    }
    beginItemDialog({
      def: form.def,
      index,
      fields,
      itemKind: fields.length ? undefined : form.itemKind,
      itemEnumOptions: form.itemEnumOptions,
      title: `编辑 · ${form.def.name}[${index}]`,
      current,
    })
  }

  function openAddDataArrayItem(form: DataFieldFormModel) {
    if (form.readonly) return
    const fields =
      form.fields.length > 0
        ? form.fields
        : inferArrayItemObjectFields(getDataArrayItems(form.field))
    if (shouldUseObjectItemEditor(fields, form.itemKind)) {
      beginObjectItemEditor({
        dataField: form.field,
        index: -1,
        fields,
        typeRef: form.field.itemTypeRef,
      })
      return
    }
    beginItemDialog({
      dataField: form.field,
      index: -1,
      fields,
      itemKind: fields.length ? undefined : form.itemKind,
      itemEnumOptions: form.itemEnumOptions,
      title: `添加 · ${form.field.name}`,
    })
  }

  function openEditDataArrayItem(form: DataFieldFormModel, index: number) {
    const current = getDataArrayItems(form.field)[index]
    const fields = mergeObjectFieldForms(
      form.fields,
      objectFieldsFromPlainValue(current),
    )
    const arrayMeta = resolveArrayFields(
      form.field.arrayFields,
      getDataArrayItems(form.field),
    )
    const itemMeta = arrayMeta[index]
    if (shouldUseObjectItemEditor(fields, form.itemKind, current)) {
      beginObjectItemEditor({
        dataField: form.field,
        index,
        fields,
        typeRef: form.field.itemTypeRef,
        current,
        readonly: form.readonly,
        objectFieldsMeta:
          itemMeta?.type === 'json' ? itemMeta.objectFields : undefined,
      })
      return
    }
    beginItemDialog({
      dataField: form.field,
      index,
      fields,
      itemKind: fields.length ? undefined : form.itemKind,
      itemEnumOptions: form.itemEnumOptions,
      title: `${form.readonly ? '查看' : '编辑'} · ${form.field.name}[${index}]`,
      readonly: form.readonly,
      current,
    })
  }

  function removeArrayItem(def: ComponentPropDef, index: number) {
    const next = [...getArrayItems(def)]
    next.splice(index, 1)
    onPropInput(def, next)
  }

  function removeDataArrayItem(field: DataField, index: number) {
    if (isReadonlyDataField(field)) return
    const next = [...getDataArrayItems(field)]
    next.splice(index, 1)
    onDataFieldInput(field, next)
  }

  function setItemField(name: string, value: unknown) {
    setItemEditDraft((prev) => ({ ...prev, [name]: value }))
  }

  function onItemNestedJsonBlur(
    fieldName: string,
    text: string,
    asArray: boolean,
  ) {
    const raw = text.trim()
    if (!raw) {
      setItemField(fieldName, asArray ? [] : {})
      return
    }
    try {
      setItemField(fieldName, JSON.parse(raw))
    } catch {
      // keep
    }
  }

  function saveItemDialog() {
    if (itemEditReadonlyRef.current) {
      setItemDialogVisible(false)
      return
    }
    const value = itemEditIsObjectRef.current
      ? { ...itemEditDraftRef.current }
      : itemEditScalarRef.current
    applyArrayItemValue(value)
    setItemDialogVisible(false)
  }

  useEffect(() => {
    setItemDialogVisible(false)
    setObjectItemDialogVisible(false)
  }, [mode])

  function renderPropInlineEditor(form: PropFormModel) {
    if (supportsPropNullToggle(form.def) && !isPropPresent(form.def)) {
      return <div className="null-hint">{unpassedPropHint(form.def)}</div>
    }
    if (form.mode === 'scalar' || isPropDynamic(form.def)) {
      return (
        <>
          {form.def.type === 'boolean' ? (
            <Select
              value={propDisplayValue(form.def) === true}
              style={{ width: '100%' }}
              options={[
                { label: 'true', value: true },
                { label: 'false', value: false },
              ]}
              onChange={(v) => onPropInput(form.def, v === true)}
            />
          ) : form.def.type === 'number' ? (
            <InputNumber
              value={Number(propDisplayValue(form.def) ?? 0)}
              style={{ width: '100%' }}
              disabled={isPropDynamic(form.def)}
              onChange={(v) => onPropInput(form.def, v ?? 0)}
            />
          ) : isPropDynamic(form.def) ? (
            <Input
              value={
                form.def.type === 'array' ||
                form.def.type === 'json' ||
                form.def.type === 'map'
                  ? formatJson(propDisplayValue(form.def))
                  : String(propDisplayValue(form.def) ?? '')
              }
              disabled
            />
          ) : form.def.type === 'color' ? (
            <ColorPicker
              value={String(propDisplayValue(form.def) ?? '')}
              placeholder="#409eff / rgba(...)"
              onChange={(v) => onPropInput(form.def, v)}
            />
          ) : form.def.type === 'time' ||
            form.def.type === 'date' ||
            form.def.type === 'datetime' ? (
            <DateTimeValueInput
              kind={form.def.type}
              size="small"
              value={String(propDisplayValue(form.def) ?? '')}
              onChange={(v) => onPropInput(form.def, v)}
            />
          ) : (
            <Input
              value={String(propDisplayValue(form.def) ?? '')}
              onChange={(e) => onPropInput(form.def, e.target.value)}
            />
          )}
          {isPropDynamic(form.def) ? (
            <div
              className="prop-dynamic-bind"
              title={propHostBinding(form.def)}
            >
              {propHostBinding(form.def)}
            </div>
          ) : null}
        </>
      )
    }
    if (form.mode === 'api') {
      return (
        <ApiPropBindField
          value={String(propDisplayValue(form.def) ?? '')}
          projectPath={projectPath || ''}
          apiParams={form.def.apiParams}
          apiReturnType={form.def.apiReturnType}
          dataFields={dataFields}
          componentProps={config?.props}
          typeLibrary={typeLibrary}
          onChange={(v) => onPropInput(form.def, v)}
        />
      )
    }
    if (form.mode === 'object' || form.mode === 'json') {
      return (
        <div className="complex-value">
          <span className="value-preview">
            {objectValueFieldCount(propDisplayValue(form.def))} 个字段
          </span>
          <Button
            type="link"
            disabled={isPropDynamic(form.def)}
            onClick={() => openPropObjectEditor(form.def)}
          >
            编辑对象
          </Button>
        </div>
      )
    }
    if (form.mode === 'array') {
      const items = getArrayItems(form.def)
      return (
        <div className="array-list">
          {!items.length ? (
            <div className="array-empty">暂无数据，点击下方添加</div>
          ) : null}
          {items.map((item, index) => (
            <div
              key={`${form.def.name}-${index}`}
              className="array-item"
              onClick={() => openEditArrayItem(form, index)}
            >
              <div className="array-item-main">
                <span className="array-index">{index + 1}</span>
                <span className="array-summary">
                  {summarizeItem(item, form.fields)}
                </span>
              </div>
              <div
                className="array-item-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => openEditArrayItem(form, index)}
                />
                <Button
                  type="link"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => removeArrayItem(form.def, index)}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="array-item array-add-item"
            onClick={() => openAddArrayItem(form)}
          >
            <div className="array-item-main">
              <span className="array-index array-add-icon">
                <PlusOutlined style={{ fontSize: 12 }} />
              </span>
              <span className="array-summary array-add-label">添加</span>
            </div>
          </button>
        </div>
      )
    }
    return null
  }

  function renderDataInlineEditor(form: DataFieldFormModel) {
    if (supportsNullToggle(form.field) && !isDataFieldPresent(form.field)) {
      return <div className="null-hint">null（外侧不勾选时为空）</div>
    }
    if (form.mode === 'scalar') {
      if (form.field.type === 'boolean') {
        return (
          <Select
            value={form.field.value === true}
            disabled={form.readonly}
            style={{ width: '100%' }}
            options={[
              { label: 'true', value: true },
              { label: 'false', value: false },
            ]}
            onChange={(v) => onDataFieldInput(form.field, v === true)}
          />
        )
      }
      if (form.field.type === 'number') {
        return (
          <InputNumber
            value={Number(form.field.value ?? 0)}
            disabled={form.readonly}
            style={{ width: '100%' }}
            onChange={(v) => onDataFieldInput(form.field, v ?? 0)}
          />
        )
      }
      if (form.field.type === 'color') {
        return (
          <ColorPicker
            value={String(form.field.value ?? '')}
            placeholder="#409eff / rgba(...)"
            onChange={(v) => onDataFieldInput(form.field, v)}
          />
        )
      }
      if (
        form.field.type === 'time' ||
        form.field.type === 'date' ||
        form.field.type === 'datetime'
      ) {
        return (
          <DateTimeValueInput
            kind={form.field.type}
            size="small"
            clearable={!form.readonly}
            value={String(form.field.value ?? '')}
            onChange={(v) => {
              if (!form.readonly) onDataFieldInput(form.field, v)
            }}
          />
        )
      }
      if (form.field.type === 'ref') {
        return (
          <div className="ref-field-row">
            <Input
              value={form.field.value == null ? '' : String(form.field.value)}
              readOnly
              placeholder="控件引用路径"
            />
            <Tooltip title="击中：组件模式并选中该组件">
              <Button
                className="ref-locate-btn"
                icon={<AimOutlined />}
                disabled={!String(form.field.value ?? '').trim()}
                onClick={() => locateRefField(form.field)}
              />
            </Tooltip>
          </div>
        )
      }
      return (
        <Input
          value={form.field.value == null ? '' : String(form.field.value)}
          readOnly={form.readonly}
          placeholder="输入字符串"
          onChange={(e) => onDataFieldInput(form.field, e.target.value)}
        />
      )
    }
    if (form.mode === 'object' || form.mode === 'json') {
      return (
        <div className="complex-value">
          <span className="value-preview">
            {objectValueFieldCount(form.field.value)} 个字段
          </span>
          <Button
            type="link"
            disabled={form.readonly}
            onClick={() => openDataObjectEditor(form.field)}
          >
            编辑对象
          </Button>
        </div>
      )
    }
    if (form.mode === 'array') {
      const items = getDataArrayItems(form.field)
      return (
        <div className="array-list">
          {!items.length ? (
            <div className="array-empty">
              暂无数据{form.readonly ? '' : '，点击下方添加'}
            </div>
          ) : null}
          {items.map((item, index) => (
            <div
              key={`${form.field.name}-${index}`}
              className="array-item"
              onClick={() => openEditDataArrayItem(form, index)}
            >
              <div className="array-item-main">
                <span className="array-index">{index + 1}</span>
                <span className="array-summary">
                  {summarizeItem(item, form.fields)}
                </span>
              </div>
              <div
                className="array-item-actions"
                onClick={(e) => e.stopPropagation()}
              >
                <Button
                  type="link"
                  icon={<EditOutlined />}
                  onClick={() => openEditDataArrayItem(form, index)}
                />
                {!form.readonly ? (
                  <Button
                    type="link"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeDataArrayItem(form.field, index)}
                  />
                ) : null}
              </div>
            </div>
          ))}
          {!form.readonly ? (
            <button
              type="button"
              className="array-item array-add-item"
              onClick={() => openAddDataArrayItem(form)}
            >
              <div className="array-item-main">
                <span className="array-index array-add-icon">
                  <PlusOutlined style={{ fontSize: 12 }} />
                </span>
                <span className="array-summary array-add-label">添加</span>
              </div>
            </button>
          ) : null}
        </div>
      )
    }
    return null
  }

  return (
    <aside className="preview-debug">
      <div className="panel-header">
        <span>调试</span>
        {mode === 'component' ? (
          <Radio.Group
            value={debugTab}
            size="small"
            className="panel-tabs"
            optionType="button"
            onChange={(e) => setDebugTab(e.target.value as 'data' | 'log')}
          >
            <Radio.Button value="data">数据</Radio.Button>
            <Radio.Button value="log">
              日志
              {emitLogs?.length ? (
                <span className="tab-badge">{emitLogs.length}</span>
              ) : null}
            </Radio.Button>
          </Radio.Group>
        ) : null}
      </div>

      <div className="panel-body">
        {inspectLabel ? (
          <div className="inspect-banner">
            <span className="inspect-banner-label">检视组件</span>
            <span className="inspect-banner-name">{inspectLabel}</span>
            {inspectComponentId ? (
              <Tooltip title="进入组件">
                <Button
                  className="inspect-edit-btn"
                  type="link"
                  size="small"
                  icon={<RightOutlined />}
                  onClick={() => onEditComponent?.(inspectComponentId)}
                >
                  查看
                </Button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {showPropSection ? (
          <div className="section">
            <div className="section-title">入参</div>
            {!propForms.length ? (
              <Empty description="暂无入参" styles={{ image: { height: 48 } }} />
            ) : (
              <div className="param-list">
                {propForms.map((form) => (
                  <div
                    key={form.def.name}
                    className={`data-field-summary${isPropInlineExpanded(form) ? ' is-expanded' : ''}${propRemark(form.def) ? ' has-remark' : ''}`}
                  >
                    <div className="data-field-summary-top">
                      <div className="data-field-summary-main">
                        {isPropDynamic(form.def) ? (
                          <span
                            className="field-lead binding-field-icon is-dynamic"
                            title={`动态绑定 ${propHostBinding(form.def)}`}
                            aria-label="动态绑定"
                          >
                            <DynamicBindIcon />
                          </span>
                        ) : form.def.type === 'boolean' &&
                          !supportsPropNullToggle(form.def) ? (
                          <Checkbox
                            className="field-lead"
                            checked={propDisplayValue(form.def) === true}
                            title="布尔值"
                            onChange={(e) =>
                              onPropInput(form.def, e.target.checked)
                            }
                          />
                        ) : (
                          <Checkbox
                            className="field-lead"
                            checked={isPropPresent(form.def)}
                            disabled={!supportsPropNullToggle(form.def)}
                            title="勾选=显式传入；不勾选=不传（有默认用默认，否则 null）"
                            onChange={(e) => {
                              if (supportsPropNullToggle(form.def)) {
                                setPropPresent(form, e.target.checked)
                              }
                            }}
                          />
                        )}
                        <div className="data-field-summary-text">
                          <div className="data-field-summary-line">
                            <span className="prop-name">{form.def.name}</span>
                            <span className="prop-type">: {form.typeLabel}</span>
                          </div>
                          {propRemark(form.def) ? (
                            <div
                              className="data-field-remark"
                              title={propRemark(form.def)}
                            >
                              {propRemark(form.def)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {isPropInlineExpandable(form.def) ? (
                        <button
                          type="button"
                          className={`expand-btn${isPropInlineExpanded(form) ? ' is-open' : ''}`}
                          aria-expanded={isPropInlineExpanded(form)}
                          aria-label={
                            isPropInlineExpanded(form) ? '收起' : '展开'
                          }
                          onClick={() => togglePropInlineExpand(form)}
                        >
                          <ExpandChevron />
                        </button>
                      ) : null}
                    </div>
                    {isPropInlineExpandable(form.def) &&
                    isPropInlineExpanded(form) ? (
                      <div className="data-field-inline-editor">
                        {renderPropInlineEditor(form)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {mode === 'component' && debugTab === 'log' ? (
          <div className="section emit-section">
            <div className="section-title row">
              <span>Emit 日志</span>
              <Button
                type="link"
                danger
                icon={<DeleteOutlined />}
                disabled={!(emitLogs && emitLogs.length)}
                onClick={() => onClearEmitLogs?.()}
              >
                清空
              </Button>
            </div>
            {!emitLogs?.length ? (
              <Empty
                description="点击画布触发 emit 后显示在这里"
                styles={{ image: { height: 48 } }}
              />
            ) : (
              <div className="emit-log">
                {emitLogs.map((item) => (
                  <div key={item.id} className="emit-card">
                    <div className="emit-head">
                      <span className="emit-event">{item.event}</span>
                      <span className="emit-time">{item.time}</span>
                    </div>
                    <pre className="emit-args">{formatJson(item.args)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {mode === 'page' || debugTab === 'data' ? (
          <div className="section">
            <div className="section-title row">
              <span>数据池</span>
              {mode === 'component' || inspectLabel ? (
                <Button
                  type="link"
                  icon={<ReloadOutlined />}
                  onClick={() => onRefresh?.()}
                >
                  刷新
                </Button>
              ) : null}
            </div>
            {!dataFieldForms.length ? (
              <Empty description="暂无数据池字段" styles={{ image: { height: 48 } }} />
            ) : (
              <div className="param-list">
                {dataFieldForms.map((form) => (
                  <div
                    key={form.field.name}
                    className={`data-field-summary${isInlineExpanded(form) ? ' is-expanded' : ''}${dataFieldRemark(form.field) ? ' has-remark' : ''}`}
                  >
                    <div className="data-field-summary-top">
                      <div className="data-field-summary-main">
                        {isComputedField(form.field) ? (
                          <span
                            className="field-lead binding-field-icon is-computed"
                            title="计算字段"
                            aria-label="计算字段"
                          >
                            <ComputedFieldIcon />
                          </span>
                        ) : isApiBoundField(form.field) ? (
                          <button
                            type="button"
                            className="field-lead binding-field-icon is-controller is-clickable"
                            title="查看获取日志"
                            aria-label="查看获取日志"
                            onClick={(e) => {
                              e.stopPropagation()
                              openControllerFetchLogs(form.field)
                            }}
                          >
                            <ApiOutlined style={{ fontSize: 14 }} />
                          </button>
                        ) : (
                          <Checkbox
                            className="field-lead"
                            checked={isDataFieldPresent(form.field)}
                            disabled={
                              form.readonly || !supportsNullToggle(form.field)
                            }
                            title="勾选=有值；不勾选=null"
                            onChange={(e) => {
                              if (supportsNullToggle(form.field)) {
                                setDataFieldPresent(form, e.target.checked)
                              }
                            }}
                          />
                        )}
                        <div className="data-field-summary-text">
                          <div className="data-field-summary-line">
                            <span className="prop-name">{form.field.name}</span>
                            <span className="prop-type">: {form.typeLabel}</span>
                          </div>
                          {dataFieldRemark(form.field) ? (
                            <div
                              className="data-field-remark"
                              title={dataFieldRemark(form.field)}
                            >
                              {dataFieldRemark(form.field)}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      {isInlineExpandableField(form.field) ? (
                        <button
                          type="button"
                          className={`expand-btn${isInlineExpanded(form) ? ' is-open' : ''}`}
                          aria-expanded={isInlineExpanded(form)}
                          aria-label={isInlineExpanded(form) ? '收起' : '展开'}
                          onClick={() => toggleInlineExpand(form)}
                        >
                          <ExpandChevron />
                        </button>
                      ) : null}
                    </div>
                    {isInlineExpandableField(form.field) &&
                    isInlineExpanded(form) ? (
                      <div className="data-field-inline-editor">
                        {renderDataInlineEditor(form)}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <Modal
        open={itemDialogVisible}
        title={itemDialogTitle}
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => setItemDialogVisible(false)}
        footer={
          itemEditReadonly ? (
            <Button onClick={() => setItemDialogVisible(false)}>关闭</Button>
          ) : (
            <Button type="primary" onClick={saveItemDialog}>
              确定
            </Button>
          )
        }
      >
        {itemEditIsObject ? (
          <div className="item-form">
            {itemEditFields.map((field) => (
              <div key={field.name} className="item-form-row">
                <div className="item-form-label">
                  <span className="prop-name">{field.name}</span>
                  {field.remark ? (
                    <span className="prop-type">{field.remark}</span>
                  ) : null}
                </div>
                {field.kind === 'boolean' ? (
                  <Switch
                    checked={itemEditDraft[field.name] === true}
                    onChange={(checked) => setItemField(field.name, checked)}
                  />
                ) : field.kind === 'number' ? (
                  <InputNumber
                    value={Number(itemEditDraft[field.name] ?? 0)}
                    style={{ width: '100%' }}
                    onChange={(v) => setItemField(field.name, v ?? 0)}
                  />
                ) : field.kind === 'enum' ? (
                  <Select
                    value={String(itemEditDraft[field.name] ?? '') || undefined}
                    allowClear
                    placeholder="选择"
                    style={{ width: '100%' }}
                    options={field.enumOptions.map((opt) => ({
                      label: opt,
                      value: opt,
                    }))}
                    onChange={(v) => setItemField(field.name, v ?? '')}
                  />
                ) : field.kind === 'json' || field.kind === 'array' ? (
                  <Input.TextArea
                    rows={3}
                    value={formatJson(itemEditDraft[field.name])}
                    onBlur={(e) =>
                      onItemNestedJsonBlur(
                        field.name,
                        e.target.value,
                        field.kind === 'array',
                      )
                    }
                  />
                ) : (
                  <Input
                    value={String(itemEditDraft[field.name] ?? '')}
                    onChange={(e) =>
                      setItemField(field.name, String(e.target.value ?? ''))
                    }
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="item-form">
            <div className="item-form-row">
              <div className="item-form-label">
                <span className="prop-name">值</span>
              </div>
              {itemEditKind === 'boolean' ? (
                <Switch
                  checked={itemEditScalar === true}
                  onChange={(checked) => setItemEditScalar(checked)}
                />
              ) : itemEditKind === 'number' ? (
                <InputNumber
                  value={Number(itemEditScalar ?? 0)}
                  style={{ width: '100%' }}
                  onChange={(v) => setItemEditScalar(v ?? 0)}
                />
              ) : itemEditKind === 'enum' ? (
                <Select
                  value={String(itemEditScalar ?? '') || undefined}
                  allowClear
                  style={{ width: '100%' }}
                  options={itemEditEnumOptions.map((opt) => ({
                    label: opt,
                    value: opt,
                  }))}
                  onChange={(v) => setItemEditScalar(v ?? '')}
                />
              ) : itemEditKind === 'json' || itemEditKind === 'array' ? (
                <Input.TextArea
                  rows={3}
                  value={formatJson(itemEditScalar)}
                  onBlur={(e) => {
                    const raw = e.target.value.trim()
                    if (!raw) {
                      setItemEditScalar(itemEditKind === 'array' ? [] : {})
                      return
                    }
                    try {
                      setItemEditScalar(JSON.parse(raw))
                    } catch {
                      /* keep */
                    }
                  }}
                />
              ) : (
                <Input
                  value={String(itemEditScalar ?? '')}
                  onChange={(e) => setItemEditScalar(e.target.value)}
                />
              )}
            </div>
          </div>
        )}
      </Modal>

      <ObjectFieldsDialog
        open={objectItemDialogVisible}
        onOpenChange={setObjectItemDialogVisible}
        fields={objectItemFields}
        typeLibrary={typeLibrary}
        typeRef={objectItemTypeRef}
        schemaLocked={Boolean(objectItemTypeRef)}
        projectPath={projectPath}
        readonly={itemEditReadonly}
        valueName={
          itemEditDataField?.name?.trim() ||
          itemEditDef?.name?.trim() ||
          'value'
        }
        onSave={saveObjectItemFields}
      />

      <Modal
        open={fetchLogDialogVisible}
        title={`获取日志 · ${fetchLogFieldName || '—'}`}
        width={560}
        destroyOnHidden
        onCancel={() => setFetchLogDialogVisible(false)}
        footer={
          <Button onClick={() => setFetchLogDialogVisible(false)}>关闭</Button>
        }
      >
        {!fetchLogEntries.length ? (
          <Empty
            description="尚无获取记录（进入预览后会自动拉取）"
            styles={{ image: { height: 56 } }}
          />
        ) : (
          <div className="fetch-log-list">
            {fetchLogEntries.map((entry) => (
              <div
                key={entry.id}
                className={`fetch-log-card${entry.status === 'error' ? ' is-error' : ''}`}
              >
                <div className="fetch-log-head">
                  <span className="fetch-log-time">{entry.time}</span>
                  <span
                    className={`fetch-log-status ${entry.status === 'success' ? 'ok' : 'err'}`}
                  >
                    {entry.status === 'success' ? '成功' : '失败'}
                  </span>
                  <span className="fetch-log-duration">
                    {entry.durationMs}ms
                  </span>
                </div>
                <div className="fetch-log-meta">
                  API：{entry.apiName || entry.apiId || '—'}
                </div>
                <div className="fetch-log-block">
                  <div className="fetch-log-label">入参</div>
                  <pre className="fetch-log-pre">
                    {formatFetchLogJson(entry.inputs)}
                  </pre>
                </div>
                {entry.status === 'error' ? (
                  <div className="fetch-log-block">
                    <div className="fetch-log-label">错误</div>
                    <pre className="fetch-log-pre is-error">
                      {entry.error || '—'}
                    </pre>
                  </div>
                ) : (
                  <>
                    {entry.raw !== undefined ? (
                      <div className="fetch-log-block">
                        <div className="fetch-log-label">原始返回</div>
                        <pre className="fetch-log-pre">
                          {formatFetchLogJson(entry.raw)}
                        </pre>
                      </div>
                    ) : null}
                    <div className="fetch-log-block">
                      <div className="fetch-log-label">写入数据池</div>
                      <pre className="fetch-log-pre">
                        {formatFetchLogJson(entry.result)}
                      </pre>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </aside>
  )
}
