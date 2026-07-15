import type { ComponentEventDef } from '../types/component'

/**
 * 创建组件方法体内的 emit：
 * emit(事件名, ...该事件定义的参数) → 按参数名打包后回调父级。
 */
export function createComponentEmit(
  events: ComponentEventDef[],
  onEmit: (eventName: string, args: Record<string, unknown>) => void,
): (event: string, ...args: unknown[]) => void {
  const map = new Map(
    events
      .filter((item) => item.name.trim())
      .map((item) => [item.name.trim(), item.params ?? []] as const),
  )

  return (event: string, ...args: unknown[]) => {
    const name = String(event ?? '').trim()
    if (!name) return
    const params = map.get(name)
    const packed: Record<string, unknown> = {}
    if (params?.length) {
      params.forEach((param, index) => {
        const key = param.name.trim()
        if (key) packed[key] = args[index]
      })
    } else {
      args.forEach((value, index) => {
        packed[`arg${index}`] = value
      })
    }
    onEmit(name, packed)
  }
}
