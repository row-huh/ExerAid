"use client"

import { Button } from "@/components/ui/button"
import { RecordExercise } from "@/components/record-exercise"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

export default function RecordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <Link href="/doctor">
          <Button variant="outline">Back</Button>
        </Link>

        <RecordExercise
          defaultName={searchParams.get("name") || ""}
          defaultType={searchParams.get("type") || "knee-extension"}
          onComplete={() => router.push("/doctor")}
          doneLabel="Back to Dashboard"
        />
      </div>
    </main>
  )
}
