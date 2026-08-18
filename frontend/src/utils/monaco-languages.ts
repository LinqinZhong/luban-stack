import * as monaco from 'monaco-editor'

/** monaco 0.55 types stub `languages.typescript` / `json` as `{ deprecated: true }`. */
export const monacoTsLang = (
  monaco.languages as unknown as { typescript: MonacoTsLang }
).typescript

export const monacoJsonLang = (
  monaco.languages as unknown as { json: MonacoJsonLang }
).json

type MonacoTsLang = {
  typescriptDefaults: {
    addExtraLib: (
      content: string,
      filePath?: string,
    ) => { dispose: () => void }
    setCompilerOptions: (options: Record<string, unknown>) => void
    setDiagnosticsOptions: (options: Record<string, unknown>) => void
  }
  ScriptTarget: { ES2020: number }
  ModuleResolutionKind: { NodeJs: number }
  ModuleKind: { ESNext: number }
}

type MonacoJsonLang = {
  jsonDefaults: {
    diagnosticsOptions: {
      schemas?: Array<{ uri: string; fileMatch?: string[]; schema?: unknown }>
    }
    setDiagnosticsOptions: (options: Record<string, unknown>) => void
  }
}
