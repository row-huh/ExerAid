"use client"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { VideoAnalysisPlayer } from "@/components/video-analysis-player"
import { LearnedTemplateView } from "@/components/learned-template-view"
import { uploadVideoToStorage } from "@/lib/storage"
import { supabase } from "@/utils/supabase/client"
import { analyzeVideoForPose, type PoseAnalysisResult } from "@/lib/pose-analyzer"
import { EXERCISE_CONFIGS, getExerciseConfig } from "@/lib/exercise-config"
import { Switch } from "@/components/ui/switch"
import { formatAngleName } from "@/lib/utils"




interface RecordExerciseProps {
  defaultName?: string
  defaultType?: string
  patientId?: string
  onComplete?: () => void
  doneLabel?: string
}




export function RecordExercise({
  defaultName = "",
  defaultType = "knee-extension",
  patientId,
  onComplete,
  doneLabel = "Back to Dashboard",
}: RecordExerciseProps) {
  const [step, setStep] = useState<"input" | "recording" | "complete">(
    defaultName ? "recording" : "input",
  )



  const [exerciseName, setExerciseName] = useState(defaultName)
  const [exerciseType, setExerciseType] = useState(defaultType)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [allowProgression, setAllowProgression] = useState(true)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<PoseAnalysisResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)


  const videoRef = useRef<HTMLVideoElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  const [recording, setRecording] = useState(false)
  const [hasVideo, setHasVideo] = useState(false)




  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setHasVideo(true)
      }
    } catch (err) {
      console.error("Error accessing webcam:", err)
    }
  }

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      setHasVideo(false)
    }
  }

  const startRecording = () => {
    if (!streamRef.current) return

    chunksRef.current = []
    mediaRecorderRef.current = new MediaRecorder(streamRef.current)

    mediaRecorderRef.current.ondataavailable = (e) => {
      chunksRef.current.push(e.data)
    }

    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" })
      handleRecordComplete(blob)
    }

    mediaRecorderRef.current.start()
    setRecording(true)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop()
      setRecording(false)
    }
  }

  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && file.type.startsWith("video/")) {
      setRecordedBlob(file)
      setStep("complete")
    } else {
      alert("Please upload a valid video file")
    }
  }

  const handleRecordComplete = (videoBlob: Blob) => {
    setRecordedBlob(videoBlob)
    setStep("complete")
  }

  const handleSave = async () => {
    if (recordedBlob) {
      setIsAnalyzing(true)

      try {
        const exerciseConfig = getExerciseConfig(exerciseType)
        const anglesOfInterest = exerciseConfig?.anglesOfInterest

        const exerciseInfo = {
          name: exerciseName.trim() || exerciseConfig?.name || "exercise",
          type: exerciseType,
        }

        const result = await analyzeVideoForPose(
          recordedBlob,
          anglesOfInterest,
          exerciseInfo
        )
        setAnalysisResult(result)

        const videoName = exerciseName.trim() || exerciseConfig?.name || "exercise"


        if (!patientId) {
          throw new Error("No patient selected. Please select a patient first.")
        }

        const { videoUrl, videoPath } = await uploadVideoToStorage(videoName, recordedBlob, exerciseType)

        const { data: { session } } = await supabase.auth.getSession()
        if (!session) throw new Error("Session expired. Please log in again.")

        const res = await fetch("/api/exercises/assign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            patient_id: patientId,
            name: videoName,
            exercise_type: exerciseType,
            video_path: videoPath,
            video_url: videoUrl,
            template: result.learnedTemplate,
            allow_progression: allowProgression,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || "Failed to assign exercise")
        }

      } catch (error) {
        console.error("Error analyzing video:", error)
        alert(`Error analyzing video: ${error instanceof Error ? error.message : "Unknown error"}`)
      } finally {
        setIsAnalyzing(false)
      }
    }
  }

  return (
    <div className="space-y-6">
      {step === "input" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Record Exercise</h1>
            <p className="text-muted-foreground">Select exercise type and record video</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium">Exercise Type</label>
              <select
                value={exerciseType}
                onChange={(e) => setExerciseType(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {EXERCISE_CONFIGS.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {getExerciseConfig(exerciseType)?.description}
              </p>
              <div className="text-xs text-muted-foreground mt-2">
                <strong>Tracked angles:</strong>{" "}
                {getExerciseConfig(exerciseType)
                  ?.anglesOfInterest.map(formatAngleName)
                  .join(", ")}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium">Exercise Name (Optional)</label>
              <Input
                placeholder="e.g., Morning knee extension"
                value={exerciseName}
                onChange={(e) => setExerciseName(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <label htmlFor="allow-progression" className="text-sm font-medium">
                  Allow progression
                </label>
                <p className="text-xs text-muted-foreground">
                  Patient can progress beyond this reference toward the ideal range of motion
                </p>
              </div>
              <Switch
                id="allow-progression"
                checked={allowProgression}
                onCheckedChange={setAllowProgression}
              />
            </div>
          </div>

          <Button onClick={() => setStep("recording")} className="w-full">
            Start Recording
          </Button>
        </div>
      )}

      {step === "recording" && (
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {exerciseName || getExerciseConfig(exerciseType)?.name}
            </h1>
            <p className="text-muted-foreground">Record or upload your exercise video</p>
            <div className="mt-2 text-sm bg-muted p-3 rounded-lg">
              <strong>Tracking:</strong>{" "}
              {getExerciseConfig(exerciseType)
                ?.anglesOfInterest.map((a) => formatAngleName(a).toUpperCase())
                .join(", ")}
            </div>
          </div>

          <Card className="p-6 space-y-4">
            <div className="aspect-video bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>

            <div className="flex gap-2">
              {!hasVideo ? (
                <Button onClick={startWebcam} className="flex-1">
                  Start Webcam
                </Button>
              ) : (
                <>
                  <Button onClick={stopWebcam} variant="outline" className="flex-1 bg-transparent">
                    Stop Webcam
                  </Button>

                  {!recording ? (
                    <Button onClick={startRecording} className="flex-1 bg-red-600 hover:bg-red-700">
                      Start Recording
                    </Button>
                  ) : (
                    <Button onClick={stopRecording} variant="secondary" className="flex-1">
                      Stop Recording
                    </Button>
                  )}
                </>
              )}
            </div>

            {recording && (
              <p className="text-sm text-red-600 animate-pulse">
                ● Recording...
              </p>
            )}
          </Card>
          {recordedBlob && (
            <Button onClick={() => setStep("complete")} className="w-full">
              Done Recording
            </Button>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">Or</span>
            </div>
          </div>

          <div className="space-y-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleVideoUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full"
            >
              Upload Video File
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              Upload a pre-recorded video for analysis
            </p>
          </div>
        </div>
      )}

      {step === "complete" && recordedBlob && (
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">
              {isAnalyzing ? "Analyzing Video..." : analysisResult ? "Analysis Complete" : "Save Exercise"}
            </h1>
            <p className="text-muted-foreground">
              {isAnalyzing
                ? "Processing your exercise with MediaPipe..."
                : analysisResult
                  ? "Joint movement analysis results"
                  : "Your video has been recorded"}
            </p>
          </div>

          {isAnalyzing && (
            <Card className="p-8">
              <div className="flex flex-col items-center space-y-4">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
                <p className="text-sm text-muted-foreground">
                  Detecting pose landmarks and calculating joint angles...
                </p>
              </div>
            </Card>
          )}

          {!isAnalyzing && !analysisResult && (
            <Button onClick={handleSave} className="w-full">
              Analyze & Save Exercise
            </Button>
          )}

          {analysisResult && (
            <div className="space-y-4">
              <Card className="p-6 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                <h3 className="font-semibold mb-2">
                  {getExerciseConfig(exerciseType)?.name} Analysis
                </h3>
                <p className="text-sm text-muted-foreground">
                  Analyzed joints: {getExerciseConfig(exerciseType)
                    ?.anglesOfInterest.map(formatAngleName)
                    .join(", ")}
                </p>
              </Card>

              <VideoAnalysisPlayer
                videoBlob={recordedBlob}
                movements={analysisResult.movements}
                anglesOfInterest={getExerciseConfig(exerciseType)?.anglesOfInterest}
              />

              {analysisResult.learnedTemplate && (
                <LearnedTemplateView
                  template={analysisResult.learnedTemplate}
                />
              )}

              <Button
                onClick={() => onComplete?.()}
                className="w-full"
              >
                {doneLabel}
              </Button>
            </div>
          )}

          {!isAnalyzing && !analysisResult && (
            <Button
              variant="outline"
              onClick={() => {
                setRecordedBlob(null)
                setStep("recording")
              }}
              className="w-full"
            >
              Record Again
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
