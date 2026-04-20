import { PoseLandmarker, FilesetResolver } from "@mediapipe/tasks-vision"
import { OneEuroFilter } from "@/lib/filters"

export interface JointAngle {
  joint: string
  angle: number
  timestamp: number
}

export interface MovementSequence {
  joint: string
  startAngle: number
  endAngle: number
  startTime: number
  endTime: number
  duration: number
  angleDelta: number
}

export interface PoseAnalysisResult {
  jointAngles: JointAngle[]
  movements: MovementSequence[]
  summary: string
  learnedTemplate?: import("./exercise-state-learner").LearnedExerciseTemplate
}

/**
 * Main entry point for video analysis - uses PoseLandmarker for all exercises
 * @param videoBlob The video blob to analyze
 * @param anglesOfInterest Optional array of specific angles to track
 * @param exerciseInfo Optional exercise information for state learning
 */
export async function analyzeVideoForPose(
  videoBlob: Blob,
  anglesOfInterest?: string[],
  exerciseInfo?: { name: string; type: string }
): Promise<PoseAnalysisResult> {
  return analyzeVideoForPoseBody(videoBlob, anglesOfInterest, exerciseInfo)
}

/**
 * Analyze a video and extract joint movement information from body pose
 * @param videoBlob The video blob to analyze
 * @param anglesOfInterest Optional array of specific angles to track (e.g., ["left_knee", "right_leg_segment"])
 * @param exerciseInfo Optional exercise information for state learning
 */
async function analyzeVideoForPoseBody(
  videoBlob: Blob,
  anglesOfInterest?: string[],
  exerciseInfo?: { name: string; type: string }
): Promise<PoseAnalysisResult> {
  console.log("Starting pose analysis...")
  console.log("Video blob size:", videoBlob.size, "bytes")
  console.log("Video blob type:", videoBlob.type)
  
  if (anglesOfInterest) {
    console.log("Tracking angles:", anglesOfInterest.join(", "))
  } else {
    console.log("Tracking all angles")
  }
  
  try {
    // Initialize MediaPipe
    console.log("Initializing MediaPipe...")
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
    )
    
    console.log("Creating PoseLandmarker...")
    const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        // Use full model for better stability (not lite)
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    })
    console.log("PoseLandmarker created successfully")

    // Create video element from blob
    const videoUrl = URL.createObjectURL(videoBlob)
    const video = document.createElement("video")
    video.src = videoUrl
    video.muted = true
    video.crossOrigin = "anonymous"
    
    console.log("Waiting for video to load...")
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        console.log("Video metadata loaded")
        console.log("Video dimensions:", video.videoWidth, "x", video.videoHeight)
        console.log("Video duration:", video.duration, "seconds")
        resolve(null)
      }
      video.onerror = (e) => {
        console.error("Video load error:", e)
        reject(new Error("Failed to load video"))
      }
      setTimeout(() => reject(new Error("Video load timeout")), 10000)
    })

    const jointAngles: JointAngle[] = []
    const fps = 30 // Process at 30 FPS for better temporal consistency
    const frameInterval = 1000 / fps
    
    // Initialize landmark smoother with tuned parameters
    // min_cutoff: lower = more smoothing, higher = more responsive
    // beta: higher = more responsive to velocity changes
    const landmarkSmoother = new LandmarkSmoother(1.0, 0.007)
    
    console.log(`Processing video at ${fps} FPS with One Euro Filter smoothing`)
    
    // Process video frames
    let frameCount = 0
    for (let time = 0; time < video.duration * 1000; time += frameInterval) {
      video.currentTime = time / 1000
      
      await new Promise((resolve) => {
        video.onseeked = resolve
      })
      
      // Detect pose
      const timestamp = video.currentTime * 1000
      const results = poseLandmarker.detectForVideo(video, timestamp)
      
      if (results.landmarks && results.landmarks.length > 0) {
        // Apply temporal smoothing to raw landmarks
        const rawLandmarks = results.landmarks[0]
        const smoothedLandmarks = landmarkSmoother.smoothLandmarks(rawLandmarks, timestamp)
        
        // Calculate angles from smoothed landmarks
        const angles = calculateJointAngles(smoothedLandmarks, anglesOfInterest)
        
        angles.forEach((angleData) => {
          jointAngles.push({
            ...angleData,
            timestamp: video.currentTime,
          })
        })
        
        frameCount++
      }
      
      if (frameCount % 30 === 0) {
        console.log(`Processed ${frameCount} frames at ${video.currentTime.toFixed(2)}s`)
      }
    }
    
    console.log(`Total frames processed: ${frameCount}`)
    console.log(`Total joint angles detected: ${jointAngles.length}`)
    
    // Analyze movements
    const movements = detectMovements(jointAngles)
    console.log(`Detected ${movements.length} movement sequences`)
    
    // Generate summary
    const summary = generateSummary(movements)
    
    // Learn exercise states if exercise info provided
    let learnedTemplate: import("./exercise-state-learner").LearnedExerciseTemplate | undefined
    
    if (exerciseInfo && anglesOfInterest && anglesOfInterest.length > 0) {
      console.log("Learning exercise states from video...")
      const { learnExerciseStates } = await import("./exercise-state-learner")
      
      learnedTemplate = learnExerciseStates(
        jointAngles,
        exerciseInfo.name,
        exerciseInfo.type,
        anglesOfInterest
      )
      
      console.log(`Learned ${learnedTemplate.states.length} states`)
      console.log(`Template confidence: ${learnedTemplate.metadata.confidence}%`)
    }
    
    URL.revokeObjectURL(videoUrl)
    poseLandmarker.close()
    
    return {
      jointAngles,
      movements,
      summary,
      learnedTemplate,
    }
  } catch (error) {
    console.error("Error in analyzeVideoForPose:", error)
    throw error
  }
}


