// ROHA to ROHA
/**
 * Exercise State Learner
 * 
 * Analyzes a reference video to automatically detect:
 * 1. Key states/poses in the exercise (e.g., bent, stretched, hold)
 * 2. Angle ranges for each state
 * 3. Transition patterns and timing
 * 4. Hold durations
 * 
 * This creates a dynamic template that can be used for comparison.
 * 
 * 
 */

import type { JointAngle } from "./pose-analyzer"

export interface DetectedState {
  id: string
  name: string
  description: string
  // Angle ranges for this state (computed from clustered data)
  angleRanges: {
    [angleName: string]: {
      mean: number
      min: number
      max: number
      stdDev: number
    }
  }
  // When this state appears in the video
  occurrences: {
    startTime: number
    endTime: number
    duration: number
  }[]
  // Representative frame timestamp
  representativeTimestamp: number
}

export interface StateTransition {
  fromState: string
  toState: string
  duration: number // How long the transition takes
  angleChanges: {
    [angleName: string]: {
      startAngle: number
      endAngle: number
      delta: number
    }
  }
}

export interface LearnedExerciseTemplate {
  exerciseName: string
  exerciseType: string
  states: DetectedState[]
  transitions: StateTransition[]
  repSequence: string[] // e.g., ["bent", "transition", "stretched", "hold", "transition", "bent"]
  totalDuration: number
  recommendedReps: number
  // Metadata
  metadata: {
    detectedAt: string
    videoLength: number
    fps: number
    confidence: number
  }
}

/**
 * K-means clustering to group similar poses into states
 */
function kMeansClustering(
  dataPoints: number[][],
  k: number,
  maxIterations: number = 100
): { clusters: number[][]; centroids: number[][] } {
  // Handle empty or insufficient data
  if (dataPoints.length === 0) {
    console.warn("No data points for clustering")
    return { clusters: [], centroids: [] }
  }
  
  if (dataPoints.length < k) {
    console.warn(`Not enough data points (${dataPoints.length}) for ${k} clusters, using ${dataPoints.length} clusters`)
    k = dataPoints.length
  }
  
  const dimensions = dataPoints[0].length
  
  // Initialize centroids randomly from data points
  const centroids: number[][] = []
  const usedIndices = new Set<number>()
  
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * dataPoints.length)
    if (!usedIndices.has(idx)) {
      centroids.push([...dataPoints[idx]])
      usedIndices.add(idx)
    }
  }
  
  let clusters: number[][] = Array(k).fill(null).map(() => [])
  
  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign points to nearest centroid
    clusters = Array(k).fill(null).map(() => [])
    
    dataPoints.forEach((point, pointIdx) => {
      let minDist = Infinity
      let closestCluster = 0
      
      centroids.forEach((centroid, clusterIdx) => {
        const dist = euclideanDistance(point, centroid)
        if (dist < minDist) {
          minDist = dist
          closestCluster = clusterIdx
        }
      })
      
      clusters[closestCluster].push(pointIdx)
    })
    
    // Update centroids
    let changed = false
    clusters.forEach((cluster, clusterIdx) => {
      if (cluster.length === 0) return
      
      const newCentroid = Array(dimensions).fill(0)
      cluster.forEach((pointIdx) => {
        dataPoints[pointIdx].forEach((val, dim) => {
          newCentroid[dim] += val
        })
      })
      
      newCentroid.forEach((val, dim) => {
        newCentroid[dim] = val / cluster.length
      })
      
      // Check if centroid changed
      if (!arraysEqual(centroids[clusterIdx], newCentroid)) {
        changed = true
        centroids[clusterIdx] = newCentroid
      }
    })
    
    if (!changed) break
  }
  
  return { clusters, centroids }
}

function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(
    a.reduce((sum, val, idx) => sum + Math.pow(val - b[idx], 2), 0)
  )
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((val, idx) => Math.abs(val - b[idx]) < 0.001)
}

/**
 * Calculate mean and standard deviation
 */
