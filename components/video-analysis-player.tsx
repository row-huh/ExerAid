"use client"

import { useEffect, useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision"
import type { MovementSequence } from "@/lib/pose-analyzer"
import { OneEuroFilter } from "@/lib/filters"

interface VideoAnalysisPlayerProps {
  videoBlob: Blob
  movements: MovementSequence[]
  anglesOfInterest?: string[]
}

export function VideoAnalysisPlayer({ videoBlob, movements, anglesOfInterest }: VideoAnalysisPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  
  const landmarkFiltersRef = useRef<Map<string, { x: OneEuroFilter; y: OneEuroFilter; z: OneEuroFilter }>>(new Map())

  useEffect(() => {
    initializePlayer()
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close()
      }
    }
  }, [videoBlob])

  const initializePlayer = async () => {
    try {
      setIsLoading(true)

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
      )

      const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      poseLandmarkerRef.current = poseLandmarker

      const videoUrl = URL.createObjectURL(videoBlob)
      if (videoRef.current) {
        videoRef.current.src = videoUrl
        videoRef.current.onloadedmetadata = () => {
          if (videoRef.current && canvasRef.current) {
            canvasRef.current.width = videoRef.current.videoWidth
            canvasRef.current.height = videoRef.current.videoHeight
          }
          setIsLoading(false)
        }
      }
    } catch (error) {
      console.error("Error initializing player:", error)
      setIsLoading(false)
    }
  }

  const drawPoseAndAnnotations = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const poseLandmarker = poseLandmarkerRef.current

    if (!video || !canvas || !poseLandmarker || video.paused || video.ended) {
      return
    }

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    try {
      // Detect pose
      const timestamp = performance.now()
      const results = poseLandmarker.detectForVideo(video, timestamp)

      if (results.landmarks && results.landmarks.length > 0) {
        const rawLandmarks = results.landmarks[0]
        
        // Apply One Euro Filter smoothing to landmarks
        const smoothedLandmarks = rawLandmarks.map((landmark: any, index: number) => {
          const key = `landmark_${index}`
          
          if (!landmarkFiltersRef.current.has(key)) {
            landmarkFiltersRef.current.set(key, {
              x: new OneEuroFilter(1.0, 0.007),
              y: new OneEuroFilter(1.0, 0.007),
              z: new OneEuroFilter(1.0, 0.007),
            })
          }
          
          const filter = landmarkFiltersRef.current.get(key)!
          const t = video.currentTime
          
          return {
            x: filter.x.filter(landmark.x, t),
            y: filter.y.filter(landmark.y, t),
            z: landmark.z ? filter.z.filter(landmark.z, t) : landmark.z,
            visibility: landmark.visibility,
          }
        })
        
        const landmarks = smoothedLandmarks
        const drawingUtils = new DrawingUtils(ctx)

        // Draw skeleton connections
        const connections = [
          [11, 12], // Shoulders
          [11, 13],
          [13, 15], // Left arm
          [12, 14],
          [14, 16], // Right arm
          [11, 23],
          [12, 24], // Torso
          [23, 24], // Hips
          [23, 25],
          [25, 27], // Left leg
          [24, 26],
          [26, 28], // Right leg
        ]

        // Draw connections (thicker lines for stability)
        ctx.strokeStyle = "#00ff00"
        ctx.lineWidth = 6
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        connections.forEach(([start, end]) => {
          const startPoint = landmarks[start]
          const endPoint = landmarks[end]

          if (startPoint && endPoint) {
            ctx.beginPath()
            ctx.moveTo(startPoint.x * canvas.width, startPoint.y * canvas.height)
            ctx.lineTo(endPoint.x * canvas.width, endPoint.y * canvas.height)
            ctx.stroke()
          }
        })

        landmarks.forEach((landmark: any, index: number) => {
          ctx.beginPath()
          ctx.arc(landmark.x * canvas.width, landmark.y * canvas.height, 8, 0, 2 * Math.PI)
          ctx.fillStyle = "#ff0000"
          ctx.fill()
          ctx.strokeStyle = "#ffffff"
          ctx.lineWidth = 2
          ctx.stroke()
        })
        drawAngles(ctx, landmarks, canvas.width, canvas.height)
      }
    } catch (error) {
      console.error("Error drawing pose:", error)
    }

    drawCurrentMovements(ctx, canvas.width, canvas.height, video.currentTime)

    animationFrameRef.current = requestAnimationFrame(drawPoseAndAnnotations)
  }

  const drawAngles = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ) => {
    const shouldTrack = (angleName: string) => {
      if (!anglesOfInterest) return true
      return anglesOfInterest.includes(angleName)
    }

    // Helper to calculate 3-point angle
    const calculateAngle = (a: number[], b: number[], c: number[]): number => {
      const radians = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(a[1] - b[1], a[0] - b[0])
      let angle = Math.abs((radians * 180.0) / Math.PI)
      if (angle > 180.0) {
        angle = 360.0 - angle
      }
      return angle
    }

    // === JOINT ANGLES (3-point) ===
    
    // Right knee angle (hip-knee-ankle)
    if (shouldTrack("right_knee")) {
      const hip = landmarks[24]
      const knee = landmarks[26]
      const ankle = landmarks[28]

      if (hip && knee && ankle) {
        const angle = calculateAngle(
          [hip.x * width, hip.y * height],
          [knee.x * width, knee.y * height],
          [ankle.x * width, ankle.y * height]
        )

        // Draw angle text at knee
        ctx.fillStyle = "#00ffff"
        ctx.font = "bold 18px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 3
        const text = `${angle.toFixed(0)}°`
        ctx.strokeText(text, knee.x * width + 15, knee.y * height - 10)
        ctx.fillText(text, knee.x * width + 15, knee.y * height - 10)
      }
    }

    // Left knee angle (hip-knee-ankle)
    if (shouldTrack("left_knee")) {
      const hip = landmarks[23]
      const knee = landmarks[25]
      const ankle = landmarks[27]

      if (hip && knee && ankle) {
        const angle = calculateAngle(
          [hip.x * width, hip.y * height],
          [knee.x * width, knee.y * height],
          [ankle.x * width, ankle.y * height]
        )

        // Draw angle text at knee
        ctx.fillStyle = "#00ffff"
        ctx.font = "bold 18px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 3
        const text = `${angle.toFixed(0)}°`
        ctx.strokeText(text, knee.x * width - 55, knee.y * height - 10)
        ctx.fillText(text, knee.x * width - 55, knee.y * height - 10)
      }
    }

    // Right elbow angle (shoulder-elbow-wrist)
    if (shouldTrack("right_elbow")) {
      const shoulder = landmarks[12]
      const elbow = landmarks[14]
      const wrist = landmarks[16]

      if (shoulder && elbow && wrist) {
        const angle = calculateAngle(
          [shoulder.x * width, shoulder.y * height],
          [elbow.x * width, elbow.y * height],
          [wrist.x * width, wrist.y * height]
        )

        // Draw angle text at elbow
        ctx.fillStyle = "#ff00ff"
        ctx.font = "bold 16px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 3
        const text = `${angle.toFixed(0)}°`
        ctx.strokeText(text, elbow.x * width + 12, elbow.y * height)
        ctx.fillText(text, elbow.x * width + 12, elbow.y * height)
      }
    }

    // Left elbow angle (shoulder-elbow-wrist)
    if (shouldTrack("left_elbow")) {
      const shoulder = landmarks[11]
      const elbow = landmarks[13]
      const wrist = landmarks[15]

      if (shoulder && elbow && wrist) {
        const angle = calculateAngle(
          [shoulder.x * width, shoulder.y * height],
          [elbow.x * width, elbow.y * height],
          [wrist.x * width, wrist.y * height]
        )

        // Draw angle text at elbow
        ctx.fillStyle = "#ff00ff"
        ctx.font = "bold 16px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 3
        const text = `${angle.toFixed(0)}°`
        ctx.strokeText(text, elbow.x * width - 50, elbow.y * height)
        ctx.fillText(text, elbow.x * width - 50, elbow.y * height)
      }
    }

    // Right hip angle (shoulder-hip-knee)
    if (shouldTrack("right_hip")) {
      const shoulder = landmarks[12]
      const hip = landmarks[24]
      const knee = landmarks[26]

      if (shoulder && hip && knee) {
        const angle = calculateAngle(
          [shoulder.x * width, shoulder.y * height],
          [hip.x * width, hip.y * height],
          [knee.x * width, knee.y * height]
        )

        // Draw angle text at hip
        ctx.fillStyle = "#ffaa00"
        ctx.font = "bold 16px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 3
        const text = `${angle.toFixed(0)}°`
        ctx.strokeText(text, hip.x * width + 12, hip.y * height + 5)
        ctx.fillText(text, hip.x * width + 12, hip.y * height + 5)
      }
    }

    // Left hip angle (shoulder-hip-knee)
    if (shouldTrack("left_hip")) {
      const shoulder = landmarks[11]
      const hip = landmarks[23]
      const knee = landmarks[25]

      if (shoulder && hip && knee) {
        const angle = calculateAngle(
          [shoulder.x * width, shoulder.y * height],
          [hip.x * width, hip.y * height],
          [knee.x * width, knee.y * height]
        )

        // Draw angle text at hip
        ctx.fillStyle = "#ffaa00"
        ctx.font = "bold 16px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 3
        const text = `${angle.toFixed(0)}°`
        ctx.strokeText(text, hip.x * width - 50, hip.y * height + 5)
        ctx.fillText(text, hip.x * width - 50, hip.y * height + 5)
      }
    }

    // === SEGMENT ANGLES (for reference - smaller text) ===
    // These show the angle relative to vertical

    // Right leg segment angle if tracking
    if (shouldTrack("right_knee") || shouldTrack("right_ankle")) {
      const knee = landmarks[26]
      const ankle = landmarks[28]

      if (knee && ankle) {
        const kneeX = knee.x * width
        const kneeY = knee.y * height
        const ankleX = ankle.x * width
        const ankleY = ankle.y * height

        // Calculate angle from vertical
        const dx = ankleX - kneeX
        const dy = ankleY - kneeY
        const angle = Math.abs((Math.atan2(dx, dy) * 180) / Math.PI)

        // Draw smaller angle text (segment angle)
        ctx.fillStyle = "#ffffff"
        ctx.font = "12px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 2
        const text = `seg: ${angle.toFixed(0)}°`
        ctx.strokeText(text, kneeX + 15, kneeY + 25)
        ctx.fillText(text, kneeX + 15, kneeY + 25)
      }
    }

    // Left leg segment angle if tracking
    if (shouldTrack("left_knee") || shouldTrack("left_ankle")) {
      const knee = landmarks[25]
      const ankle = landmarks[27]

      if (knee && ankle) {
        const kneeX = knee.x * width
        const kneeY = knee.y * height
        const ankleX = ankle.x * width
        const ankleY = ankle.y * height

        // Calculate angle from vertical
        const dx = ankleX - kneeX
        const dy = ankleY - kneeY
        const angle = Math.abs((Math.atan2(dx, dy) * 180) / Math.PI)

        // Draw smaller angle text (segment angle)
        ctx.fillStyle = "#ffffff"
        ctx.font = "12px Arial"
        ctx.strokeStyle = "#000000"
        ctx.lineWidth = 2
        const text = `seg: ${angle.toFixed(0)}°`
        ctx.strokeText(text, kneeX - 70, kneeY + 25)
        ctx.fillText(text, kneeX - 70, kneeY + 25)
      }
    }
  }

  const drawCurrentMovements = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    currentTime: number
  ) => {
    // Find movements happening at current time
    const activeMovements = movements.filter(
      (m) => currentTime >= m.startTime && currentTime <= m.endTime
    )

    if (activeMovements.length > 0) {
      // Draw semi-transparent background
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)"
      ctx.fillRect(10, 10, 400, 30 + activeMovements.length * 30)

      // Draw movement info
      ctx.fillStyle = "#00ff00"
      ctx.font = "bold 16px Arial"
      ctx.fillText("Active Movements:", 20, 35)

      activeMovements.forEach((movement, idx) => {
        const segmentName = movement.joint
          .replace("_segment", "")
          .replace("_", " ")
          .toUpperCase()
        const change = Math.abs(movement.angleDelta).toFixed(1)
        const direction = movement.angleDelta > 0 ? "↗" : "↘"

        ctx.fillStyle = "#ffff00"
        ctx.font = "14px Arial"
        ctx.fillText(`${segmentName}: ${direction} ${change}°`, 30, 60 + idx * 25)
      })
    }

    // Draw timeline with movements
    const timelineY = height - 40
    const timelineWidth = width - 40

    // Timeline background
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)"
    ctx.fillRect(20, timelineY, timelineWidth, 20)

    // Draw movement markers
    if (videoRef.current) {
      const videoDuration = videoRef.current.duration
      movements.forEach((movement) => {
        const startX = 20 + (movement.startTime / videoDuration) * timelineWidth
        const endX = 20 + (movement.endTime / videoDuration) * timelineWidth
        const width = endX - startX

        ctx.fillStyle = "rgba(0, 255, 0, 0.6)"
        ctx.fillRect(startX, timelineY, width, 20)
      })

      // Current time indicator
      const currentX = 20 + (currentTime / videoDuration) * timelineWidth
      ctx.fillStyle = "#ff0000"
      ctx.fillRect(currentX - 2, timelineY - 5, 4, 30)
    }
  }

  const handlePlayPause = () => {
    if (!videoRef.current) return

    if (isPlaying) {
      videoRef.current.pause()
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    } else {
      videoRef.current.play()
      drawPoseAndAnnotations()
    }
    setIsPlaying(!isPlaying)
  }


  return (
    <Card className="p-6">
      <h3 className="font-semibold mb-4">Video Analysis Playback</h3>

      {isLoading && (
        <div className="flex items-center justify-center h-96 bg-muted rounded">
          <p className="text-muted-foreground">Loading video...</p>
        </div>
      )}

      <div className="relative">
        <div className="relative aspect-video bg-black rounded overflow-hidden">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain"
            muted
            loop
            onEnded={() => setIsPlaying(false)}
          />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
          />
        </div>

        
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        <p>• Green lines show the detected skeleton</p>
        <p>• <span className="text-cyan-400">Cyan angles</span> = Joint angles (knee bend)</p>
        <p>• <span className="text-purple-400">Purple angles</span> = Elbow angles</p>
        <p>• <span className="text-orange-400">Orange angles</span> = Hip angles</p>
        <p>• White "seg:" = Segment angles (relative to vertical)</p>
        <p>• Green bars on timeline indicate detected movements</p>
        <p>• Active movements are displayed at the top during playback</p>
      </div>
    </Card>
  )
}
