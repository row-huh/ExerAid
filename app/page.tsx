"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import Image from "next/image"
import { supabase } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"

export default function Home() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    async function checkSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        setLoading(false)
        return
      }

      // get role
      const { data } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.user.id)
        .single()

      const userRole = data?.role ?? null
      setRole(userRole)
      setLoading(false)

      // redirect
      if (userRole === "patient") {
        router.replace("/patient")
      } else if (userRole === "doctor") {
        router.replace("/doctor")
      }
    }

    checkSession()
  }, [router])

  // 🔄 Loading
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  // 🚫 prevent UI flash if logged in
  if (role) return null

  return (
    <div className="min-h-screen bg-background">
     <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-background/70 border-b border-border">
  <nav className="container mx-auto px-6 lg:px-12 py-4 flex items-center justify-between">

    {/* LOGO */}
    <Link
      href="/"
      className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2"
    >
      <span className="w-2 h-2 bg-primary rounded-full"></span>
      PhysioGuide
    </Link>

    {/* NAV LINKS */}
    <div className="hidden md:flex items-center gap-8 text-sm font-medium">
      <Link
        href="#services"
        className="text-muted-foreground hover:text-foreground transition relative group"
      >
        Services
        <span className="absolute left-0 -bottom-1 w-0 h-[2px] bg-primary transition-all group-hover:w-full"></span>
      </Link>

      <Link
        href="#about"
        className="text-muted-foreground hover:text-foreground transition relative group"
      >
        About
        <span className="absolute left-0 -bottom-1 w-0 h-[2px] bg-primary transition-all group-hover:w-full"></span>
      </Link>
    </div>

    {/* ACTION BUTTONS */}
    <div className="flex items-center gap-3">
      <Button
        asChild
        variant="ghost"
        className="text-sm hover:bg-secondary transition"
      >
        <Link href="/login">Log In</Link>
      </Button>

      <Button
        asChild
        className="text-sm rounded-full px-6 shadow-md hover:shadow-lg transition"
      >
        <Link href="/signup">Sign Up</Link>
      </Button>
    </div>

  </nav>
</header>
      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center pt-20">
        <div className="container mx-auto px-6 lg:px-12">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary mb-8">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              <span className="text-sm text-muted-foreground">
                Expert Physiotherapy Guidance
              </span>
            </div>

            <h1 className="text-5xl md:text-6xl lg:text-7xl font-serif">
              Physiotherapy Guidance System
            </h1>

            <p className="mt-8 text-lg text-muted-foreground max-w-2xl mx-auto">
              Professional guidance for your recovery journey. Connect with expert physiotherapists.
            </p>

            <div className="mt-12">
              <Button asChild size="lg" className="rounded-full px-10 py-6">
                <Link href="/signup">Get Started</Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Background Image */}
        <div className="absolute inset-0 opacity-[0.10] pointer-events-none">
          <Image
            src="/images/pic.png" 
            alt=""
            fill
            className="object-contain"
          />
        </div>
      </section>

      {/* Services */}
    {/* SERVICES */}
