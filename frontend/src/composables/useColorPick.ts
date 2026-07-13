import { ref } from 'vue'

type PickCallback = (color: string) => void

const picking = ref(false)
let activeCallback: PickCallback | null = null

function rgbToHex(color: string): string | null {
  const trimmed = color.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const [, r, g, b] = trimmed
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
    }
    return trimmed.toLowerCase()
  }

  const match = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!match) return null

  const hex = [match[1], match[2], match[3]]
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

function readColorFromElement(el: Element): string | null {
  const style = getComputedStyle(el)
  const bg = style.backgroundColor
  if (bg && bg !== 'transparent' && !bg.endsWith(', 0)')) {
    return rgbToHex(bg)
  }
  const color = style.color
  if (color) return rgbToHex(color)
  return null
}

export function useColorPick() {
  async function startPick(callback: PickCallback) {
    if ('EyeDropper' in window) {
      try {
        const dropper = new (window as Window & { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper()
        const result = await dropper.open()
        callback(result.sRGBHex)
        return
      } catch {
        return
      }
    }

    picking.value = true
    activeCallback = callback
  }

  function cancelPick() {
    picking.value = false
    activeCallback = null
  }

  function pickFromPoint(clientX: number, clientY: number) {
    if (!activeCallback) return

    const elements = document.elementsFromPoint(clientX, clientY)
    for (const el of elements) {
      if (el.classList.contains('color-pick-ignore')) continue
      const color = readColorFromElement(el)
      if (color) {
        activeCallback(color)
        cancelPick()
        return
      }
    }
    cancelPick()
  }

  return {
    picking,
    startPick,
    cancelPick,
    pickFromPoint,
  }
}

export const colorPickState = useColorPick()
