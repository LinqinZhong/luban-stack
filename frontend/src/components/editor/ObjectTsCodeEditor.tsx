import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import * as monaco from 'monaco-editor'
import type { ArraySubField, ObjectSubField } from '../../types/page-data'
import type { DataTypeLibrary } from '../../types/data-types'
import { getColorPaletteState } from '../../composables/useColorPalette'
import {
  SPECIAL_WRAPPERS,
  autofillEmptyNamedArrayItems,
  autofillEmptyNamedInterfaces,
  arrayTsEditableLineBounds,
  arrayTsReadonlyLineRanges,
  arrayTsStructureIntact,
  collectNamedTypeEntries,
  composeArrayTsCode,
  composeNamedInterfaceSnippet,
  composeObjectTsCode,
  diagnoseArrayTsCode,
  diagnoseObjectTsCode,
  enumMemberOptions,
  extractArrayTsValueLiteral,
  extractObjectTsValueLiteral,
  findNamedTypeAtOffset,
  formatNamedTypeDefinitionSource,
  getArrayTsCodeError,
  getObjectTsCodeError,
  objectTsEditableLineBounds,
  objectTsReadonlyLineRanges,
  objectTsStructureIntact,
  parseArrayTsCode,
  parseObjectLiteral,
} from '../../utils/object-ts-code'
import './ObjectTsCodeEditor.css'

const VALUE_HINT_WRAPPERS = ['Color', 'Icon'] as const
type ValueHintWrapper = (typeof VALUE_HINT_WRAPPERS)[number]

const COLOR_PRESET_OPTIONS = [
  { label: 'transparent', value: 'transparent', detail: '透明' },
  { label: '#ffffff', value: '#ffffff', detail: '白' },
  { label: '#000000', value: '#000000', detail: '黑' },
] as const

export type ObjectTsCodeEditorHandle = { getFullCode: () => string }

type ObjectTsCodeEditorProps = {
  value: string
  onChange?: (value: string) => void
  onErrorChange?: (error: string | null) => void
  kind?: 'object' | 'array'
  fields?: ObjectSubField[]
  arrayFields?: ArraySubField[]
  constName?: string | null
  itemTypeRef?: string | null
  readonly?: boolean
  typesLocked?: boolean
  typeLibrary?: DataTypeLibrary | null
  minHeight?: number
  iconOptions?: Array<{ id: string; label: string }>
}

