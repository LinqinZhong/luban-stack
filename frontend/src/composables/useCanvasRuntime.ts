import { createContext } from 'react'
import type { DeviceInfo } from '../utils/device-info'

/** 画布运行时能力（场景相关的 getDeviceInfo 等） */
export interface CanvasRuntimeApi {
  getDeviceInfo: () => DeviceInfo
  /** 当前工程路径（组件 api 参数预览调用后端用） */
  projectPath?: string
}

export const CanvasRuntimeContext = createContext<CanvasRuntimeApi | null>(null)
