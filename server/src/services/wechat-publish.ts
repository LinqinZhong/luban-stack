/**
 * 微信小程序发布：miniprogram-ci 上传（无需打开开发者工具 UI）。
 * 密钥存于项目内 .lubanstack/wechat/private.key，不写进 luban.json。
 */
import { access, constants, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { openProject, ProjectError } from './project.js'
import { exportMpWxProject } from './export-mp-wx.js'

const WECHAT_DIR = path.join('.lubanstack', 'wechat')
const PRIVATE_KEY_FILE = 'private.key'

const require = createRequire(import.meta.url)

function wechatDir(projectPath: string): string {
  return path.join(projectPath, WECHAT_DIR)
}

export function wechatPrivateKeyPath(projectPath: string): string {
  return path.join(wechatDir(projectPath), PRIVATE_KEY_FILE)
}

export async function getWechatPublishStatus(projectPathInput: string): Promise<{
  wechatAppId: string
  hasPrivateKey: boolean
  projectVersion: string
}> {
  const { path: projectPath, config } = await openProject(projectPathInput)
  let hasPrivateKey = false
  try {
    await access(wechatPrivateKeyPath(projectPath), constants.F_OK)
    const raw = await readFile(wechatPrivateKeyPath(projectPath), 'utf-8')
    hasPrivateKey = Boolean(raw.trim())
  } catch {
    hasPrivateKey = false
  }
  return {
    wechatAppId: (config.wechatAppId ?? '').trim(),
    hasPrivateKey,
    projectVersion: (config.version ?? '0.1.0').trim() || '0.1.0',
  }
}

export async function saveWechatPrivateKey(
  projectPathInput: string,
  privateKey: string,
): Promise<{ ok: true }> {
  const { path: projectPath } = await openProject(projectPathInput)
  const key = String(privateKey ?? '').trim()
  if (!key) {
    throw new ProjectError('请粘贴代码上传密钥内容', 400)
  }
  if (!key.includes('PRIVATE KEY')) {
    throw new ProjectError(
      '密钥格式不正确：请粘贴微信公众平台下载的代码上传密钥全文（含 BEGIN PRIVATE KEY）',
      400,
    )
  }
  const dir = wechatDir(projectPath)
  await mkdir(dir, { recursive: true })
  await writeFile(wechatPrivateKeyPath(projectPath), key.endsWith('\n') ? key : `${key}\n`, 'utf-8')
  return { ok: true }
}

export async function clearWechatPrivateKey(
  projectPathInput: string,
): Promise<{ ok: true }> {
  const { path: projectPath } = await openProject(projectPathInput)
  try {
    await unlink(wechatPrivateKeyPath(projectPath))
  } catch {
    // ignore missing
  }
  return { ok: true }
}

export type PublishMpWxOptions = {
  projectPath: string
  version: string
  desc?: string
  /** 上传前是否重新导出；默认 true */
  rebuild?: boolean
}

export type PublishMpWxResult = {
  outputPath: string
  appid: string
  version: string
  desc: string
}

export async function publishMpWxProject(
  options: PublishMpWxOptions,
): Promise<PublishMpWxResult> {
  const { path: projectPath, config } = await openProject(options.projectPath)
  const appid = (config.wechatAppId ?? '').trim()
  if (!appid) {
    throw new ProjectError(
      '未配置微信 AppID：请到「设置 → 项目」填写后再发布',
      400,
    )
  }

  const keyPath = wechatPrivateKeyPath(projectPath)
  try {
    await access(keyPath, constants.F_OK)
  } catch {
    throw new ProjectError(
      '未配置代码上传密钥：请到「设置 → 项目」粘贴微信公众平台下载的上传密钥',
      400,
    )
  }

  const version = String(options.version ?? '').trim()
  if (!version) {
    throw new ProjectError('请填写版本号', 400)
  }
  const desc =
    String(options.desc ?? '').trim() || `LubanStack 发布 ${version}`

  let outputPath: string
  if (options.rebuild === false) {
    outputPath = path.join(projectPath, 'output', 'mp-wx')
    try {
      await access(path.join(outputPath, 'app.json'), constants.F_OK)
    } catch {
      throw new ProjectError('未找到已导出的小程序工程，请先构建/导出或开启重新导出', 400)
    }
  } else {
    const exported = await exportMpWxProject(projectPath, {
      wechatAppId: appid,
    })
    outputPath = exported.outputPath
  }

  let ci: typeof import('miniprogram-ci')
  try {
    ci = require('miniprogram-ci') as typeof import('miniprogram-ci')
  } catch {
    throw new ProjectError(
      '未安装 miniprogram-ci：请在 server 目录执行 pnpm add miniprogram-ci',
      500,
    )
  }

  const project = new ci.Project({
    appid,
    type: 'miniProgram',
    projectPath: outputPath,
    privateKeyPath: keyPath,
    ignores: ['node_modules/**/*'],
  })

  try {
    await ci.upload({
      project,
      version,
      desc,
      setting: {
        es6: true,
        minify: true,
      },
      onProgressUpdate: () => undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new ProjectError(
      `微信上传失败：${message}（请确认上传密钥有效，且本机 IP 已加入公众平台白名单）`,
      502,
    )
  }

  return { outputPath, appid, version, desc }
}
