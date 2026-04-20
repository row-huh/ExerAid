// when progression = True in exercises then fetch the ideal template for the relevant exercise

import { supabase } from "@/utils/supabase/client"
import type { LearnedExerciseTemplate } from "./exercise-state-learner"

// im memory cache so we dont refetch the same ideal template every time
const cache = new Map<string, LearnedExerciseTemplate>()

export async function getIdealTemplate(
  exerciseType: string
): Promise<LearnedExerciseTemplate | null> {
  // Check cache first
  const cached = cache.get(exerciseType)
  if (cached) return cached

  const { data, error } = await supabase
    .from("ideal_templates")
    .select("template")
    .eq("exercise_type", exerciseType)
    .single()

  if (error || !data) return null

  const template = data.template as LearnedExerciseTemplate
  cache.set(exerciseType, template)
  return template
}


export async function storeIdealTemplate(
  exerciseType: string,
  template: LearnedExerciseTemplate,
  videoUrl?: string
): Promise<void> {
  const { error } = await supabase
    .from("ideal_templates")
    .upsert(
      {
        exercise_type: exerciseType,
        template,
        video_url: videoUrl ?? null,
        analyzed_at: new Date().toISOString(),
      },
      { onConflict: "exercise_type" }
    )

  if (error) {
    throw new Error(`Failed to store ideal template: ${error.message}`)
  }

  // Update cache
  cache.set(exerciseType, template)
}

/** Clear the in-memory cache (useful after manual DB edits). */
export function clearIdealTemplateCache(): void {
  cache.clear()
}