function calculateStats(values: number[]): { mean: number; stdDev: number; min: number; max: number } {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length
  const stdDev = Math.sqrt(variance)
  const min = Math.min(...values)
  const max = Math.max(...values)
  
  return { mean, stdDev, min, max }
}

/**
 * Detect if a sequence of frames represents a "hold" (minimal movement)
 */
function isHoldState(
  frameAngles: { [angleName: string]: number }[],
  threshold: number = 5 // degrees
): boolean {
  if (frameAngles.length < 10) return false // Need at least 10 frames (~0.33s at 30fps)
  
  // Check if all angles stay within threshold
  const angleNames = Object.keys(frameAngles[0])
  
  return angleNames.every((angleName) => {
    const angles = frameAngles.map(f => f[angleName]).filter(a => a !== undefined)
    if (angles.length === 0) return false
    
    const min = Math.min(...angles)
    const max = Math.max(...angles)
    
    return (max - min) < threshold
  })
}

/**
 * Count repetitions by detecting complete exercise cycles
 * A rep is a complete cycle through the primary states
 * For bilateral exercises (both arms/legs), uses average of both sides
 */
function countRepetitions(
  states: DetectedState[],
  stateSequence: string[],
  angleNames: string[]
): number {
  if (states.length === 0 || stateSequence.length === 0) return 0
  
  // Identify the starting/ending state (typically the most flexed or extended position)
  // This is usually the state with the smallest or largest mean angle
  
  // For bilateral exercises, check if we have left/right pairs
  const hasBilateral = angleNames.some(name => name.includes('left')) && 
                       angleNames.some(name => name.includes('right'))
  
  let primaryAngle = angleNames[0] // Default to first angle
  
  // If bilateral, use the average of left/right for determining states
  if (hasBilateral) {
    // Find the primary joint type (e.g., 'shoulder', 'elbow', 'knee')
    const leftAngles = angleNames.filter(name => name.includes('left'))
    const rightAngles = angleNames.filter(name => name.includes('right'))
    
    // For bilateral, we'll compute average angles for state determination
    // But use the first available angle for now as primary
    const jointTypes = leftAngles.map(name => name.replace('left_', ''))
    console.log(`Bilateral exercise detected with joint types: ${jointTypes.join(', ')}`)
    primaryAngle = leftAngles[0] // Use left side as primary reference
  }
  
  // Find states sorted by angle
  const statesByAngle = [...states]
    .filter(s => s.angleRanges[primaryAngle])
    .sort((a, b) => {
      // For bilateral exercises, sort by average of both sides
      if (hasBilateral) {
        const rightAngle = primaryAngle.replace('left', 'right')
        const avgA = a.angleRanges[rightAngle] 
          ? (a.angleRanges[primaryAngle].mean + a.angleRanges[rightAngle].mean) / 2
          : a.angleRanges[primaryAngle].mean
        const avgB = b.angleRanges[rightAngle]
          ? (b.angleRanges[primaryAngle].mean + b.angleRanges[rightAngle].mean) / 2
          : b.angleRanges[primaryAngle].mean
        return avgA - avgB
      }
      return a.angleRanges[primaryAngle].mean - b.angleRanges[primaryAngle].mean
    })
  
  if (statesByAngle.length === 0) {
    console.warn("No states with angle data found")
    return 1
  }
  
  // Determine the actual start state from the sequence (first state)
  // This handles exercises that start at max extension (like squats) vs min extension (like curls)
  const firstStateId = stateSequence[0]
  const actualStartState = states.find(s => s.id === firstStateId) || statesByAngle[0]
  
  // The peak state is the one furthest from the start state (in terms of angle)
  const startAngleMean = hasBilateral 
    ? (actualStartState.angleRanges[primaryAngle].mean + (actualStartState.angleRanges[primaryAngle.replace('left', 'right')]?.mean || actualStartState.angleRanges[primaryAngle].mean)) / 2
    : actualStartState.angleRanges[primaryAngle].mean

  const peakState = statesByAngle.reduce((furthest, state) => {
    const currentMean = hasBilateral
      ? (state.angleRanges[primaryAngle].mean + (state.angleRanges[primaryAngle.replace('left', 'right')]?.mean || state.angleRanges[primaryAngle].mean)) / 2
      : state.angleRanges[primaryAngle].mean
    
    const furthestMean = hasBilateral
      ? (furthest.angleRanges[primaryAngle].mean + (furthest.angleRanges[primaryAngle.replace('left', 'right')]?.mean || furthest.angleRanges[primaryAngle].mean)) / 2
      : furthest.angleRanges[primaryAngle].mean
      
    return Math.abs(currentMean - startAngleMean) > Math.abs(furthestMean - startAngleMean)
      ? state
      : furthest
  }, statesByAngle[0])
  
  const startAngleDisplay = Math.round(startAngleMean)
  const peakAngleDisplay = Math.round(hasBilateral 
    ? (peakState.angleRanges[primaryAngle].mean + (peakState.angleRanges[primaryAngle.replace('left', 'right')]?.mean || peakState.angleRanges[primaryAngle].mean)) / 2
    : peakState.angleRanges[primaryAngle].mean)
  
  console.log(`Start state: ${actualStartState.name} (${startAngleDisplay}°)`)
  console.log(`Peak state: ${peakState.name} (${peakAngleDisplay}°)`)
  
  // Count complete cycles: start → peak → start (or back to start)
  // A rep is counted when we return to the start state after visiting the peak
  let repCount = 0
  let hasVisitedPeak = false
  let lastState: string | null = null
  
  for (let i = 0; i < stateSequence.length; i++) {
    const currentState = stateSequence[i]
    
    // Skip if same as last (no transition)
    if (currentState === lastState) continue
    
    // Check if we reached the peak state
    if (currentState === peakState.id) {
      hasVisitedPeak = true
      console.log(`  Peak reached at position ${i}`)
    }
    
    // Check if we returned to start state after visiting peak
    if (currentState === actualStartState.id && hasVisitedPeak) {
      repCount++
      hasVisitedPeak = false
      console.log(` Rep ${repCount} completed at position ${i}`)
    }
    
    lastState = currentState
  }
  
  // If we ended at peak or in transition, count it as a partial rep (round up)
  if (hasVisitedPeak && repCount > 0) {
    console.log(`  Partial rep detected (ended at peak)`)
    repCount++
  }
  
  // Fallback: if cycle counting failed, use occurrence counting for the start state
  if (repCount === 0) {
    console.warn("Cycle counting failed, using fallback method")
    repCount = Math.max(1, actualStartState.occurrences.length)
  }
  
  return repCount
}