class LandmarkSmoother {
  private filters: Map<string, { x: OneEuroFilter; y: OneEuroFilter; z: OneEuroFilter }> = new Map()
  
  constructor(
    private min_cutoff: number = 1.0,
    private beta: number = 0.007
  ) {}
  
  smoothLandmarks(landmarks: any[], timestamp: number): any[] {
    return landmarks.map((landmark, index) => {
      const key = `landmark_${index}`
      
      if (!this.filters.has(key)) {
        this.filters.set(key, {
          x: new OneEuroFilter(this.min_cutoff, this.beta),
          y: new OneEuroFilter(this.min_cutoff, this.beta),
          z: new OneEuroFilter(this.min_cutoff, this.beta),
        })
      }
      
      const filter = this.filters.get(key)!
      
      return {
        x: filter.x.filter(landmark.x, timestamp),
        y: filter.y.filter(landmark.y, timestamp),
        z: filter.z ? filter.z.filter(landmark.z || 0, timestamp) : landmark.z,
        visibility: landmark.visibility,
      }
    })
  }
  
  reset() {
    this.filters.clear()
  }
}

const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
}

/**
 * Calculate angle between three points (in degrees)
 * This is the interior angle at point b, formed by vectors b->a and b->c
 * @param a First point [x, y]
 * @param b Middle point (vertex) [x, y]
 * @param c Third point [x, y]
 * @returns Angle in degrees (0-180)
 */
function calculateAngle(a: number[], b: number[], c: number[]): number {
  const radians =
    Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(a[1] - b[1], a[0] - b[0])
  let angle = Math.abs((radians * 180.0) / Math.PI)
  
  if (angle > 180.0) {
    angle = 360.0 - angle
  }
  
  return angle
}

/**
 * Calculate the angle of a line segment relative to the vertical (0° = straight down)
 * @param start Starting point [x, y]
 * @param end Ending point [x, y]
 * @returns Angle in degrees (0-180)
 */
