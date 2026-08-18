import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, Radio, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { ElMessage } from '../../ui/feedback'
import {
  createEmptyProcessorMethodParam,
  createEmptyProcessorTypeExpr,
  PROCESSOR_METHOD_SCOPE_OPTIONS,
  type ProcessorMethod,
  type ProcessorMethodParam,
  type ProcessorMethodScope,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import { typeLabel, arrayTypeLabel, type DataFieldType } from '../../types/page-data'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import TypeGenericArgsDialog from './TypeGenericArgsDialog'
import './EditBusinessMethodDialog.css'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = [
  'color',
  'ref',
  'icon',
  'resource',
]

export type BusinessMethodEditPayload = {
  name: string
  remark: string
  scope: ProcessorMethodScope
  params: ProcessorMethodParam[]
  output: ProcessorTypeExpr
}

export default function EditBusinessMethodDialog({
  open,
  onOpenChange,
  method,
  typeLibrary,
  typeOptions,
  reservedNames,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  method: ProcessorMethod | null
  typeLibrary: DataTypeLibrary | null
  typeOptions: Array<{ id: string; label: string }>
  reservedNames?: string[]
  onSave?: (payload: BusinessMethodEditPayload) => void
}) {
  const [draftName, setDraftName] = useState('')
  const [draftRemark, setDraftRemark] = useState('')
  const [draftScope, setDraftScope] = useState<ProcessorMethodScope>('public')
  const [draftParams, setDraftParams] = useState<ProcessorMethodParam[]>([])
  const [draftOutput, setDraftOutput] = useState<ProcessorTypeExpr>(
    createEmptyProcessorTypeExpr(),
  )

  const [genericVisible, setGenericVisible] = useState(false)
  const [genericTarget, setGenericTarget] = useState<'param' | 'output'>('output')
  const [genericParamIndex, setGenericParamIndex] = useState(-1)
  const [genericNames, setGenericNames] = useState<string[]>([])
  const [genericTypeName, setGenericTypeName] = useState('')
  const [genericArgs, setGenericArgs] = useState<Record<string, string>>({})

  const title = useMemo(() => {
    const name = method?.name?.trim()
    return name ? `设计方法 · ${name}` : '设计方法'
  }, [method?.name])

  useEffect(() => {
    if (!open || !method) return
    setDraftName(method.name ?? '')
    setDraftRemark(method.remark ?? '')
    setDraftScope(method.scope === 'private' ? 'private' : 'public')
    setDraftParams(
      (method.params ?? []).map((p) => ({
        ...p,
        typeExpr: {
          ...p.typeExpr,
          genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
        },
      })),
    )
    setDraftOutput({
      ...method.output,
      genericArgs: { ...(method.output.genericArgs ?? {}) },
    })
  }, [open, method])

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

  function leafNamedRef(expr: ProcessorTypeExpr): string {
    if (expr.type === 'array' || expr.type === 'map') {
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

  function formatTypeExpr(expr: ProcessorTypeExpr): string {
    const named = leafNamedRef(expr)
    const namedLabel = named
      ? formatTypeWithGenerics(named, expr.genericArgs ?? {})
      : ''
    if (expr.type === 'map') {
      const keyLabel = expr.keyType === 'number' ? '数字' : '字符串'
      if (expr.itemType === 'array') {
        const leaf =
          namedLabel ||
          typeLabel((expr.itemItemType || 'string') as DataFieldType)
        return `映射 / ${keyLabel} / ${arrayTypeLabel(leaf)}`
      }
      const leaf =
        namedLabel || typeLabel((expr.itemType || 'string') as DataFieldType)
      return `映射 / ${keyLabel} / ${leaf}`
    }
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
    if (named) return namedLabel
    return typeLabel((expr.type || 'string') as DataFieldType)
  }

  function payloadToTypeExpr(
    payload: TypeSelectPayload,
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

  const outputHasGenerics = genericNamesOf(leafNamedRef(draftOutput)).length > 0
  const outputTypePreview = formatTypeExpr(draftOutput)

  function addParam() {
    setDraftParams((prev) => [
      ...prev,
      createEmptyProcessorMethodParam(`arg${prev.length + 1}`),
    ])
  }

  function updateParam(index: number, patch: Partial<ProcessorMethodParam>) {
    setDraftParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    )
  }

  function removeParam(index: number) {
    setDraftParams((prev) => prev.filter((_, i) => i !== index))
  }

  function handleParamTypeChange(index: number, payload: TypeSelectPayload) {
    const prev = draftParams[index]?.typeExpr
    const next = payloadToTypeExpr(payload, prev)
    updateParam(index, { typeExpr: next })
    if (genericNamesOf(leafNamedRef(next)).length) {
      openParamGenerics(index, next)
    }
  }

  function openParamGenerics(index: number, expr?: ProcessorTypeExpr) {
    const row = draftParams[index]
    const typeExpr = expr ?? row?.typeExpr
    if (!typeExpr) return
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

  function handleOutputChange(payload: TypeSelectPayload) {
    const next = payloadToTypeExpr(payload, draftOutput)
    setDraftOutput(next)
    if (genericNamesOf(leafNamedRef(next)).length) {
      openOutputGenerics(next)
    }
  }

  function openOutputGenerics(expr?: ProcessorTypeExpr) {
    const output = expr ?? draftOutput
    const named = leafNamedRef(output)
    const names = genericNamesOf(named)
    if (!names.length) return
    setGenericTarget('output')
    setGenericParamIndex(-1)
    setGenericNames(names)
    setGenericTypeName(typeDefById(named)?.name ?? '')
    setGenericArgs({ ...(output.genericArgs ?? {}) })
    setGenericVisible(true)
  }

  function saveGenerics(args: Record<string, string>) {
    if (genericTarget === 'output') {
      setDraftOutput((prev) => ({ ...prev, genericArgs: args }))
    } else if (genericParamIndex >= 0) {
      const row = draftParams[genericParamIndex]
      if (row) {
        updateParam(genericParamIndex, {
          typeExpr: { ...row.typeExpr, genericArgs: args },
        })
      }
    }
    setGenericParamIndex(-1)
  }

  function handleSave() {
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
      ElMessage.warning(`方法名「${name}」已存在`)
      return
    }
    onSave?.({
      name,
      remark: draftRemark.trim(),
      scope: draftScope,
      params: draftParams.map((p) => ({
        ...p,
        name: p.name.trim(),
        remark: p.remark.trim(),
        typeExpr: {
          ...p.typeExpr,
          genericArgs: p.typeExpr.genericArgs ?? {},
        },
      })),
      output: {
        ...draftOutput,
        genericArgs: draftOutput.genericArgs ?? {},
      },
    })
    onOpenChange?.(false)
  }

  return (
    <>
      <Modal
        open={open}
        title={title}
        width={720}
        destroyOnHidden
        maskClosable={false}
        keyboard={false}
        className="business-method-dialog"
        onCancel={() => onOpenChange?.(false)}
        footer={
          <Button type="primary" onClick={handleSave}>
            确定
          </Button>
        }
      >
        <Form
          className="method-form"
          labelCol={{ style: { width: 64 } }}
          onFinish={handleSave}
        >
          <Form.Item label="名称" required>
            <Input
              value={draftName}
              placeholder="方法名，如 list"
              maxLength={64}
              onChange={(e) => setDraftName(e.target.value)}
            />
          </Form.Item>

          <Form.Item label="说明">
            <Input
              value={draftRemark}
              placeholder="可选说明"
              maxLength={200}
              onChange={(e) => setDraftRemark(e.target.value)}
            />
          </Form.Item>

          <Form.Item label="作用域" required>
            <Radio.Group
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value)}
            >
              {PROCESSOR_METHOD_SCOPE_OPTIONS.map((opt) => (
                <Radio key={opt.value} value={opt.value}>
                  {opt.label}
                </Radio>
              ))}
            </Radio.Group>
          </Form.Item>

          <Form.Item label="出参" required>
            <DataFieldTypeTreeSelect
              className="type-select"
              type={(draftOutput.type || 'string') as DataFieldType}
              typeRef={draftOutput.typeRef}
              itemType={
                (draftOutput.itemType || undefined) as DataFieldType | undefined
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
              placeholder="选择出参类型"
              onChange={handleOutputChange}
            />
          </Form.Item>

          {outputHasGenerics ? (
            <Form.Item label="泛型">
              <div className="generic-row">
                <Button type="link" onClick={() => openOutputGenerics()}>
                  配置泛型
                </Button>
                <code className="type-preview" title={outputTypePreview}>
                  {outputTypePreview}
                </code>
              </div>
            </Form.Item>
          ) : null}

          <Form.Item label="入参" className="params-item">
            <div className="params-block">
              <div className="params-toolbar">
                <Button type="link" icon={<PlusOutlined />} onClick={addParam}>
                  添加
                </Button>
              </div>
              <Table
                dataSource={draftParams}
                rowKey={(row) => row.id || row.name}
                pagination={false}
                bordered
                size="small"
                locale={{ emptyText: '暂无入参，点击添加' }}
                columns={[
                  {
                    title: '名称',
                    minWidth: 110,
                    render: (_, row, index) => (
                      <Input
                        value={row.name}
                        placeholder="参数名"
                        size="small"
                        onChange={(e) =>
                          updateParam(index, { name: e.target.value })
                        }
                      />
                    ),
                  },
                  {
                    title: '类型',
                    minWidth: 220,
                    render: (_, row, index) => (
                      <>
                        <div className="type-cell">
                          <DataFieldTypeTreeSelect
                            className="type-select"
                            type={
                              (row.typeExpr.type || 'string') as DataFieldType
                            }
                            typeRef={row.typeExpr.typeRef}
                            itemType={
                              (row.typeExpr.itemType || undefined) as
                                | DataFieldType
                                | undefined
                            }
                            itemTypeRef={row.typeExpr.itemTypeRef}
                            itemItemType={
                              (row.typeExpr.itemItemType || undefined) as
                                | DataFieldType
                                | undefined
                            }
                            itemItemTypeRef={row.typeExpr.itemItemTypeRef}
                            keyType={
                              row.typeExpr.keyType === 'number' ||
                              row.typeExpr.keyType === 'string'
                                ? row.typeExpr.keyType
                                : undefined
                            }
                            library={typeLibrary}
                            excludeTypes={PROCESSOR_EXCLUDE_TYPES}
                            allowRef={false}
                            clearable
                            size="small"
                            placeholder="选择类型"
                            onChange={(payload) =>
                              handleParamTypeChange(index, payload)
                            }
                          />
                          {genericNamesOf(leafNamedRef(row.typeExpr)).length ? (
                            <Button
                              type="link"
                              size="small"
                              onClick={() => openParamGenerics(index)}
                            >
                              泛型
                            </Button>
                          ) : null}
                        </div>
                        {genericNamesOf(leafNamedRef(row.typeExpr)).length ? (
                          <div
                            className="param-generic-preview"
                            title={formatTypeExpr(row.typeExpr)}
                          >
                            {formatTypeExpr(row.typeExpr)}
                          </div>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    title: '说明',
                    minWidth: 100,
                    render: (_, row, index) => (
                      <Input
                        value={row.remark}
                        placeholder="可选"
                        size="small"
                        onChange={(e) =>
                          updateParam(index, { remark: e.target.value })
                        }
                      />
                    ),
                  },
                  {
                    title: '操作',
                    width: 72,
                    align: 'center',
                    render: (_, __, index) => (
                      <Button
                        type="link"
                        danger
                        size="small"
                        onClick={() => removeParam(index)}
                      >
                        删除
                      </Button>
                    ),
                  },
                ]}
              />
            </div>
          </Form.Item>
        </Form>
      </Modal>

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