/**
 * Main function: Learn exercise states from analyzed video data
 */
export function learnExerciseStates(
  jointAngles: JointAngle[],
  exerciseName: string,
  exerciseType: string,
  anglesOfInterest: string[]
): LearnedExerciseTemplate {
  console.log("Learning exercise states from video data...")
  console.log(`Analyzing ${jointAngles.length} data points`)
  console.log(`Angles of interest:`, anglesOfInterest)
  
  // Group joint angles by timestamp
  const frameData = new Map<number, { [angleName: string]: number }>()
  
  jointAngles.forEach((ja) => {
    if (anglesOfInterest.includes(ja.joint)) {
      const timestamp = Math.round(ja.timestamp * 100) / 100 // Round to 0.01s
      if (!frameData.has(timestamp)) {
        frameData.set(timestamp, {})
      }
      frameData.get(timestamp)![ja.joint] = ja.angle
    }
  })
  
  const timestamps = Array.from(frameData.keys()).sort((a, b) => a - b)
  const frames = timestamps.map(t => frameData.get(t)!)
  
  console.log(`Organized into ${frames.length} frames`)
  
  // Convert frames to vectors for clustering
  const angleNames = anglesOfInterest
  const dataVectors: number[][] = frames.map(frame => 
    angleNames.map(name => frame[name] || 0)
  )
  
  // Check if we have enough data
  if (dataVectors.length === 0) {
    console.error("No data vectors created - no angle data found")
    throw new Error("No angle data found for the specified angles of interest")
  }
  
  if (frames.length < 10) {
    console.warn("Very few frames detected, results may be unreliable")
  }
  
  // Determine optimal number of clusters (states)
  // Start with 2-4 states (common for most exercises)
  const maxStates = Math.min(5, Math.floor(frames.length / 30)) // At least 30 frames per state
  const optimalK = Math.max(2, Math.min(4, maxStates))
  
  console.log(`Clustering into ${optimalK} states...`)
  
  const { clusters, centroids } = kMeansClustering(dataVectors, optimalK)
  
  // Build detected states
  const detectedStates: DetectedState[] = []
  
  clusters.forEach((clusterIndices, clusterIdx) => {
    if (clusterIndices.length === 0) return
    
    const clusterFrames = clusterIndices.map(idx => frames[idx])
    const clusterTimestamps = clusterIndices.map(idx => timestamps[idx])
    
    // Calculate angle ranges for this state
    const angleRanges: DetectedState["angleRanges"] = {}
    
    angleNames.forEach((angleName) => {
      const angleValues = clusterFrames
        .map(f => f[angleName])
        .filter(v => v !== undefined)
      
      if (angleValues.length > 0) {
        const stats = calculateStats(angleValues)
        angleRanges[angleName] = stats
      }
    })
    
    // Detect continuous occurrences (segments where this state is held)
    const occurrences: DetectedState["occurrences"] = []
    let currentStart: number | null = null
    
    clusterTimestamps.forEach((ts, idx) => {
      const isConsecutive = idx === 0 || (ts - clusterTimestamps[idx - 1]) < 0.1 // 100ms gap allowed
      
      if (currentStart === null) {
        currentStart = ts
      } else if (!isConsecutive) {
        // End current occurrence
        occurrences.push({
          startTime: currentStart,
          endTime: clusterTimestamps[idx - 1],
          duration: clusterTimestamps[idx - 1] - currentStart,
        })
        currentStart = ts
      }
      
      // Handle last occurrence
      if (idx === clusterTimestamps.length - 1) {
        occurrences.push({
          startTime: currentStart,
          endTime: ts,
          duration: ts - currentStart,
        })
      }
    })
    
    // Representative timestamp (middle of largest occurrence)
    const largestOccurrence = occurrences.reduce((max, occ) => 
      occ.duration > max.duration ? occ : max, occurrences[0]
    )
    const representativeTimestamp = (largestOccurrence.startTime + largestOccurrence.endTime) / 2
    
    // Name the state based on key angles
    const stateName = generateStateName(angleRanges, angleNames, clusterIdx)
    
    detectedStates.push({
      id: `state_${clusterIdx}`,
      name: stateName,
      description: generateStateDescription(angleRanges, angleNames),
      angleRanges,
      occurrences,
      representativeTimestamp,
    })
  })
  
  // Sort states by first occurrence
  detectedStates.sort((a, b) => 
    a.occurrences[0].startTime - b.occurrences[0].startTime
  )
  
  console.log(`Detected ${detectedStates.length} states:`)
  detectedStates.forEach((state, idx) => {
    console.log(`  ${idx + 1}. ${state.name} - ${state.occurrences.length} occurrences`)
  })
  
  // Detect transitions between states
  const transitions: StateTransition[] = []
  const stateSequence: string[] = []
  
  // Build timeline of states
  const timeline: { timestamp: number; stateId: string }[] = []
  detectedStates.forEach((state) => {
    state.occurrences.forEach((occ) => {
      timeline.push({ timestamp: occ.startTime, stateId: state.id })
      timeline.push({ timestamp: occ.endTime, stateId: state.id })
    })
  })
  timeline.sort((a, b) => a.timestamp - b.timestamp)
  
  // Detect transitions
  for (let i = 0; i < timeline.length - 1; i++) {
    if (timeline[i].stateId !== timeline[i + 1].stateId) {
      const fromState = detectedStates.find(s => s.id === timeline[i].stateId)!
      const toState = detectedStates.find(s => s.id === timeline[i + 1].stateId)!
      
      const duration = timeline[i + 1].timestamp - timeline[i].timestamp
      
      const angleChanges: StateTransition["angleChanges"] = {}
      angleNames.forEach((angleName) => {
        const fromAngle = fromState.angleRanges[angleName]?.mean || 0
        const toAngle = toState.angleRanges[angleName]?.mean || 0
        
        angleChanges[angleName] = {
          startAngle: fromAngle,
          endAngle: toAngle,
          delta: toAngle - fromAngle,
        }
      })
      
      transitions.push({
        fromState: fromState.id,
        toState: toState.id,
        duration,
        angleChanges,
      })
      
      stateSequence.push(fromState.id)
    }
  }
  
  // Add last state
  if (timeline.length > 0) {
    stateSequence.push(timeline[timeline.length - 1].stateId)
  }
  
  console.log(`Detected ${transitions.length} transitions`)
  console.log(`Sequence:`, stateSequence.map(id => 
    detectedStates.find(s => s.id === id)?.name
  ).join(" → "))
  
  const totalDuration = timestamps[timestamps.length - 1] - timestamps[0]
  
  const estimatedReps = countRepetitions(detectedStates, stateSequence, angleNames)
  
  console.log(`Counted ${estimatedReps} repetitions`)
  
  return {
    exerciseName,
    exerciseType,
    states: detectedStates,
    transitions,
    repSequence: stateSequence,
    totalDuration,
    recommendedReps: estimatedReps,
    metadata: {
      detectedAt: new Date().toISOString(),
      videoLength: totalDuration,
      fps: Math.round(frames.length / totalDuration),
      confidence: calculateConfidence(detectedStates),
    },
  }
}

