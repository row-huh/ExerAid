"use client"

import { useEffect, useRef } from "react"
import { Card } from "@/components/ui/card"
import type { RepError, RepErrorSummary } from "@/lib/rep-error-calculator"

interface RepErrorGraphProps {
  repErrors: RepError[]
  summary: RepErrorSummary | null
  width?: number
  height?: number
}

export function RepErrorGraph({ repErrors, summary, width = 600, height = 300 }: RepErrorGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, width, height)

    if (repErrors.length === 0) {
      ctx.fillStyle = "#6b7280"
      ctx.font = "14px system-ui"
      ctx.textAlign = "center"
      ctx.fillText("No reps recorded yet", width / 2, height / 2)
      return
    }

    const margin = { top: 20, right: 20, bottom: 40, left: 50 }
    const chartWidth = width - margin.left - margin.right
    const chartHeight = height - margin.top - margin.bottom

    const maxError = Math.max(...repErrors.map(r => r.overallError), 30)
    const minError = 0
    const repCount = repErrors.length

    const xScale = (repNum: number) => margin.left + (repNum / Math.max(repCount, 1)) * chartWidth
    const yScale = (error: number) => margin.top + chartHeight - ((error - minError) / (maxError - minError)) * chartHeight

    ctx.strokeStyle = "#e5e7eb"
    ctx.lineWidth = 1
    
    for (let i = 0; i <= 5; i++) {
      const y = margin.top + (chartHeight / 5) * i
      ctx.beginPath()
      ctx.moveTo(margin.left, y)
      ctx.lineTo(width - margin.right, y)
      ctx.stroke()

      const errorValue = maxError - (maxError / 5) * i
      ctx.fillStyle = "#6b7280"
      ctx.font = "11px system-ui"
      ctx.textAlign = "right"
      ctx.fillText(`${errorValue.toFixed(0)}°`, margin.left - 5, y + 4)
    }

    ctx.strokeStyle = "#374151"
    ctx.lineWidth = 2
    
    ctx.beginPath()
    ctx.moveTo(margin.left, margin.top)
    ctx.lineTo(margin.left, height - margin.bottom)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(margin.left, height - margin.bottom)
    ctx.lineTo(width - margin.right, height - margin.bottom)
    ctx.stroke()

    const goodThreshold = 10
    const okThreshold = 20

    ctx.fillStyle = "rgba(34, 197, 94, 0.1)"
    ctx.fillRect(
      margin.left,
      yScale(goodThreshold),
      chartWidth,
      yScale(0) - yScale(goodThreshold)
    )

    ctx.fillStyle = "rgba(234, 179, 8, 0.1)"
    ctx.fillRect(
      margin.left,
      yScale(okThreshold),
      chartWidth,
      yScale(goodThreshold) - yScale(okThreshold)
    )

    ctx.fillStyle = "rgba(239, 68, 68, 0.1)"
    ctx.fillRect(
      margin.left,
      margin.top,
      chartWidth,
      yScale(okThreshold) - margin.top
    )

    if (repErrors.length > 1) {
      ctx.strokeStyle = "#3b82f6"
      ctx.lineWidth = 2
      ctx.beginPath()
      repErrors.forEach((rep, i) => {
        const x = xScale(i + 1)
        const y = yScale(rep.overallError)
        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
      })
      ctx.stroke()
    }

    repErrors.forEach((rep, i) => {
      const x = xScale(i + 1)
      const y = yScale(rep.overallError)

      if (rep.overallError < goodThreshold) {
        ctx.fillStyle = "#22c55e"
      } else if (rep.overallError < okThreshold) {
        ctx.fillStyle = "#eab308"
      } else {
        ctx.fillStyle = "#ef4444"
      }

      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = "#374151"
      ctx.font = "10px system-ui"
      ctx.textAlign = "center"
      ctx.fillText(`${rep.repNumber}`, x, height - margin.bottom + 15)
    })

    ctx.fillStyle = "#374151"
    ctx.font = "12px system-ui"
    
    ctx.textAlign = "center"
    ctx.fillText("Rep Number", width / 2, height - 5)
    
    ctx.save()
    ctx.translate(15, height / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText("Average Error (degrees)", 0, 0)
    ctx.restore()

  }, [repErrors, width, height])

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Rep Error Analysis</h3>
        {summary && repErrors.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Trend:</span>
              <span className={`font-semibold ${
                summary.errorTrend === "improving" ? "text-green-600" : 
                summary.errorTrend === "declining" ? "text-red-600" : 
                "text-gray-600"
              }`}>
                {summary.errorTrend === "improving" ? "📈 Improving" : 
                 summary.errorTrend === "declining" ? "📉 Declining" : 
                 "→ Stable"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Avg Error:</span>
              <span className="font-semibold">{summary.averageError.toFixed(1)}°</span>
            </div>
          </div>
        )}
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          style={{ width: `${width}px`, height: `${height}px` }}
          className="border border-gray-200 rounded-lg"
        />
      </div>

      {summary && repErrors.length > 0 && (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded p-2">
            <div className="text-green-700 dark:text-green-300 font-semibold">Best Rep</div>
            <div className="text-green-900 dark:text-green-100 text-lg">#{summary.bestRep}</div>
          </div>
          <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-2">
            <div className="text-red-700 dark:text-red-300 font-semibold">Worst Rep</div>
            <div className="text-red-900 dark:text-red-100 text-lg">#{summary.worstRep}</div>
          </div>
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-2">
            <div className="text-blue-700 dark:text-blue-300 font-semibold">Total Reps</div>
            <div className="text-blue-900 dark:text-blue-100 text-lg">{repErrors.length}</div>
          </div>
        </div>
      )}

      {summary && summary.commonMistakes.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded p-3">
          <div className="text-yellow-800 dark:text-yellow-200 font-semibold mb-1">
            Common Form Issues:
          </div>
          <ul className="text-yellow-700 dark:text-yellow-300 text-sm space-y-1">
            {summary.commonMistakes.map((mistake, i) => (
              <li key={i}>• {mistake}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-gray-500 border-t pt-2">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <span>Good (&lt;10°)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <span>OK (10-20°)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <span>Poor (&gt;20°)</span>
        </div>
      </div>
    </Card>
  )
}
