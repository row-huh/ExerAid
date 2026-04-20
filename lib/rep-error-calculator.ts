// deduct rep error by comparing performed angles to learned template

import type { LearnedExerciseTemplate } from "./exercise-state-learner"

export interface RepError {
  repNumber: number
  timestamp: number
  errors: {
    [angleName: string]: {
      expected: number 
      actual: number 
      error: number 
      percentError: number 
    }
  }
  overallError: number
  formScore: number 
  stateName: string 
}

export interface RepErrorSummary {
  repErrors: RepError[]
  averageError: number
  bestRep: number
  worstRep: number
  errorTrend: "improving" | "declining" | "stable"
  commonMistakes: string[]
}


export function calculateRepError(
  angles: { [key: string]: number },
  template: LearnedExerciseTemplate,
  anglesOfInterest: string[],
  repNumber: number,
  timestamp: number
): RepError | null {
  const primary = anglesOfInterest[0]
  const currentAngle = angles[primary]
  
  if (currentAngle === undefined) return null

  const candidates = template.states.filter(s => s.angleRanges[primary])
  if (candidates.length === 0) return null

  // Find nearest state using Euclidean distance across ALL angles of interest
  // This is more robust than using just the primary angle, especially for unilateral exercises
  // where the primary angle might be static (e.g. left leg static while right leg moves)
  const nearestState = candidates.reduce((best, state) => {
    const calculateDistance = (s: typeof state) => {
      let sumSquaredDiff = 0
      let count = 0
      
      anglesOfInterest.forEach(angle => {
        const range = s.angleRanges[angle]
        const val = angles[angle]
        if (range && val !== undefined) {
          // Normalize difference by the standard deviation or a default range
          // This prevents large-range angles from dominating small-range ones
          const diff = val - range.mean
          const scale = range.stdDev > 0 ? range.stdDev : 10
          sumSquaredDiff += Math.pow(diff / scale, 2)
          count++
        }
      })
      
      return count > 0 ? Math.sqrt(sumSquaredDiff / count) : Infinity
    }

    const currentDist = calculateDistance(state)
    const bestDist = calculateDistance(best)
    
    return currentDist < bestDist ? state : best
  }, candidates[0])

  // Check if we are in a transition between two states
  // Sort states by primary angle to find the "bracket"
  const sortedStates = [...candidates].sort((a, b) => 
    a.angleRanges[primary].mean - b.angleRanges[primary].mean
  )
  
  let bracketLow = null
  let bracketHigh = null
  
  for (let i = 0; i < sortedStates.length - 1; i++) {
    const s1 = sortedStates[i]
    const s2 = sortedStates[i+1]
    const m1 = s1.angleRanges[primary].mean
    const m2 = s2.angleRanges[primary].mean
    
    // Check if current angle is between these two states
    if ((currentAngle >= m1 && currentAngle <= m2) || (currentAngle >= m2 && currentAngle <= m1)) {
      bracketLow = s1
      bracketHigh = s2
      break
    }
  }

  const errors: RepError["errors"] = {}
  let totalError = 0
  let errorCount = 0

  anglesOfInterest.forEach(angleName => {
    const actual = angles[angleName]
    
    // If we found a bracket and we are not "inside" the nearest state, try interpolation
    // But first, check if we are inside the nearest state (error = 0)
    const nearestStats = nearestState.angleRanges[angleName]
    if (!nearestStats || actual === undefined) return

    const { min, max } = nearestStats
    const buffer = 5.0 // Increased buffer to 5 degrees for better tolerance
    
    let error = 0
    let expected = nearestStats.mean
    
    const isInsideNearest = actual >= (min - buffer) && actual <= (max + buffer)
    
    if (isInsideNearest) {
      error = 0
    } else if (bracketLow && bracketHigh) {
      // We are in a transition! Interpolate expected value.
      const pLow = bracketLow.angleRanges[primary].mean
      const pHigh = bracketHigh.angleRanges[primary].mean
      const totalDist = Math.abs(pHigh - pLow)
      
      if (totalDist > 0) {
        const progress = Math.abs(currentAngle - pLow) / totalDist
        
        const valLow = bracketLow.angleRanges[angleName]?.mean || 0
        const valHigh = bracketHigh.angleRanges[angleName]?.mean || 0
        
        expected = valLow + (valHigh - valLow) * progress
        
        // Interpolate the allowed range/buffer as well
        // We allow a "corridor" around the interpolated line
        const corridorWidth = 10.0 // Allow 10 degrees deviation during transition
        
        if (Math.abs(actual - expected) <= corridorWidth) {
          error = 0
        } else {
          error = Math.abs(actual - expected) - corridorWidth
        }
      } else {
        // Fallback to nearest state logic if bracket is collapsed
        if (actual < min - buffer) error = (min - buffer) - actual
        else if (actual > max + buffer) error = actual - (max + buffer)
      }
    } else {
      // No bracket found (extremes), use nearest state logic
      if (actual < min - buffer) error = (min - buffer) - actual
      else if (actual > max + buffer) error = actual - (max + buffer)
    }

    const range = max - min
    // Percent error relative to the range of motion, or 100% if error > range
    const percentError = range > 0 ? Math.min(100, (error / range) * 100) : (error > 0 ? 100 : 0)

    errors[angleName] = {
      expected,
      actual,
      error,
      percentError
    }

    totalError += error
    errorCount++
  })

  if (errorCount === 0) return null

  const overallError = totalError / errorCount

  const formScore = Math.max(0, Math.min(100, 100 - (overallError / 2)))

  return {
    repNumber,
    timestamp,
    errors,
    overallError,
    formScore,
    stateName: nearestState.name
  }
}