function calculateSegmentAngleFromVertical(start: number[], end: number[]): number {
  // Vector from start to end
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  
  // Angle from vertical (negative Y axis, since Y increases downward in screen coords)
  // atan2(dx, -dy) gives angle from vertical
  const radians = Math.atan2(dx, dy)
  const degrees = Math.abs((radians * 180.0) / Math.PI)
  
  return degrees
}

/**
 * Calculate the angle of a line segment relative to the horizontal (0° = horizontal)
 * @param start Starting point [x, y]
 * @param end Ending point [x, y]
 * @returns Angle in degrees (0-90)
 */
function calculateSegmentAngleFromHorizontal(start: number[], end: number[]): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  
  // Angle from horizontal
  const radians = Math.atan2(Math.abs(dy), Math.abs(dx))
  const degrees = (radians * 180.0) / Math.PI
  
  return degrees
}

/**
 * Calculate angles for key joints from landmarks
 * @param landmarks The pose landmarks
 * @param anglesOfInterest Optional filter for specific angles
 */
function calculateJointAngles(
  landmarks: any[],
  anglesOfInterest?: string[]
): Omit<JointAngle, "timestamp">[] {
  const angles: Omit<JointAngle, "timestamp">[] = []
  
  // Helper to get landmark coordinates
  const getLandmark = (index: number) => [landmarks[index].x, landmarks[index].y]
  
  // Helper to check if we should track this angle
  const shouldTrack = (angleName: string) => {
    if (!anglesOfInterest) return true
    return anglesOfInterest.includes(angleName)
  }
  
  // === JOINT ANGLES (3-point angles) ===
  // These measure the interior angle at a joint, useful for bends/flexion
  
  // Left elbow angle (shoulder-elbow-wrist)
  if (shouldTrack("left_elbow")) {
    try {
      const leftElbowAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
        getLandmark(POSE_LANDMARKS.LEFT_WRIST)
      )
      angles.push({ joint: "left_elbow", angle: leftElbowAngle })
    } catch (e) {
      console.warn("Could not calculate left elbow angle")
    }
  }
  
  // Right elbow angle (shoulder-elbow-wrist)
  if (shouldTrack("right_elbow")) {
    try {
      const rightElbowAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
        getLandmark(POSE_LANDMARKS.RIGHT_WRIST)
      )
      angles.push({ joint: "right_elbow", angle: rightElbowAngle })
    } catch (e) {
      console.warn("Could not calculate right elbow angle")
    }
  }
  
  // Left knee angle (hip-knee-ankle)
  if (shouldTrack("left_knee")) {
    try {
      const leftKneeAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_HIP),
        getLandmark(POSE_LANDMARKS.LEFT_KNEE),
        getLandmark(POSE_LANDMARKS.LEFT_ANKLE)
      )
      angles.push({ joint: "left_knee", angle: leftKneeAngle })
    } catch (e) {
      console.warn("Could not calculate left knee angle")
    }
  }
  
  // Right knee angle (hip-knee-ankle)
  if (shouldTrack("right_knee")) {
    try {
      const rightKneeAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_HIP),
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE),
        getLandmark(POSE_LANDMARKS.RIGHT_ANKLE)
      )
      angles.push({ joint: "right_knee", angle: rightKneeAngle })
    } catch (e) {
      console.warn("Could not calculate right knee angle")
    }
  }
  
  // Left hip angle (shoulder-hip-knee)
  if (shouldTrack("left_hip")) {
    try {
      const leftHipAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_HIP),
        getLandmark(POSE_LANDMARKS.LEFT_KNEE)
      )
      angles.push({ joint: "left_hip", angle: leftHipAngle })
    } catch (e) {
      console.warn("Could not calculate left hip angle")
    }
  }
  
  // Right hip angle (shoulder-hip-knee)
  if (shouldTrack("right_hip")) {
    try {
      const rightHipAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_HIP),
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE)
      )
      angles.push({ joint: "right_hip", angle: rightHipAngle })
    } catch (e) {
      console.warn("Could not calculate right hip angle")
    }
  }
  
  // Left shoulder angle (elbow-shoulder-hip)
  if (shouldTrack("left_shoulder")) {
    try {
      const leftShoulderAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_HIP)
      )
      angles.push({ joint: "left_shoulder", angle: leftShoulderAngle })
    } catch (e) {
      console.warn("Could not calculate left shoulder angle")
    }
  }
  
  // Right shoulder angle (elbow-shoulder-hip)
  if (shouldTrack("right_shoulder")) {
    try {
      const rightShoulderAngle = calculateAngle(
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_HIP)
      )
      angles.push({ joint: "right_shoulder", angle: rightShoulderAngle })
    } catch (e) {
      console.warn("Could not calculate right shoulder angle")
    }
  }
  
  // === SEGMENT ANGLES (Line angles relative to vertical) ===
  // These measure the angle of body segments, useful for knee extension, leg raises, etc.
  
  // Left leg segment (knee to ankle) angle from vertical
  if (shouldTrack("left_knee") || shouldTrack("left_ankle")) {
    try {
      const leftLegSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_KNEE),
        getLandmark(POSE_LANDMARKS.LEFT_ANKLE)
      )
      angles.push({ joint: "left_leg_segment", angle: leftLegSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate left leg segment angle")
    }
  }
  
  // Right leg segment (knee to ankle) angle from vertical
  if (shouldTrack("right_knee") || shouldTrack("right_ankle")) {
    try {
      const rightLegSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE),
        getLandmark(POSE_LANDMARKS.RIGHT_ANKLE)
      )
      angles.push({ joint: "right_leg_segment", angle: rightLegSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate right leg segment angle")
    }
  }
  
  // Left thigh segment (hip to knee) angle from vertical
  if (shouldTrack("left_hip") || shouldTrack("left_knee")) {
    try {
      const leftThighSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_HIP),
        getLandmark(POSE_LANDMARKS.LEFT_KNEE)
      )
      angles.push({ joint: "left_thigh_segment", angle: leftThighSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate left thigh segment angle")
    }
  }
  
  // Right thigh segment (hip to knee) angle from vertical
  if (shouldTrack("right_hip") || shouldTrack("right_knee")) {
    try {
      const rightThighSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_HIP),
        getLandmark(POSE_LANDMARKS.RIGHT_KNEE)
      )
      angles.push({ joint: "right_thigh_segment", angle: rightThighSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate right thigh segment angle")
    }
  }
  
  // Left arm segment (shoulder to elbow) angle from vertical
  if (shouldTrack("left_shoulder") || shouldTrack("left_elbow")) {
    try {
      const leftArmSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW)
      )
      angles.push({ joint: "left_arm_segment", angle: leftArmSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate left arm segment angle")
    }
  }
  
  // Right arm segment (shoulder to elbow) angle from vertical
  if (shouldTrack("right_shoulder") || shouldTrack("right_elbow")) {
    try {
      const rightArmSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW)
      )
      angles.push({ joint: "right_arm_segment", angle: rightArmSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate right arm segment angle")
    }
  }
  
  // Left forearm segment (elbow to wrist) angle from vertical
  if (shouldTrack("left_elbow")) {
    try {
      const leftForearmSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
        getLandmark(POSE_LANDMARKS.LEFT_WRIST)
      )
      angles.push({ joint: "left_forearm_segment", angle: leftForearmSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate left forearm segment angle")
    }
  }
  
  // Right forearm segment (elbow to wrist) angle from vertical
  if (shouldTrack("right_elbow")) {
    try {
      const rightForearmSegmentAngle = calculateSegmentAngleFromVertical(
        getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
        getLandmark(POSE_LANDMARKS.RIGHT_WRIST)
      )
      angles.push({ joint: "right_forearm_segment", angle: rightForearmSegmentAngle })
    } catch (e) {
      console.warn("Could not calculate right forearm segment angle")
    }
  }
  
  return angles
}

