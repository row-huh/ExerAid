"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getExerciseConfig } from "@/lib/exercise-config"
import { formatDistanceToNow } from "date-fns"
import { Dumbbell, Play, Loader2 } from "lucide-react"
import { getSimilarityColor } from "@/lib/utils"

interface Assignment {
  id: string
  name: string
  exercise_type: string
  assigned_at: string
}

interface SessionSummary {
  assignment_id: string
  count: number
  avg_score: number
  last_completed: string
}

export default function PatientPage() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [doctorName, setDoctorName] = useState<string | null>(null)
  const [hasDoctor, setHasDoctor] = useState(false)
  const [loading, setLoading] = useState(true)


  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [sessionSummaries, setSessionSummaries] = useState<Map<string, SessionSummary>>(new Map())

  const [codeInput, setCodeInput] = useState("")
  const [linkError, setLinkError] = useState("")
  const [linking, setLinking] = useState(false)

  useEffect(() => {
    async function loadPatient() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.replace("/login")
        return
      }
      setEmail(session.user.email ?? null)

      // Fetch patient's doctor_id
      const { data: patient } = await supabase
        .from("patients")
        .select("*")
        .eq("id", session.user.id)
        .single()

      if (patient?.doctor_id) {
        const { data: doctorUser } = await supabase
          .from("users")
          .select("first_name, last_name")
          .eq("id", patient.doctor_id)
          .single()

        const name = doctorUser
          ? [doctorUser.first_name, doctorUser.last_name].filter(Boolean).join(" ")
          : ""
        setDoctorName(name || "Your Doctor")
        setHasDoctor(true)

        const { data: exerciseRows } = await supabase
          .from("exercise_assignments")
          .select("id, name, exercise_type, assigned_at")
          .eq("patient_id", session.user.id)
          .order("assigned_at", { ascending: false })

        if (exerciseRows && exerciseRows.length > 0) {
          setAssignments(exerciseRows)

          const { data: sessionRows } = await supabase
            .from("exercise_sessions")
            .select("assignment_id, similarity_score, completed_at")
            .eq("patient_id", session.user.id)
            .order("completed_at", { ascending: false })

          if (sessionRows) {
            const summaryMap = new Map<string, SessionSummary>()
            for (const s of sessionRows) {
              const existing = summaryMap.get(s.assignment_id)
              if (existing) {
                existing.count++
                existing.avg_score =
                  (existing.avg_score * (existing.count - 1) + s.similarity_score) / existing.count
              } else {
                summaryMap.set(s.assignment_id, {
                  assignment_id: s.assignment_id,
                  count: 1,
                  avg_score: s.similarity_score,
                  last_completed: s.completed_at,
                })
              }
            }
            setSessionSummaries(summaryMap)
          }
        }
      }

      setLoading(false)
    }
    loadPatient()
  }, [router])

  const handleLinkDoctor = async (e: React.FormEvent) => {
    e.preventDefault()
    setLinkError("")
    setLinking(true)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setLinkError("Session expired. Please log in again.")
      setLinking(false)
      return
    }

    const res = await fetch("/api/patient/link-doctor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ doctor_code: codeInput }),
    })

    const data = await res.json()
    setLinking(false)

    if (!res.ok) {
      setLinkError(data.error || "Failed to link doctor")
      return
    }

    setDoctorName(data.doctor_name ?? "your doctor")
    setHasDoctor(true)
    setCodeInput("")
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <h1 className="text-lg font-semibold">My Exercises</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:inline">{email}</span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>Sign Out</Button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : hasDoctor ? (
          <div className="space-y-6">
            {/* Doctor Info */}
            <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-sm font-bold text-primary">
                  {doctorName?.charAt(0)?.toUpperCase() || "D"}
                </span>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Your Doctor</p>
                <p className="font-semibold">{doctorName}</p>
              </div>
            </div>

            {/* Assigned Exercises */}
            {assignments.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Dumbbell className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    Your doctor hasn&apos;t assigned any exercises yet.
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Check back later or ask your doctor to assign exercises.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Your Exercises ({assignments.length})
                </h2>
                {assignments.map(assignment => {
                  const config = getExerciseConfig(assignment.exercise_type)
                  const summary = sessionSummaries.get(assignment.id)

                  return (
                    <Link
                      key={assignment.id}
                      href={`/patient/compare/${assignment.id}`}
                    >
                      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                        <CardContent className="flex items-center gap-4 py-4">
                          {/* Icon */}
                          <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <Dumbbell className="w-6 h-6 text-primary" />
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{assignment.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {config?.name ?? assignment.exercise_type}
                            </p>
                            {summary ? (
                              <div className="flex items-center gap-3 mt-1">
                                <span className="text-xs text-muted-foreground">
                                  {summary.count} session{summary.count !== 1 ? "s" : ""}
                                </span>
                                <span className={`text-xs font-semibold ${getSimilarityColor(summary.avg_score)}`}>
                                  Avg: {Math.round(summary.avg_score)}%
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  Last: {formatDistanceToNow(new Date(summary.last_completed), { addSuffix: true })}
                                </span>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground mt-1">
                                Not started yet
                              </p>
                            )}
                          </div>

                          {/* Score badge + arrow */}
                          <div className="flex items-center gap-2">
                            {summary && (
                              <div className="text-right">
                                <p className={`text-lg font-bold ${getSimilarityColor(summary.avg_score)}`}>
                                  {Math.round(summary.avg_score)}%
                                </p>
                              </div>
                            )}
                            <Play className="w-5 h-5 text-primary shrink-0" />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-sm mx-auto space-y-4 pt-12">
            <div className="text-center">
              <h2 className="text-lg font-semibold">Link to your Doctor</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Enter the code your doctor gave you to get started.
              </p>
            </div>
            <form onSubmit={handleLinkDoctor} className="flex gap-2">
              <Input
                placeholder="e.g. DR-A7X3"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                required
              />
              <Button type="submit" disabled={linking}>
                {linking ? "Linking..." : "Link"}
              </Button>
            </form>
            {linkError && (
              <p className="text-sm text-destructive">{linkError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
