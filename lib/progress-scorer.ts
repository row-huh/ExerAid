/**
 * Progress Scorer — Dual-Threshold Scoring Engine
 *
 * Compares a patient's exercise attempt against:
 *   - Reference template (patient's baseline ROM — the floor)
 *   - Ideal template    (gold-standard ROM — the ceiling)
 *
 * Produces per-rep validity, "good rep" status, and a 0-100 progress score
 * indicating how far between reference and ideal the patient reached.
 */

import type {
  LearnedExerciseTemplate,
  DetectedState,
} from "./exercise-state-learner"
import { getExerciseConfig } from "./exercise-config"


export interface SessionScore {
  totalReps: number
  validReps: number
  goodReps: number
  progressScore: number // 0-100, average progress across valid reps
  formScore: number // 0-100, secondary-angle quality
  perRepDetails: RepDetail[]
}

export interface RepDetail {
  rep: number
  valid: boolean
  good: boolean
  peakAngle: number // primary angle peak achieved by patient
  progressPercent: number // 0-100, position between ref and ideal
  formScore: number // secondary angles quality for this rep
}


function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Identify the primary angle for an exercise type.
 * Uses the first angle from exercise-config (e.g. "left_knee" for knee-extension).
 */
function getPrimaryAngle(exerciseType: string): string | null {
  const config = getExerciseConfig(exerciseType)
  return config?.anglesOfInterest[0] ?? null
}

/**
 * Extract the peak (max) value of a given angle across all template states.
 * "Peak" = the largest mean value the angle reaches in any state.
 */
function getAnglePeak(template: LearnedExerciseTemplate, angleName: string): number | null {
  let peak: number | null = null
  for (const state of template.states) {
    const range = state.angleRanges[angleName]
    if (range) {
      const val = range.mean
      if (peak === null || val > peak) peak = val
    }
  }
  return peak
}

/**
 * Extract the trough (min) value of a given angle across all template states.
 */
function getAngleTrough(template: LearnedExerciseTemplate, angleName: string): number | null {
  let trough: number | null = null
  for (const state of template.states) {
    const range = state.angleRanges[angleName]
    if (range) {
      const val = range.mean
      if (trough === null || val < trough) trough = val
    }
  }
  return trough
}

/**
 * Compute a simple form score for a patient state against reference states.
 * Looks at all secondary angles (everything except the primary) and measures
 * how close the patient's state means are to the reference means.
 */
function computeSecondaryFormScore(
  patientState: DetectedState,
  referenceStates: DetectedState[],
  primaryAngle: string,
  allAngles: string[]
): number {
  const secondaryAngles = allAngles.filter((a) => a !== primaryAngle)
  if (secondaryAngles.length === 0) return 100

  // Find the reference state closest to the patient state on the primary angle
  const patientPrimary = patientState.angleRanges[primaryAngle]?.mean
  if (patientPrimary === undefined) return 100

  let closestRef: DetectedState | null = null
  let closestDist = Infinity
  for (const ref of referenceStates) {
    const refPrimary = ref.angleRanges[primaryAngle]?.mean
    if (refPrimary === undefined) continue
    const dist = Math.abs(patientPrimary - refPrimary)
    if (dist < closestDist) {
      closestDist = dist
      closestRef = ref
    }
  }

  if (!closestRef) return 100

  let totalError = 0
  let count = 0
  for (const angle of secondaryAngles) {
    const refRange = closestRef.angleRanges[angle]
    const patRange = patientState.angleRanges[angle]
    if (!refRange || !patRange) continue

    const error = Math.abs(patRange.mean - refRange.mean)
    totalError += error
    count++
  }

  if (count === 0) return 100
  const avgError = totalError / count
  // Same formula as rep-error-calculator: formScore = 100 - overallError/2
  return Math.max(0, Math.min(100, 100 - avgError / 2))
}


/**
 * Score a patient's exercise session against reference + ideal templates.
 *
 * @param referenceTemplate  The doctor-recorded baseline (floor)
 * @param idealTemplate      Gold-standard ROM (ceiling). null = use reference as ceiling
 * @param patientTemplate    The patient's attempt
 * @param allowProgression   true = dual-threshold mode; false = ref is both floor & ceiling
 */