export function analyzeRepTrends(repErrors: RepError[]): RepErrorSummary {
  if (repErrors.length === 0) {
    return {
      repErrors: [],
      averageError: 0,
      bestRep: 0,
      worstRep: 0,
      errorTrend: "stable",
      commonMistakes: []
    }
  }

  const averageError = repErrors.reduce((sum, rep) => sum + rep.overallError, 0) / repErrors.length

  const bestRep = repErrors.reduce((best, rep) => 
    rep.overallError < best.overallError ? rep : best
  ).repNumber

  const worstRep = repErrors.reduce((worst, rep) => 
    rep.overallError > worst.overallError ? rep : worst
  ).repNumber

  let errorTrend: "improving" | "declining" | "stable" = "stable"
  if (repErrors.length >= 4) {
    const midpoint = Math.floor(repErrors.length / 2)
    const firstHalfAvg = repErrors.slice(0, midpoint).reduce((sum, rep) => sum + rep.overallError, 0) / midpoint
    const secondHalfAvg = repErrors.slice(midpoint).reduce((sum, rep) => sum + rep.overallError, 0) / (repErrors.length - midpoint)
    
    const improvementThreshold = 2 // degrees
    if (firstHalfAvg - secondHalfAvg > improvementThreshold) {
      errorTrend = "improving"
    } else if (secondHalfAvg - firstHalfAvg > improvementThreshold) {
      errorTrend = "declining"
    }
  }

  const angleMistakes = new Map<string, number>()
  repErrors.forEach(rep => {
    Object.entries(rep.errors).forEach(([angleName, error]) => {
      const current = angleMistakes.get(angleName) || 0
      angleMistakes.set(angleName, current + error.percentError)
    })
  })

  const commonMistakes: string[] = []
  angleMistakes.forEach((totalPercent, angleName) => {
    const avgPercent = totalPercent / repErrors.length
    if (avgPercent > 20) { 
      const readableName = angleName.replace(/_/g, " ")
      commonMistakes.push(`${readableName} (${avgPercent.toFixed(0)}% off)`)
    }
  })

  return {
    repErrors,
    averageError,
    bestRep,
    worstRep,
    errorTrend,
    commonMistakes
  }
}

