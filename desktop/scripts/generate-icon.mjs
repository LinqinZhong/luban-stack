import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(root, 'build')
const svgPath = path.join(buildDir, 'icon.svg')

await mkdir(buildDir, { recursive: true })

const svg = await readFile(svgPath)
const png512 = await sharp(svg).resize(512, 512).png().toBuffer()
const png256 = await sharp(svg).resize(256, 256).png().toBuffer()
const png128 = await sharp(svg).resize(128, 128).png().toBuffer()
const png64 = await sharp(svg).resize(64, 64).png().toBuffer()
const png48 = await sharp(svg).resize(48, 48).png().toBuffer()
const png32 = await sharp(svg).resize(32, 32).png().toBuffer()
const png16 = await sharp(svg).resize(16, 16).png().toBuffer()

await writeFile(path.join(buildDir, 'icon.png'), png512)
const ico = await pngToIco([png256, png128, png64, png48, png32, png16])
await writeFile(path.join(buildDir, 'icon.ico'), ico)

console.log('Wrote build/icon.png and build/icon.ico')
