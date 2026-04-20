"use client"

import { useState } from "react"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { Eye, EyeOff } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  //  toggle state
  const [showPassword, setShowPassword] = useState(false)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (signInError) {
      setError(signInError.message)
      return
    }

    router.push("/")
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


      <Card className="rounded-2xl border shadow-sm">

        {/* Title */}
        <CardHeader>
          <CardTitle className="text-center text-xl font-semibold">
            Log In
          </CardTitle>
        </CardHeader>


        <CardContent className="space-y-4">

          <form onSubmit={handleLogin} className="space-y-4">

            {/* email */}
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


            {/* password+ see password */}
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


            {/* error */}
            {error && (
              <p className="text-sm text-destructive text-center">
                {error}
              </p>
            )}


            {/* log in */}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? "Logging in..." : "Log In"}
            </Button>

          </form>


          {/* Signup Link */}
          <p className="text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>

        </CardContent>
      </Card>
    </div>
  </div>
)
}