<section id="services" className="py-32">
  <div className="container mx-auto px-6 lg:px-12">

    <div className="text-center max-w-2xl mx-auto mb-20">
      <h2 className="text-4xl font-bold mb-4">Our Services</h2>
      <p className="text-muted-foreground">
        Comprehensive physiotherapy solutions designed to accelerate your recovery.
      </p>
    </div>

    <div className="grid lg:grid-cols-3 gap-10">

      {/* CARD 1 */}
      <div className="group rounded-3xl overflow-hidden shadow-xl hover:shadow-2xl transition bg-background">
        <div className="relative h-64">
          <Image
            src="/images/service1.jpg"
            alt=""
            fill
            className="object-cover group-hover:scale-110 transition duration-500"
          />
        </div>
        <div className="p-8">
          <h3 className="text-2xl font-semibold mb-3">
            Personalized Assessment
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Get a detailed evaluation and customized recovery plan tailored to your specific condition.
          </p>
        </div>
      </div>

      {/* CARD 2 */}
      <div className="group rounded-3xl overflow-hidden shadow-xl hover:shadow-2xl transition bg-background">
        <div className="relative h-64">
          <Image
            src="/images/service2.jpg"
            alt=""
            fill
            className="object-cover group-hover:scale-110 transition duration-500"
          />
        </div>
        <div className="p-8">
          <h3 className="text-2xl font-semibold mb-3">
            Expert Consultation
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Connect with certified physiotherapists and receive expert guidance anytime.
          </p>
        </div>
      </div>

      {/* CARD 3 */}
      <div className="group rounded-3xl overflow-hidden shadow-xl hover:shadow-2xl transition bg-background">
        <div className="relative h-64">
          <Image
            src="/images/service3.jpg"
            alt=""
            fill
            className="object-cover group-hover:scale-110 transition duration-500"
          />
        </div>
        <div className="p-8">
          <h3 className="text-2xl font-semibold mb-3">
            Progress Tracking
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            Monitor your recovery with real-time insights and data-driven progress tracking.
          </p>
        </div>
      </div>

    </div>
  </div>
</section>


{/* ABOUT */}
<section id="about" className="py-32 bg-secondary">
  <div className="container mx-auto px-6 lg:px-12 grid lg:grid-cols-2 gap-20 items-center">

    {/* IMAGE */}
    <div className="relative h-[500px] rounded-3xl overflow-hidden shadow-2xl">
      <Image
        src="/images/anatomy.jpg"
        alt="Anatomy"
        fill
        className="object-cover"
      />
    </div>

    {/* TEXT */}
    <div>
      <h2 className="text-4xl font-bold mb-6 leading-tight">
        Built for Precision <br /> & Better Recovery
      </h2>

      <p className="text-muted-foreground mb-6 leading-relaxed text-lg">
        Our physiotherapy guidance system blends clinical expertise with modern technology,
        helping patients recover faster and more effectively through personalized care.
      </p>

      <p className="text-muted-foreground mb-10 leading-relaxed">
        We empower both patients and professionals with tools to track progress,
        optimize treatment, and achieve long-term health outcomes.
      </p>

      {/* STATS */}
      <div className="grid grid-cols-3 gap-8">
        <div>
          <h3 className="text-3xl font-bold">500+</h3>
          <p className="text-muted-foreground">Patients</p>
        </div>
        <div>
          <h3 className="text-3xl font-bold">50+</h3>
          <p className="text-muted-foreground">Experts</p>
        </div>
        <div>
          <h3 className="text-3xl font-bold">98%</h3>
          <p className="text-muted-foreground">Success Rate</p>
        </div>
      </div>
    </div>

  </div>
</section>


{/* CTA */}
<section className="py-32 bg-foreground text-center">
  <div className="max-w-2xl mx-auto px-6">
    <h2 className="text-4xl font-bold text-background mb-6">
      Ready to start your recovery journey?
    </h2>

    <p className="text-background/70 mb-10">
      Join thousands of patients improving their health with our platform.
    </p>

    <div className="flex justify-center gap-4">
      <Button asChild size="lg">
        <Link href="/signup">Sign Up</Link>
      </Button>
      <Button asChild size="lg" variant="outline">
        <Link href="/login">Login</Link>
      </Button>
    </div>
  </div>
</section>


{/* FOOTER */}
<footer className="py-16 bg-background border-t">
  <div className="container mx-auto px-6 lg:px-12">

    <div className="flex flex-col md:flex-row justify-between items-center gap-6">

      <h1 className="text-lg font-semibold">PhysioGuide</h1>

      <div className="flex gap-6 text-sm text-muted-foreground">
        <Link href="#services">Services</Link>
        <Link href="#about">About</Link>
        <Link href="/login">Login</Link>
      </div>

      <p className="text-sm text-muted-foreground">
        © 2026 PhysioGuide. All rights reserved.
      </p>

    </div>
  </div>
</footer>
    </div>
  )
}