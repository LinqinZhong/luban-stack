import { useSyncExternalStore } from 'react'

/**
 * 预览数据池版本号。setData / updateProps 原地改 field.value 时递增，
 * 强制实例 $props / vShow 重算。
 */
let revision = 0
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function getSnapshot() {
  return revision
}

export function bumpPreviewDataRevision(): void {
  revision += 1
  for (const fn of listeners) fn()
}

export function resetPreviewDataRevision(): void {
  revision = 0
  for (const fn of listeners) fn()
}

export function getPreviewDataRevision(): number {
  return revision
}

export function usePreviewDataRevision(): number {
  return useSyncExternalStore(subscribe, getSnapshot)
}
