import { useEffect, useMemo, useState } from 'react'
import { Input, Select } from 'antd'
import type { DataField } from '../../types/page-data'
import type { ComponentPropDef } from '../../types/component'
import NumericInput from './NumericInput'
import {
  buildConditionFieldTree,
  composeFieldPath,
  pathNeedsArrayIndex,
  splitFieldPath,
  type FieldPathTreeNode,
} from '../../utils/data-field-paths'
import './DataFieldPathSelect.css'

export default function DataFieldPathSelect({
  value,
  onChange,
  fields,
  componentProps,
  routeParams,
  repeatListName,
}: {
  value: string
  onChange?: (value: string) => void
  fields?: DataField[]
  componentProps?: ComponentPropDef[] | null
  routeParams?: Record<string, unknown> | null
  repeatListName?: string | null
}) {
  const [treeSelected, setTreeSelected] = useState('')
  const [arrayIndex, setArrayIndex] = useState('')

  const treeData = useMemo(
    () =>
      buildConditionFieldTree(
        fields ?? [],
        repeatListName,
        componentProps,
        routeParams,
      ),
    [fields, repeatListName, componentProps, routeParams],
  )

  const flatOptions = useMemo(() => {
    const out: Array<{ value: string; label: string }> = []

    function walk(nodes: FieldPathTreeNode[], trail: string[]) {
      for (const node of nodes) {
        const nextTrail = [...trail, node.label]
        if (node.selectable && node.value) {
          out.push({
            value: node.value,
            label: nextTrail.join(' / '),
          })
        }
        if (node.children?.length) {
          walk(node.children, nextTrail)
        }
      }
    }

    walk(treeData, [])
    return out
  }, [treeData])

  const showIndexInput = pathNeedsArrayIndex(
    treeSelected,
    fields ?? [],
    repeatListName,
    componentProps,
    routeParams,
  )

  useEffect(() => {
    const { selected, arrayIndex: idx } = splitFieldPath(value || '')
    const exact = flatOptions.find((item) => item.value === (value || ''))
    if (exact) {
      setTreeSelected(exact.value)
      setArrayIndex('')
      return
    }
    setTreeSelected(selected)
    setArrayIndex(idx)
  }, [value, flatOptions])

  function emitPath(nextSelected: string, nextIndex: string, needsIndex: boolean) {
    const next = needsIndex
      ? composeFieldPath(nextSelected, nextIndex)
      : nextSelected.trim()
    onChange?.(next)
  }

  function onSelectChange(nextSelected: string) {
    const needsIndex = pathNeedsArrayIndex(
      nextSelected,
      fields ?? [],
      repeatListName,
      componentProps,
      routeParams,
    )
    let nextIndex = arrayIndex
    if (!needsIndex) {
      nextIndex = ''
      setArrayIndex('')
    } else if (!arrayIndex) {
      nextIndex = '0'
      setArrayIndex('0')
    }
    setTreeSelected(nextSelected)
    emitPath(nextSelected, nextIndex, needsIndex)
  }

  function onIndexChange(nextIndex: string) {
    setArrayIndex(nextIndex)
    emitPath(treeSelected, nextIndex, showIndexInput)
  }

  return (
    <div className="field-path-select">
      {flatOptions.length ? (
        <Select
          value={treeSelected || undefined}
          showSearch
          allowClear
          placeholder="选择字段"
          optionFilterProp="label"
          style={{ flex: 1, minWidth: 0 }}
          options={flatOptions}
          onChange={(next) => onSelectChange(next ?? '')}
        />
      ) : (
        <Input
          value={value}
          allowClear
          placeholder="输入字段，如 $props.id / $route.id"
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => onChange?.(e.target.value ?? '')}
        />
      )}
      {flatOptions.length > 0 && showIndexInput && (
        <div className="index-input">
          <NumericInput
            value={arrayIndex}
            placeholder="下标"
            min={0}
            max={9999}
            onChange={onIndexChange}
          />
        </div>
      )}
    </div>
  )
}
