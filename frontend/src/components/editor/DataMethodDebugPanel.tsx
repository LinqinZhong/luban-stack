import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
} from 'antd'
import {
  CaretRightOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import { debugDataLayerMethod } from '../../api/projects'
import type {
  ProcessorMethod,
  ProcessorMethodParam,
  ProcessorTypeExpr,
} from '../../types/backend-services'
import type {
  DataTypeDef,
  DataTypeLibrary,
  InterfaceField,
  TypeExpr,
} from '../../types/data-types'
import {
  findDataTypeDef,
  typeExprToDataFieldType,
} from '../../utils/named-type-fields'
import { arrayTypeLabel } from '../../types/page-data'
import './DataMethodDebugPanel.css'

export type DataMethodDebugTarget = {
  projectPath: string
  serviceId: string
  processorId: string
  processorName: string
  method: ProcessorMethod
}

type FieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'json' | 'array'

type ObjectFieldForm = {
  name: string
  remark: string
  kind: FieldKind
  enumOptions: string[]
}

type ParamFormModel = {
  param: ProcessorMethodParam
  mode: 'scalar' | 'object' | 'json' | 'array'
  typeLabel: string
  kind: FieldKind
  enumOptions: string[]
  fields: ObjectFieldForm[]
  itemKind?: FieldKind
  itemEnumOptions?: string[]
}

function useBag<T extends Record<string, unknown>>(initial: T) {
  const bag = useRef(initial)
  const [, bump] = useState(0)
  return {
    get current() {
      return bag.current
    },
    touch() {
      bump((n) => n + 1)
    },
    clear() {
      for (const key of Object.keys(bag.current)) delete bag.current[key]
      bump((n) => n + 1)
    },
  }
}

export default function DataMethodDebugPanel({
  target,
  typeLibrary,
  onDebugParamsChange,
}: {
  target: DataMethodDebugTarget | null
  typeLibrary: DataTypeLibrary | null
  onDebugParamsChange?: (params: Record<string, unknown>) => void
}) {
  const draft = useBag<Record<string, unknown>>({})
  const paramEnabled = useBag<Record<string, boolean>>({})
  const paramStash = useBag<Record<string, unknown>>({})
  const [running, setRunning] = useState(false)
  const [dryRun, setDryRun] = useState(true)
  const [resultSql, setResultSql] = useState('')
  const [resultRaw, setResultRaw] = useState<unknown>(null)
  const [resultOutput, setResultOutput] = useState<unknown>(null)
  const [resultError, setResultError] = useState('')
  const [resultDryRun, setResultDryRun] = useState(false)
  const foldOpen = useBag({ sql: false, raw: false, output: false })

  const FOLD_MAX_LINES = 10
  const FOLD_MAX_CHARS = 480

  function isLongText(text: string): boolean {
    if (!text) return false
    if (text.length > FOLD_MAX_CHARS) return true
    return text.split('\n').length > FOLD_MAX_LINES
  }

  function resetFoldOpen() {
    foldOpen.current.sql = false
    foldOpen.current.raw = false
    foldOpen.current.output = false
    foldOpen.touch()
  }

  function formatJson(value: unknown): string {
    try {
      return JSON.stringify(value ?? null, null, 2)
    } catch {
      return String(value)
    }
  }

  const resultRawText = formatJson(resultRaw)
  const resultOutputText = formatJson(resultOutput)
  const resultSqlText = resultSql || '—'

  const [itemDialogVisible, setItemDialogVisible] = useState(false)
  const [itemDialogTitle, setItemDialogTitle] = useState('')
  const [itemEditParam, setItemEditParam] = useState('')
  const [itemEditIndex, setItemEditIndex] = useState(-1)
  const [itemEditFields, setItemEditFields] = useState<ObjectFieldForm[]>([])
  const [itemEditIsObject, setItemEditIsObject] = useState(true)
  const [itemEditKind, setItemEditKind] = useState<FieldKind>('string')
  const [itemEditEnumOptions, setItemEditEnumOptions] = useState<string[]>([])
  const itemEditDraft = useBag<Record<string, unknown>>({})
  const [itemEditScalar, setItemEditScalar] = useState<unknown>('')

  const method = target?.method ?? null
  const methodUnavailable = Boolean(method?.disabled)
  const unavailableHint = !methodUnavailable
    ? ''
    : method?.name === 'deleteById' || method?.id === 'preset_deleteById'
      ? '请先在数据表设计中勾选逻辑删除字段，才能使用 deleteById'
      : '该方法当前不可用'

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

  function disabledParamValue(_form: ParamFormModel): unknown {
    return null
  }

  function defaultEnabledParamValue(form: ParamFormModel): unknown {
    if (form.mode === 'object') return buildObjectDefault(form.fields)
    if (form.mode === 'json') return {}
    if (form.mode === 'array' || form.kind === 'array') return []
    if (form.kind === 'number') return 0
    if (form.kind === 'boolean') return false
    if (form.kind === 'enum') return form.enumOptions[0] ?? ''
    return ''
  }

  function disabledParamHint(_form: ParamFormModel): string {
    return 'null'
  }

  function isParamEnabled(form: ParamFormModel): boolean {
    return paramEnabled.current[form.param.name.trim()] !== false
  }

  function setParamEnabled(form: ParamFormModel, enabled: boolean) {
    const name = form.param.name.trim()
    if (enabled) {
      const restored = paramStash.current[name]
      paramEnabled.current[name] = true
      draft.current[name] =
        restored !== undefined ? restored : defaultEnabledParamValue(form)
      delete paramStash.current[name]
    } else {
      if (paramEnabled.current[name] !== false) {
        paramStash.current[name] = draft.current[name]
      }
      paramEnabled.current[name] = false
      draft.current[name] = disabledParamValue(form)
    }
    draft.touch()
    paramEnabled.touch()
    persistDebugParams()
  }

  function primaryAtom(expr: TypeExpr | undefined | null) {
    return expr?.intersections[0]?.alternatives[0] ?? { kind: 'string' as const }
  }

  function fieldKindFromTypeExpr(
    expr: TypeExpr,
    library: DataTypeLibrary | null,
  ): { kind: FieldKind; enumOptions: string[]; typeRef?: string } {
    const mapped = typeExprToDataFieldType(expr, library)
    if (mapped.type === 'number') return { kind: 'number', enumOptions: [] }
    if (mapped.type === 'boolean') return { kind: 'boolean', enumOptions: [] }
    if (mapped.type === 'array') return { kind: 'array', enumOptions: [] }
    if (mapped.typeRef) {
      const def = findDataTypeDef(library, mapped.typeRef)
      if (def?.kind === 'enum') {
        return {
          kind: 'enum',
          enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
          typeRef: mapped.typeRef,
        }
      }
      if (def?.kind === 'interface') {
        return { kind: 'json', enumOptions: [], typeRef: mapped.typeRef }
      }
    }
    const atom = primaryAtom(expr)
    if (atom.kind === 'number') return { kind: 'number', enumOptions: [] }
    if (atom.kind === 'boolean') return { kind: 'boolean', enumOptions: [] }
    return { kind: 'string', enumOptions: [] }
  }

  function objectFieldsOf(def: DataTypeDef | null): ObjectFieldForm[] {
    if (!def || def.kind !== 'interface') return []
    return def.fields
      .map((f: InterfaceField) => {
        const name = f.name.trim()
        if (!name) return null
        const info = fieldKindFromTypeExpr(f.type, typeLibrary)
        return {
          name,
          remark: f.remark?.trim() || '',
          kind: info.kind,
          enumOptions: info.enumOptions,
        }
      })
      .filter((x): x is ObjectFieldForm => Boolean(x))
  }

  function namedTypeLabel(typeRef: string): string {
    if (!typeRef) return ''
    return findDataTypeDef(typeLibrary, typeRef)?.name || typeRef
  }

  function atomTypeLabel(type: string, typeRef: string): string {
    if (typeRef) return namedTypeLabel(typeRef)
    if (type === 'json') return 'object'
    if (type === 'number') return 'number'
    if (type === 'boolean') return 'boolean'
    if (type === 'string' || !type) return 'string'
    return type
  }

  function resolveParamForm(param: ProcessorMethodParam): ParamFormModel {
    const expr: ProcessorTypeExpr = param.typeExpr

    if (expr.type === 'array') {
      if (expr.itemType === 'array') {
        const leaf = atomTypeLabel(expr.itemItemType, expr.itemItemTypeRef)
        return {
          param,
          mode: 'json',
          typeLabel: arrayTypeLabel(leaf, 2),
          kind: 'array',
          enumOptions: [],
          fields: [],
        }
      }

      const ref = expr.itemTypeRef
      if (ref) {
        const def = findDataTypeDef(typeLibrary, ref)
        if (def?.kind === 'interface') {
          const fields = objectFieldsOf(def)
          if (fields.length) {
            return {
              param,
              mode: 'array',
              typeLabel: arrayTypeLabel(def.name || ref),
              kind: 'array',
              enumOptions: [],
              fields,
            }
          }
        }
        if (def?.kind === 'enum') {
          return {
            param,
            mode: 'array',
            typeLabel: arrayTypeLabel(def.name || ref),
            kind: 'array',
            enumOptions: [],
            fields: [],
            itemKind: 'enum',
            itemEnumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
          }
        }
      }

      const itemType = expr.itemType || 'string'
      const itemKind: FieldKind =
        itemType === 'number'
          ? 'number'
          : itemType === 'boolean'
            ? 'boolean'
            : itemType === 'json'
              ? 'json'
              : 'string'
      return {
        param,
        mode: 'array',
        typeLabel: arrayTypeLabel(atomTypeLabel(itemType, ref)),
        kind: 'array',
        enumOptions: [],
        fields: [],
        itemKind,
        itemEnumOptions: [],
      }
    }

    const typeLabel = (() => {
      if (expr.typeRef) return namedTypeLabel(expr.typeRef)
      if (expr.type === 'json') return 'object'
      if (expr.type === 'number') return 'number'
      if (expr.type === 'boolean') return 'boolean'
      return expr.type || 'string'
    })()

    if (expr.typeRef || expr.type === 'json') {
      const def = findDataTypeDef(typeLibrary, expr.typeRef)
      if (def?.kind === 'interface') {
        const fields = objectFieldsOf(def)
        if (fields.length) {
          return {
            param,
            mode: 'object',
            typeLabel: def.name || typeLabel,
            kind: 'json',
            enumOptions: [],
            fields,
          }
        }
      }
      if (def?.kind === 'enum') {
        return {
          param,
          mode: 'scalar',
          typeLabel: def.name || typeLabel,
          kind: 'enum',
          enumOptions: def.enumMembers.map((m) => m.name).filter(Boolean),
          fields: [],
        }
      }
      if (def?.kind === 'number') {
        return {
          param,
          mode: 'scalar',
          typeLabel,
          kind: 'number',
          enumOptions: [],
          fields: [],
        }
      }
      if (def?.kind === 'boolean') {
        return {
          param,
          mode: 'scalar',
          typeLabel,
          kind: 'boolean',
          enumOptions: [],
          fields: [],
        }
      }
    }

    const t = expr.type || 'string'
    if (t === 'number') {
      return {
        param,
        mode: 'scalar',
        typeLabel,
        kind: 'number',
        enumOptions: [],
        fields: [],
      }
    }
    if (t === 'boolean') {
      return {
        param,
        mode: 'scalar',
        typeLabel,
        kind: 'boolean',
        enumOptions: [],
        fields: [],
      }
    }
    if (t === 'json') {
      return {
        param,
        mode: 'json',
        typeLabel,
        kind: 'json',
        enumOptions: [],
        fields: [],
      }
    }
    return {
      param,
      mode: 'scalar',
      typeLabel,
      kind: 'string',
      enumOptions: [],
      fields: [],
    }
  }

  const paramForms = useMemo(
    () =>
      (method?.params ?? [])
        .filter((p) => p.name.trim())
        .map(resolveParamForm),
    [method, typeLibrary],
  )

  function coerceArrayValue(prev: unknown): unknown[] {
    if (Array.isArray(prev)) return prev
    if (prev && typeof prev === 'object') return [prev]
    if (prev !== undefined && prev !== null) return [prev]
    return []
  }

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function collectParams(): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const form of paramForms) {
      const name = form.param.name.trim()
      out[name] = draft.current[name]
    }
    return out
  }

  function persistDebugParams() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      onDebugParamsChange?.(collectParams())
    }, 400)
  }

  function syncDraftFromMethod(options?: { clearResults?: boolean }) {
    draft.clear()
    paramEnabled.clear()
    paramStash.clear()
    const saved = method?.debugParams ?? {}
    let shouldPersist = false
    for (const form of paramForms) {
      const name = form.param.name.trim()
      const prev = saved[name]
      if (Object.prototype.hasOwnProperty.call(saved, name) && prev === null) {
        draft.current[name] = disabledParamValue(form)
        paramEnabled.current[name] = false
        continue
      }
      paramEnabled.current[name] = true
      if (form.mode === 'object') {
        const base = buildObjectDefault(form.fields)
        if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
          draft.current[name] = { ...base, ...(prev as Record<string, unknown>) }
        } else {
          draft.current[name] = base
        }
      } else if (form.kind === 'number') {
        draft.current[name] =
          typeof prev === 'number' ? prev : Number(prev ?? 0) || 0
      } else if (form.kind === 'boolean') {
        draft.current[name] = prev === true || prev === 'true'
      } else if (form.mode === 'array' || form.kind === 'array') {
        const next = coerceArrayValue(prev)
        draft.current[name] = next
        if (prev !== undefined && !Array.isArray(prev)) shouldPersist = true
        if (prev === undefined) shouldPersist = true
      } else if (form.mode === 'json') {
        draft.current[name] = prev !== undefined && prev !== null ? prev : {}
      } else {
        draft.current[name] = prev !== undefined && prev !== null ? String(prev) : ''
      }
    }
    draft.touch()
    paramEnabled.touch()
    if (shouldPersist) persistDebugParams()
    if (options?.clearResults !== false) {
      setResultSql('')
      setResultRaw(null)
      setResultOutput(null)
      setResultError('')
      setResultDryRun(false)
      resetFoldOpen()
    }
  }

  function methodSyncKey(t: DataMethodDebugTarget | null): string {
    if (!t) return ''
    const paramsKey = t.method.params
      .map((p) => {
        const e = p.typeExpr
        return [
          p.id,
          p.name,
          e?.type,
          e?.typeRef,
          e?.itemType,
          e?.itemTypeRef,
          e?.itemItemType,
          e?.itemItemTypeRef,
        ].join(':')
      })
      .join('|')
    return `${t.processorId}::${t.method.id}::${paramsKey}`
  }

  const syncKey = methodSyncKey(target)
  const prevSyncKey = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!target || !syncKey) return
    if (syncKey === prevSyncKey.current) return
    prevSyncKey.current = syncKey
    syncDraftFromMethod({ clearResults: true })
  }, [syncKey, target])

  function setScalar(name: string, value: unknown) {
    draft.current[name] = value
    draft.touch()
    persistDebugParams()
  }

  function setObjectField(paramName: string, fieldName: string, value: unknown) {
    const cur =
      draft.current[paramName] &&
      typeof draft.current[paramName] === 'object' &&
      !Array.isArray(draft.current[paramName])
        ? { ...(draft.current[paramName] as Record<string, unknown>) }
        : {}
    cur[fieldName] = value
    draft.current[paramName] = cur
    draft.touch()
    persistDebugParams()
  }

  function objectFieldValue(paramName: string, fieldName: string): unknown {
    const obj = draft.current[paramName]
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return (obj as Record<string, unknown>)[fieldName]
    }
    return undefined
  }

  function onJsonBlur(paramName: string, text: string, asArray: boolean) {
    const raw = text.trim()
    if (!raw) {
      draft.current[paramName] = asArray ? [] : {}
      draft.touch()
      persistDebugParams()
      return
    }
    try {
      const parsed = JSON.parse(raw)
      if (asArray) {
        draft.current[paramName] = Array.isArray(parsed)
          ? parsed
          : parsed && typeof parsed === 'object'
            ? [parsed]
            : [parsed]
      } else {
        draft.current[paramName] = parsed
      }
      draft.touch()
      persistDebugParams()
    } catch {
      // keep previous
    }
  }

  function onNestedJsonBlur(
    paramName: string,
    fieldName: string,
    text: string,
    asArray: boolean,
  ) {
    const raw = text.trim()
    if (!raw) {
      setObjectField(paramName, fieldName, asArray ? [] : {})
      return
    }
    try {
      setObjectField(paramName, fieldName, JSON.parse(raw))
    } catch {
      // keep previous
    }
  }

  function getArrayItems(paramName: string): unknown[] {
    const v = draft.current[paramName]
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

  function clearItemEditDraft() {
    itemEditDraft.clear()
  }

  function openAddArrayItem(form: ParamFormModel) {
    setItemEditParam(form.param.name.trim())
    setItemEditIndex(-1)
    setItemEditFields(form.fields)
    setItemEditIsObject(form.fields.length > 0)
    setItemEditKind(form.itemKind || 'string')
    setItemEditEnumOptions(form.itemEnumOptions || [])
    setItemDialogTitle(`添加 · ${form.param.name}`)
    clearItemEditDraft()
    if (form.fields.length > 0) {
      Object.assign(itemEditDraft.current, buildObjectDefault(form.fields))
      itemEditDraft.touch()
    } else {
      setItemEditScalar(defaultForKind(form.itemKind || 'string'))
    }
    setItemDialogVisible(true)
  }

  function openEditArrayItem(form: ParamFormModel, index: number) {
    const items = getArrayItems(form.param.name.trim())
    const current = items[index]
    setItemEditParam(form.param.name.trim())
    setItemEditIndex(index)
    setItemEditFields(form.fields)
    setItemEditIsObject(form.fields.length > 0)
    setItemEditKind(form.itemKind || 'string')
    setItemEditEnumOptions(form.itemEnumOptions || [])
    setItemDialogTitle(`编辑 · ${form.param.name}[${index}]`)
    clearItemEditDraft()
    if (form.fields.length > 0) {
      const base = buildObjectDefault(form.fields)
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        Object.assign(itemEditDraft.current, base, current as Record<string, unknown>)
      } else {
        Object.assign(itemEditDraft.current, base)
      }
      itemEditDraft.touch()
    } else {
      setItemEditScalar(
        current !== undefined ? current : defaultForKind(form.itemKind || 'string'),
      )
    }
    setItemDialogVisible(true)
  }

  function removeArrayItem(paramName: string, index: number) {
    const next = [...getArrayItems(paramName)]
    next.splice(index, 1)
    draft.current[paramName] = next
    draft.touch()
    persistDebugParams()
  }

  function saveItemDialog() {
    const name = itemEditParam
    if (!name) return
    const next = [...getArrayItems(name)]
    const value = itemEditIsObject ? { ...itemEditDraft.current } : itemEditScalar
    if (itemEditIndex < 0) {
      next.push(value)
    } else {
      next[itemEditIndex] = value
    }
    draft.current[name] = next
    draft.touch()
    persistDebugParams()
    setItemDialogVisible(false)
  }

  function setItemField(fieldName: string, value: unknown) {
    itemEditDraft.current[fieldName] = value
    itemEditDraft.touch()
  }

  function onItemNestedJsonBlur(fieldName: string, text: string, asArray: boolean) {
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

  function onItemScalarJsonBlur(text: string) {
    const raw = text.trim()
    if (!raw) {
      setItemEditScalar(itemEditKind === 'array' ? [] : {})
      return
    }
    try {
      setItemEditScalar(JSON.parse(raw))
    } catch {
      // keep
    }
  }

  async function handleRun() {
    if (!target) return
    if (methodUnavailable) {
      ElMessage.warning(unavailableHint || '该方法不可用')
      return
    }
    const params = collectParams()
    onDebugParamsChange?.(params)
    setRunning(true)
    setResultError('')
    try {
      const res = await debugDataLayerMethod({
        projectPath: target.projectPath,
        serviceId: target.serviceId,
        processorId: target.processorId,
        methodId: target.method.id,
        params,
        dryRun,
      })
      setResultSql(res.sql)
      setResultRaw(res.raw)
      setResultOutput(res.output)
      setResultDryRun(res.dryRun === true)
      resetFoldOpen()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '执行失败'
      setResultError(msg)
      setResultSql('')
      setResultRaw(null)
      setResultOutput(null)
      setResultDryRun(false)
      resetFoldOpen()
      ElMessage.error(msg)
    } finally {
      setRunning(false)
    }
  }

  function renderScalar(form: ParamFormModel) {
    if (form.kind === 'boolean') {
      return (
        <Switch
          checked={draft.current[form.param.name] === true}
          onChange={(v) => setScalar(form.param.name, v === true)}
        />
      )
    }
    if (form.kind === 'number') {
      return (
        <InputNumber
          value={Number(draft.current[form.param.name] ?? 0)}
          style={{ width: '100%' }}
          onChange={(v) => setScalar(form.param.name, v ?? 0)}
        />
      )
    }
    if (form.kind === 'enum') {
      return (
        <Select
          value={String(draft.current[form.param.name] ?? '')}
          allowClear
          placeholder="选择"
          style={{ width: '100%' }}
          options={form.enumOptions.map((opt) => ({ label: opt, value: opt }))}
          onChange={(v) => setScalar(form.param.name, v ?? '')}
        />
      )
    }
    return (
      <Input
        value={String(draft.current[form.param.name] ?? '')}
        onChange={(e) => setScalar(form.param.name, String(e.target.value ?? ''))}
      />
    )
  }

  function renderObjectFields(form: ParamFormModel) {
    return (
      <div className="object-fields">
        {form.fields.map((field) => (
          <div key={field.name} className="prop-row">
            <div className="prop-label nested">
              <span className="prop-name">{field.name}</span>
              {field.remark ? <span className="prop-type">{field.remark}</span> : null}
            </div>
            {field.kind === 'boolean' ? (
              <Switch
                checked={objectFieldValue(form.param.name, field.name) === true}
                onChange={(v) => setObjectField(form.param.name, field.name, v === true)}
              />
            ) : field.kind === 'number' ? (
              <InputNumber
                value={Number(objectFieldValue(form.param.name, field.name) ?? 0)}
                style={{ width: '100%' }}
                onChange={(v) => setObjectField(form.param.name, field.name, v ?? 0)}
              />
            ) : field.kind === 'enum' ? (
              <Select
                value={String(objectFieldValue(form.param.name, field.name) ?? '')}
                allowClear
                placeholder="选择"
                style={{ width: '100%' }}
                options={field.enumOptions.map((opt) => ({ label: opt, value: opt }))}
                onChange={(v) => setObjectField(form.param.name, field.name, v ?? '')}
              />
            ) : field.kind === 'json' || field.kind === 'array' ? (
              <Input.TextArea
                rows={2}
                value={formatJson(objectFieldValue(form.param.name, field.name))}
                onBlur={(e) =>
                  onNestedJsonBlur(
                    form.param.name,
                    field.name,
                    e.target.value,
                    field.kind === 'array',
                  )
                }
              />
            ) : (
              <Input
                value={String(objectFieldValue(form.param.name, field.name) ?? '')}
                onChange={(e) =>
                  setObjectField(form.param.name, field.name, String(e.target.value ?? ''))
                }
              />
            )}
          </div>
        ))}
      </div>
    )
  }

  function renderFold(
    text: string,
    open: boolean,
    onToggle: () => void,
  ) {
    return (
      <div className="fold-code">
        <div className="fold-body">
          <pre className={`code-box${isLongText(text) && !open ? ' is-collapsed' : ''}`}>
            {text}
          </pre>
          {isLongText(text) && !open ? <div className="fold-fade" /> : null}
        </div>
        {isLongText(text) ? (
          <button type="button" className="fold-toggle" onClick={onToggle}>
            {open ? '收起' : '展开全部'}
          </button>
        ) : null}
      </div>
    )
  }

  function renderItemField(field: ObjectFieldForm) {
    if (field.kind === 'boolean') {
      return (
        <Switch
          checked={itemEditDraft.current[field.name] === true}
          onChange={(v) => setItemField(field.name, v === true)}
        />
      )
    }
    if (field.kind === 'number') {
      return (
        <InputNumber
          value={Number(itemEditDraft.current[field.name] ?? 0)}
          style={{ width: '100%' }}
          onChange={(v) => setItemField(field.name, v ?? 0)}
        />
      )
    }
    if (field.kind === 'enum') {
      return (
        <Select
          value={String(itemEditDraft.current[field.name] ?? '')}
          allowClear
          placeholder="选择"
          style={{ width: '100%' }}
          options={field.enumOptions.map((opt) => ({ label: opt, value: opt }))}
          onChange={(v) => setItemField(field.name, v ?? '')}
        />
      )
    }
    if (field.kind === 'json' || field.kind === 'array') {
      return (
        <Input.TextArea
          rows={3}
          value={formatJson(itemEditDraft.current[field.name])}
          onBlur={(e) =>
            onItemNestedJsonBlur(field.name, e.target.value, field.kind === 'array')
          }
        />
      )
    }
    return (
      <Input
        value={String(itemEditDraft.current[field.name] ?? '')}
        onChange={(e) => setItemField(field.name, String(e.target.value ?? ''))}
      />
    )
  }

  return (
    <aside className="debug-panel">
      <div className="panel-header">调试</div>
      {!target ? (
        <div className="panel-empty">
          <Empty description="选中数据层方法后可调试" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <div className="panel-body">
          <div className="section">
            <div className="section-title row">
              <div className="method-title">
                <span className="proc">{target.processorName}</span>
                <span className="sep">/</span>
                <span className="name">{method?.name || method?.id}</span>
              </div>
              <Button
                type="primary"
                size="small"
                icon={<CaretRightOutlined />}
                loading={running}
                disabled={methodUnavailable}
                onClick={() => void handleRun()}
              >
                执行
              </Button>
            </div>
            {methodUnavailable ? (
              <Alert className="unavailable-alert" type="warning" showIcon message={unavailableHint} />
            ) : null}
            <div className="dry-run-row">
              <div className="dry-run-label">
                <span>试运行</span>
                <span className="dry-run-hint">开启后写入会回滚，不落库</span>
              </div>
              <Switch checked={dryRun} size="small" onChange={setDryRun} />
            </div>
          </div>

          <div className="section">
            <div className="section-title">入参</div>
            {!paramForms.length ? (
              <Empty description="该方法无入参" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="param-list">
                {paramForms.map((form) => (
                  <div key={form.param.id} className="param-block">
                    <div className="prop-label">
                      <Checkbox
                        checked={isParamEnabled(form)}
                        onChange={(e) => setParamEnabled(form, e.target.checked)}
                      />
                      <span className="prop-name">{form.param.name}</span>
                      <span className="prop-type">{form.typeLabel}</span>
                    </div>
                    {!isParamEnabled(form) ? (
                      <div className="null-hint">{disabledParamHint(form)}</div>
                    ) : form.mode === 'scalar' ? (
                      renderScalar(form)
                    ) : form.mode === 'object' ? (
                      renderObjectFields(form)
                    ) : form.mode === 'array' ? (
                      <div className="array-list">
                        {!getArrayItems(form.param.name).length ? (
                          <div className="array-empty">暂无数据，点击下方添加</div>
                        ) : null}
                        {getArrayItems(form.param.name).map((item, index) => (
                          <div
                            key={`${form.param.id}-${index}`}
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
                                onClick={() => removeArrayItem(form.param.name, index)}
                              />
                            </div>
                          </div>
                        ))}
                        <Button
                          className="array-add"
                          type="link"
                          icon={<PlusOutlined />}
                          onClick={() => openAddArrayItem(form)}
                        >
                          添加
                        </Button>
                      </div>
                    ) : (
                      <Input.TextArea
                        rows={3}
                        value={formatJson(draft.current[form.param.name])}
                        onBlur={(e) =>
                          onJsonBlur(form.param.name, e.target.value, form.kind === 'array')
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {resultError ? (
            <p className="error-box">{resultError}</p>
          ) : resultDryRun && (resultSql || resultRaw != null) ? (
            <p className="dry-run-box">试运行已回滚，数据未写入数据库</p>
          ) : null}

          {resultSql || resultRaw != null ? (
            <>
              <div className="section">
                <div className="section-title">查询语句</div>
                {renderFold(resultSqlText, foldOpen.current.sql, () => {
                  foldOpen.current.sql = !foldOpen.current.sql
                  foldOpen.touch()
                })}
              </div>
              <div className="section">
                <div className="section-title">数据源返回</div>
                {renderFold(resultRawText, foldOpen.current.raw, () => {
                  foldOpen.current.raw = !foldOpen.current.raw
                  foldOpen.touch()
                })}
              </div>
              <div className="section">
                <div className="section-title">出参数据</div>
                {renderFold(resultOutputText, foldOpen.current.output, () => {
                  foldOpen.current.output = !foldOpen.current.output
                  foldOpen.touch()
                })}
              </div>
            </>
          ) : null}
        </div>
      )}

      <Modal
        open={itemDialogVisible}
        title={itemDialogTitle}
        width={420}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        className="array-item-dialog"
        onCancel={() => setItemDialogVisible(false)}
        footer={
          <Button type="primary" onClick={saveItemDialog}>
            确定
          </Button>
        }
      >
        {itemEditIsObject ? (
          <div className="item-form">
            {itemEditFields.map((field) => (
              <div key={field.name} className="item-form-row">
                <div className="item-form-label">
                  <span className="prop-name">{field.name}</span>
                  {field.remark ? <span className="prop-type">{field.remark}</span> : null}
                </div>
                {renderItemField(field)}
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
                  onChange={(v) => setItemEditScalar(v === true)}
                />
              ) : itemEditKind === 'number' ? (
                <InputNumber
                  value={Number(itemEditScalar ?? 0)}
                  style={{ width: '100%' }}
                  onChange={(v) => setItemEditScalar(v ?? 0)}
                />
              ) : itemEditKind === 'enum' ? (
                <Select
                  value={String(itemEditScalar ?? '')}
                  allowClear
                  placeholder="选择"
                  style={{ width: '100%' }}
                  options={itemEditEnumOptions.map((opt) => ({ label: opt, value: opt }))}
                  onChange={(v) => setItemEditScalar(v ?? '')}
                />
              ) : itemEditKind === 'json' || itemEditKind === 'array' ? (
                <Input.TextArea
                  rows={4}
                  value={formatJson(itemEditScalar)}
                  onBlur={(e) => onItemScalarJsonBlur(e.target.value)}
                />
              ) : (
                <Input
                  value={String(itemEditScalar ?? '')}
                  onChange={(e) => setItemEditScalar(String(e.target.value ?? ''))}
                />
              )}
            </div>
          </div>
        )}
      </Modal>
    </aside>
  )
}
