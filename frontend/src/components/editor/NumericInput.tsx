import type { KeyboardEvent } from 'react'
import { Input } from 'antd'
import './NumericInput.css'

export default function NumericInput({
  value,
  onChange,
  placeholder = '数字或 {变量}',
}: {
  value: string | number
  onChange?: (value: string) => void
  min?: number
  max?: number
  step?: number
  placeholder?: string
}) {
  const innerValue =
    value === undefined || value === null ? '' : String(value)

  function handleChange(next: string) {
    onChange?.(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.stopPropagation()
    }
  }

  return (
    <Input
      className="numeric-input"
      value={innerValue}
      allowClear
      placeholder={placeholder}
      onChange={(e) => handleChange(e.target.value)}
      onKeyDown={handleKeyDown}
    />
  )
}
