import { ref, type Ref } from 'vue'
import type { ColorPalette } from '../types/color-palette'
import { createEmptyColorPalette } from '../types/color-palette'

/** 项目调色板：WorkspaceView 写入；ColorPicker / 画布读取（含 teleport 弹层） */
export const colorPaletteState: Ref<ColorPalette> = ref(createEmptyColorPalette())

export function setColorPaletteState(palette: ColorPalette) {
  colorPaletteState.value = palette
}
