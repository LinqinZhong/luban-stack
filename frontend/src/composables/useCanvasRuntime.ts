import type { InjectionKey } from 'vue'
import type { DeviceInfo } from '../utils/device-info'

/** 画布运行时能力（场景相关的 getDeviceInfo 等） */
export interface CanvasRuntimeApi {
  getDeviceInfo: () => DeviceInfo
}

export const CANVAS_RUNTIME_KEY: InjectionKey<CanvasRuntimeApi> = Symbol(
  'voiderCanvasRuntime',
)
