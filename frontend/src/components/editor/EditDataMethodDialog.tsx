import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Select,
} from 'antd'
import { ElMessage } from '../../ui/feedback'
import {
  DATA_METHOD_OPERATION_OPTIONS,
  DATA_METHOD_SOURCE_OPTIONS,
  createEmptyDataMethodConfig,
  createEmptyDataMethodHttpRequestConfig,
  createEmptyProcessorTypeExpr,
  type DataMethodConfig,
  type DataMethodFieldMapping,
  type DataMethodOperation,
  type DataMethodSourceKind,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import NetworkRequestFields from './method-flow/dialogs/NetworkRequestFields'
import {
  validateNetworkParamRows,
  type NetworkRequestConfig,
} from './method-flow/dialogs/network-request'
import TsCodeEditor from './TsCodeEditor'
import {
  HTTP_RESPONSE_TYPE_ID,
  unwrapArrayAtom,
  type DataTypeLibrary,
  type InterfaceField,
  type TypeExpr,
} from '../../types/data-types'
import {
  MAP_KEY_TYPE_OPTIONS,
  typeLabel,
  arrayTypeLabel,
  type DataFieldType,
  type MapKeyType,
} from '../../types/page-data'
import {
  findDataTypeDef,
} from '../../utils/named-type-fields'
import type { MysqlColumnDef, MysqlIndexDef } from '../../types/mysql'
import {
  processorTypeExprToMethodParamType,
  processorTypeExprToTs,
  type MethodParam,
} from '../../types/page-method'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import MethodParamsDialog from './MethodParamsDialog'
import TypeGenericArgsDialog from './TypeGenericArgsDialog'
import SqlCodeEditor from './SqlCodeEditor'
import DataMethodConditionsEditor from './DataMethodConditionsEditor'
import {
  buildConditionFieldOptions,
  serializeConditionGroups as serializeConditionGroupsUtil,
  type ConditionValueUi,
} from '../../utils/data-method-conditions'
import { DM } from './edit-data-method-copy'
import './EditDataMethodDialog.css'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = [
  'color',
  'ref',
  'icon',
  'resource',
]
const MAP_VALUE_EXCLUDE_TYPES: DataFieldType[] = [
  ...PROCESSOR_EXCLUDE_TYPES,
  'map',
]

export type OutputFieldOption = {
  name: string
  remark: string
  sourceLabel?: string
}

export type DataMethodEditPayload = {
  name: string
  params: ProcessorMethodParam[]
  output: ProcessorTypeExpr
  dataConfig: DataMethodConfig
}

const MAP_KEY_FIELD = 'key'

const HTTP_PARSE_AMBIENT_EXTRA = [
  'type HttpResponse<T = any> = {',
  '  status: number;',
  '  headers: Map<string, string> | Record<string, string>;',
  '  body: T;',
  '};',
].join('\n')

type SourceOption = { value: string; label: string }

function leafNamedRef(expr: ProcessorTypeExpr): string {
  if (expr.type === 'array' || expr.type === 'map') {
    if (expr.itemType === 'array') return expr.itemItemTypeRef || ''
    return expr.itemTypeRef || ''
  }
  return expr.typeRef || ''
}

function primaryAtom(expr: TypeExpr | undefined | null) {
  return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
}

function fieldsOf(
  def: { fields: InterfaceField[] } | null | undefined,
): OutputFieldOption[] {
  if (!def) return []
  return def.fields
    .map((f) => ({
      name: f.name.trim(),
      remark: f.remark?.trim() || '',
    }))
    .filter((f) => f.name)
}

function resolveOutputFields(
  output: ProcessorTypeExpr,
  library: DataTypeLibrary | null,
): OutputFieldOption[] {
  const t = (output.type || '').trim()

  if (t === 'map') {
    const valueIsArray = output.itemType === 'array'
    const leafType = (
      valueIsArray ? output.itemItemType || 'string' : output.itemType || 'string'
    ) as DataFieldType
    const leafRef = (
      valueIsArray ? output.itemItemTypeRef || '' : output.itemTypeRef || ''
    ).trim()
    const leafDef = findDataTypeDef(library, leafRef)
    const keyRemark = valueIsArray ? DM.mapIndexField : DM.mapUniqueKey
    const keyRow: OutputFieldOption = {
      name: MAP_KEY_FIELD,
      remark: keyRemark,
      sourceLabel: keyRemark,
    }

    if (leafDef?.kind === 'interface') {
      return [
        keyRow,
        ...fieldsOf(leafDef).map((f) => ({
          ...f,
          sourceLabel: leafDef.name,
        })),
      ]
    }

    let valueLabel =
      leafDef?.name?.trim() || typeLabel(leafType) || leafType || 'any'
    if (valueIsArray) valueLabel = arrayTypeLabel(valueLabel)
    return [
      keyRow,
      {
        name: 'value',
        remark: `${DM.mapValue} · ${valueLabel}`,
        sourceLabel: valueLabel,
      },
    ]
  }

  const named = leafNamedRef(output)
  const def = findDataTypeDef(library, named)
  if (def && def.kind === 'interface') {
    const genericField = def.fields.find((f) => {
      const atom = unwrapArrayAtom(primaryAtom(f.type))
      return atom.kind === 'generic'
    })
    if (genericField) {
      const gName = unwrapArrayAtom(primaryAtom(genericField.type)).ref ?? ''
      const boundId = (output.genericArgs?.[gName] ?? '').trim()
      const bound = findDataTypeDef(library, boundId)
      if (bound?.kind === 'interface') {
        const nested = fieldsOf(bound)
        if (nested.length) {
          return nested.map((f) => ({
            ...f,
            sourceLabel: bound.name,
          }))
        }
      }
    }

    return fieldsOf(def).map((f) => ({
      ...f,
      sourceLabel: def.name,
    }))
  }

  if (!t) return []

  let label = ''
  if (named) {
    label = def?.name?.trim() || named
    if (t === 'array') label = `${label}[]`
  } else if (t === 'array') {
    const item =
      typeLabel((output.itemType || 'string') as DataFieldType) ||
      output.itemType ||
      'any'
    label = arrayTypeLabel(item)
  } else {
    label = typeLabel(t as DataFieldType) || t
  }

  return [
    {
      name: 'value',
      remark: label,
      sourceLabel: label,
    },
  ]
}

function displayRemark(name: string, remark: string): string {
  const r = remark.trim()
  if (!r || r === name) return ''
  return r
}

function createHttpResponseOutput(
  prev?: ProcessorTypeExpr | null,
): ProcessorTypeExpr {
  const prevT =
    prev?.typeRef === HTTP_RESPONSE_TYPE_ID
      ? (prev.genericArgs?.T ?? '').trim()
      : ''
  return {
    ...createEmptyProcessorTypeExpr('json'),
    type: 'json',
    typeRef: HTTP_RESPONSE_TYPE_ID,
    genericArgs: { T: prevT },
  }
}

export default function EditDataMethodDialog({
  open,
  onOpenChange,
  method,
  typeLibrary,
  typeOptions,
  entityRef,
  entityColumns,
  entityIndexes,
  entityTableName,
  reservedNames,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  method: ProcessorMethod | null
  typeLibrary: DataTypeLibrary | null
  typeOptions: Array<{ id: string; label: string }>
  entityRef?: string
  entityColumns?: MysqlColumnDef[]
  entityIndexes?: MysqlIndexDef[]
  entityTableName?: string
  reservedNames?: string[]
  onSave?: (payload: DataMethodEditPayload) => void
}) {
  const [draft, setDraft] = useState<DataMethodConfig>(
    createEmptyDataMethodConfig(),
  )
  const [draftName, setDraftName] = useState('')
  const [draftParams, setDraftParams] = useState<ProcessorMethodParam[]>([])
  const [draftOutput, setDraftOutput] = useState<ProcessorTypeExpr>(
    createEmptyProcessorTypeExpr(),
  )
  const [insertEnabled, setInsertEnabled] = useState<string[]>([])
  const [paramsDialogVisible, setParamsDialogVisible] = useState(false)
  const [genericVisible, setGenericVisible] = useState(false)
  const [genericNames, setGenericNames] = useState<string[]>([])
  const [genericTypeName, setGenericTypeName] = useState('')
  const [genericArgs, setGenericArgs] = useState<Record<string, string>>({})

  const draftRef = useRef(draft)
  const paramsRef = useRef(draftParams)
  const outputRef = useRef(draftOutput)
  const insertEnabledRef = useRef(insertEnabled)
  draftRef.current = draft
  paramsRef.current = draftParams
  outputRef.current = draftOutput
  insertEnabledRef.current = insertEnabled

  const outputFields = useMemo(
    () => resolveOutputFields(draftOutput, typeLibrary),
    [draftOutput, typeLibrary],
  )

  const isQuery = draft.operation === 'query'
  const isCustom = draft.operation === 'custom'
  const isMapOutput = draftOutput.type === 'map'
  const isInsert =
    draft.operation === 'insert' || draft.operation === 'batchInsert'
  const isBatchInsert = draft.operation === 'batchInsert'
  const showConditions = !isInsert && !isCustom
  const isMysql = draft.source === 'mysql'
  const isHttp = draft.source === 'http'

  const httpAmbientVars = useMemo(
    (): MethodParam[] =>
      draftParams
        .filter((p) => p.name.trim())
        .map((p) => ({
          name: p.name.trim(),
          type: processorTypeExprToMethodParamType(p.typeExpr),
          typeExpr: p.typeExpr,
          tsType: processorTypeExprToTs(p.typeExpr, typeLibrary),
        })),
    [draftParams, typeLibrary],
  )

  const httpBodyTypeIdent = useMemo(() => {
    const t = (draftOutput.genericArgs?.T ?? '').trim()
    if (!t || t === 'any') return 'any'
    const def = findDataTypeDef(typeLibrary, t)
    const name = (def?.name || t).trim()
    return /^[A-Za-z_$][\w$]*$/.test(name) ? name : 'any'
  }, [draftOutput.genericArgs, typeLibrary])

  const httpOutputLabel = `HttpResponse<${httpBodyTypeIdent}>`
  const httpParseReturnTs = `HttpResponse<${httpBodyTypeIdent}>`
  const httpParseParams = useMemo(
    () => [
      {
        name: 'response',
        type: 'object' as const,
        tsType: 'HttpResponse<any>',
      },
    ],
    [],
  )

  const tableFields = useMemo((): OutputFieldOption[] => {
    const cols = entityColumns ?? []
    const table = entityTableName?.trim() || ''
    const list: OutputFieldOption[] = []
    const seen = new Set<string>()
    for (const c of cols) {
      const col = c.name.trim()
      if (!col || seen.has(col)) continue
      seen.add(col)
      list.push({
        name: col,
        remark: c.comment?.trim() || '',
        sourceLabel: table || col,
      })
    }
    return list
  }, [entityColumns, entityTableName])

  const tableFieldNames = useMemo(
    () => new Set(tableFields.map((f) => f.name)),
    [tableFields],
  )

  const selectedQueryFieldOptions = useMemo(() => {
    const selected = new Set(draft.queryFields)
    return tableFields.filter((f) => selected.has(f.name))
  }, [draft.queryFields, tableFields])

  const mapKeyType: MapKeyType =
    draftOutput.keyType === 'number' ? 'number' : 'string'

  const mapValueIsInterface = useMemo(() => {
    if (draftOutput.type !== 'map') return false
    const ref = (
      draftOutput.itemType === 'array'
        ? draftOutput.itemItemTypeRef
        : draftOutput.itemTypeRef
    ).trim()
    const def = findDataTypeDef(typeLibrary, ref)
    return def?.kind === 'interface'
  }, [draftOutput, typeLibrary])

  const uniqueOrPrimaryFieldNames = useMemo(() => {
    const names = new Set<string>()
    const cols = entityColumns ?? []
    for (const c of cols) {
      const col = c.name.trim()
      if (!col) continue
      if (c.primaryKey || col.toLowerCase() === 'id') names.add(col)
    }
    for (const idx of entityIndexes ?? []) {
      if (idx.columns.length !== 1) continue
      const col = idx.columns[0]?.trim()
      if (!col) continue
      names.add(col)
    }
    return names
  }, [entityColumns, entityIndexes])

  const conditionFieldOptions = useMemo(
    () => buildConditionFieldOptions(typeLibrary, entityRef ?? ''),
    [typeLibrary, entityRef],
  )

  function tableColumnValueUi(columnName: string): ConditionValueUi {
    const col = (entityColumns ?? []).find((c) => c.name.trim() === columnName)
    if (col) {
      const t = col.type.trim().toLowerCase()
      if (
        t.includes('date') ||
        t.includes('time') ||
        t === 'year' ||
        t === 'timestamp'
      ) {
        return 'datetime'
      }
      if (
        /^(tiny|small|medium|big)?int|decimal|numeric|float|double|real|bit/.test(
          t,
        )
      ) {
        return 'number'
      }
      if (t === 'bool' || t === 'boolean' || t.startsWith('tinyint(1)')) {
        return 'boolean'
      }
      return 'string'
    }
    return (
      conditionFieldOptions.find((o) => o.value === columnName)?.valueUi ??
      'string'
    )
  }

  const mapKeyFieldOptions = useMemo(() => {
    const unique = uniqueOrPrimaryFieldNames
    const preferred = tableFields.filter((f) => unique.has(f.name))
    if (preferred.length) return preferred
    const selected = new Set(draft.queryFields)
    const fromQuery = tableFields.filter((f) => selected.has(f.name))
    if (fromQuery.length) return fromQuery
    return tableFields
  }, [uniqueOrPrimaryFieldNames, tableFields, draft.queryFields])

  const hasUniqueOrPrimaryKeys = uniqueOrPrimaryFieldNames.size > 0

  const mapKeyColumn =
    draft.fieldMappings.find((m) => m.field === MAP_KEY_FIELD)?.column ?? ''

  const mappingRows = useMemo(() => {
    const map = new Map(
      draft.fieldMappings.map((m) => [m.field, m.column] as const),
    )
    return outputFields.map((f) => ({
      field: f.name,
      remark: displayRemark(f.name, f.remark),
      column: map.get(f.name) ?? '',
    }))
  }, [draft.fieldMappings, outputFields])

  const mapValueMappingRows = mappingRows.filter(
    (r) => r.field !== MAP_KEY_FIELD,
  )

  const mapValueSelectType: DataFieldType =
    draftOutput.itemType === 'array'
      ? 'array'
      : ((draftOutput.itemType || 'string') as DataFieldType) || 'string'
  const mapValueSelectTypeRef =
    draftOutput.itemType === 'array' ? '' : draftOutput.itemTypeRef || ''
  const mapValueSelectItemType: DataFieldType | undefined =
    draftOutput.itemType !== 'array'
      ? undefined
      : ((draftOutput.itemItemType || 'string') as DataFieldType)
  const mapValueSelectItemTypeRef =
    draftOutput.itemType === 'array' ? draftOutput.itemItemTypeRef || '' : ''

  const enabledSourceOptions = DATA_METHOD_SOURCE_OPTIONS.filter(
    (o) => !o.disabled,
  )

  const conditionAmbientVars = useMemo(
    (): MethodParam[] =>
      draftParams
        .map((p) => {
          const name = p.name.trim()
          if (!name) return null
          return {
            name,
            type: processorTypeExprToMethodParamType(p.typeExpr),
            typeExpr: p.typeExpr,
            tsType: processorTypeExprToTs(p.typeExpr, typeLibrary),
          } satisfies MethodParam
        })
        .filter((p): p is NonNullable<typeof p> => p !== null),
    [draftParams, typeLibrary],
  )

  const entityFields = useMemo(() => {
    const def = findDataTypeDef(typeLibrary, entityRef ?? '')
    if (!def || def.kind !== 'interface') return [] as OutputFieldOption[]
    return fieldsOf(def).map((f) => ({
      ...f,
      sourceLabel: def.name,
    }))
  }, [typeLibrary, entityRef])

  const queryFieldPool = tableFields

  const queryFieldsSourceHint = useMemo(() => {
    const table = entityTableName?.trim()
    if (table) return `${DM.target}${DM.mid}${table}`
    return DM.queryFields
  }, [entityTableName])

  const arrayParamOptions = useMemo((): SourceOption[] => {
    const opts: SourceOption[] = []
    for (const p of draftParams) {
      const name = p.name.trim()
      if (!name || p.typeExpr.type !== 'array') continue
      const itemRef =
        p.typeExpr.itemType === 'array'
          ? p.typeExpr.itemItemTypeRef
          : p.typeExpr.itemTypeRef
      const typeName = itemRef
        ? findDataTypeDef(typeLibrary, itemRef)?.name || itemRef
        : p.typeExpr.itemType || DM.element
      opts.push({
        value: name,
        label: `${name}${DM.mid}${typeName}[]`,
      })
    }
    return opts
  }, [draftParams, typeLibrary])

  const pageParamOptions = useMemo((): SourceOption[] => {
    const opts: SourceOption[] = []
    for (const p of draftParams) {
      const name = p.name.trim()
      if (!name) continue
      const t = p.typeExpr.type
      if (t === 'array' || t === 'string' || t === 'number' || t === 'boolean') {
        continue
      }
      const ts = processorTypeExprToTs(p.typeExpr, typeLibrary)
      opts.push({
        value: name,
        label: `${name}${DM.mid}${ts}`,
      })
    }
    return opts
  }, [draftParams, typeLibrary])

  function buildInsertSourceOptions(
    d: DataMethodConfig,
    params: ProcessorMethodParam[],
  ): SourceOption[] {
    const opts: SourceOption[] = []
    const batch = d.operation === 'batchInsert'

    if (batch) {
      const arrayName = d.batchSourceParam.trim()
      if (!arrayName) return opts
      const p = params.find((x) => x.name.trim() === arrayName)
      if (!p || p.typeExpr.type !== 'array') return opts
      const expr = p.typeExpr
      const itemRef =
        expr.itemType === 'array' ? expr.itemItemTypeRef : expr.itemTypeRef
      const itemType =
        expr.itemType === 'array' ? expr.itemItemType : expr.itemType
      if (itemRef) {
        const def = findDataTypeDef(typeLibrary, itemRef)
        if (def?.kind === 'interface') {
          for (const f of fieldsOf(def)) {
            opts.push({
              value: `${arrayName}.${f.name}`,
              label: `${f.name}${f.remark ? `${DM.mid}${f.remark}` : ''}`,
            })
          }
          return opts
        }
      }
      if (itemType && itemType !== 'json' && itemType !== 'array') {
        opts.push({ value: arrayName, label: DM.elementSelf })
      }
      return opts
    }

    for (const p of params) {
      const name = p.name.trim()
      if (!name) continue
      const expr = p.typeExpr
      if (expr.type === 'array') continue
      if (expr.typeRef || (expr.type === 'json' && expr.typeRef)) {
        const def = findDataTypeDef(typeLibrary, expr.typeRef)
        if (def?.kind === 'interface') {
          for (const f of fieldsOf(def)) {
            opts.push({
              value: `${name}.${f.name}`,
              label: `${name}.${f.name}${f.remark ? `${DM.mid}${f.remark}` : ''}`,
            })
          }
          continue
        }
      }
      opts.push({ value: name, label: name })
    }
    return opts
  }

  const insertSourceOptions = useMemo(
    () => buildInsertSourceOptions(draft, draftParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, draftParams, typeLibrary],
  )

  const insertMappingRows = useMemo(() => {
    const map = new Map(
      draft.fieldMappings.map((m) => [m.field, m.column] as const),
    )
    const enabled = new Set(insertEnabled)
    return entityFields.map((f) => ({
      field: f.name,
      remark: displayRemark(f.name, f.remark),
      source: map.get(f.name) ?? '',
      checked: enabled.has(f.name),
    }))
  }, [draft.fieldMappings, insertEnabled, entityFields])

  const selectedCount = draft.queryFields.length
  const allSelected =
    queryFieldPool.length > 0 &&
    queryFieldPool.every((f) => draft.queryFields.includes(f.name))

  const methodTitle = useMemo(() => {
    const name = draftName.trim() || method?.name?.trim()
    return name ? `${DM.title}${DM.mid}${name}` : DM.title
  }, [draftName, method?.name])

  function typeDefById(id: string) {
    return findDataTypeDef(typeLibrary, id)
  }

  function genericNamesOf(typeRef: string): string[] {
    return (typeDefById(typeRef)?.generics ?? [])
      .map((g) => g.name.trim())
      .filter(Boolean)
  }

  function formatTypeWithGenerics(
    typeRef: string,
    args: Record<string, string>,
  ): string {
    const def = typeDefById(typeRef)
    if (!def?.name) return typeRef || '?'
    const names = genericNamesOf(typeRef)
    if (!names.length) return def.name
    const inner = names
      .map((n) => {
        const ref = args[n] ?? ''
        if (!ref) return 'any'
        return typeDefById(ref)?.name || ref
      })
      .join(', ')
    return `${def.name}<${inner}>`
  }

  function formatTypeExpr(expr: ProcessorTypeExpr): string {
    const named = leafNamedRef(expr)
    const namedLabel = named
      ? formatTypeWithGenerics(named, expr.genericArgs ?? {})
      : ''
    if (expr.type === 'array') {
      if (expr.itemType === 'array') {
        const leaf =
          namedLabel ||
          typeLabel((expr.itemItemType || 'string') as DataFieldType)
        return arrayTypeLabel(leaf, 2)
      }
      const leaf =
        namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
      return arrayTypeLabel(leaf)
    }
    if (expr.type === 'map') {
      const keyLabel = expr.keyType === 'number' ? 'number' : 'string'
      if (expr.itemType === 'array') {
        const leaf =
          namedLabel ||
          typeLabel((expr.itemItemType || 'string') as DataFieldType)
        return `${typeLabel('map')} / ${keyLabel} / ${arrayTypeLabel(leaf)}`
      }
      const leaf =
        namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
      return `${typeLabel('map')} / ${keyLabel} / ${leaf}`
    }
    if (named) return namedLabel
    return typeLabel((expr.type || 'string') as DataFieldType)
  }

  function paramsSummary(params: ProcessorMethodParam[]): string {
    if (!params.length) return DM.paramsEmpty
    return params
      .map((p) => {
        const label = formatTypeExpr(p.typeExpr)
        return p.name ? `${p.name}: ${label}` : label
      })
      .join(', ')
  }

  function payloadToTypeExpr(
    payload: TypeSelectPayload,
    prev?: ProcessorTypeExpr,
  ): ProcessorTypeExpr {
    const fieldType =
      payload.type === 'void' || payload.type === 'generic'
        ? 'any'
        : payload.type
    const next: ProcessorTypeExpr = {
      ...createEmptyProcessorTypeExpr(fieldType),
      type: fieldType,
      typeRef: payload.typeRef ?? '',
      itemType:
        payload.itemType === 'generic' ? 'any' : (payload.itemType ?? ''),
      itemTypeRef: payload.itemTypeRef ?? '',
      itemItemType:
        payload.itemItemType === 'generic'
          ? 'any'
          : (payload.itemItemType ?? ''),
      itemItemTypeRef: payload.itemItemTypeRef ?? '',
      keyType:
        fieldType === 'map'
          ? payload.keyType === 'number'
            ? 'number'
            : 'string'
          : '',
      genericArgs: {},
    }
    const named = leafNamedRef(next)
    const prevNamed = prev ? leafNamedRef(prev) : ''
    if (named && named === prevNamed) {
      next.genericArgs = { ...(prev?.genericArgs ?? {}) }
    } else {
      for (const n of genericNamesOf(named)) next.genericArgs[n] = ''
    }
    return next
  }

  function syncQueryFieldsForOutput(
    output: ProcessorTypeExpr,
    d: DataMethodConfig,
  ): DataMethodConfig {
    const names = resolveOutputFields(output, typeLibrary).map((f) => f.name)
    let next = { ...d }
    if (next.operation === 'query') {
      if (output.type === 'map') {
        const map = new Map(
          next.fieldMappings.map((m) => [m.field, m.column] as const),
        )
        const fieldMappings = names.map((name) => ({
          field: name,
          column: map.get(name) ?? '',
        }))
        let queryFields = next.queryFields.filter((n) => tableFieldNames.has(n))
        if (!queryFields.length) {
          queryFields = [
            ...new Set(
              fieldMappings
                .map((m) => m.column.trim())
                .filter((c) => tableFieldNames.has(c)),
            ),
          ]
        }
        next = { ...next, fieldMappings, queryFields }
        return next
      }
      const kept = next.queryFields.filter((n) => tableFieldNames.has(n))
      next = {
        ...next,
        queryFields: kept.length ? kept : tableFields.map((f) => f.name),
      }
    }
    if (next.operation === 'custom' && names.length) {
      const map = new Map(
        next.fieldMappings.map((m) => [m.field, m.column] as const),
      )
      next = {
        ...next,
        fieldMappings: names.map((name) => ({
          field: name,
          column: map.get(name) ?? '',
        })),
      }
    }
    return next
  }

  function computeInsertMappings(
    d: DataMethodConfig,
    params: ProcessorMethodParam[],
    enabled: string[],
    options?: { preferEnabled: string[] | null },
  ): { fieldMappings: DataMethodFieldMapping[]; insertEnabled: string[] } {
    const sources = buildInsertSourceOptions(d, params)
    const byLeaf = new Map<string, string>()
    for (const s of sources) {
      const leaf = s.value.includes('.')
        ? s.value.slice(s.value.lastIndexOf('.') + 1)
        : s.value
      if (!byLeaf.has(leaf)) byLeaf.set(leaf, s.value)
    }
    const prev = new Map(d.fieldMappings.map((m) => [m.field, m.column] as const))
    const fieldMappings = entityFields.map((f) => ({
      field: f.name,
      column: prev.get(f.name) || byLeaf.get(f.name) || '',
    }))

    const names = new Set(entityFields.map((f) => f.name))
    if (options && options.preferEnabled !== undefined) {
      if (options.preferEnabled?.length) {
        return {
          fieldMappings,
          insertEnabled: options.preferEnabled.filter((n) => names.has(n)),
        }
      }
      return {
        fieldMappings,
        insertEnabled: fieldMappings
          .filter((m) => m.column.trim())
          .map((m) => m.field),
      }
    }

    const kept = enabled.filter((n) => names.has(n))
    return {
      fieldMappings,
      insertEnabled: kept.length
        ? kept
        : fieldMappings.filter((m) => m.column.trim()).map((m) => m.field),
    }
  }

  function applyMapKeyColumn(
    d: DataMethodConfig,
    output: ProcessorTypeExpr,
    column: string,
  ): { draft: DataMethodConfig; output: ProcessorTypeExpr } {
    const names = resolveOutputFields(output, typeLibrary)
    const list: DataMethodFieldMapping[] = names.map((f) => {
      const existing = d.fieldMappings.find((m) => m.field === f.name)
      return {
        field: f.name,
        column: f.name === MAP_KEY_FIELD ? column : (existing?.column ?? ''),
      }
    })
    let queryFields = d.queryFields
    if (column && !queryFields.includes(column)) {
      queryFields = [...queryFields, column]
    }
    let nextOutput = output
    if (column) {
      const ui = tableColumnValueUi(column)
      nextOutput = {
        ...output,
        type: 'map',
        keyType: ui === 'number' ? 'number' : 'string',
      }
    }
    return {
      draft: { ...d, fieldMappings: list, queryFields },
      output: nextOutput,
    }
  }

  function ensureMapKeyOn(
    d: DataMethodConfig,
    output: ProcessorTypeExpr,
    keyOptions: OutputFieldOption[],
  ): { draft: DataMethodConfig; output: ProcessorTypeExpr } | null {
    if (d.operation !== 'query' || output.type !== 'map') return null
    const cur =
      d.fieldMappings.find((m) => m.field === MAP_KEY_FIELD)?.column?.trim() ??
      ''
    if (cur) return null
    const first = keyOptions[0]
    if (!first?.name) return null
    return applyMapKeyColumn(d, output, first.name)
  }

  useEffect(() => {
    if (!open || !method) return
    setDraftName(method.name)
    const params = method.params.map((p) => ({
      ...p,
      typeExpr: {
        ...p.typeExpr,
        genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
      },
    }))
    setDraftParams(params)
    let output: ProcessorTypeExpr = {
      ...method.output,
      genericArgs: { ...(method.output.genericArgs ?? {}) },
    }
    const cfg = method.dataConfig
    let next: DataMethodConfig = {
      ...createEmptyDataMethodConfig(),
      ...cfg,
      queryFields: [...(cfg?.queryFields ?? [])],
      fieldMappings: (cfg?.fieldMappings ?? []).map((m) => ({ ...m })),
      conditionGroups: (cfg?.conditionGroups ?? []).map((g) => ({
        ...g,
        conditions: (g.conditions ?? []).map((c) => ({ ...c })),
      })),
      httpRequest: createEmptyDataMethodHttpRequestConfig(cfg?.httpRequest),
    }
    if (next.source === 'http') {
      output = createHttpResponseOutput(output)
    }
    next = syncQueryFieldsForOutput(output, next)
    if (next.operation === 'query' && output.type === 'map') {
      const unique = uniqueOrPrimaryFieldNames
      const preferred = tableFields.filter((f) => unique.has(f.name))
      const selected = new Set(next.queryFields)
      const fromQuery = tableFields.filter((f) => selected.has(f.name))
      const keyOpts = preferred.length
        ? preferred
        : fromQuery.length
          ? fromQuery
          : tableFields
      const allowed = new Set(keyOpts.map((f) => f.name))
      const cur =
        next.fieldMappings.find((m) => m.field === MAP_KEY_FIELD)?.column ?? ''
      if (cur && !allowed.has(cur)) {
        const applied = applyMapKeyColumn(next, output, '')
        next = applied.draft
        output = applied.output
      }
      const ensured = ensureMapKeyOn(next, output, keyOpts)
      if (ensured) {
        next = ensured.draft
        output = ensured.output
      }
    }
    if (next.operation === 'batchInsert') {
      const arrayOpts: SourceOption[] = []
      for (const p of params) {
        const name = p.name.trim()
        if (!name || p.typeExpr.type !== 'array') continue
        arrayOpts.push({ value: name, label: name })
      }
      const stillValid = arrayOpts.some((o) => o.value === next.batchSourceParam)
      if (!stillValid) {
        next = { ...next, batchSourceParam: arrayOpts[0]?.value ?? '' }
      }
    }
    let nextInsertEnabled: string[] = []
    if (next.operation === 'insert' || next.operation === 'batchInsert') {
      const savedEnabled = (method.dataConfig?.fieldMappings ?? [])
        .filter((m) => m.field.trim() && m.column.trim())
        .map((m) => m.field.trim())
      const computed = computeInsertMappings(next, params, [], {
        preferEnabled: savedEnabled.length ? savedEnabled : null,
      })
      next = { ...next, fieldMappings: computed.fieldMappings }
      nextInsertEnabled = computed.insertEnabled
    }
    setDraft(next)
    setDraftOutput(output)
    setInsertEnabled(nextInsertEnabled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, method])

  useEffect(() => {
    if (!open) return
    const ensured = ensureMapKeyOn(
      draftRef.current,
      outputRef.current,
      mapKeyFieldOptions,
    )
    if (!ensured) return
    setDraft(ensured.draft)
    setDraftOutput(ensured.output)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mapKeyFieldOptions])

  function onHttpRequestUpdate(value: NetworkRequestConfig) {
    setDraft((prev) => ({
      ...prev,
      httpRequest: createEmptyDataMethodHttpRequestConfig({
        ...prev.httpRequest,
        ...value,
        parseCode: prev.httpRequest?.parseCode ?? '',
        responseBodyType: prev.httpRequest?.responseBodyType ?? 'json',
      }),
    }))
  }

  function stopParseEditorKeys(e: React.KeyboardEvent) {
    e.stopPropagation()
  }

  function onBatchSourceChange(value: string | undefined) {
    const batchSourceParam = typeof value === 'string' ? value : ''
    const prevEnabled = [...insertEnabled]
    setDraft((prev) => {
      const next = { ...prev, batchSourceParam }
      const computed = computeInsertMappings(next, draftParams, insertEnabled)
      queueMicrotask(() => {
        const names = new Set(entityFields.map((f) => f.name))
        const kept = prevEnabled.filter((n) => names.has(n))
        setInsertEnabled(kept.length ? kept : computed.insertEnabled)
      })
      return { ...next, fieldMappings: computed.fieldMappings }
    })
  }

  function onPageParamChange(value: string | undefined) {
    setDraft((prev) => ({
      ...prev,
      pageParam: typeof value === 'string' ? value : '',
    }))
  }

  function updateInsertSource(field: string, source: string) {
    setDraft((prev) => ({
      ...prev,
      fieldMappings: entityFields.map((f) => {
        const existing = prev.fieldMappings.find((m) => m.field === f.name)
        return {
          field: f.name,
          column: f.name === field ? source : (existing?.column ?? ''),
        }
      }),
    }))
  }

  function toggleInsertField(field: string, checked: boolean) {
    setInsertEnabled((prev) => {
      if (checked) {
        return prev.includes(field) ? prev : [...prev, field]
      }
      return prev.filter((n) => n !== field)
    })
  }

  function handleOutputChange(payload: TypeSelectPayload) {
    const nextOutput = payloadToTypeExpr(payload, outputRef.current)
    setDraftOutput(nextOutput)
    setDraft((prev) => syncQueryFieldsForOutput(nextOutput, prev))
    const named = leafNamedRef(nextOutput)
    if (genericNamesOf(named).length) openOutputGenerics(nextOutput)
  }

  function handleMapKeyTypeChange(value: MapKeyType | undefined) {
    const keyType: MapKeyType = value === 'number' ? 'number' : 'string'
    setDraftOutput((prev) => ({ ...prev, type: 'map', keyType }))
  }

  function onMapKeyFieldChange(value: string | undefined) {
    const column = String(value ?? '')
    const applied = applyMapKeyColumn(
      draftRef.current,
      outputRef.current,
      column,
    )
    setDraft(applied.draft)
    setDraftOutput(applied.output)
  }

  function handleMapValueTypeChange(payload: TypeSelectPayload) {
    const prev = outputRef.current
    const keyType: MapKeyType = prev.keyType === 'number' ? 'number' : 'string'
    let next: ProcessorTypeExpr
    if (payload.cleared) {
      next = {
        ...prev,
        type: 'map',
        keyType,
        itemType: 'string',
        itemTypeRef: '',
        itemItemType: '',
        itemItemTypeRef: '',
        genericArgs: {},
      }
    } else if (payload.type === 'array') {
      next = {
        ...prev,
        type: 'map',
        keyType,
        itemType: 'array',
        itemTypeRef: '',
        itemItemType:
          payload.itemType === 'generic' ? 'any' : (payload.itemType ?? 'string'),
        itemItemTypeRef: payload.itemTypeRef ?? '',
        genericArgs: {},
      }
    } else {
      const fieldType =
        payload.type === 'generic' ? 'any' : (payload.type as DataFieldType)
      next = {
        ...prev,
        type: 'map',
        keyType,
        itemType: fieldType,
        itemTypeRef: payload.typeRef ?? '',
        itemItemType: '',
        itemItemTypeRef: '',
        genericArgs: {},
      }
    }
    setDraftOutput(next)
    setDraft((d) => syncQueryFieldsForOutput(next, d))
    const named = leafNamedRef(next)
    if (genericNamesOf(named).length) openOutputGenerics(next)
  }

  function openOutputGenerics(expr?: ProcessorTypeExpr) {
    const output = expr ?? outputRef.current
    const named = leafNamedRef(output)
    const names = genericNamesOf(named)
    if (!names.length) return
    setGenericNames(names)
    setGenericTypeName(typeDefById(named)?.name ?? '')
    setGenericArgs({ ...(output.genericArgs ?? {}) })
    setGenericVisible(true)
  }

  function saveGenerics(args: Record<string, string>) {
    const next = { ...outputRef.current, genericArgs: args }
    setDraftOutput(next)
    setDraft((d) => syncQueryFieldsForOutput(next, d))
  }

  function saveParams(params: ProcessorMethodParam[]) {
    setDraftParams(params)
    const d = draftRef.current
    if (d.operation === 'batchInsert') {
      const opts: SourceOption[] = []
      for (const p of params) {
        const name = p.name.trim()
        if (!name || p.typeExpr.type !== 'array') continue
        opts.push({ value: name, label: name })
      }
      let next = d
      if (!opts.some((o) => o.value === d.batchSourceParam)) {
        next = { ...d, batchSourceParam: opts[0]?.value ?? '' }
      }
      const computed = computeInsertMappings(
        next,
        params,
        insertEnabledRef.current,
      )
      setDraft({ ...next, fieldMappings: computed.fieldMappings })
      setInsertEnabled(computed.insertEnabled)
    } else if (d.operation === 'insert') {
      const computed = computeInsertMappings(
        d,
        params,
        insertEnabledRef.current,
      )
      setDraft({ ...d, fieldMappings: computed.fieldMappings })
      setInsertEnabled(computed.insertEnabled)
    }
  }

  function onSourceChange(value: string | number) {
    if (
      value === 'mysql' ||
      value === 'http' ||
      value === 'redis' ||
      value === 'stream'
    ) {
      const source = value as DataMethodSourceKind
      setDraft((prev) => {
        const next = { ...prev, source }
        if (source === 'http') {
          return {
            ...next,
            httpRequest:
              prev.httpRequest ?? createEmptyDataMethodHttpRequestConfig(),
          }
        }
        return next
      })
      if (source === 'http') {
        setDraftOutput((prev) => createHttpResponseOutput(prev))
      }
    }
  }

  function onOperationChange(value: string | number) {
    if (
      value !== 'query' &&
      value !== 'insert' &&
      value !== 'batchInsert' &&
      value !== 'delete' &&
      value !== 'update' &&
      value !== 'custom'
    ) {
      return
    }
    const op = value as DataMethodOperation
    const prevOp = draftRef.current.operation
    if (op === prevOp) return
    setDraft((prev) => {
      let next = { ...prev, operation: op }
      const names = resolveOutputFields(
        outputRef.current,
        typeLibrary,
      ).map((f) => f.name)
      if (op === 'query' && !next.queryFields.length) {
        next = { ...next, queryFields: [...names] }
      }
      if (op === 'custom' && names.length && !next.fieldMappings.length) {
        next = {
          ...next,
          fieldMappings: names.map((name) => ({ field: name, column: '' })),
        }
      }
      if (op === 'batchInsert') {
        const opts: SourceOption[] = []
        for (const p of paramsRef.current) {
          const pname = p.name.trim()
          if (!pname || p.typeExpr.type !== 'array') continue
          opts.push({ value: pname, label: pname })
        }
        if (!opts.some((o) => o.value === next.batchSourceParam)) {
          next = { ...next, batchSourceParam: opts[0]?.value ?? '' }
        }
      }
      if (
        (op === 'insert' || op === 'batchInsert') &&
        entityFields.length
      ) {
        const computed = computeInsertMappings(next, paramsRef.current, [], {
          preferEnabled: null,
        })
        next = { ...next, fieldMappings: computed.fieldMappings }
        queueMicrotask(() => setInsertEnabled(computed.insertEnabled))
      }
      if (op === 'query') {
        const ensured = ensureMapKeyOn(
          next,
          outputRef.current,
          mapKeyFieldOptions,
        )
        if (ensured) {
          queueMicrotask(() => setDraftOutput(ensured.output))
          return ensured.draft
        }
      }
      return next
    })
  }

  function selectAllFields() {
    setDraft((prev) => ({
      ...prev,
      queryFields: queryFieldPool.map((f) => f.name),
    }))
  }

  function clearFields() {
    setDraft((prev) => ({ ...prev, queryFields: [] }))
  }

  function toggleField(name: string) {
    setDraft((prev) => {
      const queryFields = prev.queryFields.includes(name)
        ? prev.queryFields.filter((n) => n !== name)
        : [...prev.queryFields, name]
      const next = { ...prev, queryFields }
      const output = outputRef.current
      const keyCol =
        next.fieldMappings.find((m) => m.field === MAP_KEY_FIELD)?.column ?? ''
      if (
        next.operation === 'query' &&
        output.type === 'map' &&
        !keyCol &&
        uniqueOrPrimaryFieldNames.has(name) &&
        queryFields.includes(name)
      ) {
        const applied = applyMapKeyColumn(next, output, name)
        queueMicrotask(() => setDraftOutput(applied.output))
        return applied.draft
      }
      return next
    })
  }

  function isFieldSelected(name: string) {
    return draft.queryFields.includes(name)
  }

  function updateMappingColumn(field: string, column: string) {
    setDraft((prev) => {
      const names = resolveOutputFields(outputRef.current, typeLibrary)
      return {
        ...prev,
        fieldMappings: names.map((f) => {
          const existing = prev.fieldMappings.find((m) => m.field === f.name)
          return {
            field: f.name,
            column: f.name === field ? column : (existing?.column ?? ''),
          }
        }),
      }
    })
  }

  function handleSave() {
    let source = draftRef.current.source
    if (
      source !== 'mysql' &&
      source !== 'http' &&
      source !== 'redis' &&
      source !== 'stream'
    ) {
      source = 'mysql'
    }
    const d = { ...draftRef.current, source }
    const name = draftName.trim()
    if (!name) {
      ElMessage.warning('请填写方法名')
      return
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      ElMessage.warning('方法名须为合法标识符')
      return
    }
    const reserved = reservedNames ?? []
    if (reserved.some((n) => n.toLowerCase() === name.toLowerCase())) {
      ElMessage.warning(`方法名「${name}」不可用（与预置方法或其它方法冲突）`)
      return
    }

    if (d.source === 'http') {
      const http = createEmptyDataMethodHttpRequestConfig(d.httpRequest)
      if (!http.apiUrl.trim()) {
        ElMessage.warning('请填写外部接口地址')
        return
      }
      const headerErr = validateNetworkParamRows(http.headers, '请求头')
      if (headerErr) {
        ElMessage.warning(headerErr)
        return
      }
      const queryErr = validateNetworkParamRows(http.queryParams, 'Query')
      if (queryErr) {
        ElMessage.warning(queryErr)
        return
      }
      const formErr = validateNetworkParamRows(http.formParams, '表单参数')
      if (formErr) {
        ElMessage.warning(formErr)
        return
      }
      onSave?.({
        name,
        params: paramsRef.current,
        output: createHttpResponseOutput(outputRef.current),
        dataConfig: {
          ...createEmptyDataMethodConfig(),
          source: 'http',
          operation: 'custom',
          httpRequest: http,
        },
      })
      onOpenChange?.(false)
      return
    }

    const names = new Set(
      resolveOutputFields(outputRef.current, typeLibrary).map((f) => f.name),
    )
    const tableNames = tableFieldNames
    const entityNames = new Set(entityFields.map((f) => f.name))
    const mapQuery = d.operation === 'query' && outputRef.current.type === 'map'
    const mapMappings = mapQuery
      ? d.fieldMappings
          .filter((m) => names.has(m.field) && m.column.trim())
          .map((m) => ({
            field: m.field,
            column: m.column.trim(),
          }))
      : []
    if (mapQuery) {
      const keyBound = mapMappings.some((m) => m.field === MAP_KEY_FIELD)
      if (!keyBound) {
        ElMessage.warning(
          outputRef.current.itemType === 'array'
            ? '请绑定映射键（索引字段）'
            : '请绑定映射键（唯一字段）',
        )
        return
      }
      if (mapMappings.length < 2) {
        ElMessage.warning('请绑定映射值字段')
        return
      }
    }
    const showCond = d.operation !== 'insert' && d.operation !== 'batchInsert' && d.operation !== 'custom'
    const config: DataMethodConfig = {
      source: d.source,
      operation: d.operation,
      queryFields:
        d.operation === 'query'
          ? mapQuery
            ? [
                ...new Set([
                  ...d.queryFields.filter((n) => tableNames.has(n)),
                  ...mapMappings.map((m) => m.column),
                ]),
              ]
            : d.queryFields.filter((n) => tableNames.has(n))
          : [],
      sql: d.operation === 'custom' ? d.sql : '',
      fieldMappings: mapQuery
        ? mapMappings
        : d.operation === 'custom'
          ? d.fieldMappings
              .filter((m) => names.has(m.field))
              .map((m) => ({
                field: m.field,
                column: m.column.trim(),
              }))
          : d.operation === 'insert' || d.operation === 'batchInsert'
            ? d.fieldMappings
                .filter(
                  (m) =>
                    entityNames.has(m.field) &&
                    m.column.trim() &&
                    insertEnabledRef.current.includes(m.field),
                )
                .map((m) => ({
                  field: m.field,
                  column: m.column.trim(),
                }))
            : [],
      batchSourceParam:
        d.operation === 'batchInsert' ? d.batchSourceParam.trim() : '',
      pageParam:
        d.operation === 'query' || d.operation === 'custom'
          ? d.pageParam.trim()
          : '',
      conditionGroups: showCond
        ? serializeConditionGroupsUtil(d.conditionGroups)
        : [],
      httpRequest: createEmptyDataMethodHttpRequestConfig(),
    }
    onSave?.({
      name,
      params: paramsRef.current,
      output: outputRef.current,
      dataConfig: config,
    })
    onOpenChange?.(false)
  }

  const outputHasGenerics = genericNamesOf(leafNamedRef(draftOutput)).length > 0

  return (
    <>
      <Modal
        open={open}
        title={methodTitle}
        width={820}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        className="data-method-dialog"
        onCancel={() => onOpenChange?.(false)}
        footer={
          <Button
            type="primary"
            disabled={!(isMysql || isHttp) || !draftName.trim()}
            onClick={handleSave}
          >
            {DM.ok}
          </Button>
        }
      >
        <div className="dlg-body">
          <section className="dlg-section">
            <div className="section-label">{DM.name}</div>
            <div className="section-control">
              <Input
                value={draftName}
                placeholder={DM.namePh}
                maxLength={64}
                onChange={(e) => setDraftName(e.target.value)}
              />
            </div>
          </section>

          <section className="dlg-section">
            <div className="section-label">{DM.params}</div>
            <div className="section-control">
              <button
                type="button"
                className="params-trigger"
                onClick={() => setParamsDialogVisible(true)}
              >
                {paramsSummary(draftParams)}
              </button>
            </div>
          </section>

          <section className="dlg-section">
            <div className="section-label">{DM.output}</div>
            <div className="section-control">
              {isHttp ? (
                <div className="output-row">
                  <span className="http-output-fixed" title={httpOutputLabel}>
                    {httpOutputLabel}
                  </span>
                  <Button type="link" size="small" onClick={() => openOutputGenerics()}>
                    {DM.generics}
                  </Button>
                </div>
              ) : (
                <div
                  className={`output-row${isMapOutput && isQuery ? ' output-row--map' : ''}`}
                >
                  <DataFieldTypeTreeSelect
                    className={`output-select${isMapOutput && isQuery ? ' output-select--map' : ''}`}
                    type={(draftOutput.type || 'string') as DataFieldType}
                    typeRef={draftOutput.typeRef}
                    itemType={
                      (draftOutput.itemType || undefined) as
                        | DataFieldType
                        | undefined
                    }
                    itemTypeRef={draftOutput.itemTypeRef}
                    itemItemType={
                      (draftOutput.itemItemType || undefined) as
                        | DataFieldType
                        | undefined
                    }
                    itemItemTypeRef={draftOutput.itemItemTypeRef}
                    keyType={
                      draftOutput.keyType === 'number' ||
                      draftOutput.keyType === 'string'
                        ? draftOutput.keyType
                        : undefined
                    }
                    library={typeLibrary}
                    excludeTypes={PROCESSOR_EXCLUDE_TYPES}
                    allowRef={false}
                    mapLeaf
                    clearable
                    size="small"
                    placeholder={DM.outputPh}
                    onChange={handleOutputChange}
                  />
                  {isMapOutput && isQuery ? (
                    <>
                      <span className="map-inline-label">{DM.mapKeyShort}</span>
                      <Select
                        value={mapKeyType}
                        size="small"
                        className="map-inline-select map-inline-select--type"
                        placeholder={DM.mapKeyType}
                        options={MAP_KEY_TYPE_OPTIONS.map((opt) => ({
                          value: opt.value,
                          label: opt.label,
                        }))}
                        onChange={handleMapKeyTypeChange}
                      />
                      <span className="map-inline-label">
                        {DM.mapValueShort}
                      </span>
                      <DataFieldTypeTreeSelect
                        className="map-inline-select"
                        type={mapValueSelectType}
                        typeRef={mapValueSelectTypeRef}
                        itemType={mapValueSelectItemType}
                        itemTypeRef={mapValueSelectItemTypeRef}
                        library={typeLibrary}
                        excludeTypes={MAP_VALUE_EXCLUDE_TYPES}
                        allowRef={false}
                        clearable
                        size="small"
                        placeholder={DM.mapValueType}
                        onChange={handleMapValueTypeChange}
                      />
                    </>
                  ) : null}
                  {outputHasGenerics ? (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => openOutputGenerics()}
                    >
                      {DM.generics}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          <section className="dlg-section">
            <div className="section-label">{DM.source}</div>
            <div className="section-control">
              <Radio.Group
                value={draft.source}
                className="chip-group"
                optionType="button"
                options={enabledSourceOptions.map((opt) => ({
                  value: opt.value,
                  label: opt.label,
                }))}
                onChange={(e) => onSourceChange(e.target.value)}
              />
            </div>
          </section>

          {isHttp ? (
            <>
              <Form
                labelAlign="right"
                labelCol={{ style: { width: 96 } }}
                className="http-request-form"
              >
                <NetworkRequestFields
                  value={
                    draft.httpRequest ?? createEmptyDataMethodHttpRequestConfig()
                  }
                  ambientVars={httpAmbientVars}
                  onChange={onHttpRequestUpdate}
                />
                <Form.Item label="数据解析" className="http-parse-item">
                  <div className="http-parse-block">
                    <p className="http-parse-hint">
                      <code>
                        function parse(response: HttpResponse&lt;any&gt;):
                        HttpResponse&lt;{httpBodyTypeIdent}&gt;
                      </code>
                      ；签名不可编辑。留空则按泛型 T 列出全部字段（缺失为
                      null）。
                    </p>
                    <div
                      className="http-parse-editor nokey"
                      onKeyDown={stopParseEditorKeys}
                      onKeyUp={stopParseEditorKeys}
                    >
                      <TsCodeEditor
                        value={draft.httpRequest?.parseCode ?? ''}
                        onChange={(code) =>
                          setDraft((prev) => ({
                            ...prev,
                            httpRequest: createEmptyDataMethodHttpRequestConfig({
                              ...prev.httpRequest,
                              parseCode: code,
                            }),
                          }))
                        }
                        functionName="parse"
                        params={httpParseParams}
                        returnTypeTs={httpParseReturnTs}
                        ambientExtra={HTTP_PARSE_AMBIENT_EXTRA}
                      />
                    </div>
                  </div>
                </Form.Item>
              </Form>
              <p className="http-request-hint">
                请求参数可绑定上方「入参」；出参固定为 HttpResponse&lt;T&gt;。最终
                body 按泛型 T 列出字段，缺失为 null。
              </p>
            </>
          ) : (
            <>
              <section className="dlg-section">
                <div className="section-label">{DM.operation}</div>
                <div className="section-control">
                  <Radio.Group
                    value={draft.operation}
                    size="small"
                    className="chip-group"
                    optionType="button"
                    options={DATA_METHOD_OPERATION_OPTIONS.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    }))}
                    onChange={(e) => onOperationChange(e.target.value)}
                  />
                </div>
              </section>

              {isQuery ? (
                <section className="dlg-section dlg-section--block">
                  <div className="section-label">{DM.queryFields}</div>
                  <div className="section-control">
                    <div className="field-panel">
                      <div className="field-panel-head">
                        <span className="source-hint">
                          {queryFieldsSourceHint}
                        </span>
                        {queryFieldPool.length ? (
                          <div className="field-panel-actions">
                            <span className="count">
                              {selectedCount} / {queryFieldPool.length}
                            </span>
                            <button
                              type="button"
                              className="text-btn"
                              onClick={() =>
                                allSelected ? clearFields() : selectAllFields()
                              }
                            >
                              {allSelected ? DM.clear : DM.selectAll}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {!queryFieldPool.length ? (
                        <div className="empty-box empty-box--inset">
                          {entityTableName?.trim()
                            ? DM.mapNoTableColumns
                            : DM.noEntity}
                        </div>
                      ) : (
                        <ul className="field-list">
                          {queryFieldPool.map((f) => (
                            <li
                              key={f.name}
                              className={`field-row${isFieldSelected(f.name) ? ' selected' : ''}`}
                              onClick={() => toggleField(f.name)}
                            >
                              <Checkbox
                                checked={isFieldSelected(f.name)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={() => toggleField(f.name)}
                              />
                              <div className="field-meta">
                                <code className="field-code">{f.name}</code>
                                {displayRemark(f.name, f.remark) ? (
                                  <span className="field-desc">
                                    {displayRemark(f.name, f.remark)}
                                  </span>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {isQuery && isMapOutput ? (
                <section className="dlg-section dlg-section--block">
                  <div className="section-label">{DM.fieldMapping}</div>
                  <div className="section-control">
                    <p className="page-param-hint map-hint">
                      {DM.mapMappingHint}
                    </p>

                    <div className="map-bind-row">
                      <span className="map-bind-label">{DM.mapKeyField}</span>
                      <Select
                        value={mapKeyColumn || undefined}
                        allowClear
                        showSearch
                        size="small"
                        className="map-bind-select"
                        placeholder={DM.mapKeyFieldPh}
                        disabled={!mapKeyFieldOptions.length}
                        options={mapKeyFieldOptions.map((ef) => ({
                          value: ef.name,
                          label: ef.remark
                            ? `${ef.name}${DM.mid}${ef.remark}`
                            : ef.name,
                        }))}
                        onChange={onMapKeyFieldChange}
                      />
                    </div>
                    {!hasUniqueOrPrimaryKeys ? (
                      <p className="page-param-hint map-hint">
                        {DM.mapNoUniqueKey}
                      </p>
                    ) : null}

                    <div className="map-bind-block">
                      <span className="map-bind-label">
                        {DM.mapValueMapping}
                      </span>
                      {!selectedQueryFieldOptions.length ||
                      !mapValueMappingRows.length ? (
                        <div className="empty-box empty-box--inset">
                          {DM.mapNeedQueryFields}
                        </div>
                      ) : (
                        <div className="mapping-panel mapping-panel--inset">
                          {mapValueMappingRows.map((row) => (
                            <div key={row.field} className="mapping-row">
                              <div className="mapping-field">
                                <code className="field-code">
                                  {mapValueIsInterface ? row.field : DM.mapValue}
                                </code>
                                {mapValueIsInterface &&
                                displayRemark(row.field, row.remark) ? (
                                  <span className="field-desc">
                                    {displayRemark(row.field, row.remark)}
                                  </span>
                                ) : null}
                              </div>
                              <span className="mapping-arrow">{DM.arrow}</span>
                              <Select
                                value={row.column || undefined}
                                allowClear
                                showSearch
                                size="small"
                                className="mapping-input"
                                placeholder={DM.mapValueFieldPh}
                                options={selectedQueryFieldOptions.map((ef) => ({
                                  value: ef.name,
                                  label: ef.remark
                                    ? `${ef.name}${DM.mid}${ef.remark}`
                                    : ef.name,
                                }))}
                                onChange={(v) =>
                                  updateMappingColumn(row.field, String(v ?? ''))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {isQuery ? (
                <section className="dlg-section">
                  <div className="section-label">{DM.pageParam}</div>
                  <div className="section-control">
                    <Select
                      value={draft.pageParam || undefined}
                      allowClear
                      showSearch
                      placeholder={DM.pageParamPh}
                      className="page-param-select"
                      options={pageParamOptions}
                      onChange={onPageParamChange}
                    />
                    <p className="page-param-hint">{DM.pageParamHint}</p>
                  </div>
                </section>
              ) : null}

              {showConditions ? (
                <section className="dlg-section dlg-section--block">
                  <div className="section-label">{DM.conditions}</div>
                  <div className="section-control">
                    <DataMethodConditionsEditor
                      value={draft.conditionGroups}
                      onChange={(conditionGroups) =>
                        setDraft((prev) => ({ ...prev, conditionGroups }))
                      }
                      fieldOptions={conditionFieldOptions}
                      ambientVars={conditionAmbientVars}
                      typeLibrary={typeLibrary}
                      ambientHint={conditionAmbientVars
                        .map((v) => v.name)
                        .filter(Boolean)
                        .join(', ')}
                    />
                  </div>
                </section>
              ) : null}

              {isInsert ? (
                <>
                  {isBatchInsert ? (
                    <section className="dlg-section">
                      <div className="section-label">{DM.batchSource}</div>
                      <div className="section-control">
                        <Select
                          value={draft.batchSourceParam || undefined}
                          allowClear
                          showSearch
                          placeholder={DM.batchSourcePh}
                          className="batch-source-select"
                          options={arrayParamOptions}
                          onChange={onBatchSourceChange}
                        />
                      </div>
                    </section>
                  ) : null}

                  <section className="dlg-section dlg-section--block">
                    <div className="section-label">{DM.fieldMapping}</div>
                    <div className="section-control">
                      {entityFields[0]?.sourceLabel ? (
                        <div className="section-actions">
                          <span className="count">
                            {DM.target}
                            {DM.mid}
                            {entityFields[0].sourceLabel}
                          </span>
                        </div>
                      ) : null}
                      {!entityFields.length ? (
                        <div className="empty-box">{DM.noEntity}</div>
                      ) : isBatchInsert && !arrayParamOptions.length ? (
                        <div className="empty-box">{DM.needArrayParam}</div>
                      ) : isBatchInsert && !draft.batchSourceParam ? (
                        <div className="empty-box">{DM.pickBatchSource}</div>
                      ) : !insertSourceOptions.length ? (
                        <div className="empty-box">
                          {isBatchInsert ? DM.noBatchFields : DM.needObjectParam}
                        </div>
                      ) : (
                        <div className="mapping-panel insert-mapping">
                          <div className="mapping-head">
                            <span />
                            <span>{DM.targetField}</span>
                            <span />
                            <span>{DM.sourceField}</span>
                          </div>
                          {insertMappingRows.map((row) => (
                            <div
                              key={row.field}
                              className={`mapping-row${row.checked ? '' : ' dimmed'}`}
                            >
                              <Checkbox
                                checked={row.checked}
                                onChange={(e) =>
                                  toggleInsertField(row.field, e.target.checked)
                                }
                              />
                              <div className="mapping-field">
                                <code className="field-code">{row.field}</code>
                                {displayRemark(row.field, row.remark) ? (
                                  <span className="field-desc">
                                    {displayRemark(row.field, row.remark)}
                                  </span>
                                ) : null}
                              </div>
                              <span className="mapping-arrow">{DM.arrow}</span>
                              <Select
                                value={row.source || undefined}
                                allowClear
                                showSearch
                                size="small"
                                placeholder={DM.pickSourceField}
                                className="mapping-input"
                                disabled={!row.checked}
                                options={insertSourceOptions}
                                onChange={(v) =>
                                  updateInsertSource(row.field, String(v ?? ''))
                                }
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </section>
                </>
              ) : null}

              {isCustom ? (
                <>
                  <section className="dlg-section dlg-section--block">
                    <div className="section-label">{DM.sql}</div>
                    <div className="section-control">
                      <SqlCodeEditor
                        value={draft.sql}
                        onChange={(sql) =>
                          setDraft((prev) => ({ ...prev, sql }))
                        }
                        height={160}
                        placeholder={DM.sqlPh}
                        paramNames={draftParams
                          .map((p) => p.name)
                          .filter(Boolean)}
                      />
                    </div>
                  </section>
                  <section className="dlg-section">
                    <div className="section-label">{DM.pageParam}</div>
                    <div className="section-control">
                      <Select
                        value={draft.pageParam || undefined}
                        allowClear
                        showSearch
                        placeholder={DM.pageParamPh}
                        className="page-param-select"
                        options={pageParamOptions}
                        onChange={onPageParamChange}
                      />
                      <p className="page-param-hint">{DM.pageParamHint}</p>
                    </div>
                  </section>
                  <section className="dlg-section dlg-section--block">
                    <div className="section-label">{DM.fieldMapping}</div>
                    <div className="section-control">
                      <div className="field-panel">
                        <div className="field-panel-head">
                          <div className="field-panel-type">
                            <DataFieldTypeTreeSelect
                              className="output-select-mini"
                              type={
                                (draftOutput.type || 'string') as DataFieldType
                              }
                              typeRef={draftOutput.typeRef}
                              itemType={
                                (draftOutput.itemType || undefined) as
                                  | DataFieldType
                                  | undefined
                              }
                              itemTypeRef={draftOutput.itemTypeRef}
                              itemItemType={
                                (draftOutput.itemItemType || undefined) as
                                  | DataFieldType
                                  | undefined
                              }
                              itemItemTypeRef={draftOutput.itemItemTypeRef}
                              keyType={
                                draftOutput.keyType === 'number' ||
                                draftOutput.keyType === 'string'
                                  ? draftOutput.keyType
                                  : undefined
                              }
                              library={typeLibrary}
                              excludeTypes={PROCESSOR_EXCLUDE_TYPES}
                              allowRef={false}
                              clearable
                              size="small"
                              placeholder={DM.outputPh}
                              onChange={handleOutputChange}
                            />
                            {outputHasGenerics ? (
                              <Button
                                type="link"
                                size="small"
                                onClick={() => openOutputGenerics()}
                              >
                                {DM.generics}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {!outputFields.length ? (
                          <div className="empty-box empty-box--inset">
                            {DM.mappingEmpty}
                          </div>
                        ) : (
                          <div className="mapping-panel mapping-panel--inset">
                            {mappingRows.map((row) => (
                              <div key={row.field} className="mapping-row">
                                <div className="mapping-field">
                                  <code className="field-code">{row.field}</code>
                                  {displayRemark(row.field, row.remark) ? (
                                    <span className="field-desc">
                                      {displayRemark(row.field, row.remark)}
                                    </span>
                                  ) : null}
                                </div>
                                <span className="mapping-arrow">
                                  {DM.arrow}
                                </span>
                                <Input
                                  value={row.column}
                                  placeholder={DM.columnExpr}
                                  size="small"
                                  className="mapping-input"
                                  onChange={(e) =>
                                    updateMappingColumn(
                                      row.field,
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                </>
              ) : null}
            </>
          )}
        </div>
      </Modal>

      <MethodParamsDialog
        open={paramsDialogVisible}
        onOpenChange={setParamsDialogVisible}
        params={draftParams}
        typeOptions={typeOptions}
        typeLibrary={typeLibrary}
        methodName={draftName}
        onSave={saveParams}
      />
      <TypeGenericArgsDialog
        open={genericVisible}
        onOpenChange={setGenericVisible}
        typeName={genericTypeName}
        genericNames={genericNames}
        args={genericArgs}
        typeOptions={typeOptions}
        onSave={saveGenerics}
      />
    </>
  )
}