export default forwardRef<ObjectTsCodeEditorHandle, ObjectTsCodeEditorProps>(
  function ObjectTsCodeEditor(p, ref) {
    const hostRef = useRef<HTMLDivElement | null>(null)
    const propsRef = useRef(p)
    propsRef.current = p
    const onChangeRef = useRef(p.onChange)
    onChangeRef.current = p.onChange
    const onErrorChangeRef = useRef(p.onErrorChange)
    onErrorChangeRef.current = p.onErrorChange
    const apiRef = useRef<{
      getFullCode: () => string
      onExternalValue: (value: string) => void
      onReadonlyChange: (readonly: boolean) => void
    } | null>(null)

    useImperativeHandle(ref, () => ({
      getFullCode: () =>
        apiRef.current?.getFullCode() ?? propsRef.current.value ?? '',
    }))

    useEffect(() => {
      const LANG_ID = 'voider-object-static'

      const props = {
        get modelValue() {
          return propsRef.current.value
        },
        get kind() {
          return propsRef.current.kind ?? 'object'
        },
        get fields() {
          return propsRef.current.fields ?? []
        },
        get arrayFields() {
          return propsRef.current.arrayFields ?? []
        },
        get constName() {
          return propsRef.current.constName ?? 'value'
        },
        get itemTypeRef() {
          return propsRef.current.itemTypeRef ?? null
        },
        get readonly() {
          return Boolean(propsRef.current.readonly)
        },
        get typesLocked() {
          return Boolean(propsRef.current.typesLocked)
        },
        get typeLibrary() {
          return propsRef.current.typeLibrary ?? null
        },
        get minHeight() {
          return propsRef.current.minHeight ?? 360
        },
        get iconOptions() {
          return propsRef.current.iconOptions ?? []
        },
      }
      function emit(
        event: 'update:modelValue' | 'update:error',
        value: string | null,
      ) {
        if (event === 'update:modelValue') onChangeRef.current?.(value as string)
        else onErrorChangeRef.current?.(value)
      }

      let editor: monaco.editor.IStandaloneCodeEditor | null = null
      let model: monaco.editor.ITextModel | null = null
      let completionDisposable: monaco.IDisposable | null = null
      let codeActionDisposable: monaco.IDisposable | null = null
      let hoverDisposable: monaco.IDisposable | null = null
      let tokensDisposable: monaco.IDisposable | null = null
      let syncing = false
      let lastValidFull = ''
      let shellDecorations: string[] = []
      let restoreTimer: ReturnType<typeof setTimeout> | null = null
      let activeModelUri = ''
      let langReady = false
      let lastEmittedError: string | null | undefined = undefined
      
      const isArrayKind = () => props.kind === 'array'
      
      function tsCodeOptions() {
        return {
          typeLibrary: props.typeLibrary,
          constName: props.constName,
        }
      }
      
      function arrayTsOptions() {
        return {
          typeLibrary: props.typeLibrary,
          constName: props.constName,
          itemTypeRef: props.itemTypeRef ?? undefined,
        }
      }
      
      function diagnoseCode(full: string) {
        return isArrayKind()
          ? diagnoseArrayTsCode(full, arrayTsOptions())
          : diagnoseObjectTsCode(full, tsCodeOptions())
      }
      
      function getCodeError(full: string): string | null {
        return isArrayKind()
          ? getArrayTsCodeError(full, arrayTsOptions())
          : getObjectTsCodeError(full, tsCodeOptions())
      }
      
      function structureIntact(full: string): boolean {
        return isArrayKind()
          ? arrayTsStructureIntact(full, props.constName)
          : objectTsStructureIntact(full, props.constName)
      }
      
      function readonlyLineRanges(full: string) {
        return isArrayKind()
          ? arrayTsReadonlyLineRanges(full, props.typesLocked)
          : objectTsReadonlyLineRanges(full, props.typesLocked)
      }
      
      function editableLineBounds(full: string) {
        return isArrayKind()
          ? arrayTsEditableLineBounds(full, props.typesLocked)
          : objectTsEditableLineBounds(full, props.typesLocked)
      }
      
      function composeShellCode(value?: Record<string, unknown>): string {
        if (isArrayKind()) {
          return composeArrayTsCode(props.arrayFields ?? [], props.constName, {
            typeLibrary: props.typeLibrary,
            itemTypeRef: props.itemTypeRef ?? undefined,
          })
        }
        return composeObjectTsCode(props.fields ?? [], value ?? {}, props.constName, {
          typeLibrary: props.typeLibrary,
        })
      }
      
      function autofillNamed(full: string): string {
        return isArrayKind()
          ? autofillEmptyNamedArrayItems(full, props.typeLibrary)
          : autofillEmptyNamedInterfaces(full, props.typeLibrary)
      }
      
      function completionNamedEntries() {
        const entries = collectNamedTypeEntries(props.typeLibrary)
        if (!isArrayKind() || !props.typesLocked || !props.itemTypeRef?.trim()) {
          return entries
        }
        const locked = entries.find((e) => e.typeRef === props.itemTypeRef!.trim())
        return locked ? [locked] : entries
      }
      
      function emitError(error: string | null) {
        if (lastEmittedError === error) return
        lastEmittedError = error
        emit('update:error', error)
      }
      
      function applyValidationMarkers(full: string) {
        if (!model) return
        const diagnostics = diagnoseCode(full)
        const error = diagnostics[0]?.message ?? null
        emitError(error)
        const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => {
          const start = model!.getPositionAt(
            Math.max(0, Math.min(d.start, full.length)),
          )
          const end = model!.getPositionAt(
            Math.max(0, Math.min(Math.max(d.end, d.start + 1), full.length)),
          )
          return {
            severity: monaco.MarkerSeverity.Error,
            message: d.message,
            code: d.code,
            source: 'voider',
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          }
        })
        monaco.editor.setModelMarkers(model, 'voider-object-static', markers)
        if (!error && structureIntact(full)) {
          lastValidFull = full
        }
        return error
      }
      
      const WRAPPER_DOCS: Record<string, string> = {
        Color: '颜色：调色板色名或色值，如 Color("primary") / Color("#ff0000")',
        Time: '时间 HH:mm:ss，如 Time("12:00:00")',
        Date: '日期，如 Date("2022-01-01")',
        Datetime: '日期时间，如 Datetime("2022-01-01 12:00:00")',
        Icon: '图标：项目图标库 id，如 Icon("message")',
        Resource: '互联网资源，如 Resource("https://...")',
      }
      
      function ensureLanguage() {
        if (langReady) return
        langReady = true
        monaco.languages.register({ id: LANG_ID })
        tokensDisposable = monaco.languages.setMonarchTokensProvider(LANG_ID, {
          keywords: ['const', 'true', 'false', 'null'],
          wrappers: [...SPECIAL_WRAPPERS],
          tokenizer: {
            root: [
              [/\/\/.*$/, 'comment'],
              [/\/\*/, 'comment', '@comment'],
              [/"([^"\\]|\\.)*$/, 'string.invalid'],
              [/'([^'\\]|\\.)*$/, 'string.invalid'],
              [/"/, 'string', '@string_double'],
              [/'/, 'string', '@string_single'],
              [/\d+(\.\d+)?/, 'number'],
              [/@[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*/, 'type.identifier'],
              [
                /[a-zA-Z_$][\w$]*/,
                {
                  cases: {
                    '@keywords': 'keyword',
                    '@wrappers': 'type.identifier',
                    '@default': 'identifier',
                  },
                },
              ],
              [/[{}()\[\]]/, '@brackets'],
              [/[,:]/, 'delimiter'],
              [/[ \t\r\n]+/, 'white'],
            ],
            comment: [
              [/[^\/*]+/, 'comment'],
              [/\*\//, 'comment', '@pop'],
              [/[\/*]/, 'comment'],
            ],
            string_double: [
              [/[^\\"]+/, 'string'],
              [/\\./, 'string.escape'],
              [/"/, 'string', '@pop'],
            ],
            string_single: [
              [/[^\\']+/, 'string'],
              [/\\./, 'string.escape'],
              [/'/, 'string', '@pop'],
            ],
          },
        })
      }
      
      /** 光标是否在对象「值」位置（冒号之后）；写字段名时不提示 */
      function isTypingObjectValue(
        textModel: monaco.editor.ITextModel,
        position: monaco.Position,
      ): boolean {
        const line = textModel.getLineContent(position.lineNumber)
        const before = line.slice(0, Math.max(0, position.column - 1))
        // 去掉已闭合的字符串，避免冒号落在字符串里误判
        let stripped = ''
        let i = 0
        while (i < before.length) {
          const ch = before[i]!
          if (ch === '"' || ch === "'") {
            const quote = ch
            i += 1
            while (i < before.length) {
              if (before[i] === '\\') {
                i += 2
                continue
              }
              if (before[i] === quote) {
                i += 1
                break
              }
              i += 1
            }
            stripped += '""'
            continue
          }
          stripped += ch
          i += 1
        }
        // 未闭合引号 → 在字符串里，不当作包装器补全
        if ((stripped.match(/"/g) || []).length % 2 === 1) return false
      
        let lastColon = -1
        let lastKeySep = -1
        for (let j = 0; j < stripped.length; j++) {
          const ch = stripped[j]!
          if (ch === ':') lastColon = j
          if (ch === ',' || ch === '{' || ch === '[') lastKeySep = j
        }
        return lastColon > lastKeySep
      }
      
      /** 数组模式下，光标是否在顶层元素起始位置（`[` 或 `,` 之后） */
      function isTypingArrayElementValue(
        textModel: monaco.editor.ITextModel,
        position: monaco.Position,
      ): boolean {
        const line = textModel.getLineContent(position.lineNumber)
        const before = line.slice(0, Math.max(0, position.column - 1)).replace(/\s+$/, '')
        if (!before.length) return false
        const last = before[before.length - 1]!
        return last === '[' || last === ','
      }
      
      function shouldOfferValueCompletions(
        textModel: monaco.editor.ITextModel,
        position: monaco.Position,
      ): boolean {
        if (isTypingObjectValue(textModel, position)) return true
        return isArrayKind() && isTypingArrayElementValue(textModel, position)
      }
      
      function skipStringLiteral(src: string, from: number): number {
        const quote = src[from]
        if (quote !== '"' && quote !== "'") return from
        let i = from + 1
        while (i < src.length) {
          if (src[i] === '\\') {
            i += 2
            continue
          }
          if (src[i] === quote) return i + 1
          i += 1
        }
        return src.length
      }
      
      function isInUnclosedString(
        full: string,
        argStart: number,
        offset: number,
      ): boolean {
        let j = argStart
        while (j < offset) {
          const ch = full[j]!
          if (ch === '"' || ch === "'") {
            const next = skipStringLiteral(full, j)
            if (next > offset) return true
            j = next
            continue
          }
          j += 1
        }
        return false
      }
      
      /**
       * 光标是否落在 `@group.EnumName( ... )` 实参区内（枚举参数应为字符串成员名）。
       */
      function findEnumArgContext(
        textModel: monaco.editor.ITextModel,
        position: monaco.Position,
      ): {
        path: string
        typeRef: string
        members: Array<{ label: string; value: string }>
        /** 实参区起点（开括号后） */
        argStartOffset: number
        /** 是否已在字符串字面量内 */
        inString: boolean
      } | null {
        const offset = textModel.getOffsetAt(position)
        const full = textModel.getValue()
        const before = full.slice(0, offset)
      
        type OpenCall = { path: string; argStart: number }
        const stack: OpenCall[] = []
        let i = 0
        while (i < before.length) {
          const ch = before[i]!
          if (ch === '"' || ch === "'") {
            i = skipStringLiteral(before, i)
            continue
          }
          if (ch === '@' && /[A-Za-z_$]/.test(before[i + 1] ?? '')) {
            const scanned = before.slice(i).match(/^@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/)
            if (scanned) {
              const path = scanned[1]!
              const argStart = i + scanned[0].length
              stack.push({ path, argStart })
              i = argStart
              continue
            }
          }
          if (ch === '(') {
            stack.push({ path: '', argStart: i + 1 })
            i += 1
            continue
          }
          if (ch === ')') {
            stack.pop()
            i += 1
            continue
          }
          i += 1
        }
      
        for (let s = stack.length - 1; s >= 0; s--) {
          const call = stack[s]!
          if (!call.path) continue
          const entry = collectNamedTypeEntries(props.typeLibrary).find(
            (e) => e.path === call.path && e.kind === 'enum',
          )
          if (!entry) continue
          const members = enumMemberOptions(entry.typeRef, props.typeLibrary)
          if (!members.length) continue
      
          return {
            path: call.path,
            typeRef: entry.typeRef,
            members,
            argStartOffset: call.argStart,
            inString: isInUnclosedString(full, call.argStart, offset),
          }
        }
        return null
      }
      
      function wrapperValueOptions(
        name: ValueHintWrapper,
      ): Array<{ label: string; value: string; detail?: string }> {
        if (name === 'Icon') {
          return (props.iconOptions ?? []).map((item) => ({
            label: item.id,
            value: item.id,
            detail: item.label && item.label !== item.id ? item.label : '图标',
          }))
        }
        const seen = new Set<string>()
        const options: Array<{ label: string; value: string; detail?: string }> = []
        for (const color of getColorPaletteState().colors) {
          const key = color.name.trim()
          if (!key || seen.has(key)) continue
          seen.add(key)
          options.push({
            label: key,
            value: key,
            detail: color.value || color.description || '调色板',
          })
        }
        for (const preset of COLOR_PRESET_OPTIONS) {
          if (seen.has(preset.value)) continue
          seen.add(preset.value)
          options.push({ ...preset })
        }
        return options
      }
      
      /**
       * 光标是否落在 `Color(...)` / `Icon(...)` 实参区内。
       */
      function findSpecialWrapperArgContext(
        textModel: monaco.editor.ITextModel,
        position: monaco.Position,
      ): {
        name: ValueHintWrapper
        options: Array<{ label: string; value: string; detail?: string }>
        argStartOffset: number
        inString: boolean
      } | null {
        const offset = textModel.getOffsetAt(position)
        const full = textModel.getValue()
        const before = full.slice(0, offset)
        const wrapperRe = new RegExp(
          `^(${VALUE_HINT_WRAPPERS.join('|')})\\s*\\(`,
        )
      
        type OpenCall = { name: string; argStart: number }
        const stack: OpenCall[] = []
        let i = 0
        while (i < before.length) {
          const ch = before[i]!
          if (ch === '"' || ch === "'") {
            i = skipStringLiteral(before, i)
            continue
          }
          const prev = before[i - 1]
          if (
            /[A-Za-z_$]/.test(ch) &&
            (i === 0 || (prev !== undefined && !/[\w$]/.test(prev)))
          ) {
            const scanned = before.slice(i).match(wrapperRe)
            if (scanned) {
              const name = scanned[1]!
              const argStart = i + scanned[0].length
              stack.push({ name, argStart })
              i = argStart
              continue
            }
          }
          if (ch === '(') {
            stack.push({ name: '', argStart: i + 1 })
            i += 1
            continue
          }
          if (ch === ')') {
            stack.pop()
            i += 1
            continue
          }
          i += 1
        }
      
        for (let s = stack.length - 1; s >= 0; s--) {
          const call = stack[s]!
          if (!(VALUE_HINT_WRAPPERS as readonly string[]).includes(call.name)) continue
          const name = call.name as ValueHintWrapper
          const options = wrapperValueOptions(name)
          if (!options.length) continue
          return {
            name,
            options,
            argStartOffset: call.argStart,
            inString: isInUnclosedString(full, call.argStart, offset),
          }
        }
        return null
      }
      
      function buildStringArgSuggestions(params: {
        textModel: monaco.editor.ITextModel
        position: monaco.Position
        argStartOffset: number
        inString: boolean
        items: Array<{ label: string; value: string; detail?: string }>
        detailPrefix: string
        kind: monaco.languages.CompletionItemKind
      }): monaco.languages.CompletionItem[] {
        const { textModel, position, argStartOffset, inString, items, detailPrefix, kind } =
          params
        const word = textModel.getWordUntilPosition(position)
        const offset = textModel.getOffsetAt(position)
        const full = textModel.getValue()
        let range: monaco.Range
        if (inString) {
          range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn,
          )
        } else {
          const between = full.slice(argStartOffset, offset)
          if (/^\s*\{?\s*$/.test(between)) {
            let end = offset
            const trail = full.slice(offset).match(/^\s*\}?/)
            if (trail) end = offset + trail[0].length
            const startPos = textModel.getPositionAt(argStartOffset)
            const endPos = textModel.getPositionAt(end)
            range = new monaco.Range(
              startPos.lineNumber,
              startPos.column,
              endPos.lineNumber,
              endPos.column,
            )
          } else {
            range = new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column,
            )
          }
        }
        const prefix = word.word.toLowerCase()
        return items
          .filter((m) => !prefix || m.value.toLowerCase().startsWith(prefix) || m.label.toLowerCase().startsWith(prefix))
          .map((m, index) => ({
            label: inString ? m.label : `"${m.value}"`,
            kind,
            detail: m.detail ? `${detailPrefix} · ${m.detail}` : detailPrefix,
            documentation: m.detail || m.value,
            insertText: inString ? m.value : `"${m.value}"`,
            range,
            sortText: `0_${String(index).padStart(3, '0')}_${m.value}`,
            filterText: m.value,
          }))
      }
      
      function registerWrapperCompletions() {
        completionDisposable?.dispose()
        completionDisposable = monaco.languages.registerCompletionItemProvider(LANG_ID, {
          triggerCharacters: [
            ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split(''),
            ':',
            '@',
            '.',
            '(',
            '"',
            "'",
          ],
          provideCompletionItems(textModel, position) {
            if (textModel.uri.toString() !== activeModelUri) {
              return { suggestions: [] }
            }
      
            const enumCtx = findEnumArgContext(textModel, position)
            if (enumCtx) {
              return {
                suggestions: buildStringArgSuggestions({
                  textModel,
                  position,
                  argStartOffset: enumCtx.argStartOffset,
                  inString: enumCtx.inString,
                  items: enumCtx.members,
                  detailPrefix: `枚举成员 · @${enumCtx.path}`,
                  kind: monaco.languages.CompletionItemKind.EnumMember,
                }),
              }
            }
      
            const wrapperCtx = findSpecialWrapperArgContext(textModel, position)
            if (wrapperCtx) {
              return {
                suggestions: buildStringArgSuggestions({
                  textModel,
                  position,
                  argStartOffset: wrapperCtx.argStartOffset,
                  inString: wrapperCtx.inString,
                  items: wrapperCtx.options,
                  detailPrefix:
                    wrapperCtx.name === 'Icon' ? '图标' : '颜色',
                  kind:
                    wrapperCtx.name === 'Icon'
                      ? monaco.languages.CompletionItemKind.Constant
                      : monaco.languages.CompletionItemKind.Color,
                }),
              }
            }
      
            // 字段名位置不提示，只在值位置提示 Color/Time / @group.Type
            if (!shouldOfferValueCompletions(textModel, position)) {
              return { suggestions: [] }
            }
            const line = textModel.getLineContent(position.lineNumber)
            const before = line.slice(0, Math.max(0, position.column - 1))
            const atMatch = before.match(/@([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)$/)
            const atBare = before.endsWith('@')
            const word = textModel.getWordUntilPosition(position)
            const namedEntries = completionNamedEntries()
      
            if (atMatch || atBare) {
              const typed = atMatch?.[1] ?? ''
              const range = new monaco.Range(
                position.lineNumber,
                position.column - typed.length - 1,
                position.lineNumber,
                position.column,
              )
              const prefix = typed.toLowerCase()
              const suggestions: monaco.languages.CompletionItem[] = namedEntries
                .filter((e) => !prefix || e.path.toLowerCase().startsWith(prefix))
                .map((e, index) => {
                  const isEnum = e.kind === 'enum'
                  return {
                    label: isEnum ? `@${e.path}("成员")` : `@${e.path}({...})`,
                    kind: isEnum
                      ? monaco.languages.CompletionItemKind.Enum
                      : monaco.languages.CompletionItemKind.Class,
                    detail: isEnum ? '自定义枚举 · 参数为字符串' : '自定义对象 · 自动补全字段',
                    documentation: isEnum
                      ? `枚举类型，参数为成员名字符串，如 @${e.path}("OK")`
                      : `具名对象，自动补全类型字段，不允许额外字段`,
                    insertText: isEnum
                      ? `@${e.path}("$0")`
                      : composeNamedInterfaceSnippet(
                          e.path,
                          e.typeRef,
                          props.typeLibrary,
                        ),
                    insertTextRules:
                      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    sortText: `0_${index}_${e.path}`,
                    filterText: `@${e.path}`,
                    command: isEnum
                      ? {
                          id: 'editor.action.triggerSuggest',
                          title: 'Suggest enum members',
                        }
                      : undefined,
                  }
                })
              return { suggestions }
            }
      
            const range = new monaco.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn,
            )
            const prefix = word.word.toLowerCase()
            const specials: monaco.languages.CompletionItem[] = SPECIAL_WRAPPERS.filter(
              (name) => !prefix || name.toLowerCase().startsWith(prefix),
            ).map((name, index) => {
              const needsValueHint = (VALUE_HINT_WRAPPERS as readonly string[]).includes(
                name,
              )
              return {
                label: `${name}("")`,
                kind: monaco.languages.CompletionItemKind.Function,
                detail: '特殊类型',
                documentation: WRAPPER_DOCS[name] || name,
                insertText: `${name}("$0")`,
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                sortText: `0_${index}_${name}`,
                filterText: name,
                command: needsValueHint
                  ? {
                      id: 'editor.action.triggerSuggest',
                      title: `Suggest ${name} values`,
                    }
                  : undefined,
              }
            })
            const named: monaco.languages.CompletionItem[] = namedEntries
              .filter((e) => {
                if (!prefix) return true
                const lower = e.path.toLowerCase()
                return (
                  lower.startsWith(prefix) ||
                  lower.split('.').some((p) => p.startsWith(prefix))
                )
              })
              .map((e, index) => {
                const isEnum = e.kind === 'enum'
                return {
                  label: isEnum ? `@${e.path}("成员")` : `@${e.path}({...})`,
                  kind: isEnum
                    ? monaco.languages.CompletionItemKind.Enum
                    : monaco.languages.CompletionItemKind.Class,
                  detail: isEnum ? '自定义枚举 · 参数为字符串' : '自定义对象 · 自动补全字段',
                  documentation: isEnum
                    ? `枚举类型，参数为成员名字符串，如 @${e.path}("OK")`
                    : `具名对象，自动补全类型字段，不允许额外字段`,
                  insertText: isEnum
                    ? `@${e.path}("$0")`
                    : composeNamedInterfaceSnippet(
                        e.path,
                        e.typeRef,
                        props.typeLibrary,
                      ),
                  insertTextRules:
                    monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range,
                  sortText: `1_${index}_${e.path}`,
                  filterText: e.path,
                  command: isEnum
                    ? {
                        id: 'editor.action.triggerSuggest',
                        title: 'Suggest enum members',
                      }
                    : undefined,
                }
              })
            return { suggestions: [...specials, ...named] }
          },
        })
      }
      
      function offsetsToRange(
        textModel: monaco.editor.ITextModel,
        start: number,
        end: number,
      ): monaco.Range {
        const len = textModel.getValueLength()
        const s = textModel.getPositionAt(Math.max(0, Math.min(start, len)))
        const e = textModel.getPositionAt(
          Math.max(0, Math.min(Math.max(end, start + 1), len)),
        )
        return new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column)
      }
      
      function registerCodeActions() {
        codeActionDisposable?.dispose()
        codeActionDisposable = monaco.languages.registerCodeActionProvider(LANG_ID, {
          provideCodeActions(textModel, range, context) {
            if (textModel.uri.toString() !== activeModelUri) {
              return { actions: [], dispose() {} }
            }
            const diagnostics = diagnoseCode(textModel.getValue())
            const markerMessages = new Set(
              (context.markers ?? []).map((m) => m.message),
            )
            const seenTitles = new Set<string>()
            const actions: monaco.languages.CodeAction[] = []
      
            for (const d of diagnostics) {
              if (!d.fixes?.length) continue
              const diagRange = offsetsToRange(textModel, d.start, d.end)
              const inRange = monaco.Range.areIntersectingOrTouching(diagRange, range)
              const matchedMarker = markerMessages.has(d.message)
              if (!inRange && !matchedMarker) continue
              for (const fix of d.fixes) {
                const key = `${fix.title}::${fix.edits.map((e) => `${e.start}:${e.end}`).join('|')}`
                if (seenTitles.has(key)) continue
                seenTitles.add(key)
                actions.push({
                  title: fix.title,
                  kind: 'quickfix',
                  isPreferred: fix === d.fixes[0],
                  diagnostics: (context.markers ?? []).filter(
                    (m) => m.message === d.message,
                  ),
                  edit: {
                    edits: fix.edits.map((e) => ({
                      resource: textModel.uri,
                      versionId: textModel.getVersionId(),
                      textEdit: {
                        range: offsetsToRange(textModel, e.start, e.end),
                        text: e.text,
                      },
                    })),
                  },
                })
              }
            }
            return { actions, dispose() {} }
          },
        })
      }
      
      function registerHoverProvider() {
        hoverDisposable?.dispose()
        hoverDisposable = monaco.languages.registerHoverProvider(LANG_ID, {
          provideHover(textModel, position) {
            if (textModel.uri.toString() !== activeModelUri) return null
            const offset = textModel.getOffsetAt(position)
            const hit = findNamedTypeAtOffset(
              textModel.getValue(),
              offset,
              props.typeLibrary,
            )
            if (!hit) return null
            const source = formatNamedTypeDefinitionSource(
              hit.typeRef,
              props.typeLibrary,
            )
            if (!source) return null
            const kindLabel = hit.kind === 'enum' ? '自定义枚举' : '自定义对象'
            const start = textModel.getPositionAt(hit.start)
            const end = textModel.getPositionAt(hit.end)
            return {
              range: new monaco.Range(
                start.lineNumber,
                start.column,
                end.lineNumber,
                end.column,
              ),
              contents: [
                {
                  value: `**@${hit.path}** · ${kindLabel}`,
                },
                {
                  value: '```typescript\n' + source + '\n```',
                },
              ],
            }
          },
        })
      }
      
      function extractValueLiteral(full: string): string {
        if (isArrayKind()) {
          return extractArrayTsValueLiteral(full) || '[\n  \n]'
        }
        return extractObjectTsValueLiteral(full) || '{\n  \n}'
      }
      
      function applyShellDecorations() {
        if (!editor || !model) return
        const full = model.getValue()
        const ranges = readonlyLineRanges(full).map((r) => ({
          range: new monaco.Range(r.startLine, 1, r.endLine, Number.MAX_SAFE_INTEGER),
          options: {
            isWholeLine: true,
            className: 'object-ts-shell-readonly',
            marginClassName: 'object-ts-shell-readonly-margin',
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        }))
        shellDecorations = editor.deltaDecorations(shellDecorations, ranges)
      }
      
      function clampSelectionToEditable() {
        if (!editor || !model || props.readonly || syncing) return
        const boundsList = editableLineBounds(model.getValue())
        if (!boundsList.length) return
        const sel = editor.getSelection()
        if (!sel) return
        const b = boundsList[0]!
        const clamp = (line: number) => Math.min(Math.max(line, b.first), b.last)
        const startLine = clamp(sel.startLineNumber)
        const endLine = clamp(sel.endLineNumber)
        if (
          startLine === sel.startLineNumber &&
          endLine === sel.endLineNumber &&
          sel.startLineNumber >= b.first &&
          sel.endLineNumber <= b.last
        ) {
          return
        }
        editor.setSelection(
          new monaco.Selection(startLine, sel.startColumn, endLine, sel.endColumn),
        )
      }
      
      function setModelText(full: string, preserveCursor = true) {
        if (!model || !editor) return
        if (full === model.getValue()) {
          if (!getCodeError(full)) {
            lastValidFull = full
          }
          applyShellDecorations()
          applyValidationMarkers(full)
          return
        }
        const pos = preserveCursor ? editor.getPosition() : null
        syncing = true
        model.setValue(full)
        syncing = false
        if (!getCodeError(full)) {
          lastValidFull = full
        }
        applyShellDecorations()
        applyValidationMarkers(full)
        if (pos) {
          const bounds = editableLineBounds(full)[0]
          if (bounds) {
            const line = Math.min(Math.max(pos.lineNumber, bounds.first), bounds.last)
            const maxCol = model.getLineMaxColumn(line)
            editor.setPosition({
              lineNumber: line,
              column: Math.min(Math.max(pos.column, 1), maxCol),
            })
          }
        }
      }
      
      function restoreStructure() {
        if (!model || !editor) return
        if (lastValidFull && structureIntact(lastValidFull)) {
          setModelText(lastValidFull)
          return
        }
        if (isArrayKind()) {
          const parsed = parseArrayTsCode(
            props.modelValue || '',
            props.arrayFields ?? [],
            {
              typeLibrary: props.typeLibrary,
              itemTypeRef: props.itemTypeRef ?? undefined,
            },
          )
          setModelText(
            composeArrayTsCode(
              parsed?.fields ?? props.arrayFields ?? [],
              props.constName,
              {
                typeLibrary: props.typeLibrary,
                itemTypeRef: props.itemTypeRef ?? undefined,
              },
            ),
          )
          return
        }
        const lit = extractValueLiteral(props.modelValue || '')
        const value =
          parseObjectLiteral(lit, { typeLibrary: props.typeLibrary }) || {}
        setModelText(composeShellCode(value))
      }
      
      function mountEditor() {
        if (!hostRef.current) return
      
        ensureLanguage()
        registerWrapperCompletions()
        registerCodeActions()
        registerHoverProvider()
      
        const initial =
          props.modelValue?.trim() && structureIntact(props.modelValue)
            ? props.modelValue.replace(/\r\n/g, '\n')
            : composeShellCode()
        lastValidFull = initial
      
        const modelUri = monaco.Uri.parse(
          `inmemory://luban/object-static-${Date.now()}-${Math.random().toString(36).slice(2)}.ts`,
        )
        activeModelUri = modelUri.toString()
        model = monaco.editor.createModel(initial, LANG_ID, modelUri)
      
        editor = monaco.editor.create(hostRef.current, {
          model,
          readOnly: props.readonly,
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2,
          insertSpaces: true,
          detectIndentation: false,
          wordWrap: 'on',
          theme: 'vs',
          tabFocusMode: false,
          fixedOverflowWidgets: true,
          hover: { enabled: true, delay: 300 },
          lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.On },
          quickSuggestions: { other: true, comments: false, strings: true },
          suggestOnTriggerCharacters: true,
          wordBasedSuggestions: 'off',
          parameterHints: { enabled: false },
          snippetSuggestions: 'inline',
          suggest: {
            showWords: false,
            showKeywords: false,
            showSnippets: true,
            showFunctions: true,
            showEnums: true,
            showEnumMembers: true,
          },
          padding: { top: 8, bottom: 8 },
        })
      
        editor.onKeyDown((e) => {
          if (
            e.keyCode === monaco.KeyCode.Tab ||
            e.keyCode === monaco.KeyCode.Space
          ) {
            e.browserEvent.stopPropagation()
          }
        })
      
        applyShellDecorations()
        applyValidationMarkers(initial)
      
        model.onDidChangeContent(() => {
          if (syncing || !model) return
          let full = model.getValue()
          if (!structureIntact(full)) {
            applyValidationMarkers(full)
            if (restoreTimer) clearTimeout(restoreTimer)
            restoreTimer = setTimeout(() => {
              restoreTimer = null
              if (!model || syncing) return
              if (!structureIntact(model.getValue())) {
                restoreStructure()
              }
            }, 600)
            return
          }
          const filled = autofillNamed(full)
          if (filled !== full) {
            const pos = editor?.getPosition()
            syncing = true
            model.setValue(filled)
            syncing = false
            full = filled
            if (pos && editor) {
              const line = Math.min(pos.lineNumber, model.getLineCount())
              editor.setPosition({
                lineNumber: line,
                column: Math.min(pos.column, model.getLineMaxColumn(line)),
              })
            }
          }
          // 结构完整即可同步到外部；合法性由 markers / error 事件决定是否允许保存
          emit('update:modelValue', full)
          applyShellDecorations()
          applyValidationMarkers(full)
        })
      
        editor.onDidChangeCursorSelection(() => {
          clampSelectionToEditable()
        })
      }

      function onExternalValue(value: string) {
        if (!model || syncing) return
        if (model.getValue() === value) return
        if (value && structureIntact(value)) {
          setModelText(value.replace(/\r\n/g, '\n'))
          return
        }
        restoreStructure()
      }

      function onReadonlyChange(readonly: boolean) {
        editor?.updateOptions({ readOnly: Boolean(readonly) })
      }

      function disposeAll() {
        if (restoreTimer) clearTimeout(restoreTimer)
        if (model) monaco.editor.setModelMarkers(model, 'voider-object-static', [])
        completionDisposable?.dispose()
        completionDisposable = null
        codeActionDisposable?.dispose()
        codeActionDisposable = null
        hoverDisposable?.dispose()
        hoverDisposable = null
        tokensDisposable?.dispose()
        tokensDisposable = null
        editor?.dispose()
        model?.dispose()
        editor = null
        model = null
        activeModelUri = ''
      }

      function getFullCode(): string {
        if (!model) return props.modelValue || ''
        const full = model.getValue()
        if (!structureIntact(full)) {
          return lastValidFull || props.modelValue || ''
        }
        return full
      }
      
      
      mountEditor()
      apiRef.current = {
        getFullCode,
        onExternalValue,
        onReadonlyChange,
      }
      return () => {
        disposeAll()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const skipValueSync = useRef(true)
    useEffect(() => {
      if (skipValueSync.current) {
        skipValueSync.current = false
        return
      }
      apiRef.current?.onExternalValue(p.value)
    }, [p.value])

    const skipReadonlySync = useRef(true)
    useEffect(() => {
      if (skipReadonlySync.current) {
        skipReadonlySync.current = false
        return
      }
      apiRef.current?.onReadonlyChange(Boolean(p.readonly))
    }, [p.readonly])

    return (
      <div
        ref={hostRef}
        className="object-ts-editor nokey"
        style={{ minHeight: `${p.minHeight ?? 360}px` }}
      />
    )
  },
)