/**
 * Apply additional angle-level smoothing using exponential moving average
 * This is a secondary smoothing layer after landmark smoothing
 * @param jointAngles Angle data (already from smoothed landmarks)
 * @param alpha Smoothing factor (0.0 = max smoothing, 1.0 = no smoothing)
 */
function smoothJointAnglesEMA(jointAngles: JointAngle[], alpha: number = 0.3): JointAngle[] {
  const smoothed: JointAngle[] = []
  
  // Group by joint
  const jointGroups = new Map<string, JointAngle[]>()
  jointAngles.forEach((ja) => {
    if (!jointGroups.has(ja.joint)) {
      jointGroups.set(ja.joint, [])
    }
    jointGroups.get(ja.joint)!.push(ja)
  })
  
  // Smooth each joint's angles using EMA
  jointGroups.forEach((angles, joint) => {
    // Sort by timestamp
    angles.sort((a, b) => a.timestamp - b.timestamp)
    
    if (angles.length === 0) return
    
    // First value is unchanged
    let prevSmoothed = angles[0].angle
    smoothed.push(angles[0])
    
    // Apply exponential smoothing
    for (let i = 1; i < angles.length; i++) {
      const currentAngle = angles[i].angle
      const smoothedAngle = alpha * currentAngle + (1 - alpha) * prevSmoothed
      
      smoothed.push({
        joint: angles[i].joint,
        angle: smoothedAngle,
        timestamp: angles[i].timestamp,
      })
      
      prevSmoothed = smoothedAngle
    }
  })
  
  return smoothed
}

