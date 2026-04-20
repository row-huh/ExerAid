import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(req: Request) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Server missing Supabase config" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Get the session from the Authorization header
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
    }

    const token = authHeader.replace("Bearer ", "")
    const { data: { user }, error: userError } = await createClient(
      supabaseUrl,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    ).auth.getUser(token)

    if (userError || !user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 })
    }

    const body = await req.json()
    const { patient_id, name, exercise_type, video_path, video_url, template, notes, allow_progression } = body

    // Validate required fields
    if (!patient_id || !name || !exercise_type || !video_path || !video_url || !template) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    // Verify caller is a doctor
    const { data: doctor, error: doctorErr } = await supabaseAdmin
      .from("doctors")
      .select("id")
      .eq("id", user.id)
      .single()

    if (doctorErr || !doctor) {
      return NextResponse.json({ error: "Only doctors can assign exercises" }, { status: 403 })
    }

    // Verify patient belongs to this doctor
    const { data: patient, error: patientErr } = await supabaseAdmin
      .from("patients")
      .select("id")
      .eq("id", patient_id)
      .eq("doctor_id", user.id)
      .single()

    if (patientErr || !patient) {
      return NextResponse.json({ error: "Patient not found or not linked to you" }, { status: 403 })
    }

    // Insert the exercise assignment
    const { data: assignment, error: insertErr } = await supabaseAdmin
      .from("exercise_assignments")
      .insert({
        doctor_id: user.id,
        patient_id,
        name,
        exercise_type,
        video_path,
        video_url,
        template,
        notes: notes || null,
        allow_progression: allow_progression ?? true,
      })
      .select("id")
      .single()

    if (insertErr || !assignment) {
      console.error("[assign] Failed to insert exercise assignment:", insertErr?.message)
      return NextResponse.json({ error: "Failed to assign exercise" }, { status: 500 })
    }

    return NextResponse.json({ id: assignment.id })
  } catch (err: any) {
    console.error("[assign] Unexpected error:", err)
    return NextResponse.json({ error: `Unexpected error: ${err?.message || String(err)}` }, { status: 500 })
  }
}
