import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** POST — Save a patient's exercise session results after comparison */
export async function POST(req: Request) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Server missing Supabase config" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Authenticate the patient
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await createClient(
      supabaseUrl, supabaseAnonKey
    ).auth.getUser(token)

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    }

    const body = await req.json()
    const {
      assignment_id,
      similarity_score,
      reps_completed,
      reps_expected,
      state_matches,
      angle_deviations,
      duration_seconds,
      valid_reps,
      good_reps,
      progress_score,
      form_score,
    } = body

    if (!assignment_id || similarity_score === undefined) {
      return NextResponse.json({
        error: "assignment_id and similarity_score are required"
      }, { status: 400 })
    }

    // Insert session
    const { data: session, error: insertErr } = await supabaseAdmin
      .from("exercise_sessions")
      .insert({
        patient_id: user.id,
        assignment_id,
        similarity_score: Math.round(similarity_score),
        reps_completed: reps_completed || 0,
        reps_expected: reps_expected || 0,
        state_matches: state_matches || {},
        angle_deviations: angle_deviations || {},
        duration_seconds: duration_seconds || 0,
        valid_reps: valid_reps ?? 0,
        good_reps: good_reps ?? 0,
        progress_score: progress_score ?? 0,
        form_score: form_score ?? 0,
      })
      .select("id, completed_at")
      .single()

    if (insertErr) {
      console.error("[save-session] Insert error:", insertErr.message)
      return NextResponse.json({ error: `Failed to save session: ${insertErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, session })
  } catch (err: any) {
    console.error("[save-session] Unexpected error:", err)
    return NextResponse.json({ error: `Unexpected error: ${err?.message || String(err)}` }, { status: 500 })
  }
}