/**
 * Detect significant movements from joint angle data
 */
function detectMovements(jointAngles: JointAngle[]): MovementSequence[] {
  const movements: MovementSequence[] = []
  const ANGLE_THRESHOLD = 20 // Minimum angle change to consider as movement
  const NOISE_THRESHOLD = 5 // Ignore changes smaller than this (reduced due to better smoothing)
  const TIME_THRESHOLD = 0.4 // Minimum time (seconds) to hold position
  
  // Apply additional angle-level smoothing (secondary layer)
  // Since landmarks are already smoothed, use lighter smoothing here
  const smoothedAngles = smoothJointAnglesEMA(jointAngles, 0.35)
  
  // Group by joint
  const jointGroups = new Map<string, JointAngle[]>()
  smoothedAngles.forEach((ja) => {
    if (!jointGroups.has(ja.joint)) {
      jointGroups.set(ja.joint, [])
    }
    jointGroups.get(ja.joint)!.push(ja)
  })
  
  // Analyze each joint
  jointGroups.forEach((angles, joint) => {
    if (angles.length < 2) return
    
    // Sort by timestamp to ensure chronological order
    angles.sort((a, b) => a.timestamp - b.timestamp)
    
    let currentSegment: JointAngle | null = angles[0]
    let accumulatedDelta = 0
    
    for (let i = 1; i < angles.length; i++) {
      const angle = angles[i]
      const instantDelta = angle.angle - angles[i - 1].angle
      const totalDelta = angle.angle - currentSegment!.angle
      const timeDelta = angle.timestamp - currentSegment!.timestamp
      
      // Ignore small jitters
      if (Math.abs(instantDelta) > NOISE_THRESHOLD) {
        accumulatedDelta += instantDelta
      }
      
      // Detect significant movement
      if (Math.abs(totalDelta) > ANGLE_THRESHOLD && timeDelta >= TIME_THRESHOLD) {
        movements.push({
          joint,
          startAngle: currentSegment!.angle,
          endAngle: angle.angle,
          startTime: currentSegment!.timestamp,
          endTime: angle.timestamp,
          duration: angle.timestamp - currentSegment!.timestamp,
          angleDelta: angle.angle - currentSegment!.angle,
        })
        currentSegment = angle
        accumulatedDelta = 0
      } else if (i === angles.length - 1 && timeDelta >= TIME_THRESHOLD) {
        // Last segment - check if there was any significant change
        if (Math.abs(totalDelta) > ANGLE_THRESHOLD) {
          movements.push({
            joint,
            startAngle: currentSegment!.angle,
            endAngle: angle.angle,
            startTime: currentSegment!.timestamp,
            endTime: angle.timestamp,
            duration: angle.timestamp - currentSegment!.timestamp,
            angleDelta: angle.angle - currentSegment!.angle,
          })
        }
      }
    }
  })
  
  // Filter out movements that are too small in total change
  const significantMovements = movements.filter((m) => Math.abs(m.angleDelta) > ANGLE_THRESHOLD)
  
  return significantMovements.sort((a, b) => a.startTime - b.startTime)
}

