import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY")
}
if (!supabaseServiceKey) {
  console.warn("Missing SUPABASE_SERVICE_ROLE_KEY — role/profile inserts will fail")
}

function generateDoctorCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no 0/O/1/I to avoid confusion
  let code = "DR-"
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { email, password, role } = body

    if (!email || !password || !role) {
      return NextResponse.json({ error: "email, password and role are required" }, { status: 400 })
    }

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Server missing Supabase config" }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    // Service role client bypasses RLS — used for DB writes only
    const supabaseAdmin = supabaseServiceKey
      ? createClient(supabaseUrl, supabaseServiceKey)
      : supabase

    console.log(`[signup] Attempting signup for ${email} as ${role}`)

    const { data: signData, error: signError } = await supabase.auth.signUp({ email, password })

    if (signError) {
      console.error(`[signup] Auth error:`, signError.message, `| status: ${signError.status}`)
      return NextResponse.json({ error: `Auth failed: ${signError.message}` }, { status: 400 })
    }

    const userId = signData?.user?.id
    console.log(`[signup] Auth user created:`, { userId, email, identities: signData?.user?.identities?.length })

    // If identities is empty, the email is already registered
    if (!userId || signData?.user?.identities?.length === 0) {
      console.warn(`[signup] User already exists or no ID returned for ${email}`)
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
    }


    if (role !== "patient" && role !== "doctor") {
      console.error(`[signup] Invalid role: ${role}`)
      // this shouldn't be a problem coz input sanitization is happening on the frontend
      // will remove later
      return NextResponse.json({ error: `Invalid role "${role}". Must be "patient" or "doctor"` }, { status: 400 })
    }

    // Set role on the users row created by the trigger
    const { error: updateErr } = await supabaseAdmin
      .from("users")
      .update({ role })
      .eq("id", userId)
    if (updateErr) {
      console.error(`[signup] Failed to set role on users row:`, updateErr.message, updateErr.details)
      return NextResponse.json({ error: `Account created but role update failed: ${updateErr.message}` }, { status: 500 })
    }

    // relevant row insert ere 
    if (role === "doctor") {
      // Insert doctor row with a unique doctor_code
      // this will only failif the same code already exists (unique constraints on the db so this'll be rejected)
      let inserted = false
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = generateDoctorCode()
        const { error: insertErr } = await supabaseAdmin
          .from("doctors")
          .insert({ id: userId, doctor_code: code })
        if (!insertErr) {
          console.log(`[signup] Doctor code assigned: ${code}`)
          inserted = true
          break
        }
        // retry with a new code upto 3 times before going YOU SHALL NOT PASS
        if (insertErr.code === "23505" && insertErr.message.includes("doctor_code")) {
          console.warn(`[signup] Doctor code collision (${code}), retrying...`)
          continue
        }
        // YOU SHALL NOT PASS
        console.error(`[signup] Failed to insert doctors row:`, insertErr.message, insertErr.details)
        return NextResponse.json({ error: `Account created but doctors profile failed: ${insertErr.message}` }, { status: 500 })
      }
      if (!inserted) {
        return NextResponse.json({ error: "Failed to generate a unique doctor code. Please try again." }, { status: 500 })
      }
    } else {
      const { error: insertErr } = await supabaseAdmin
        .from("patients")
        .insert({ id: userId })
      if (insertErr) {
        console.error(`[signup] Failed to insert patients row:`, insertErr.message, insertErr.details)
        return NextResponse.json({ error: `Account created but patients profile failed: ${insertErr.message}` }, { status: 500 })
      }
    }

    console.log(`[signup] Success: ${email} registered as ${role}`)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error(`[signup] Unexpected error:`, err)
    return NextResponse.json({ error: `Unexpected error: ${err?.message || String(err)}` }, { status: 500 })
  }
}
