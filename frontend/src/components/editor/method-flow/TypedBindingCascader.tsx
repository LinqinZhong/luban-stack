import { useMemo } from 'react'
import { Cascader } from 'antd'
import type { ProcessorTypeExpr } from '../../../types/backend-services'
import type { DataTypeLibrary } from '../../../types/data-types'
import type { MethodParam } from '../../../types/page-method'
import {
  buildTypedBindingCascaderOptions,
  isSelectableBindingPath,
  joinBindingPath,
  splitBindingPath,
  toElCascaderOptions,
  type BindingCompatibilityMode,
  type TypedBindingCascaderOption,
} from '../../../utils/typed-binding-paths'
import './TypedBindingCascader.css'

export default function TypedBindingCascader({
  value,
  onChange,
  ambientVars,
  targetType,
  typeLibrary,
  placeholder,
  extraRoots,
  compatibility = 'strict',
  className,
}: {
  value: string
  onChange?: (value: string) => void
  ambientVars: MethodParam[]
  targetType: ProcessorTypeExpr | null | undefined
  typeLibrary?: DataTypeLibrary | null
  placeholder?: string
  extraRoots?: TypedBindingCascaderOption[]
  compatibility?: BindingCompatibilityMode
  className?: string
}) {
  const rawOptions = useMemo(
    () =>
      buildTypedBindingCascaderOptions(
        ambientVars,
        targetType,
        typeLibrary,
        extraRoots,
        compatibility,
      ),
    [ambientVars, targetType, typeLibrary, extraRoots, compatibility],
  )

  const options = useMemo(() => toElCascaderOptions(rawOptions), [rawOptions])

  const pathValue = useMemo((): string[] => {
    const segments = splitBindingPath(value || '')
    if (!segments.length) return []
    if (!findInTree(rawOptions, segments)) {
      return segments.length === 1 ? segments : [value]
    }
    return segments
  }, [rawOptions, value])

  function findInTree(
    nodes: ReturnType<typeof buildTypedBindingCascaderOptions>,
    segments: string[],
  ): boolean {
    let list = nodes
    for (const seg of segments) {
      const hit = list.find((n) => n.value === seg)
      if (!hit) return false
      list = hit.children ?? []
    }
    return true
  }

  function normalizePathValue(
    val: (string | number)[] | string | null | undefined,
  ): string[] {
    if (val == null || val === '') return []
    if (Array.isArray(val)) return val.map(String).filter(Boolean)
    if (typeof val === 'string') return splitBindingPath(val)
    return []
  }

  function onPathChange(val: (string | number)[] | undefined) {
    const segments = normalizePathValue(val)
    if (!segments.length) {
      onChange?.('')
      return
    }
    if (!isSelectableBindingPath(rawOptions, segments)) {
      return
    }
    onChange?.(joinBindingPath(segments))
  }

  return (
    <div className="typed-binding-wrap">
      <Cascader
        value={pathValue}
        options={options}
        changeOnSelect
        expandTrigger="hover"
        showSearch
        allowClear
        placeholder={placeholder || '选择类型匹配的变量或字段'}
        className={`typed-binding-cascader${className ? ` ${className}` : ''}`}
        onChange={(val) => onPathChange(val as (string | number)[] | undefined)}
      />
      {!options.length ? (
        <p className="empty-hint">暂无类型匹配的可选变量</p>
      ) : null}
    </div>
  )
}