/**
 * Generate a descriptive name for a state based on its angle ranges
 */
function generateStateName(
  angleRanges: DetectedState["angleRanges"],
  angleNames: string[],
  index: number
): string {
  // Find the angle with the largest mean
  let primaryAngleName = angleNames[0]
  let primaryAngleValue = 0
  
  angleNames.forEach((name) => {
    const range = angleRanges[name]
    if (range && Math.abs(range.mean) > Math.abs(primaryAngleValue)) {
      primaryAngleName = name
      primaryAngleValue = range.mean
    }
  })
  
  // Determine if it's bent or straight
  const avgAngle = primaryAngleValue
  
  if (avgAngle < 100) {
    return `Flexed/Bent (${Math.round(avgAngle)}°)`
  } else if (avgAngle > 150) {
    return `Extended/Straight (${Math.round(avgAngle)}°)`
  } else {
    return `Intermediate (${Math.round(avgAngle)}°)`
  }
}

/**
 * Generate a description of what the state looks like
 */
function generateStateDescription(
  angleRanges: DetectedState["angleRanges"],
  angleNames: string[]
): string {
  const descriptions = angleNames
    .filter(name => angleRanges[name])
    .map(name => {
      const range = angleRanges[name]
      return `${name}: ${Math.round(range.mean)}° (±${Math.round(range.stdDev)}°)`
    })
  
  return descriptions.join(", ")
}

/**
 * Calculate confidence score based on cluster quality
 */
function calculateConfidence(states: DetectedState[]): number {
  // Higher confidence if:
  // 1. States have low standard deviation (tight clusters)
  // 2. States have multiple occurrences (consistent)
  
  const avgStdDev = states.reduce((sum, state) => {
    const stdDevs = Object.values(state.angleRanges).map(r => r.stdDev)
    const avgStateStdDev = stdDevs.reduce((s, v) => s + v, 0) / stdDevs.length
    return sum + avgStateStdDev
  }, 0) / states.length
  
  const avgOccurrences = states.reduce((sum, state) => 
    sum + state.occurrences.length, 0) / states.length
  
  // Lower stdDev = higher confidence, more occurrences = higher confidence
  const confidence = Math.min(100, Math.max(0, 
    (100 - avgStdDev) * 0.5 + Math.min(avgOccurrences * 10, 50)
  ))
  
  return Math.round(confidence)
}
