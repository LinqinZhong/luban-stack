import { useEffect, useMemo, useState } from 'react'
import { Button, ColorPicker as AntColorPicker, Input, Popover, Tooltip } from 'antd'
import { AimOutlined } from '@ant-design/icons'
import { colorPickState } from '../../composables/useColorPick'
import { useColorPaletteState } from '../../composables/useColorPalette'
import {
  findPaletteColor,
  type PaletteColor,
} from '../../types/color-palette'
import './ColorPicker.css'

const PRESET_COLORS = [
  { label: '透明', value: 'transparent' },
  { label: '白', value: '#ffffff' },
  { label: '黑', value: '#000000' },
] as const

const PREDEFINE = [
  'transparent',
  '#ffffff',
  '#000000',
  '#409eff',
  '#67c23a',
  '#e6a23c',
  '#f56c6c',
]

function normalizeColor(value: unknown): string {
  return String(value ?? '').trim()
}

function toPickerColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'transparent' || /\{[^{}]+\}/.test(trimmed)) {
    return 'rgba(255, 255, 255, 0)'
  }
  if (/^rgba?\(/i.test(trimmed) || /^hsla?\(/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) return hex8ToRgba(trimmed)
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return '#ffffff'
}

function hex8ToRgba(hex: string): string {
  const h = hex.slice(1)
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const a = parseInt(h.slice(6, 8), 16) / 255
  const alpha = Math.round(a * 1000) / 1000
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function formatOutgoingColor(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'transparent'

  const rgba = parseRgba(trimmed)
  if (rgba) {
    if (rgba.a <= 0.005) return 'transparent'
    if (rgba.a >= 0.995) {
      return `#${toHex(rgba.r)}${toHex(rgba.g)}${toHex(rgba.b)}`
    }
    const a = Math.round(rgba.a * 1000) / 1000
    return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${a})`
  }

  if (/^#[0-9a-f]{8}$/i.test(trimmed)) {
    return formatOutgoingColor(hex8ToRgba(trimmed))
  }
  if (/^#[0-9a-f]{3,6}$/i.test(trimmed)) return trimmed.toLowerCase()
  return trimmed
}

function parseRgba(
  value: string,
): { r: number; g: number; b: number; a: number } | null {
  const m = value
    .trim()
    .match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i,
    )
  if (!m) return null
  return {
    r: clampByte(Number(m[1])),
    g: clampByte(Number(m[2])),
    b: clampByte(Number(m[3])),
    a: m[4] == null ? 1 : Math.min(1, Math.max(0, Number(m[4]))),
  }
}

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(255, Math.max(0, Math.round(n)))
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, '0')
}

export default function ColorPicker({
  value,
  onChange,
  placeholder,
  hidePalette = false,
  compact = false,
}: {
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  hidePalette?: boolean
  compact?: boolean
}) {
  const colorPalette = useColorPaletteState()
  const [popoverVisible, setPopoverVisible] = useState(false)
  const [localValue, setLocalValue] = useState(() => normalizeColor(value))

  useEffect(() => {
    setLocalValue(normalizeColor(value))
  }, [value])

  const paletteColors = hidePalette ? [] : colorPalette.colors

  const isBinding = /\{[^{}]+\}/.test(localValue.trim())

  const activePaletteColor = findPaletteColor(
    { colors: paletteColors },
    localValue.trim(),
  )

  const isPaletteKey = Boolean(activePaletteColor)

  const pickerModel = useMemo(() => {
    if (activePaletteColor) {
      return toPickerColor(activePaletteColor.value)
    }
    return toPickerColor(localValue)
  }, [activePaletteColor, localValue])

  function commit(nextValue: string) {
    const next = normalizeColor(nextValue)
    setLocalValue(next)
    onChange?.(next)
  }

  function handleTextChange() {
    commit(localValue)
  }

  function applyPreset(presetValue: string) {
    commit(presetValue)
  }

  function applyPalette(color: PaletteColor) {
    commit(color.name)
  }

  function handleEyedropper() {
    void colorPickState.startPick((color) => {
      commit(color)
    })
  }

  function isPresetActive(presetValue: string): boolean {
    const cur = localValue.trim().toLowerCase()
    if (presetValue === 'transparent') return !cur || cur === 'transparent'
    return cur === presetValue.toLowerCase()
  }

  function isPaletteActive(name: string): boolean {
    return localValue.trim() === name
  }

  function paletteTitle(color: PaletteColor): string {
    const desc = color.description?.trim()
    return desc ? `${color.name} · ${desc}` : color.name
  }

  const swatchCss = (() => {
    if (activePaletteColor) {
      const v = activePaletteColor.value.trim()
      if (!v || v === 'transparent') return undefined
      return v
    }
    const cur = localValue.trim()
    if (!cur || cur === 'transparent' || isBinding) return undefined
    return toPickerColor(cur)
  })()

  const isTransparentSwatch = (() => {
    if (activePaletteColor) {
      const v = activePaletteColor.value.trim()
      return !v || v === 'transparent'
    }
    const cur = localValue.trim()
    return !cur || cur === 'transparent'
  })()

  const displayLabel = (() => {
    const cur = localValue.trim()
    if (!cur) return placeholder || '选择颜色'
    return cur
  })()

  const pickerBody = (
    <div className="color-picker">
      <div className="color-picker-row">
        <AntColorPicker
          className="ep-picker"
          size="small"
          disabled={isBinding || isPaletteKey}
          value={pickerModel}
          presets={[{ label: '预置', colors: [...PREDEFINE] }]}
          onChange={(color) => {
            const next = color.toRgbString()
            if (!next) {
              commit('transparent')
              return
            }
            commit(formatOutgoingColor(next))
          }}
        />
        <Input
          className="hex-input"
          size="small"
          value={localValue}
          allowClear
          placeholder={placeholder || '#ffffff / transparent / rgba() / key'}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleTextChange}
          onPressEnter={handleTextChange}
        />
        <Tooltip title="吸管取色" placement="top">
          <Button
            className="eyedropper-btn"
            size="small"
            icon={<AimOutlined />}
            disabled={isBinding}
            onClick={handleEyedropper}
          />
        </Tooltip>
      </div>
      {paletteColors.length > 0 && (
        <div className="preset-row" role="list" aria-label="调色板">
          {paletteColors.map((item) => (
            <button
              key={item.name}
              type="button"
              className={`preset-chip palette-chip${isPaletteActive(item.name) ? ' active' : ''}`}
              title={paletteTitle(item)}
              role="listitem"
              onClick={() => applyPalette(item)}
            >
              <span
                className={`preset-swatch${item.value === 'transparent' ? ' checker' : ''}`}
                style={
                  item.value === 'transparent'
                    ? undefined
                    : { background: item.value }
                }
              />
              <span className="preset-label">{item.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="preset-row" role="list" aria-label="参考颜色">
        {PRESET_COLORS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={`preset-chip${isPresetActive(item.value) ? ' active' : ''}`}
            title={item.label}
            role="listitem"
            onClick={() => applyPreset(item.value)}
          >
            <span
              className={`preset-swatch${item.value === 'transparent' ? ' checker' : ''}`}
              style={
                item.value === 'transparent'
                  ? undefined
                  : { background: item.value }
              }
            />
            <span className="preset-label">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )

  if (compact) {
    return (
      <Popover
        open={isBinding ? false : popoverVisible}
        onOpenChange={(next) => {
          if (isBinding) return
          setPopoverVisible(next)
        }}
        placement="bottomLeft"
        trigger="click"
        overlayClassName="color-picker-compact-popper"
        overlayInnerStyle={{ width: 320 }}
        content={pickerBody}
      >
        <button type="button" className="color-compact-trigger" title={displayLabel}>
          <span
            className={`compact-swatch${isTransparentSwatch ? ' checker' : ''}`}
            style={swatchCss ? { background: swatchCss } : undefined}
          />
          <span className="compact-label">{displayLabel}</span>
        </button>
      </Popover>
    )
  }

  return pickerBody
}