export function scoreSession(
  referenceTemplate: LearnedExerciseTemplate,
  idealTemplate: LearnedExerciseTemplate | null,
  patientTemplate: LearnedExerciseTemplate,
  allowProgression: boolean
): SessionScore {
  const exerciseType = referenceTemplate.exerciseType
  const primaryAngle = getPrimaryAngle(exerciseType)
  const allAngles = getExerciseConfig(exerciseType)?.anglesOfInterest ?? []

  // Fallback: if no primary angle is configured, return a zeroed-out score
  if (!primaryAngle) {
    return {
      totalReps: patientTemplate.recommendedReps,
      validReps: 0,
      goodReps: 0,
      progressScore: 0,
      formScore: 0,
      perRepDetails: [],
    }
  }

  const refPeak = getAnglePeak(referenceTemplate, primaryAngle)
  const refTrough = getAngleTrough(referenceTemplate, primaryAngle)

  // In stick-with-reference mode or when no ideal is available,
  // the ideal thresholds collapse to the reference thresholds.
  const effectiveIdeal =
    allowProgression && idealTemplate ? idealTemplate : referenceTemplate
  const idealPeak = getAnglePeak(effectiveIdeal, primaryAngle)

  if (refPeak === null || idealPeak === null) {
    return {
      totalReps: patientTemplate.recommendedReps,
      validReps: 0,
      goodReps: 0,
      progressScore: 0,
      formScore: 0,
      perRepDetails: [],
    }
  }

  // Determine ROM direction
  // For some exercises the "peak" is high (e.g. knee extension → ~170°),
  // for others the meaningful extreme might be the trough.
  // We use the range (peak - trough) to decide: if the peak is the
  // extreme of motion, we compare patient peaks against ref/ideal peaks.
  // A simple heuristic: use peak comparison (higher = better) unless
  // the reference ROM is inverted (peak < trough in terms of movement).
  // For now, we always compare peaks — this covers knee extension,
  // scap wall slides, etc.

  const TOLERANCE = 0.9 // 10% tolerance

  // Score each patient state as a "rep" 
  // The patient template's states represent the key poses detected
  // during their exercise. Each state with a primary angle above the
  // reference peak counts as a valid rep attempt.
  //
  // In a real scenario, the template's `recommendedReps` and state
  // occurrences tell us how many reps were performed. We treat each
  // state that represents the "extended" / peak position as one rep.

  // Strategy: sort patient states by primary angle descending.
  // The states with the highest primary angle are the "peak" positions.
  // We count the number of rep-like state occurrences.

  // Better approach: use repSequence to count reps. Each cycle through
  // the sequence = 1 rep. The patient's recommendedReps already captures this.
  const totalReps = patientTemplate.recommendedReps

  // Find the patient's peak states (the ones with the highest primary angle)
  // These correspond to the "extended" position of each rep.
  const patientStates = patientTemplate.states.filter(
    (s) => s.angleRanges[primaryAngle]
  )

  // Sort states by primary angle to identify the peak state
  const sortedByPrimary = [...patientStates].sort(
    (a, b) =>
      (b.angleRanges[primaryAngle]?.mean ?? 0) -
      (a.angleRanges[primaryAngle]?.mean ?? 0)
  )

  // The "peak state" is the one with the highest primary angle mean
  const patientPeakState = sortedByPrimary[0]
  const patientPeak = patientPeakState?.angleRanges[primaryAngle]?.mean ?? 0

  // For per-rep details, we use state occurrences of the peak state.
  // Each occurrence = one time the patient reached that position = one rep.
  const peakOccurrences = patientPeakState?.occurrences ?? []
  const detectedReps = Math.max(totalReps, peakOccurrences.length)

  // Build per-rep details 
  const perRepDetails: RepDetail[] = []
  let validCount = 0
  let goodCount = 0
  let progressSum = 0
  let formScoreSum = 0

  // For each rep, the patient reached roughly the same peak
  // (K-means assigns occurrences to the same state cluster).
  // We use the peak state's mean as the representative peak for all reps.
  // This is a simplification — in later increments we can refine to
  // per-occurrence angle tracking.
  for (let i = 0; i < detectedReps; i++) {
    const valid = patientPeak >= refPeak * TOLERANCE
    const good = patientPeak >= idealPeak * TOLERANCE

    // Progress: how far between reference and ideal
    const range = idealPeak - refPeak
    const progress =
      range > 0
        ? clamp(((patientPeak - refPeak) / range) * 100, 0, 100)
        : valid
          ? 100
          : 0

    // Form score from secondary angles
    const formScore = patientPeakState
      ? computeSecondaryFormScore(
          patientPeakState,
          referenceTemplate.states,
          primaryAngle,
          allAngles
        )
      : 0

    if (valid) validCount++
    if (good) goodCount++
    progressSum += valid ? progress : 0
    formScoreSum += formScore

    perRepDetails.push({
      rep: i + 1,
      valid,
      good,
      peakAngle: patientPeak,
      progressPercent: valid ? Math.round(progress) : 0,
      formScore: Math.round(formScore),
    })
  }

  const avgProgress =
    validCount > 0 ? Math.round(progressSum / validCount) : 0
  const avgFormScore =
    detectedReps > 0 ? Math.round(formScoreSum / detectedReps) : 0

  return {
    totalReps: detectedReps,
    validReps: validCount,
    goodReps: goodCount,
    progressScore: avgProgress,
    formScore: avgFormScore,
    perRepDetails,
  }
}
