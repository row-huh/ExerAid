import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * POST /api/ideal-templates/store
 *
 * Stores a pre-analyzed ideal template for an exercise type.
 * The actual video analysis happens client-side (MediaPipe is browser-only),
 * so this endpoint just receives the resulting template and persists it.
 *
 * Body: { exercise_type, template, video_url? }
 * Auth: Bearer token — caller must be a doctor.
 */


export async function POST(req: Request) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Server missing Supabase config" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Authenticate
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

    // Only doctors can store ideal templates
    const { data: doctor, error: doctorErr } = await supabaseAdmin
      .from("doctors")
      .select("id")
      .eq("id", user.id)
      .single()

    if (doctorErr || !doctor) {
      return NextResponse.json({ error: "Only doctors can store ideal templates" }, { status: 403 })
    }

    const body = await req.json()
    const { exercise_type, template, video_url } = body

    if (!exercise_type || !template) {
      return NextResponse.json({ error: "Missing exercise_type or template" }, { status: 400 })
    }

    // Upsert — one ideal template per exercise type
    const { error: upsertErr } = await supabaseAdmin
      .from("ideal_templates")
      .upsert(
        {
          exercise_type,
          template,
          video_url: video_url ?? null,
          analyzed_at: new Date().toISOString(),
        },
        { onConflict: "exercise_type" }
      )

    if (upsertErr) {
      console.error("[ideal-templates/store] Upsert error:", upsertErr.message)
      return NextResponse.json({ error: "Failed to store ideal template" }, { status: 500 })
    }

    return NextResponse.json({ success: true, exercise_type })
  } catch (err: any) {
    console.error("[ideal-templates/store] Unexpected error:", err)
    return NextResponse.json({ error: `Unexpected error: ${err?.message || String(err)}` }, { status: 500 })
  }
}
