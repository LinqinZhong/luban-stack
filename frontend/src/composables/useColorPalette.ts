import { useSyncExternalStore } from 'react'
import type { ColorPalette } from '../types/color-palette'
import { createEmptyColorPalette } from '../types/color-palette'

let palette: ColorPalette = createEmptyColorPalette()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot() {
  return palette
}

export function getColorPaletteState(): ColorPalette {
  return palette
}

export function setColorPaletteState(next: ColorPalette) {
  palette = next
  for (const fn of listeners) fn()
}

export function useColorPaletteState(): ColorPalette {
  return useSyncExternalStore(subscribe, getSnapshot)
}