/**
 * Generate human-readable summary of movements
 */
function generateSummary(movements: MovementSequence[]): string {
  if (movements.length === 0) {
    return "No significant movements detected."
  }
  
  const summaryLines: string[] = []
  
  // Group movements by type (joint angles vs segment angles)
  const jointMovements = movements.filter((m) => !m.joint.includes("_segment"))
  const segmentMovements = movements.filter((m) => m.joint.includes("_segment"))
  
  if (jointMovements.length > 0) {
    summaryLines.push("=== JOINT ANGLES (Flexion/Extension) ===")
    jointMovements.forEach((movement, index) => {
      const jointName = movement.joint
        .replace("_", " ")
        .toUpperCase()
      
      const totalChange = Math.abs(movement.angleDelta).toFixed(1)
      const changeDirection = movement.angleDelta > 0 ? "+" : ""
      
      // Determine movement type for joints
      let movementType = ""
      if (movement.joint.includes("knee") || movement.joint.includes("elbow")) {
        movementType = movement.angleDelta < 0 ? "flexed (bent)" : "extended (straightened)"
      } else if (movement.joint.includes("hip") || movement.joint.includes("shoulder")) {
        movementType = movement.angleDelta < 0 ? "closed" : "opened"
      } else {
        movementType = movement.angleDelta > 0 ? "increased" : "decreased"
      }
      
      summaryLines.push(
        `${index + 1}. ${jointName}: ${movementType} by ${totalChange}° ` +
        `(went from ${movement.startAngle.toFixed(0)}° to ${movement.endAngle.toFixed(0)}°, change: ${changeDirection}${movement.angleDelta.toFixed(1)}°) ` +
        `at ${movement.startTime.toFixed(1)}s for ${movement.duration.toFixed(1)}s`
      )
    })
  }
  
  if (segmentMovements.length > 0) {
    if (jointMovements.length > 0) summaryLines.push("")
    summaryLines.push("=== SEGMENT ANGLES (Relative to Vertical) ===")
    segmentMovements.forEach((movement, index) => {
      const segmentName = movement.joint
        .replace("_segment", "")
        .replace("_", " ")
        .toUpperCase()
      
      const totalChange = Math.abs(movement.angleDelta).toFixed(1)
      const changeDirection = movement.angleDelta > 0 ? "+" : ""
      
      // Determine movement direction for segments
      let direction = ""
      if (movement.angleDelta > 0) {
        direction = "raised/moved away from vertical"
      } else {
        direction = "lowered/moved toward vertical"
      }
      
      summaryLines.push(
        `${index + 1}. ${segmentName}: ${direction} by ${totalChange}° ` +
        `(went from ${movement.startAngle.toFixed(0)}° to ${movement.endAngle.toFixed(0)}°, change: ${changeDirection}${movement.angleDelta.toFixed(1)}°) ` +
        `at ${movement.startTime.toFixed(1)}s for ${movement.duration.toFixed(1)}s`
      )
    })
  }
  
  return summaryLines.join("\n")
}
