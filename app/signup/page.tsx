"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/utils/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"

export default function SignupPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState("patient")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // 👁️ password toggle state
  const [showPassword, setShowPassword] = useState(false)

  // After signup, show the OTP verification step
  const [awaitingVerification, setAwaitingVerification] = useState(false)
  const [token, setToken] = useState("")

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role }),
    })

    const data = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(data.error || "Signup failed")
      return
    }

    setAwaitingVerification(true)
  }

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: token.trim(),
      type: "signup",
    })

    setLoading(false)

    if (verifyError) {
      setError(verifyError.message)
      return
    }

    router.push("/onboarding")
    router.refresh()
  }

 return (
  <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">

    {/* ===================== CONTAINER ===================== */}
    <div className="w-full max-w-md space-y-6">

      {/* ===== APP HEADING ===== */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">
          Physiotherapy Guidance System
        </h1>
        <p className="text-sm text-muted-foreground">
          Smart exercise tracking & recovery support
        </p>
      </div>


      {/* ===================== CARD ===================== */}
      <Card className="rounded-2xl border shadow-sm">

        {/* ===== TITLE ===== */}
        <CardHeader>
          <CardTitle className="text-center text-xl font-semibold">
            {awaitingVerification ? "Verify Email" : "Create Account"}
          </CardTitle>
        </CardHeader>


        {/* ===================== CONTENT ===================== */}
        <CardContent className="space-y-4">

          {!awaitingVerification ? (
            <>
              <form onSubmit={handleSignup} className="space-y-4">

                {/* ===== EMAIL ===== */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>


                {/* ===== PASSWORD ===== */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Password</label>

                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>


                {/* ===== ROLE ===== */}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Role</label>

                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="patient">Patient</option>
                    <option value="doctor">Doctor</option>
                  </select>
                </div>


                {/* ===== ERROR ===== */}
                {error && (
                  <p className="text-sm text-destructive text-center">
                    {error}
                  </p>
                )}


                {/* ===== BUTTON ===== */}
                <Button type="submit" disabled={loading} className="w-full">
                  {loading ? "Creating Account..." : "Sign Up"}
                </Button>

              </form>


              {/* ===== LOGIN LINK ===== */}
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary hover:underline">
                  Log in
                </Link>
              </p>
            </>
          ) : (

            /* ===================== VERIFY UI ===================== */
            <form onSubmit={handleVerify} className="space-y-4">

              <p className="text-sm text-muted-foreground text-center">
                Enter the verification code sent to <br />
                <span className="font-semibold">{email}</span>
              </p>

              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Verification Code
                </label>

                <Input
                  type="text"
                  placeholder="Enter code"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoFocus
                  className="text-center tracking-widest font-mono"
                />
              </div>


              {error && (
                <p className="text-sm text-destructive text-center">
                  {error}
                </p>
              )}


              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Verifying..." : "Verify"}
              </Button>


              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setAwaitingVerification(false)
                  setError("")
                  setToken("")
                }}
              >
                Back
              </Button>

            </form>
          )}

        </CardContent>
      </Card>
    </div>
  </div>
)
}