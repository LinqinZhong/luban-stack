import { useMemo, useState } from 'react'
import { Select } from 'antd'

function antdSize(size?: 'large' | 'default' | 'small') {
  if (size === 'large') return 'large' as const
  if (size === 'small') return 'small' as const
  return 'middle' as const
}

function optionLabel(opt: { id: string; label: string }) {
  if (!opt.label) return opt.id
  if (opt.id.startsWith('{')) return `${opt.label} · ${opt.id}`
  if (opt.label === opt.id) return opt.id
  return `${opt.label} (${opt.id})`
}

export default function IconValueSelect({
  value,
  onChange,
  options,
  placeholder,
  allowCreate,
  size = 'default',
}: {
  value: string
  onChange?: (value: string) => void
  options?: Array<{ id: string; label: string }>
  placeholder?: string
  allowCreate?: boolean
  size?: 'large' | 'default' | 'small'
}) {
  const [search, setSearch] = useState('')

  function handleChange(next: string) {
    onChange?.(next ?? '')
  }

  const selectOptions = useMemo(() => {
    const base = (options ?? []).map((opt) => ({
      value: opt.id,
      label: optionLabel(opt),
    }))
    if (allowCreate !== false && search && !base.some((o) => o.value === search)) {
      return [{ value: search, label: search }, ...base]
    }
    return base
  }, [options, search, allowCreate])

  return (
    <Select
      value={value || undefined}
      size={antdSize(size)}
      showSearch
      allowClear
      placeholder={placeholder || '选择图标'}
      style={{ width: '100%' }}
      options={selectOptions}
      filterOption={(input, option) =>
        String(option?.label ?? '')
          .toLowerCase()
          .includes(input.toLowerCase())
      }
      onSearch={setSearch}
      onChange={(next) => handleChange((next as string) ?? '')}
    />
  )
}
