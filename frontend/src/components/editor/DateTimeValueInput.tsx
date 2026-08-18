import dayjs, { type Dayjs } from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { DatePicker, TimePicker } from 'antd'
import './DateTimeValueInput.css'

dayjs.extend(customParseFormat)

function antdSize(size?: 'small' | 'default' | 'large') {
  if (size === 'large') return 'large' as const
  if (size === 'small') return 'small' as const
  return 'middle' as const
}

function parseValue(text: string | null, format: string): Dayjs | null {
  if (!text) return null
  const parsed = dayjs(text, format, true)
  return parsed.isValid() ? parsed : null
}

export default function DateTimeValueInput({
  value,
  onChange,
  kind,
  size = 'default',
  placeholder,
  clearable = true,
}: {
  value?: string | number | null
  onChange?: (value: string) => void
  kind: 'time' | 'date' | 'datetime'
  size?: 'small' | 'default' | 'large'
  placeholder?: string
  clearable?: boolean
}) {
  const text =
    value == null || value === '' ? null : String(value)

  const valueFormat =
    kind === 'time'
      ? 'HH:mm:ss'
      : kind === 'date'
        ? 'YYYY-MM-DD'
        : 'YYYY-MM-DD HH:mm:ss'

  const hint =
    placeholder ||
    (kind === 'time' ? '选择时间' : kind === 'date' ? '选择日期' : '选择日期时间')

  function handleUpdate(next: string | null) {
    onChange?.(next == null ? '' : String(next))
  }

  const pickerValue = parseValue(text, valueFormat)
  const commonSize = antdSize(size)

  if (kind === 'time') {
    return (
      <TimePicker
        className="datetime-value-input"
        value={pickerValue}
        size={commonSize}
        allowClear={clearable}
        placeholder={hint}
        format="HH:mm:ss"
        style={{ width: '100%' }}
        onChange={(_d, dateString) => {
          const s = Array.isArray(dateString) ? dateString[0] : dateString
          handleUpdate(s ? String(s) : null)
        }}
      />
    )
  }

  return (
    <DatePicker
      className="datetime-value-input"
      value={pickerValue}
      showTime={kind === 'datetime'}
      size={commonSize}
      allowClear={clearable}
      placeholder={hint}
      format={valueFormat}
      style={{ width: '100%' }}
      onChange={(_d, dateString) => {
        const s = Array.isArray(dateString) ? dateString[0] : dateString
        handleUpdate(s ? String(s) : null)
      }}
    />
  )
}
