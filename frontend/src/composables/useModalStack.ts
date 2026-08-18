import {
  createContext,
  useMemo,
  useSyncExternalStore,
  type RefObject,
} from 'react'

export interface ModalStackApi {
  readonly stack: string[]
  readonly top: string | null
  open: (name: string) => void
  /** 无参：关闭栈顶；有 name：弹出到该层（含自身） */
  close: (name?: string) => void
  closeAll: () => void
  isTop: (name: string) => boolean
  subscribe: (fn: () => void) => () => void
}

export const ModalStackContext = createContext<ModalStackApi | null>(null)
export const ModalHostContext = createContext<RefObject<HTMLElement | null> | null>(
  null,
)
export const BadgeHostContext = createContext<RefObject<HTMLElement | null> | null>(
  null,
)

/** 编辑态测量模式：select 普通选中；measure 显示间距与尺寸 */
export type CanvasToolMode = 'select' | 'measure'
export const CanvasToolModeContext = createContext<CanvasToolMode>('select')

/** 预览检视：纯净模式不显示组件操纵杆；组件模式显示 */
export type PreviewInspectMode = 'clean' | 'component'
export const PreviewInspectModeContext = createContext<PreviewInspectMode>('clean')

/** 预览检视：按 Component 节点 id 覆盖实例入参 */
export const PreviewInstancePropOverridesContext = createContext<
  Record<string, Record<string, unknown>>
>({})

/**
 * 页面级 Modal 堆栈：同一时刻仅栈顶可见；
 * open 会将同名项移到栈顶（其余层暂隐，关闭时可恢复）。
 */
export function createModalStack(): ModalStackApi {
  let stack: string[] = []
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const fn of listeners) fn()
  }

  const api: ModalStackApi = {
    get stack() {
      return stack
    },
    get top() {
      return stack.length ? stack[stack.length - 1]! : null
    },
    open(name: string) {
      const id = String(name ?? '').trim()
      if (!id) return
      stack = [...stack.filter((item) => item !== id), id]
      notify()
    },
    close(name?: string) {
      const id = name == null ? '' : String(name).trim()
      if (!id) {
        if (stack.length) {
          stack = stack.slice(0, -1)
          notify()
        }
        return
      }
      const idx = stack.lastIndexOf(id)
      if (idx < 0) return
      stack = stack.slice(0, idx)
      notify()
    },
    closeAll() {
      stack = []
      notify()
    },
    isTop(name: string) {
      const id = String(name ?? '').trim()
      return Boolean(id) && api.top === id
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }

  return api
}

export function useModalStackSnapshot(api: ModalStackApi | null) {
  return useSyncExternalStore(
    api?.subscribe ?? (() => () => {}),
    () => api?.stack ?? EMPTY_STACK,
  )
}

const EMPTY_STACK: string[] = []

export function useModalStackFactory() {
  return useMemo(() => createModalStack(), [])
}
