"use client"

import { useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { supabase } from "@/utils/supabase/client"
import { getExerciseConfig } from "@/lib/exercise-config"
import type { LearnedExerciseTemplate } from "@/lib/exercise-state-learner"
import { getIdealTemplate } from "@/lib/ideal-template-manager"
import Link from "next/link"
import { useParams } from "next/navigation"
import { Loader2, CheckCircle2 } from "lucide-react"
import { ComparisonRecorder, type SessionEndData } from "@/components/comparison-recorder"


export default function ComparePage() {
  const params = useParams()
  const [exercise, setExercise] = useState<any>(null)
  const [allowProgression, setAllowProgression] = useState(true)
  const [idealTemplate, setIdealTemplate] = useState<LearnedExerciseTemplate | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [sessionSaved, setSessionSaved] = useState(false)
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [videoError, setVideoError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)


  useEffect(() => {
    async function fetchExercise() {
      setIsLoading(true)
      const { data, error } = await supabase
        .from("exercise_assignments")
        .select("id, name, exercise_type, video_url, template, allow_progression")
        .eq("id", params.id as string)
        .single()

      if (!data || error) {
        setIsLoading(false)
        return
      }

      setAllowProgression(data.allow_progression ?? true)

      // Fetch ideal template for this exercise type
      const ideal = await getIdealTemplate(data.exercise_type)
      setIdealTemplate(ideal)

      // Get a signed URL for the private storage bucket
      let videoUrl = data.video_url
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        try {
          const res = await fetch(`/api/exercises/signed-url?id=${data.id}`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          })
          if (res.ok) {
            const { signedUrl } = await res.json()
            videoUrl = signedUrl
          }
        } catch (e) {
          console.error("Failed to get signed URL, falling back to stored URL:", e)
        }
      }

      setExercise({
        id: data.id,
        name: data.name,
        type: data.exercise_type,
        videoUrl,
        learnedTemplate: data.template,
      })
      setIsLoading(false)
    }
    fetchExercise()
  }, [params.id])


  /** Save session results from real-time recording */
  const handleSessionEnd = async (data: SessionEndData) => {
    if (!exercise) return

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setSessionSaveError("Not authenticated")
        return
      }

      // Compute meaningful scores from real-time session data
      const repsExpected = exercise.learnedTemplate?.recommendedReps ?? 0
      const validRate = data.reps_completed > 0
        ? Math.round((data.valid_reps / data.reps_completed) * 100)
        : 0
      // Similarity: 50% valid rep rate + 50% form score
      const similarityScore = data.reps_completed > 0
        ? Math.round((validRate * 0.5) + (data.form_score * 0.5))
        : 0
      // Progress: ratio of good (ideal ROM) reps to total reps
      const progressScore = data.reps_completed > 0
        ? Math.round((data.good_reps / data.reps_completed) * 100)
        : 0

      const res = await fetch("/api/exercises/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          assignment_id: exercise.id,
          similarity_score: similarityScore,
          reps_completed: data.reps_completed,
          reps_expected: repsExpected,
          state_matches: {},
          angle_deviations: {},
          duration_seconds: data.duration_seconds,
          valid_reps: data.valid_reps,
          good_reps: data.good_reps,
          progress_score: progressScore,
          form_score: data.form_score,
        }),
      })

      if (res.ok) {
        setSessionSaved(true)
      } else {
        const result = await res.json()
        setSessionSaveError(result.error || "Failed to save session")
      }
    } catch (err) {
      console.error("Error saving session:", err)
      setSessionSaveError("Failed to save session")
    }
  }


  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3 text-white" />
          <p className="text-white/60">Loading exercise...</p>
        </div>
      </div>
    )
  }

  if (!exercise) {
    return (
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white/60 mb-4">Exercise not found</p>
          <Link href="/patient">
            <Button>Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    )
  }


  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
        <Link href="/patient" className="pointer-events-auto">
          <Button
            variant="outline"
            size="sm"
            className="bg-black/60 text-white border-white/30 hover:bg-white/10"
          >
            ← Back
          </Button>
        </Link>
        <h1 className="text-white font-semibold text-lg">{exercise.name}</h1>
        <div className="flex items-center gap-2">
          {sessionSaved && (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}
          {sessionSaveError && (
            <span className="text-xs text-red-400">{sessionSaveError}</span>
          )}
        </div>
      </div>

      {/* Split screen */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel: Reference Video */}
        <div className="w-1/2 h-full relative flex items-center justify-center bg-black border-r border-white/10">
          {videoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <div className="text-sm text-red-400 text-center p-4">
                <p className="font-semibold mb-2">Video Load Error</p>
                <p>{videoError}</p>
              </div>
            </div>
          )}
          <video
            ref={videoRef}
            controls
            loop
            muted
            autoPlay
            playsInline
            className="w-full h-full object-contain"
            crossOrigin="anonymous"
            onError={(e) => {
              setVideoError(
                e.currentTarget.error
                  ? `Error ${e.currentTarget.error.code}: ${e.currentTarget.error.message}`
                  : "Failed to load video"
              )
            }}
            onLoadedData={() => setVideoError(null)}
          >
            <source src={exercise.videoUrl} type="video/webm" />
            <source src={exercise.videoUrl} type="video/mp4" />
          </video>
          <div className="absolute bottom-4 left-4 bg-black/60 backdrop-blur-sm rounded px-3 py-1.5">
            <span className="text-xs font-medium text-white/80">Reference</span>
          </div>
        </div>

        {/* Right panel: Real-time recording */}
        <div className="w-1/2 h-full relative bg-black">
          <ComparisonRecorder
            fullscreen
            onSessionEnd={handleSessionEnd}
            anglesOfInterest={getExerciseConfig(exercise?.type)?.anglesOfInterest || ["right_knee"]}
            exerciseName={exercise?.name}
            exerciseType={exercise?.type}
            enableTestMode={true}
            referenceTemplate={exercise?.learnedTemplate}
            idealTemplate={idealTemplate ?? undefined}
            allowProgression={allowProgression}
          />
          <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-sm rounded px-3 py-1.5 pointer-events-none">
            <span className="text-xs font-medium text-white/80">Your Exercise</span>
          </div>
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 p-3 bg-red-900/80 border border-red-500 rounded-md max-w-md">
          <p className="text-sm text-red-200">{error}</p>
        </div>
      )}
    </div>
  )
}
