import { useSyncExternalStore } from 'react'

type PickCallback = (color: string) => void

let picking = false
let activeCallback: PickCallback | null = null
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function notify() {
  for (const fn of listeners) fn()
}

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

function setPicking(next: boolean) {
  picking = next
  notify()
}

export function useColorPick() {
  const isPicking = useSyncExternalStore(
    subscribe,
    () => picking,
  )

  async function startPick(callback: PickCallback) {
    if ('EyeDropper' in window) {
      try {
        const dropper = new (window as Window & {
          EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> }
        }).EyeDropper()
        const result = await dropper.open()
        callback(result.sRGBHex)
        return
      } catch {
        return
      }
    }

    setPicking(true)
    activeCallback = callback
  }

  function cancelPick() {
    setPicking(false)
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
    picking: isPicking,
    startPick,
    cancelPick,
    pickFromPoint,
  }
}

export const colorPickState = {
  get picking() {
    return picking
  },
  async startPick(callback: PickCallback) {
    if ('EyeDropper' in window) {
      try {
        const dropper = new (window as Window & {
          EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> }
        }).EyeDropper()
        const result = await dropper.open()
        callback(result.sRGBHex)
        return
      } catch {
        return
      }
    }
    setPicking(true)
    activeCallback = callback
  },
  cancelPick() {
    setPicking(false)
    activeCallback = null
  },
  pickFromPoint(clientX: number, clientY: number) {
    if (!activeCallback) return
    const elements = document.elementsFromPoint(clientX, clientY)
    for (const el of elements) {
      if (el.classList.contains('color-pick-ignore')) continue
      const color = readColorFromElement(el)
      if (color) {
        activeCallback(color)
        this.cancelPick()
        return
      }
    }
    this.cancelPick()
  },
}
