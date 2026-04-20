import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function GET(req: Request) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: "Server missing Supabase config" }, { status: 500 })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

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

    const { searchParams } = new URL(req.url)
    const assignmentId = searchParams.get("id")

    if (!assignmentId) {
      return NextResponse.json({ error: "Missing assignment id" }, { status: 400 })
    }

    const { data: assignment, error: assignmentError } = await supabaseAdmin
      .from("exercise_assignments")
      .select("video_path, patient_id")
      .eq("id", assignmentId)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json({ error: "Exercise not found" }, { status: 404 })
    }

    if (assignment.patient_id !== user.id) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 })
    }

    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin.storage
      .from("reference-videos")
      .createSignedUrl(assignment.video_path, 3600)

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error("[signed-url] Failed to create signed URL:", signedUrlError?.message)
      return NextResponse.json({ error: "Failed to generate video URL" }, { status: 500 })
    }

    return NextResponse.json({ signedUrl: signedUrlData.signedUrl })
  } catch (err: any) {
    console.error("[signed-url] Unexpected error:", err)
    return NextResponse.json({ error: `Unexpected error: ${err?.message || String(err)}` }, { status: 500 })
  }
}
