declare module 'miniprogram-ci' {
  export class Project {
    constructor(options: {
      appid: string
      type: 'miniProgram' | 'miniProgramPlugin' | 'miniGame' | 'miniGamePlugin'
      projectPath: string
      privateKeyPath: string
      ignores?: string[]
    })
  }

  export function upload(options: {
    project: Project
    version: string
    desc?: string
    setting?: Record<string, unknown>
    onProgressUpdate?: (task: unknown) => void
  }): Promise<unknown>

  export function preview(options: {
    project: Project
    desc?: string
    setting?: Record<string, unknown>
    qrcodeFormat?: 'image' | 'base64' | 'terminal'
    qrcodeOutputDest?: string
    onProgressUpdate?: (task: unknown) => void
  }): Promise<unknown>
}
