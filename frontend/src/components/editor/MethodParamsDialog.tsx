import { useEffect, useState } from 'react'
import { Button, Input, Modal, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import {
  createEmptyProcessorMethodParam,
  createEmptyProcessorTypeExpr,
  type ProcessorMethodParam,
  type ProcessorTypeExpr,
} from '../../types/backend-services'
import type { DataTypeLibrary } from '../../types/data-types'
import {
  typeLabel,
  arrayTypeLabel,
  type DataFieldType,
} from '../../types/page-data'
import DataFieldTypeTreeSelect, {
  type TypeSelectPayload,
} from './DataFieldTypeTreeSelect'
import TypeGenericArgsDialog from './TypeGenericArgsDialog'
import './MethodParamsDialog.css'

const PROCESSOR_EXCLUDE_TYPES: DataFieldType[] = [
  'color',
  'ref',
  'icon',
  'resource',
]

export default function MethodParamsDialog({
  open,
  onOpenChange,
  params,
  typeOptions,
  typeLibrary,
  methodName,
  onSave,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  params: ProcessorMethodParam[]
  typeOptions: Array<{ id: string; label: string }>
  typeLibrary: DataTypeLibrary | null
  methodName?: string
  onSave?: (params: ProcessorMethodParam[]) => void
}) {
  const [draft, setDraft] = useState<ProcessorMethodParam[]>([])
  const [genericVisible, setGenericVisible] = useState(false)
  const [genericIndex, setGenericIndex] = useState(-1)
  const [genericNames, setGenericNames] = useState<string[]>([])
  const [genericTypeName, setGenericTypeName] = useState('')
  const [genericArgs, setGenericArgs] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setDraft(
      params.map((p) => ({
        ...p,
        typeExpr: {
          ...p.typeExpr,
          genericArgs: { ...(p.typeExpr.genericArgs ?? {}) },
        },
      })),
    )
  }, [open, params])

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

  function addParam() {
    setDraft((prev) => [
      ...prev,
      createEmptyProcessorMethodParam(`arg${prev.length + 1}`),
    ])
  }

  function updateParam(index: number, patch: Partial<ProcessorMethodParam>) {
    setDraft((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function removeParam(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index))
  }

  function handleTypeChange(index: number, payload: TypeSelectPayload) {
    const prev = draft[index]?.typeExpr
    const next = payloadToTypeExpr(payload, prev)
    updateParam(index, { typeExpr: next })
    if (genericNamesOf(leafNamedRef(next)).length) openGenerics(index, next)
  }

  function openGenerics(index: number, expr?: ProcessorTypeExpr) {
    const row = draft[index]
    const typeExpr = expr ?? row?.typeExpr
    if (!typeExpr) return
    const named = leafNamedRef(typeExpr)
    const names = genericNamesOf(named)
    if (!names.length) return
    setGenericIndex(index)
    setGenericNames(names)
    setGenericTypeName(typeDefById(named)?.name ?? '')
    setGenericArgs({ ...(typeExpr.genericArgs ?? {}) })
    setGenericVisible(true)
  }

  function saveGenerics(args: Record<string, string>) {
    if (genericIndex < 0) return
    const row = draft[genericIndex]
    if (!row) return
    updateParam(genericIndex, {
      typeExpr: { ...row.typeExpr, genericArgs: args },
    })
    setGenericIndex(-1)
  }

  function handleSave() {
    onSave?.(
      draft.map((p) => ({
        ...p,
        name: p.name.trim(),
        remark: p.remark.trim(),
        typeExpr: {
          ...p.typeExpr,
          genericArgs: p.typeExpr.genericArgs ?? {},
        },
      })),
    )
    onOpenChange?.(false)
  }

  return (
    <Modal
      open={open}
      title={methodName ? `入参 · ${methodName}` : '入参'}
      width={640}
      destroyOnHidden
      maskClosable={false}
      keyboard={false}
      onCancel={() => onOpenChange?.(false)}
      footer={
        <Button type="primary" onClick={handleSave}>
          确定
        </Button>
      }
    >
      <div className="params-head">
        <span className="hint">
          为方法添加入参；带泛型的类型可选「泛型」配置，未配按 any。
        </span>
        <Button type="link" icon={<PlusOutlined />} onClick={addParam}>
          添加
        </Button>
      </div>
      <Table
        dataSource={draft}
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
                onChange={(e) => updateParam(index, { name: e.target.value })}
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
                    type={(row.typeExpr.type || 'string') as DataFieldType}
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
                    onChange={(payload) => handleTypeChange(index, payload)}
                  />
                  {genericNamesOf(leafNamedRef(row.typeExpr)).length ? (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => openGenerics(index)}
                    >
                      泛型
                    </Button>
                  ) : null}
                </div>
                {genericNamesOf(leafNamedRef(row.typeExpr)).length ? (
                  <div className="generic-preview">
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
                onChange={(e) => updateParam(index, { remark: e.target.value })}
              />
            ),
          },
          {
            title: '操作',
            width: 72,
            align: 'center',
            render: (_, __, index) => (
              <Button type="link" danger size="small" onClick={() => removeParam(index)}>
                删除
              </Button>
            ),
          },
        ]}
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
    </Modal>
  )
}
