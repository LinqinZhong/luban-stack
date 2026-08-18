import { createContext, type RefObject } from 'react'
import type { PreviewInspectPayload } from '../types/preview-inspect'

/** 组件检视操纵杆挂载层（在手机框外，避免被 overflow 裁切） */
export const InspectHostContext = createContext<RefObject<HTMLElement | null> | null>(
  null,
)
/** 手机框元素，用于计算「屏外」伸出长度 */
export const PhoneFrameContext = createContext<RefObject<HTMLElement | null> | null>(
  null,
)
/**
 * 打开组件检视（由 PageCanvas provide）。
 */
export const OpenInspectContext = createContext<
  ((payload: PreviewInspectPayload) => void) | null
>(null)

export type InspectCalloutSide = 'left' | 'right'

type InspectEntry = {
  id: string
  side: InspectCalloutSide
  /** 组件中线 Y（手机本地坐标） */
  preferredY: number
  /** 按钮直径（本地坐标） */
  btnSize: number
  /** 布局后按钮中心 Y */
  buttonY: number
}

const entries = new Map<string, InspectEntry>()
const listeners = new Set<() => void>()

const MIN_GAP = 12

function resolveLayout() {
  let changed = false
  for (const side of ['left', 'right'] as const) {
    const list = [...entries.values()]
      .filter((e) => e.side === side)
      .sort((a, b) => a.preferredY - b.preferredY)
    let lastBottom = -Infinity
    for (const e of list) {
      const half = e.btnSize / 2
      let y = e.preferredY
      const minY = lastBottom + MIN_GAP + half
      if (y < minY) y = minY
      if (Math.abs(e.buttonY - y) > 0.25) {
        e.buttonY = y
        changed = true
      } else {
        e.buttonY = y
      }
      lastBottom = y + half
    }
  }
  if (!changed) return
  for (const fn of listeners) fn()
}

/** 注册/更新检视锚点；返回布局后的按钮 Y */
export function upsertInspectCallout(input: {
  id: string
  side: InspectCalloutSide
  preferredY: number
  btnSize: number
}): number {
  const id = input.id.trim()
  if (!id) return input.preferredY
  const btnSize = Math.max(12, input.btnSize)
  const prev = entries.get(id)
  if (
    prev &&
    prev.side === input.side &&
    prev.btnSize === btnSize &&
    Math.abs(prev.preferredY - input.preferredY) < 1
  ) {
    return prev.buttonY
  }
  entries.set(id, {
    id,
    side: input.side,
    preferredY: input.preferredY,
    btnSize,
    buttonY: prev?.buttonY ?? input.preferredY,
  })
  resolveLayout()
  return entries.get(id)!.buttonY
}

export function removeInspectCallout(id: string) {
  const key = id.trim()
  if (!key || !entries.has(key)) return
  entries.delete(key)
  resolveLayout()
}

export function getInspectButtonY(id: string): number | null {
  return entries.get(id.trim())?.buttonY ?? null
}

export function subscribeInspectLayout(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
