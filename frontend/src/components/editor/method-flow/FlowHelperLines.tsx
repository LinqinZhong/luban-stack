import { useEffect, useRef } from 'react'
import { useStore, useViewport } from '@xyflow/react'
import { colorPrimary } from '../../../theme'
import './FlowHelperLines.css'

export default function FlowHelperLines({
  horizontal,
  vertical,
}: {
  horizontal?: number
  vertical?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { x, y, zoom } = useViewport()
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return

    const dpi = window.devicePixelRatio || 1
    canvas.width = width * dpi
    canvas.height = height * dpi
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = colorPrimary
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])

    if (typeof vertical === 'number') {
      ctx.beginPath()
      ctx.moveTo(vertical * zoom + x, 0)
      ctx.lineTo(vertical * zoom + x, height)
      ctx.stroke()
    }

    if (typeof horizontal === 'number') {
      ctx.beginPath()
      ctx.moveTo(0, horizontal * zoom + y)
      ctx.lineTo(width, horizontal * zoom + y)
      ctx.stroke()
    }
  }, [width, height, x, y, zoom, horizontal, vertical])

  return <canvas ref={canvasRef} className="helper-lines-canvas" />
}
