"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { RecordExercise } from "@/components/record-exercise"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"
import { getExerciseConfig } from "@/lib/exercise-config"
import { formatAngleName, getSimilarityColor, getSimilarityBg } from "@/lib/utils"
import {
  Users, Dumbbell, Activity, TrendingUp, Copy, Check,
  ChevronDown, ChevronRight, Plus, Loader2, Clock,
  Calendar, Target, User,
} from "lucide-react"
import { format, formatDistanceToNow } from "date-fns"

// ── Types ──────────────────────────────────────────────────────

interface PatientInfo {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
}

interface ExerciseAssignment {
  id: string
  name: string
  exercise_type: string
  video_url: string
  patient_id: string
  assigned_at: string
}

interface ExerciseSession {
  id: string
  patient_id: string
  assignment_id: string
  similarity_score: number
  reps_completed: number
  reps_expected: number
  state_matches: Record<string, number>
  angle_deviations: Record<string, number>
  duration_seconds: number
  completed_at: string
  valid_reps: number
  good_reps: number
  progress_score: number
  form_score: number
}

interface PatientData {
  info: PatientInfo
  assignments: ExerciseAssignment[]
  sessions: ExerciseSession[]
}



export default function DoctorDashboard() {
  const router = useRouter()
  const [email, setEmail] = useState<string | null>(null)
  const [doctorCode, setDoctorCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  // Data
  const [patients, setPatients] = useState<PatientData[]>([])
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null)
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null)

  // Dialog-based assign exercise
  const [assignPatient, setAssignPatient] = useState<PatientInfo | null>(null)

  const loadDashboard = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      router.replace("/login")
      return
    }

    setEmail(session.user.email ?? null)

    // Fetch doctor code
    const { data: doctor, error } = await supabase
      .from("doctors")
      .select("doctor_code")
      .eq("id", session.user.id)
      .single()

    if (error) {
      console.error("[doctor] Failed to fetch doctor_code:", error.message, error.code)
    }
    setDoctorCode(doctor?.doctor_code ?? null)

    const { data: patientRows } = await supabase
      .from("patients")
      .select("id")
      .eq("doctor_id", session.user.id)

    if (!patientRows || patientRows.length === 0) {
      setPatients([])
      setLoading(false)
      return
    }

    const patientIds = patientRows.map(p => p.id)

    
    const { data: userRows } = await supabase
      .from("users")
      .select("id, first_name, last_name, email")
      .in("id", patientIds)

    
    const { data: assignmentRows } = await supabase
      .from("exercise_assignments")
      .select("id, name, exercise_type, video_url, patient_id, assigned_at")
      .eq("doctor_id", session.user.id)
      .order("assigned_at", { ascending: false })

    
    const { data: sessionRows } = await supabase
      .from("exercise_sessions")
      .select("*")
      .in("patient_id", patientIds)
      .order("completed_at", { ascending: false })

    
    const assembled: PatientData[] = patientIds.map(pid => {
      const userInfo = userRows?.find(u => u.id === pid)
      return {
        info: {
          id: pid,
          email: userInfo?.email ?? "Unknown",
          firstName: userInfo?.first_name ?? null,
          lastName: userInfo?.last_name ?? null,
        },
        assignments: (assignmentRows ?? []).filter(a => a.patient_id === pid),
        sessions: (sessionRows ?? []).filter(s => s.patient_id === pid),
      }
    })

    setPatients(assembled)
    setLoading(false)
  }, [router])

  useEffect(() => {
    loadDashboard()
  }, [loadDashboard])

  const handleCopy = async () => {
    if (!doctorCode) return
    await navigator.clipboard.writeText(doctorCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }


  const totalPatients = patients.length
  const totalAssignments = patients.reduce((s, p) => s + p.assignments.length, 0)
  const allSessions = patients.flatMap(p => p.sessions)
  const totalSessions = allSessions.length
  const avgScore = totalSessions > 0
    ? Math.round(allSessions.reduce((s, x) => s + x.similarity_score, 0) / totalSessions)
    : 0
  const sessionsWithProgress = allSessions.filter(s => s.progress_score > 0)
  const avgProgress = sessionsWithProgress.length > 0
    ? Math.round(sessionsWithProgress.reduce((s, x) => s + x.progress_score, 0) / sessionsWithProgress.length)
    : 0



  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">Dashboard</h1>
            {doctorCode && (
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs font-mono font-medium hover:bg-muted/80 transition-colors"
              >
                <span className="text-muted-foreground">Code:</span>
                <span className="font-bold tracking-wider">{doctorCode}</span>
                {copied
                  ? <Check className="w-3 h-3 text-green-500" />
                  : <Copy className="w-3 h-3 text-muted-foreground" />
                }
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:inline">{email}</span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>Sign Out</Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Patients"
            value={totalPatients}
            icon={<Users className="w-4 h-4" />}
            color="text-blue-600 dark:text-blue-400"
            bg="bg-blue-50 dark:bg-blue-950/30"
          />
          <StatCard
            label="Exercises Assigned"
            value={totalAssignments}
            icon={<Dumbbell className="w-4 h-4" />}
            color="text-purple-600 dark:text-purple-400"
            bg="bg-purple-50 dark:bg-purple-950/30"
          />
          <StatCard
            label="Sessions Completed"
            value={totalSessions}
            icon={<Activity className="w-4 h-4" />}
            color="text-green-600 dark:text-green-400"
            bg="bg-green-50 dark:bg-green-950/30"
          />
          <StatCard
            label="Avg Progress"
            value={sessionsWithProgress.length > 0 ? `${avgProgress}%` : totalSessions > 0 ? `${avgScore}% sim` : "—"}
            icon={<TrendingUp className="w-4 h-4" />}
            color="text-amber-600 dark:text-amber-400"
            bg="bg-amber-50 dark:bg-amber-950/30"
          />
        </div>

        {/* Patients Section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Your Patients</h2>
            {doctorCode && (
              <p className="text-xs text-muted-foreground">
                Share code <span className="font-mono font-bold">{doctorCode}</span> to link new patients
              </p>
            )}
          </div>

          {patients.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground mb-1">No patients linked yet</p>
                <p className="text-sm text-muted-foreground">
                  Share your code <span className="font-mono font-bold">{doctorCode}</span> with patients to get started.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {patients.map(patient => (
                <PatientCard
                  key={patient.info.id}
                  patient={patient}
                  expanded={expandedPatient === patient.info.id}
                  expandedExercise={expandedExercise}
                  onToggle={() =>
                    setExpandedPatient(prev =>
                      prev === patient.info.id ? null : patient.info.id
                    )
                  }
                  onToggleExercise={(id) =>
                    setExpandedExercise(prev => prev === id ? null : id)
                  }
                  onAssignExercise={() => setAssignPatient(patient.info)}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Assign Exercise Dialog */}
      <Dialog
        open={assignPatient !== null}
        onOpenChange={(open) => { if (!open) setAssignPatient(null) }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Assign Exercise to{" "}
              {assignPatient
                ? getPatientName(assignPatient)
                : ""}
            </DialogTitle>
          </DialogHeader>
          {assignPatient && (
            <RecordExercise
              patientId={assignPatient.id}
              onComplete={() => {
                setAssignPatient(null)
                loadDashboard()
              }}
              doneLabel="Done"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Helper ──────────────────────────────────────────────────────

function getPatientName(info: PatientInfo): string {
  const name = [info.firstName, info.lastName].filter(Boolean).join(" ")
  return name || info.email
}

// ── StatCard ────────────────────────────────────────────────────

function StatCard({
  label, value, icon, color, bg,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  color: string
  bg: string
}) {
  return (
    <Card className="py-4">
      <CardContent className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg}`}>
          <span className={color}>{icon}</span>
        </div>
        <div>
          <p className="text-2xl font-bold leading-none">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
        </div>
      </CardContent>
    </Card>
  )
}


function PatientCard({
  patient,
  expanded,
  expandedExercise,
  onToggle,
  onToggleExercise,
  onAssignExercise,
}: {
  patient: PatientData
  expanded: boolean
  expandedExercise: string | null
  onToggle: () => void
  onToggleExercise: (id: string) => void
  onAssignExercise: () => void
}) {
  const { info, assignments, sessions } = patient
  const name = getPatientName(info)
  const totalSessions = sessions.length
  const avgScore = totalSessions > 0
    ? Math.round(sessions.reduce((s, x) => s + x.similarity_score, 0) / totalSessions)
    : null
  const lastSession = sessions[0]

  return (
    <Card className="overflow-hidden">
      {/* Patient Header — always visible */}
      <button
        onClick={onToggle}
        className="w-full text-left px-6 py-4 flex items-center gap-4 hover:bg-muted/50 transition-colors"
      >
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <User className="w-5 h-5 text-primary" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{name}</p>
          <p className="text-xs text-muted-foreground truncate">{info.email}</p>
        </div>

        {/* Quick Stats */}
        <div className="hidden sm:flex items-center gap-4 text-sm">
          <div className="text-center">
            <p className="font-semibold">{assignments.length}</p>
            <p className="text-xs text-muted-foreground">Exercises</p>
          </div>
          <div className="text-center">
            <p className="font-semibold">{totalSessions}</p>
            <p className="text-xs text-muted-foreground">Sessions</p>
          </div>
          {avgScore !== null && (
            <div className="text-center">
              <p className={`font-semibold ${getSimilarityColor(avgScore)}`}>{avgScore}%</p>
              <p className="text-xs text-muted-foreground">Avg Score</p>
            </div>
          )}
          {lastSession && (
            <div className="text-center">
              <p className="font-semibold text-xs">
                {formatDistanceToNow(new Date(lastSession.completed_at), { addSuffix: true })}
              </p>
              <p className="text-xs text-muted-foreground">Last Active</p>
            </div>
          )}
        </div>

        {/* Expand arrow */}
        {expanded
          ? <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />
          : <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        }
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t px-6 py-4 space-y-4 bg-muted/30">
          {/* Mobile stats */}
          <div className="flex sm:hidden gap-3 flex-wrap">
            <MiniStat label="Exercises" value={assignments.length} />
            <MiniStat label="Sessions" value={totalSessions} />
            {avgScore !== null && <MiniStat label="Avg Score" value={`${avgScore}%`} />}
          </div>

          {/* Assigned Exercises */}
          {assignments.length === 0 ? (
            <div className="text-center py-6">
              <Dumbbell className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground mb-3">
                No exercises assigned yet
              </p>
              <Button size="sm" onClick={onAssignExercise}>
                <Plus className="w-4 h-4 mr-1" /> Assign Exercise
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Assigned Exercises
                </h3>
                <Button variant="outline" size="sm" onClick={onAssignExercise}>
                  <Plus className="w-3 h-3 mr-1" /> Assign
                </Button>
              </div>
              <div className="space-y-2">
                {assignments.map(assignment => {
                  const exerciseSessions = sessions
                    .filter(s => s.assignment_id === assignment.id)
                    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
                  const isExpanded = expandedExercise === assignment.id
                  return (
                    <ExerciseCard
                      key={assignment.id}
                      assignment={assignment}
                      sessions={exerciseSessions}
                      expanded={isExpanded}
                      onToggle={() => onToggleExercise(assignment.id)}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}



function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-background rounded-md border px-3 py-1.5 text-center">
      <p className="font-semibold text-sm">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}



function ExerciseCard({
  assignment,
  sessions,
  expanded,
  onToggle,
}: {
  assignment: ExerciseAssignment
  sessions: ExerciseSession[]
  expanded: boolean
  onToggle: () => void
}) {
  const config = getExerciseConfig(assignment.exercise_type)
  const sessionCount = sessions.length
  const hasProgressData = sessions.some(s => s.progress_score > 0)

  // Use progress_score if available, fall back to similarity_score
  const avgScore = sessionCount > 0
    ? hasProgressData
      ? Math.round(sessions.filter(s => s.progress_score > 0).reduce((s, x) => s + x.progress_score, 0) / sessions.filter(s => s.progress_score > 0).length)
      : Math.round(sessions.reduce((s, x) => s + x.similarity_score, 0) / sessionCount)
    : null

  // Trend: compare last session to average of previous sessions
  let trend: "up" | "down" | "stable" | null = null
  if (sessions.length >= 2) {
    const scoreKey = hasProgressData ? "progress_score" : "similarity_score"
    const recent = sessions[0][scoreKey]
    const prevAvg = sessions.slice(1).reduce((s, x) => s + x[scoreKey], 0) / (sessions.length - 1)
    if (recent > prevAvg + 3) trend = "up"
    else if (recent < prevAvg - 3) trend = "down"
    else trend = "stable"
  }

  return (
    <div className="bg-background rounded-lg border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors"
      >
        {/* Exercise icon */}
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Dumbbell className="w-4 h-4 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{assignment.name}</p>
          <p className="text-xs text-muted-foreground">
            {config?.name ?? assignment.exercise_type}
            {assignment.assigned_at && (
              <> &middot; Assigned {format(new Date(assignment.assigned_at), "MMM d")}</>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {sessionCount > 0 && (
            <div className="text-right">
              <div className="flex items-center gap-1">
                {avgScore !== null && (
                  <span className={`text-sm font-semibold ${getSimilarityColor(avgScore)}`}>
                    {avgScore}%
                  </span>
                )}
                {trend === "up" && <TrendingUp className="w-3 h-3 text-green-500" />}
                {trend === "down" && <TrendingUp className="w-3 h-3 text-red-500 rotate-180" />}
              </div>
              <p className="text-[10px] text-muted-foreground">{sessionCount} session{sessionCount !== 1 ? "s" : ""}</p>
            </div>
          )}
          {sessionCount === 0 && (
            <span className="text-xs text-muted-foreground">No sessions yet</span>
          )}
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground" />
          }
        </div>
      </button>

      {expanded && sessions.length > 0 && (
        <div className="border-t px-4 py-3 space-y-3">
          {/* Progress bar visual */}
          {sessions.length >= 2 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Progress over sessions</p>
              <div className="flex items-end gap-1 h-12">
                {sessions.slice().reverse().map((s, i) => (
                  <div
                    key={s.id}
                    className="flex-1 rounded-t-sm transition-all"
                    style={{
                      height: `${Math.max(s.similarity_score, 8)}%`,
                      backgroundColor: s.similarity_score >= 80
                        ? "var(--color-chart-2)"
                        : s.similarity_score >= 60
                          ? "var(--color-chart-5)"
                          : "var(--color-destructive)",
                      opacity: 0.5 + (i / sessions.length) * 0.5,
                    }}
                    title={`${s.similarity_score}% — ${format(new Date(s.completed_at), "MMM d")}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Session list */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Session History</p>
            {sessions.map(session => (
              <SessionRow key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── SessionRow ──────────────────────────────────────────────────

function SessionRow({ session }: { session: ExerciseSession }) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="bg-muted/50 rounded-md">
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="w-full text-left px-3 py-2 flex items-center gap-3 text-sm hover:bg-muted transition-colors rounded-md"
      >
        <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground w-24 shrink-0">
          {format(new Date(session.completed_at), "MMM d, h:mm a")}
        </span>
        <div className="flex-1 flex items-center gap-3 flex-wrap">
          {/* Progress or Similarity */}
          {session.progress_score > 0 ? (
            <div className="flex items-center gap-1.5">
              <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${getSimilarityBg(session.progress_score)}`}
                  style={{ width: `${session.progress_score}%` }}
                />
              </div>
              <span className={`text-xs font-semibold min-w-[2rem] ${getSimilarityColor(session.progress_score)}`}>
                {session.progress_score}%
              </span>
              <span className="text-[10px] text-muted-foreground">progress</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="w-16 bg-muted rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${getSimilarityBg(session.similarity_score)}`}
                  style={{ width: `${session.similarity_score}%` }}
                />
              </div>
              <span className={`text-xs font-semibold min-w-[2rem] ${getSimilarityColor(session.similarity_score)}`}>
                {session.similarity_score}%
              </span>
            </div>
          )}
          {/* Valid/Good Reps or fallback to old reps */}
          {session.valid_reps > 0 ? (
            <span className="text-xs text-muted-foreground">
              <Target className="w-3 h-3 inline mr-0.5" />
              {session.valid_reps} valid · {session.good_reps} good / {session.reps_completed}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              <Target className="w-3 h-3 inline mr-0.5" />
              {session.reps_completed}/{session.reps_expected} reps
            </span>
          )}
          {/* Form score badge */}
          {session.form_score > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              session.form_score >= 80
                ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                : session.form_score >= 50
                  ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400"
                  : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
            }`}>
              Form: {session.form_score}%
            </span>
          )}
        </div>
        {showDetails
          ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground" />
        }
      </button>

      {showDetails && (
        <div className="px-3 pb-3 space-y-2">
          {/* Progress metrics */}
          {session.progress_score > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400">
                Progress: {session.progress_score}%
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400">
                Form: {session.form_score}%
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400">
                Valid: {session.valid_reps} · Good: {session.good_reps}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-700 dark:bg-gray-950/40 dark:text-gray-400">
                Similarity: {session.similarity_score}%
              </span>
            </div>
          )}

          {/* State Matches */}
          {session.state_matches && Object.keys(session.state_matches).length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">State Accuracy</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(session.state_matches).map(([state, score]) => (
                  <span
                    key={state}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      score >= 80
                        ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                        : score >= 60
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400"
                          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    }`}
                  >
                    {state}: {Math.round(score)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Angle Deviations */}
          {session.angle_deviations && Object.keys(session.angle_deviations).length > 0 && (
            <div>
              <p className="text-[10px] font-medium text-muted-foreground mb-1">Angle Deviations</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(session.angle_deviations).map(([angle, deviation]) => (
                  <span
                    key={angle}
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      deviation < 10
                        ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                        : deviation < 20
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400"
                          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400"
                    }`}
                  >
                    {formatAngleName(angle)}: ±{Math.round(deviation)}°
                  </span>
                ))}
              </div>
            </div>
          )}

          {session.duration_seconds > 0 && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Duration: {Math.round(session.duration_seconds)}s
            </p>
          )}
        </div>
      )}
    </div>
  )
}
