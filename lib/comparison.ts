import type { LearnedExerciseTemplate, DetectedState } from "@/lib/exercise-state-learner"
import { getExerciseConfig } from "./exercise-config"

export interface ComparisonResult {
  similarity: number
  referenceReps: number
  uploadedReps: number
  details: {
    referenceTemplate: LearnedExerciseTemplate
    uploadedTemplate: LearnedExerciseTemplate
    stateMatches: { [key: string]: number }
    angleDeviations: { [key: string]: number }
  }
}


// Compare two learned exercise templates and return a similarity score.
// Score = (stateSimilarity × 0.6) + (angleAccuracy × 0.4)
//
// IMPORTANT: Only compares exercise-relevant joints. For knee extensions,
// only knee/leg angles matter — arm movement is ignored entirely.
export function compareTemplates(
  reference: LearnedExerciseTemplate,
  uploaded: LearnedExerciseTemplate
): ComparisonResult {
  const stateMatches: { [key: string]: number } = {}
  const angleDeviations: { [key: string]: number } = {}

  // Get exercise-specific angles — only these joints matter for comparison
  const exerciseType = reference.exerciseType
  const config = getExerciseConfig(exerciseType)
  const relevantAngles: Set<string> | null = config
    ? new Set(config.anglesOfInterest)
    : null // null = no config found, fall back to all angles

  // For each reference state, find the closest matching uploaded state
  // (only comparing relevant joints)
  reference.states.forEach((refState) => {
    const closestMatch = uploaded.states.reduce((best, upState) => {
      const similarity = calculateStateSimilarity(refState, upState, relevantAngles)
      return similarity > best.similarity ? { state: upState, similarity } : best
    }, { state: uploaded.states[0], similarity: 0 })

    stateMatches[refState.name] = closestMatch.similarity
  })

  // Only compute deviations for exercise-relevant angles
  const anglesToCompare: Set<string> = new Set()
  reference.states.forEach(s =>
    Object.keys(s.angleRanges).forEach(angle => {
      if (!relevantAngles || relevantAngles.has(angle)) {
        anglesToCompare.add(angle)
      }
    })
  )

  // Calculate average deviation per angle (only relevant ones)
  anglesToCompare.forEach(angleName => {
    const refAngles = reference.states
      .map(s => s.angleRanges[angleName]?.mean)
      .filter(a => a !== undefined) as number[]
    const upAngles = uploaded.states
      .map(s => s.angleRanges[angleName]?.mean)
      .filter(a => a !== undefined) as number[]

    if (refAngles.length > 0 && upAngles.length > 0) {
      const refAvg = refAngles.reduce((a, b) => a + b, 0) / refAngles.length
      const upAvg = upAngles.reduce((a, b) => a + b, 0) / upAngles.length
      angleDeviations[angleName] = Math.abs(refAvg - upAvg)
    }
  })

  // Overall score: 60% state similarity + 40% angle accuracy
  const stateMatchValues = Object.values(stateMatches)
  const stateSimilarity = stateMatchValues.length > 0
    ? stateMatchValues.reduce((a, b) => a + b, 0) / stateMatchValues.length
    : 0
  const deviationValues = Object.values(angleDeviations)
  const angleAccuracy = deviationValues.length > 0
    ? 100 - Math.min(100, deviationValues.reduce((a, b) => a + b, 0) / deviationValues.length)
    : 0
  const overallSimilarity = (stateSimilarity * 0.6 + angleAccuracy * 0.4)

  return {
    similarity: Math.round(overallSimilarity),
    referenceReps: reference.recommendedReps,
    uploadedReps: uploaded.recommendedReps,
    details: {
      referenceTemplate: reference,
      uploadedTemplate: uploaded,
      stateMatches,
      angleDeviations,
    }
  }
}

/**
 * Calculate similarity between two detected states based on their angle ranges.
 * Returns 0-100 where 100 = identical angles.
 *
 * @param relevantAngles  If provided, only these angles are compared.
 *                        If null, all common angles are used (legacy fallback).
 */
export function calculateStateSimilarity(
  state1: DetectedState,
  state2: DetectedState,
  relevantAngles?: Set<string> | null
): number {
  const angles1 = Object.keys(state1.angleRanges)
  const angles2 = Object.keys(state2.angleRanges)
  let commonAngles = angles1.filter(a => angles2.includes(a))

  // Filter to only exercise-relevant joints
  if (relevantAngles) {
    commonAngles = commonAngles.filter(a => relevantAngles.has(a))
  }

  if (commonAngles.length === 0) return 0

  const similarities = commonAngles.map(angle => {
    const mean1 = state1.angleRanges[angle].mean
    const mean2 = state2.angleRanges[angle].mean
    const diff = Math.abs(mean1 - mean2)
    return Math.max(0, 100 - (diff / 180) * 100)
  })

  return similarities.reduce((a, b) => a + b, 0) / similarities.length
}
