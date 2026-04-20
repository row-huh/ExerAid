import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: Request) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Server missing Supabase config" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Authenticate the doctor
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

    // Verify user is a doctor
    const { data: doctorRow } = await supabaseAdmin
      .from("doctors")
      .select("id")
      .eq("id", user.id)
      .single()

    if (!doctorRow) {
      return NextResponse.json({ error: "Only doctors can assign exercises" }, { status: 403 })
    }

    const body = await req.json()
    const { patient_id, name, exercise_type, video_url, template } = body

    if (!patient_id || !name || !exercise_type || !video_url) {
      return NextResponse.json({
        error: "patient_id, name, exercise_type, and video_url are required"
      }, { status: 400 })
    }

    // Verify the patient belongs to this doctor
    const { data: patient } = await supabaseAdmin
      .from("patients")
      .select("id")
      .eq("id", patient_id)
      .eq("doctor_id", user.id)
      .single()

    if (!patient) {
      return NextResponse.json({ error: "Patient not found or not linked to you" }, { status: 404 })
    }

    // Insert the exercise assignment
    const { data: assignment, error: insertErr } = await supabaseAdmin
      .from("exercise_assignments")
      .insert({
        name,
        exercise_type,
        video_url,
        template: template || null,
        doctor_id: user.id,
        patient_id,
      })
      .select("id, name, exercise_type, created_at")
      .single()

    if (insertErr) {
      console.error("[assign-exercise] Insert error:", insertErr.message)
      return NextResponse.json({ error: `Failed to assign exercise: ${insertErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ ok: true, assignment })
  } catch (err: any) {
    console.error("[assign-exercise] Unexpected error:", err)
    return NextResponse.json({ error: `Unexpected error: ${err?.message || String(err)}` }, { status: 500 })
  }
}
