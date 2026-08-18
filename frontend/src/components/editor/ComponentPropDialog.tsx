import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, InputNumber, Modal, Switch } from 'antd'
import { ElMessage } from '../../ui/feedback'
import {
  defaultValue,
  type DataFieldType,
  type DataFieldValue,
} from '../../types/page-data'
import {
  createEmptyComponentProp,
  type ComponentPropDef,
} from '../../types/component'
import { normalizePropDefaultValue } from '../../utils/component-props'
import {
  normalizeApiParams,
  normalizeApiReturnType,
} from '../../utils/api-prop'
import {
  createEmptyProcessorTypeExpr,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import {
  dataFieldToMethodParamType,
  methodParamToDataFieldType,
  type MethodParam,
} from '../../types/page-method'
import type { DataTypeLibrary } from '../../types/data-types'
import IconValueSelect from './IconValueSelect'
import ColorPicker from './ColorPicker'
import DateTimeValueInput from './DateTimeValueInput'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import TypeGenericArgsDialog from './TypeGenericArgsDialog'
import './ComponentPropDialog.css'

export default function ComponentPropDialog({
  open,
  onOpenChange,
  prop,
  existingNames,
  iconOptions,
  typeLibrary,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  prop: ComponentPropDef | null
  existingNames?: string[]
  iconOptions?: Array<{ id: string; label: string }>
  typeLibrary?: DataTypeLibrary | null
  onSave?: (prop: ComponentPropDef) => void
}) {
  const [draft, setDraft] = useState<ComponentPropDef>({
    ...createEmptyComponentProp(),
    apiParams: [],
    apiReturnType: createEmptyProcessorTypeExpr('any'),
  })
  const [jsonDefaultText, setJsonDefaultText] = useState('')
  const [genericVisible, setGenericVisible] = useState(false)
  const [genericTarget, setGenericTarget] = useState<'param' | 'return'>('return')
  const [genericParamIndex, setGenericParamIndex] = useState(-1)
  const [genericNames, setGenericNames] = useState<string[]>([])
  const [genericTypeName, setGenericTypeName] = useState('')
  const [genericArgs, setGenericArgs] = useState<Record<string, string>>({})

  const isEdit = Boolean(prop?.name?.trim())
  const title = isEdit ? '编辑参数' : '添加参数'
  const isApiType = draft.type === 'api'

  const namedTypeOptions = useMemo(() => {
    const opts: Array<{ id: string; label: string }> = []
    for (const group of typeLibrary?.groups ?? []) {
      for (const t of group.types) {
        if (!t.name.trim()) continue
        opts.push({ id: t.id, label: `${group.name} / ${t.name}` })
      }
    }
    return opts
  }, [typeLibrary])

  function typeDefById(id: string) {
    if (!id) return null
    for (const group of typeLibrary?.groups ?? []) {
      const hit = group.types.find((t) => t.id === id)
      if (hit) return hit
    }
    return null
  }

  function genericNamesOf(typeRef: string): string[] {
    return (typeDefById(typeRef)?.generics ?? [])
      .map((g) => g.name.trim())
      .filter(Boolean)
  }

  function leafNamedRef(expr: ProcessorTypeExpr | null | undefined): string {
    if (!expr) return ''
    if (expr.type === 'array') {
      if (expr.itemType === 'array') return expr.itemItemTypeRef || ''
      return expr.itemTypeRef || ''
    }
    return expr.typeRef || ''
  }

  function formatTypeWithGenerics(
    typeRef: string,
    args: Record<string, string>,
  ): string {
    const def = typeDefById(typeRef)
    if (!def?.name) return typeRef || '—'
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

  function formatTypeExpr(expr: ProcessorTypeExpr | null | undefined): string {
    if (!expr) return 'any'
    const named = leafNamedRef(expr)
    if (named) return formatTypeWithGenerics(named, expr.genericArgs ?? {})
    if (expr.type === 'array') return `${expr.itemType || 'any'}[]`
    return expr.type || 'any'
  }

  function payloadToTypeExpr(
    payload: {
      type: DataFieldType | 'void' | 'generic'
      typeRef?: string
      itemType?: DataFieldType | 'generic'
      itemTypeRef?: string
      itemItemType?: DataFieldType | 'generic'
      itemItemTypeRef?: string
    },
    prev?: ProcessorTypeExpr,
  ): ProcessorTypeExpr {
    const fieldType =
      payload.type === 'void' || payload.type === 'generic' ? 'any' : payload.type
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

  function paramNamedRef(param: MethodParam): string {
    if (param.typeExpr) return leafNamedRef(param.typeExpr)
    if (param.type === 'array') {
      if (param.itemType === 'array') return param.itemItemTypeRef || ''
      return param.itemTypeRef || ''
    }
    return param.typeRef || ''
  }

  const defaultEditor = useMemo(() => {
    if (isApiType) return 'none'
    const type = String(draft.type ?? '')
    if (type === 'string' || type === 'resource') return 'string'
    if (type === 'number') return 'number'
    if (type === 'boolean') return 'boolean'
    if (type === 'time' || type === 'date' || type === 'datetime') return type
    if (type === 'icon') return 'icon'
    if (type === 'color') return 'color'
    if (type === 'array') return 'array'
    if (type === 'json' || type === 'map') return 'json'
    return 'json'
  }, [isApiType, draft.type])

  const colorDefault =
    draft.defaultValue == null || typeof draft.defaultValue === 'object'
      ? ''
      : String(draft.defaultValue)

  function formatDefaultForJson(value: DataFieldValue): string {
    try {
      return JSON.stringify(value ?? defaultValue('json'), null, 2)
    } catch {
      return '{}'
    }
  }

  function syncDraft(source: ComponentPropDef | null) {
    const next = source ? { ...source } : createEmptyComponentProp()
    const updated: ComponentPropDef = {
      ...createEmptyComponentProp(),
      name: next.name,
      type: next.type,
      typeRef: next.typeRef,
      itemType: next.itemType,
      itemTypeRef: next.itemTypeRef,
      itemItemType: next.itemItemType,
      itemItemTypeRef: next.itemItemTypeRef,
      remark: next.remark,
      defaultValue: next.defaultValue,
      twoWay: next.type === 'api' ? false : next.twoWay,
      required: Boolean(next.required),
      apiParams: normalizeApiParams(next.apiParams),
      apiReturnType: normalizeApiReturnType(next.apiReturnType),
    }
    if (updated.type === 'color' && typeof updated.defaultValue === 'object') {
      updated.defaultValue = ''
    }
    if (updated.type === 'api') {
      updated.defaultValue = ''
      if (!updated.apiParams) updated.apiParams = []
    }
    setDraft(updated)
    if (updated.type === 'json' || updated.type === 'array') {
      setJsonDefaultText(formatDefaultForJson(updated.defaultValue))
    } else {
      setJsonDefaultText('')
    }
  }

  useEffect(() => {
    if (!open) return
    syncDraft(prop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prop])

  function onTypeChange(payload: TypeSelectPayload) {
    const nextType = payload.type
    if (nextType === 'void' || nextType === 'generic') return
    setDraft((prev) => {
      const next = { ...prev }
      next.type = nextType
      next.typeRef = payload.typeRef
      next.itemType =
        nextType === 'array'
          ? payload.itemType === 'generic'
            ? 'any'
            : payload.itemType || 'string'
          : undefined
      next.itemTypeRef = nextType === 'array' ? payload.itemTypeRef : undefined
      next.itemItemType =
        nextType === 'array' && payload.itemType === 'array'
          ? payload.itemItemType === 'generic'
            ? 'any'
            : payload.itemItemType || 'string'
          : undefined
      next.itemItemTypeRef =
        nextType === 'array' && payload.itemType === 'array'
          ? payload.itemItemTypeRef
          : undefined
      next.defaultValue = nextType === 'api' ? '' : defaultValue(nextType)
      if (nextType === 'api') {
        next.twoWay = false
        if (!next.apiParams?.length) next.apiParams = []
        if (!next.apiReturnType) {
          next.apiReturnType = createEmptyProcessorTypeExpr('any')
        }
      }
      if (payload.type === 'json' || payload.type === 'array') {
        setJsonDefaultText(formatDefaultForJson(next.defaultValue))
      } else {
        setJsonDefaultText('')
      }
      return next
    })
  }

  function addApiParam() {
    setDraft((prev) => ({
      ...prev,
      apiParams: [
        ...(prev.apiParams ?? []),
        {
          name: '',
          type: 'any',
          typeExpr: createEmptyProcessorTypeExpr('any'),
        },
      ],
    }))
  }

  function removeApiParam(index: number) {
    setDraft((prev) => ({
      ...prev,
      apiParams: (prev.apiParams ?? []).filter((_, i) => i !== index),
    }))
  }

  function updateApiParam(index: number, patch: Partial<MethodParam>) {
    setDraft((prev) => ({
      ...prev,
      apiParams: (prev.apiParams ?? []).map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    }))
  }

  function onApiParamTypeChange(index: number, payload: TypeSelectPayload) {
    const param = draft.apiParams?.[index]
    if (!param) return
    const fieldType =
      payload.type === 'void' || payload.type === 'generic' ? 'any' : payload.type
    const next = payloadToTypeExpr(payload, param.typeExpr)
    updateApiParam(index, {
      type: dataFieldToMethodParamType(fieldType),
      typeRef: payload.typeRef,
      itemType:
        fieldType === 'array'
          ? payload.itemType === 'generic'
            ? 'any'
            : payload.itemType || 'string'
          : undefined,
      itemTypeRef: fieldType === 'array' ? payload.itemTypeRef : undefined,
      itemItemType:
        fieldType === 'array' && payload.itemType === 'array'
          ? payload.itemItemType === 'generic'
            ? 'any'
            : payload.itemItemType || 'string'
          : undefined,
      itemItemTypeRef:
        fieldType === 'array' && payload.itemType === 'array'
          ? payload.itemItemTypeRef
          : undefined,
      typeExpr: next,
    })
    if (genericNamesOf(leafNamedRef(next)).length) {
      openParamGenerics(index, next)
    }
  }

  function onApiReturnTypeChange(payload: TypeSelectPayload) {
    const next = payloadToTypeExpr(payload, draft.apiReturnType)
    setDraft((prev) => ({ ...prev, apiReturnType: next }))
    if (genericNamesOf(leafNamedRef(next)).length) {
      openReturnGenerics(next)
    }
  }

  function ensureParamTypeExpr(param: MethodParam): ProcessorTypeExpr {
    if (param.typeExpr) return param.typeExpr
    return {
      ...createEmptyProcessorTypeExpr(methodParamToDataFieldType(param.type)),
      type: methodParamToDataFieldType(param.type),
      typeRef: param.typeRef ?? '',
      itemType: param.itemType ?? '',
      itemTypeRef: param.itemTypeRef ?? '',
      itemItemType: param.itemItemType ?? '',
      itemItemTypeRef: param.itemItemTypeRef ?? '',
      genericArgs: {},
    }
  }

  function openParamGenerics(index: number, expr?: ProcessorTypeExpr) {
    const param = draft.apiParams?.[index]
    if (!param) return
    const typeExpr = expr ?? ensureParamTypeExpr(param)
    const named = leafNamedRef(typeExpr)
    const names = genericNamesOf(named)
    if (!names.length) return
    setGenericTarget('param')
    setGenericParamIndex(index)
    setGenericNames(names)
    setGenericTypeName(typeDefById(named)?.name ?? '')
    setGenericArgs({ ...(typeExpr.genericArgs ?? {}) })
    setGenericVisible(true)
  }

  function openReturnGenerics(expr?: ProcessorTypeExpr) {
    const output = expr ?? draft.apiReturnType ?? createEmptyProcessorTypeExpr('any')
    const named = leafNamedRef(output)
    const names = genericNamesOf(named)
    if (!names.length) return
    setGenericTarget('return')
    setGenericParamIndex(-1)
    setGenericNames(names)
    setGenericTypeName(typeDefById(named)?.name ?? '')
    setGenericArgs({ ...(output.genericArgs ?? {}) })
    setGenericVisible(true)
  }

  function handleGenericSave(args: Record<string, string>) {
    if (genericTarget === 'return') {
      setDraft((prev) => ({
        ...prev,
        apiReturnType: {
          ...(prev.apiReturnType ?? createEmptyProcessorTypeExpr('any')),
          genericArgs: { ...args },
        },
      }))
    } else {
      const param = draft.apiParams?.[genericParamIndex]
      if (param) {
        const expr = ensureParamTypeExpr(param)
        updateApiParam(genericParamIndex, {
          typeExpr: { ...expr, genericArgs: { ...args } },
        })
      }
    }
    setGenericVisible(false)
  }

  function parseComplexDefault(): DataFieldValue | null {
    const raw = jsonDefaultText.trim()
    if (!raw) return defaultValue(draft.type)
    try {
      const parsed = JSON.parse(raw) as unknown
      if (draft.type === 'array' && !Array.isArray(parsed)) {
        ElMessage.error('默认值需为 JSON 数组')
        return null
      }
      if (
        draft.type === 'json' &&
        (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      ) {
        ElMessage.error('默认值需为 JSON 对象')
        return null
      }
      return parsed as DataFieldValue
    } catch {
      ElMessage.error('默认值 JSON 格式不正确')
      return null
    }
  }

  function handleSave() {
    const name = draft.name.trim()
    if (!name) {
      ElMessage.error('请填写参数名')
      return
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      ElMessage.error('参数名需以字母或下划线开头，仅含字母、数字、下划线')
      return
    }
    const others = (existingNames ?? []).map((item) => item.trim()).filter(Boolean)
    if (others.includes(name)) {
      ElMessage.error(`参数名重复：${name}`)
      return
    }

    let defaultVal = draft.defaultValue
    if (draft.type === 'api') {
      defaultVal = ''
    } else if (draft.type === 'json' || draft.type === 'array') {
      const parsed = parseComplexDefault()
      if (parsed === null) return
      defaultVal = parsed
    } else {
      defaultVal = normalizePropDefaultValue(draft.type, defaultVal)
    }

    const apiParams =
      draft.type === 'api' ? normalizeApiParams(draft.apiParams) : undefined
    const apiReturnType =
      draft.type === 'api' ? normalizeApiReturnType(draft.apiReturnType) : undefined
    if (draft.type === 'api') {
      for (const p of apiParams ?? []) {
        if (!p.name.trim()) {
          ElMessage.error('请填写完整的 API 形参名')
          return
        }
      }
    }

    onSave?.({
      name,
      type: draft.type,
      typeRef: draft.typeRef,
      itemType: draft.itemType,
      itemTypeRef: draft.itemTypeRef,
      itemItemType: draft.itemItemType,
      itemItemTypeRef: draft.itemItemTypeRef,
      remark: draft.remark.trim(),
      defaultValue: defaultVal,
      twoWay: draft.type === 'api' ? false : Boolean(draft.twoWay),
      required: Boolean(draft.required),
      ...(draft.type === 'api'
        ? { apiParams: apiParams ?? [], apiReturnType }
        : {}),
    })
    onOpenChange?.(false)
  }

  return (
    <>
      <Modal
        open={open}
        title={title}
        width={isApiType ? 720 : 520}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        onCancel={() => onOpenChange?.(false)}
        footer={
          <Button type="primary" onClick={handleSave}>
            保存
          </Button>
        }
      >
        <Form layout="vertical">
          <Form.Item label="参数名" required>
            <Input
              value={draft.name}
              placeholder="例如：fetchApi"
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, name: e.target.value }))
              }
            />
          </Form.Item>

          <Form.Item label="数据类型" required>
            <DataFieldTypeTreeSelect
              type={draft.type}
              typeRef={draft.typeRef}
              itemType={draft.itemType}
              itemTypeRef={draft.itemTypeRef}
              itemItemType={draft.itemItemType}
              itemItemTypeRef={draft.itemItemTypeRef}
              library={typeLibrary}
              composable
              onChange={onTypeChange}
            />
          </Form.Item>

          <Form.Item label="备注">
            <Input
              value={draft.remark}
              placeholder="备注（可选）"
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, remark: e.target.value }))
              }
            />
          </Form.Item>

          {isApiType ? (
            <>
              <Form.Item label="API 形参">
                <div className="api-params">
                  {(draft.apiParams ?? []).map((param, index) => (
                    <div key={index} className="api-param-row">
                      <Input
                        value={param.name}
                        placeholder="形参名"
                        style={{ width: 140 }}
                        onChange={(e) =>
                          updateApiParam(index, { name: e.target.value })
                        }
                      />
                      <DataFieldTypeTreeSelect
                        type={methodParamToDataFieldType(param.type)}
                        typeRef={param.typeRef}
                        itemType={param.itemType}
                        itemTypeRef={param.itemTypeRef}
                        itemItemType={param.itemItemType}
                        itemItemTypeRef={param.itemItemTypeRef}
                        library={typeLibrary}
                        composable
                        excludeTypes={['api', 'icon', 'color', 'ref']}
                        onChange={(payload) =>
                          onApiParamTypeChange(index, payload)
                        }
                      />
                      {genericNamesOf(paramNamedRef(param)).length ? (
                        <Button type="link" onClick={() => openParamGenerics(index)}>
                          泛型
                        </Button>
                      ) : null}
                      <Button
                        type="link"
                        danger
                        onClick={() => removeApiParam(index)}
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                  <Button type="link" onClick={addApiParam}>
                    + 添加形参
                  </Button>
                </div>
                <p className="hint">
                  组件内调用
                  <code>$props.{draft.name || 'fetchApi'}(args)</code>
                  时传入这些字段。匹配规则：组件声明的形参须出现在 API
                  入参中且类型一致；API 可有额外入参（由调用方补齐）。
                </p>
              </Form.Item>

              <Form.Item label="出参类型">
                <div className="api-return-row">
                  <DataFieldTypeTreeSelect
                    type={(draft.apiReturnType?.type || 'any') as DataFieldType}
                    typeRef={draft.apiReturnType?.typeRef}
                    itemType={
                      (draft.apiReturnType?.itemType || undefined) as
                        | DataFieldType
                        | undefined
                    }
                    itemTypeRef={draft.apiReturnType?.itemTypeRef}
                    itemItemType={
                      (draft.apiReturnType?.itemItemType || undefined) as
                        | DataFieldType
                        | undefined
                    }
                    itemItemTypeRef={draft.apiReturnType?.itemItemTypeRef}
                    library={typeLibrary}
                    composable
                    excludeTypes={['api', 'icon', 'color', 'ref']}
                    onChange={onApiReturnTypeChange}
                  />
                  {genericNamesOf(leafNamedRef(draft.apiReturnType)).length ? (
                    <Button type="link" onClick={() => openReturnGenerics()}>
                      泛型
                    </Button>
                  ) : null}
                </div>
                {genericNamesOf(leafNamedRef(draft.apiReturnType)).length ? (
                  <p className="generic-preview">
                    {formatTypeExpr(draft.apiReturnType)}
                  </p>
                ) : null}
                <p className="hint">
                  此处配置的是 resolve 类型
                  <code>T</code>
                  ；组件内调用返回
                  <code>Promise&lt;T&gt;</code>
                  ，例如
                  <code>await $props.{draft.name || 'fetchApi'}(args)</code>
                  。 父级绑定的控制器 API 出参须与 <code>T</code> 一致。
                </p>
              </Form.Item>
            </>
          ) : (
            <Form.Item label="默认值">
              {defaultEditor === 'string' ? (
                <Input
                  value={String(draft.defaultValue ?? '')}
                  placeholder="默认值"
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, defaultValue: e.target.value }))
                  }
                />
              ) : defaultEditor === 'number' ? (
                <InputNumber
                  value={Number(draft.defaultValue ?? 0)}
                  style={{ width: '100%' }}
                  onChange={(next) =>
                    setDraft((prev) => ({
                      ...prev,
                      defaultValue: Number(next ?? 0),
                    }))
                  }
                />
              ) : defaultEditor === 'boolean' ? (
                <Switch
                  checked={
                    draft.defaultValue === true || draft.defaultValue === 'true'
                  }
                  onChange={(checked) =>
                    setDraft((prev) => ({ ...prev, defaultValue: checked }))
                  }
                />
              ) : defaultEditor === 'time' ||
                defaultEditor === 'date' ||
                defaultEditor === 'datetime' ? (
                <DateTimeValueInput
                  kind={defaultEditor}
                  value={String(draft.defaultValue ?? '')}
                  onChange={(next) =>
                    setDraft((prev) => ({ ...prev, defaultValue: next }))
                  }
                />
              ) : defaultEditor === 'icon' ? (
                <IconValueSelect
                  value={String(draft.defaultValue ?? '')}
                  options={iconOptions}
                  onChange={(next) =>
                    setDraft((prev) => ({ ...prev, defaultValue: next }))
                  }
                />
              ) : defaultEditor === 'color' ? (
                <ColorPicker
                  value={colorDefault}
                  placeholder="#409eff / rgba(...)"
                  onChange={(next) =>
                    setDraft((prev) => ({ ...prev, defaultValue: next }))
                  }
                />
              ) : (
                <Input.TextArea
                  value={jsonDefaultText}
                  rows={5}
                  placeholder={
                    defaultEditor === 'array'
                      ? 'JSON 数组，例如 []'
                      : 'JSON 对象，例如 {}'
                  }
                  onChange={(e) => setJsonDefaultText(e.target.value)}
                />
              )}
            </Form.Item>
          )}

          <div className="switch-row">
            <Form.Item label="必填">
              <Switch
                checked={draft.required}
                onChange={(checked) =>
                  setDraft((prev) => ({ ...prev, required: checked }))
                }
              />
            </Form.Item>
            {!isApiType ? (
              <Form.Item label="可更新">
                <Switch
                  checked={Boolean(draft.twoWay)}
                  onChange={(checked) =>
                    setDraft((prev) => ({ ...prev, twoWay: checked }))
                  }
                />
              </Form.Item>
            ) : null}
          </div>
          <p className="hint">
            {isApiType ? (
              <>
                后端 API 由父页面绑定具体控制器方法；组件内当作异步函数调用，返回
                <code>Promise&lt;出参类型&gt;</code>。
              </>
            ) : (
              <>
                关闭为普通入参；开启后可在组件内用
                <code>updateProps</code>
                修改并通知父级。入参仍可传常量或表达式，模板用
                <code>{'{$props.字段名}'}</code> 读取。
              </>
            )}
          </p>
        </Form>
      </Modal>

      <TypeGenericArgsDialog
        open={genericVisible}
        onOpenChange={setGenericVisible}
        typeName={genericTypeName}
        genericNames={genericNames}
        args={genericArgs}
        typeOptions={namedTypeOptions}
        onSave={handleGenericSave}
      />
    </>
  )
}
