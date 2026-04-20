"use client"

import { useRef, useState, useEffect } from "react"
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

import { RepErrorGraph } from "@/components/rep-error-graph"
import {
  calculateRepError,
  analyzeRepTrends,
  type RepError,
  type RepErrorSummary
} from "@/lib/rep-error-calculator"

import { OneEuroFilter } from "@/lib/filters"
import { LearnedExerciseTemplate } from "@/lib/exercise-state-learner"


const getAudioFeedback = (lang: "en" | "ur") => ({
  knee: {
    up: `/audio/knee/${lang}/up.mp3`,
    down: `/audio/knee/${lang}/down.mp3`,
    hold: `/audio/knee/${lang}/hold.mp3`,
    correction: `/audio/knee/${lang}/correction.mp3`,
  },
  scap: {
    up: `/audio/scap/${lang}/up.mp3`,
    down: `/audio/scap/${lang}/down.mp3`,
    hold: `/audio/scap/${lang}/hold.mp3`,
    level: `/audio/scap/${lang}/level.mp3`,
  }
})



export interface SessionEndData {
  reps_completed: number
  valid_reps: number
  good_reps: number
  form_score: number
  duration_seconds: number
}

interface ComparisonRecorderProps {
  onVideoRecorded?: (videoBlob: Blob) => void
  onSessionEnd?: (data: SessionEndData) => void
  anglesOfInterest?: string[]
  exerciseName?: string
  exerciseType?: string
  enableTestMode?: boolean
  referenceTemplate?: LearnedExerciseTemplate
  idealTemplate?: LearnedExerciseTemplate
  allowProgression?: boolean
  fullscreen?: boolean
}


const POSE_LANDMARKS = {
  // Body
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
}



interface JointAngleData {
  [key: string]: number
}

export function ComparisonRecorder({
  onSessionEnd,
  anglesOfInterest,
  exerciseName,
  exerciseType,
  enableTestMode = false,
  referenceTemplate,
  idealTemplate,
  allowProgression = true,
  fullscreen = false
}: ComparisonRecorderProps) {


  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const poseRef = useRef<PoseLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const learnedTemplateRef = useRef<LearnedExerciseTemplate | null>(null)
  // Locked primary angle — resolved once, used everywhere in the session
  const resolvedPrimaryRef = useRef<string | null>(null)

  const thresholdGood = useRef(false)  
  const thresholdValid = useRef(false)
  const thresholdRest = useRef(false)



  // audio feedback
  const lastAudioTimeRef = useRef<number>(0)     // cooldown tracker
  const lastSpokenRef = useRef<string>("")       // avoid repetition

  const playAudio = (src: string, label: string) => {
    const now = Date.now()

    //Prevent repeating same instruction
    if (lastSpokenRef.current === label) return

    // Prevent too frequent playback
    if (now - lastAudioTimeRef.current < 2500) return

    lastAudioTimeRef.current = now
    lastSpokenRef.current = label

    // Stop previous audio
    if (audioRef.current) {
      audioRef.current.pause()
    }

    // Play new audio
    const audio = new Audio(src)
    audioRef.current = audio
    audio.play().catch(() => {})
  }



  const [isStreaming, setIsStreaming] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [language, setLanguage] = useState<"en" | "ur">("en")


  const [currentAngles, setCurrentAngles] = useState<JointAngleData>({})
  const [repCount, setRepCount] = useState(0)

  const [currentState, setCurrentState] = useState<string>("")
  const [templateState, setTemplateState] = useState<string>("")




  const [repErrors, setRepErrors] = useState<RepError[]>([])
  const [errorSummary, setErrorSummary] = useState<RepErrorSummary | null>(null)

  const [repDetails, setRepDetails] = useState<Array<{
    index: number
    startTime: number
    endTime: number
    primaryAngle: string
    minAngle: number
    maxAngle: number
    correct: boolean
  }>>([])


 
 

  const [liveThresholdStatus, setLiveThresholdStatus] =
    useState<"below" | "valid" | "good" | "rest">("rest")

  const [liveValidReps, setLiveValidReps] = useState(0)
  const [liveGoodReps, setLiveGoodReps] = useState(0)

  // Track the peak angle reached in the current rep cycle (for sticky threshold status)
  const repCyclePeakRef = useRef<number>(0)

  // Rep quality: recorded at peak detection time, used at rep completion time.
  // This avoids the timing issue where repCyclePeakRef resets (when primaryVal
  // drops below midpoint) BEFORE the state matcher detects return-to-start.
  const repWasValidRef = useRef<boolean>(false)
  const repWasGoodRef = useRef<boolean>(false)

  // Session tracking for DB persistence
  const sessionStartTimeRef = useRef<number>(0)
  const formScoreSamplesRef = useRef<number[]>([])
  const refPeakRef = useRef<number>(0)
  const idealPeakRef = useRef<number>(0)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [sessionSummary, setSessionSummary] = useState<SessionEndData | null>(null)




  const [testMode, setTestMode] = useState(false)
  const [testVideoFile, setTestVideoFile] = useState<File | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)



  // --------INTERNAL TRACKING (ALGORITHM CORE)---------
  const angleFiltersRef = useRef<Map<string, OneEuroFilter>>(new Map())
  const angleHistoryRef = useRef<Array<{ timestamp: number; angles: JointAngleData }>>([])
  const primaryAngleHistoryRef = useRef<Array<{ t: number; value: number }>>([])

  const lastStateRef = useRef<string>("")
  const hasVisitedPeakRef = useRef(false)

  const stateChangeTimestampRef = useRef<number>(0)
  const lastRepTimestampRef = useRef<number | null>(null)

  const MIN_REP_COOLDOWN = 0.6
  const MIN_PEAK_DELTA = 15

  // Template-aware thresholds (computed lazily, cached in ref)
  const repThresholdsRef = useRef<{ up: number; down: number } | null>(null)
  const getRepThresholds = () => {
    if (repThresholdsRef.current) return repThresholdsRef.current
    const tmpl = referenceTemplate ?? learnedTemplateRef.current
    const primary = resolvedPrimaryRef.current ?? anglesOfInterest?.[0]
    if (tmpl && primary) {
      let peak = 0, start = Infinity
      for (const s of tmpl.states) {
        const r = s.angleRanges[primary]
        if (r) {
          if (r.mean > peak) peak = r.mean
          if (r.mean < start) start = r.mean
        }
      }
      if (peak > 0 && start < Infinity) {
        const midpoint = (start + peak) / 2
        repThresholdsRef.current = { up: midpoint, down: midpoint }
        return repThresholdsRef.current
      }
    }
    // Fallback when no template
    repThresholdsRef.current = { up: 140, down: 100 }
    return repThresholdsRef.current
  }

  // Finite State Machine for rep detection
  const repFSMRef = useRef<{
    phase: 'idle' | 'up' | 'down'
    lastValley?: number
    lastPeak?: number
  }>({ phase: 'idle' })


// Rep quality classification
  const classifyRepQuality = (
    cycleHistory: Array<{ timestamp: number; angles: JointAngleData }>,
    primaryAngleName?: string
  ) => {

    const name =
      primaryAngleName ||
      (anglesOfInterest && anglesOfInterest[0]) ||
      "right_knee"

    const values = cycleHistory
      .map(h => h.angles[name])
      .filter(v => v !== undefined) as number[]

    if (values.length === 0) return false

    const maxAngle = Math.max(...values)
    const minAngle = Math.min(...values)

    // Expected ROM thresholds
    const EXTENDED_MIN = 150  // TODO: extract from db ? why are we using hardcoded ones?
    const REST_MAX = 90  // don't allow a rest timer - allow the user to rest as much as required

    const isExtendedReached = maxAngle >= EXTENDED_MIN
    const isRestReached = minAngle <= REST_MAX

    return isExtendedReached && isRestReached
  }



// Rep Range Analysis
// Calculates min & max angle for a completed rep cycle
const computeRepMinMax = (
  cycleHistory: Array<{ timestamp: number; angles: JointAngleData }>,
  primaryAngleName?: string
): { min: number; max: number; primary: string } | null => {

  // Select primary joint (fallback to right_knee)
  const name =
    primaryAngleName ||
    (anglesOfInterest && anglesOfInterest[0]) ||
    "right_knee"                                    // why is this hardcoded for knee? We will be performing exercises

  // Extract valid angle values
  const values = cycleHistory
    .map(h => h.angles[name])
    .filter(v => v !== undefined) as number[]

  // If no data → return null
  if (values.length === 0) return null

  // Return min/max range of motion
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    primary: name
  }
}



// helper to draw skeleton (connecting relevant joints with a line. These are 2 joint segments line. 3 joint angles are basically just two 2-joint angles)
const POSE_CONNECTIONS = [
  { start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 7 },
  { start: 0, end: 4 }, { start: 4, end: 5 }, { start: 5, end: 6 }, { start: 6, end: 8 },
  { start: 9, end: 10 },

  { start: 11, end: 12 }, { start: 11, end: 23 }, { start: 12, end: 24 },
  { start: 23, end: 24 },

  { start: 11, end: 13 }, { start: 13, end: 15 },
  { start: 15, end: 17 }, { start: 15, end: 19 }, { start: 15, end: 21 },
  { start: 17, end: 19 },

  { start: 12, end: 14 }, { start: 14, end: 16 },
  { start: 16, end: 18 }, { start: 16, end: 20 }, { start: 16, end: 22 },
  { start: 18, end: 20 },

  { start: 23, end: 25 }, { start: 25, end: 27 },
  { start: 27, end: 29 }, { start: 27, end: 31 }, { start: 29, end: 31 },

  { start: 24, end: 26 }, { start: 26, end: 28 },
  { start: 28, end: 30 }, { start: 28, end: 32 }, { start: 30, end: 32 },
]



// 3 point angle joint calculations 
// Calculates angle between 3 points (A-B-C)
const calculateAngle = (a: number[], b: number[], c: number[]): number => {

  const radians =
    Math.atan2(c[1] - b[1], c[0] - b[0]) -
    Math.atan2(a[1] - b[1], a[0] - b[0])

  let angle = Math.abs((radians * 180.0) / Math.PI)

  // Normalize to 0–180 range
  if (angle > 180.0) {
    angle = 360.0 - angle
  }

  return angle
}


// Calculates angle of a limb segment relative to vertical axis
// this is to find out the tilt of any segment relative to the true y-axis 
const calculateSegmentAngleFromVertical = (
  start: number[],
  end: number[]
): number => {

  const dx = end[0] - start[0]
  const dy = end[1] - start[1]

  const radians = Math.atan2(dx, dy)
  const degrees = Math.abs((radians * 180.0) / Math.PI)

  return degrees
}


// angle extraction 
// Converts pose landmarks → biomechanical joint angles
const calculateAllAngles = (landmarks: any[]): JointAngleData => {

  const angles: JointAngleData = {}

  // Helper to extract (x, y)
  const getLandmark = (index: number) => [
    landmarks[index].x,     // does this help with drawing skeletons?
    landmarks[index].y
  ]

  try {


    //  ELBOW ANGLES

    angles.left_elbow = calculateAngle(
      getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
      getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
      getLandmark(POSE_LANDMARKS.LEFT_WRIST)
    )

    angles.right_elbow = calculateAngle(
      getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
      getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
      getLandmark(POSE_LANDMARKS.RIGHT_WRIST)
    )


    // KNEE ANGLES
   
    angles.left_knee = calculateAngle(
      getLandmark(POSE_LANDMARKS.LEFT_HIP),
      getLandmark(POSE_LANDMARKS.LEFT_KNEE),
      getLandmark(POSE_LANDMARKS.LEFT_ANKLE)
    )

    angles.right_knee = calculateAngle(
      getLandmark(POSE_LANDMARKS.RIGHT_HIP),
      getLandmark(POSE_LANDMARKS.RIGHT_KNEE),
      getLandmark(POSE_LANDMARKS.RIGHT_ANKLE)
    )



    //  HIP ANGLES

    angles.left_hip = calculateAngle(
      getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
      getLandmark(POSE_LANDMARKS.LEFT_HIP),
      getLandmark(POSE_LANDMARKS.LEFT_KNEE)
    )

    angles.right_hip = calculateAngle(
      getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
      getLandmark(POSE_LANDMARKS.RIGHT_HIP),
      getLandmark(POSE_LANDMARKS.RIGHT_KNEE)
    )


 
    //  SHOULDER ANGLES

    angles.left_shoulder = calculateAngle(
      getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
      getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
      getLandmark(POSE_LANDMARKS.LEFT_HIP)
    )

    angles.right_shoulder = calculateAngle(
      getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
      getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
      getLandmark(POSE_LANDMARKS.RIGHT_HIP)
    )


    // LEG SEGMENTS
  
    angles.left_leg_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.LEFT_KNEE),
      getLandmark(POSE_LANDMARKS.LEFT_ANKLE)
    )

    angles.right_leg_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.RIGHT_KNEE),
      getLandmark(POSE_LANDMARKS.RIGHT_ANKLE)
    )



    // THIGH SEGMENTS
    
    angles.left_thigh_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.LEFT_HIP),
      getLandmark(POSE_LANDMARKS.LEFT_KNEE)
    )

    angles.right_thigh_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.RIGHT_HIP),
      getLandmark(POSE_LANDMARKS.RIGHT_KNEE)
    )


    //  ARM SEGMENTS
    
    angles.left_arm_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.LEFT_SHOULDER),
      getLandmark(POSE_LANDMARKS.LEFT_ELBOW)
    )

    angles.right_arm_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.RIGHT_SHOULDER),
      getLandmark(POSE_LANDMARKS.RIGHT_ELBOW)
    )


   
    // FOREARM SEGMENTS
    
    angles.left_forearm_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.LEFT_ELBOW),
      getLandmark(POSE_LANDMARKS.LEFT_WRIST)
    )

    angles.right_forearm_segment = calculateSegmentAngleFromVertical(
      getLandmark(POSE_LANDMARKS.RIGHT_ELBOW),
      getLandmark(POSE_LANDMARKS.RIGHT_WRIST)
    )



  } catch (e) {
    console.warn("Error calculating some angles:", e)
  }

  return angles
}



// Uses OneEuroFilter to smooth noisy angle signals in real-time
// This is to keep the angle-values that are being read stable to reduce jitter/fluctuation in the calculations. if the angles move around too frequently, 
// it messes up the calculations a lil

const smoothAngles = (
  rawAngles: JointAngleData,
  timestamp: number
): JointAngleData => {

  const smoothed: JointAngleData = {}

  Object.entries(rawAngles).forEach(([angleName, angleValue]) => {

    // Initialize filter for new angle if not exists
    if (!angleFiltersRef.current.has(angleName)) {
      angleFiltersRef.current.set(angleName, new OneEuroFilter(1.0, 0.007))
    }

    const filter = angleFiltersRef.current.get(angleName)!

    // Apply smoothing filter
    smoothed[angleName] = filter.filter(angleValue, timestamp)
  })

  return smoothed
}


// state classification for exercises
// TODO: why is this happening hardcoded - why aren't we using clusters we learnt??
// Converts continuous angle → discrete states (flexed / extended / transition)
const determineExerciseState = (angles: JointAngleData): string => {

  // Use locked primary angle
  const primaryAngle = resolvedPrimaryRef.current ?? (anglesOfInterest?.[0] || "right_knee")
  const angle = angles[primaryAngle]

  if (angle === undefined) {
    return ""
  }

  // thresholds here are assumed - because it makes it easier to run state detection later on 
  // state detection then knows what to look for
  // TODO: that doesn't sound right, hardcoded angles for states doesn't sound like a good idea

  // State classification based on angle thresholds
  if (angle < 70) {
    return "flexed"
  } else if (angle > 150) {
    return "extended"
  } else {
    return "transition"
  }
}


// REP COUNTING (FSM + VELOCITY + HYSTERESIS)
// TODO: too complicated, i think a few million of my braincells just died
// Advanced rep detection independent of simple state labels
const updateRepCount = (state: string) => {

  // Use locked primary angle
  const primaryName = resolvedPrimaryRef.current ?? (anglesOfInterest?.[0] || 'right_knee')

  // Get last two angle samples (for velocity calculation)
  const last = angleHistoryRef.current[angleHistoryRef.current.length - 1]
  const prev = angleHistoryRef.current[angleHistoryRef.current.length - 2]

  // Not enough data → exit
  if (!last || !prev) {
    lastStateRef.current = state
    return
  }

  const a = last.angles[primaryName]
  const b = prev.angles[primaryName]

  // Missing angle data → exit
  if (a === undefined || b === undefined) {
    lastStateRef.current = state
    return
  }

  const nowTs = last.timestamp

  // Velocity of movement (angle change)
  const vel = a - b

  const fsm = repFSMRef.current

  // FSM INITIALIZATION
  
  if (fsm.phase === 'idle') {
    fsm.lastValley = a
    fsm.phase = 'down'
  }

  // UPWARD PHASE (EXTENSION)
  if (fsm.phase === 'down') {

    // Start upward movement when threshold crossed
    if (a >= getRepThresholds().up && vel > 0) {
      fsm.phase = 'up'
      fsm.lastPeak = a
    }

    // Track lowest point (valley)
    if (fsm.lastValley === undefined || a < fsm.lastValley) {
      fsm.lastValley = a
    }

  } else if (fsm.phase === 'up') {

    // Track highest point (peak)
    if (fsm.lastPeak === undefined || a > fsm.lastPeak) {
      fsm.lastPeak = a
    }

    // downward phase flexion
    if (a <= getRepThresholds().down && vel < 0) {

      // Compute rep characteristics
      const valley = fsm.lastValley ?? a
      const peak = fsm.lastPeak ?? a
      const delta = peak - valley

      // Cooldown check to avoid double counting
      const cooledDown =
        lastRepTimestampRef.current === null ||
        (nowTs - lastRepTimestampRef.current) >= MIN_REP_COOLDOWN

      // Valid rep condition
      if (delta >= MIN_PEAK_DELTA && cooledDown) {

        // Increment rep count
        setRepCount(r => r + 1)
        lastRepTimestampRef.current = nowTs

        // Build cycle window: last 1.5s
        const cycle = angleHistoryRef.current.filter(
          h => nowTs - h.timestamp <= 1.5
        )

        // Evaluate rep quality
        const isCorrect = classifyRepQuality(cycle, primaryName)
        const minMax = computeRepMinMax(cycle, primaryName)

        // Store rep details for UI / analysis
        if (minMax) {
          setRepDetails(prev => ([
            ...prev,
            {
              index: prev.length + 1,
              startTime: cycle.length
                ? cycle[0].timestamp
                : nowTs - 1.5,
              endTime: nowTs,
              primaryAngle: minMax.primary,
              minAngle: Math.round(minMax.min),
              maxAngle: Math.round(minMax.max),
              correct: isCorrect,
            }
          ]))
        }
      }
      else if (thresholdGood && thresholdValid && thresholdRest) {
        thresholdGood.current = true
        thresholdValid.current = true
        thresholdRest.current = true

        // Increment rep count
        setRepCount(r => r + 1)
        lastRepTimestampRef.current = nowTs

        // Build cycle window: last 1.5s
        const cycle = angleHistoryRef.current.filter(
          h => nowTs - h.timestamp <= 1.5
        )

        // Evaluate rep quality
        const isCorrect = classifyRepQuality(cycle, primaryName)
        const minMax = computeRepMinMax(cycle, primaryName)

        // Store rep details for UI / analysis
        if (minMax) {
          setRepDetails(prev => ([
            ...prev,
            {
              index: prev.length + 1,
              startTime: cycle.length
                ? cycle[0].timestamp
                : nowTs - 1.5,
              endTime: nowTs,
              primaryAngle: minMax.primary,
              minAngle: Math.round(minMax.min),
              maxAngle: Math.round(minMax.max),
              correct: isCorrect,
            }
          ]))
        }
      }

      
      //  RESET FSM FOR NEXT REP

      fsm.phase = 'down'
      fsm.lastValley = a
      fsm.lastPeak = undefined
    }
  }

  // Store last state
  lastStateRef.current = state
}


// webcam init
// Starts live camera feed and pose detection
const openWebcam = async () => {

  // Prevent duplicate initialization
  if (isStreaming || isLoading) return

  setIsLoading(true)
  setTestMode(false)

  try {
    // Request camera access
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    })

    streamRef.current = stream

    if (videoRef.current) {
      videoRef.current.srcObject = stream

      // Start video playback
      await videoRef.current.play().catch(() => {})

      // Sync canvas size with video
      if (canvasRef.current) {
        canvasRef.current.width = videoRef.current.videoWidth || 640
        canvasRef.current.height = videoRef.current.videoHeight || 480
      }

      // Initialize pose model and start loop
      await initPose()
      startPoseLoop()
    }

    setIsStreaming(true)
    sessionStartTimeRef.current = Date.now()

  } catch (e) {
    console.error("Failed to open webcam", e)
    alert("Unable to access camera. Please check permissions and try again.")
  } finally {
    setIsLoading(false)
  }
}


// TEST VIDEO UPLOAD MODE
// Allows testing with pre-recorded video instead of live camera
const handleTestVideoUpload = async (
  event: React.ChangeEvent<HTMLInputElement>
) => {

  const file = event.target.files?.[0]

  // Validate file type
  if (!file || !file.type.startsWith('video/')) {
    alert("Please select a valid video file")
    return
  }

  setIsLoading(true)
  setTestVideoFile(file)

  try {
    const videoUrl = URL.createObjectURL(file)

    if (videoRef.current) {

      // Switch from webcam to video file
      videoRef.current.srcObject = null
      videoRef.current.src = videoUrl
      videoRef.current.loop = false

      // Wait for video metadata to load (needed for dimensions)
      await new Promise<void>((resolve) => {
        videoRef.current!.onloadedmetadata = () => {

          if (canvasRef.current && videoRef.current) {
            canvasRef.current.width = videoRef.current.videoWidth
            canvasRef.current.height = videoRef.current.videoHeight
          }

          resolve()
        }
      })

      // Initialize pose system
      await initPose()

      setTestMode(true)
      setIsStreaming(true)

      // Start playback
      await videoRef.current.play()
      setIsPlaying(true)

      // Start pose detection loop
      startPoseLoop()
    }

  } catch (e) {
    console.error("Failed to load test video:", e)
    alert("Failed to load video file")
  } finally {
    setIsLoading(false)
  }
}


// VIDEO PLAYBACK CONTROL
// Toggles play/pause in test mode
const togglePlayPause = () => {

  // Only works in test mode
  if (!videoRef.current || !testMode) return

  if (isPlaying) {
    videoRef.current.pause()
    setIsPlaying(false)
  } else {
    videoRef.current.play()
    setIsPlaying(true)
  }
}


//  RESET TEST VIDEO STATE
// Resets playback and all tracking variables
const resetTestVideo = () => {

  if (!videoRef.current || !testMode) return

  // Reset video position
  videoRef.current.currentTime = 0

  // Reset UI + tracking states
  setRepCount(0)
  setLiveValidReps(0)
  setLiveGoodReps(0)
  setCurrentState("")
  setCurrentAngles({})

  // Reset internal tracking refs
  lastStateRef.current = ""
  hasVisitedPeakRef.current = false
  repWasValidRef.current = false
  repWasGoodRef.current = false
  stateChangeTimestampRef.current = 0

  angleFiltersRef.current.clear()
  angleHistoryRef.current = []

  setRepDetails([])

  // Reset FSM (rep detection)
  repFSMRef.current = { phase: 'idle' }
}


// COMPUTE & SAVE SESSION SUMMARY
// Snapshots all session data BEFORE any resets, saves to state for the
// summary overlay, and fires the onSessionEnd callback.
const saveAndEndSession = () => {
  // Snapshot data before any resets
  const durationSeconds = sessionStartTimeRef.current > 0
    ? Math.round((Date.now() - sessionStartTimeRef.current) / 1000)
    : 0
  const samples = formScoreSamplesRef.current
  const avgFormScore = samples.length > 0
    ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)
    : 0

  const summary: SessionEndData = {
    reps_completed: repCount,
    valid_reps: liveValidReps,
    good_reps: liveGoodReps,
    form_score: avgFormScore,
    duration_seconds: durationSeconds,
  }

  // Store for overlay display (before state resets wipe the values)
  setSessionSummary(summary)
  setSessionEnded(true)

  // Fire callback
  onSessionEnd?.(summary)
}


// STOP TEST MODE
// Completely stops video + tracking loop, saves session first
const stopTestMode = () => {
  // Save session snapshot before resetting
  if (onSessionEnd && repCount > 0) {
    saveAndEndSession()
  }

  if (videoRef.current) {
    videoRef.current.pause()
    videoRef.current.src = ""
  }

  // Stop animation loop
  if (rafRef.current) {
    cancelAnimationFrame(rafRef.current)
  }

  // Reset all states
  setTestMode(false)
  setIsStreaming(false)
  setIsPlaying(false)
  setTestVideoFile(null)

  setRepCount(0)
  setLiveValidReps(0)
  setLiveGoodReps(0)
  setCurrentState("")
  setCurrentAngles({})

  // Reset internal tracking
  lastStateRef.current = ""
  hasVisitedPeakRef.current = false
  repWasValidRef.current = false
  repWasGoodRef.current = false
  stateChangeTimestampRef.current = 0

  angleFiltersRef.current.clear()
  angleHistoryRef.current = []
  formScoreSamplesRef.current = []

  setRepDetails([])

  // Reset FSM
  repFSMRef.current = { phase: 'idle' }
}


// END SESSION (webcam)
const endSession = () => {
  // Snapshot and save FIRST
  saveAndEndSession()

  // Then stop everything
  if (streamRef.current) {
    streamRef.current.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }
  if (rafRef.current) {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }
  setIsStreaming(false)
}

// MEDIAPIPE INITIALIZATION
// Loads PoseLandmarker model and configures detection settings
const initPose = async () => {

  try {
    // Prevent re-initialization
    if (poseRef.current) return

    // Load MediaPipe vision WASM
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm"
    )

    // Create PoseLandmarker instance
    poseRef.current = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU", // Use GPU for performance
      },
      runningMode: "VIDEO",
      numPoses: 1,

      // Confidence thresholds
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,

      outputSegmentationMasks: false,
    })

  } catch (err) {
    console.error("Failed to init MediaPipe Pose", err)
  }
}


// MAIN POSE LOOP (CORE ENGINE)
// Runs on every frame → detects pose → calculates angles → updates UI → gives feedback
const startPoseLoop = () => {

  if (!videoRef.current || !canvasRef.current || !poseRef.current) return

  const ctx = canvasRef.current.getContext("2d")
  if (!ctx) return

  const drawer = new DrawingUtils(ctx)

  // Pre-compute template state list once per session (avoids spread on every frame)
  const allTemplateStates = referenceTemplate
    ? [...referenceTemplate.states, ...(idealTemplate?.states ?? [])]
    : []


  // FRAME RENDER FUNCTION
  const render = () => {

    if (!videoRef.current || !poseRef.current || !canvasRef.current) return

    // SYNC CANVAS SIZE WITH VIDEO
    // this tries to get the mediapipe's pose skeleton on the exact place where the perons's limbs are . This was a 
    // problem coz the person doing exercise is gonna be shown on the side of the screen 
    if (
      canvasRef.current.width !== videoRef.current.videoWidth ||
      canvasRef.current.height !== videoRef.current.videoHeight
    ) {
      canvasRef.current.width = videoRef.current.videoWidth
      canvasRef.current.height = videoRef.current.videoHeight
    }

    // Clear previous frame
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)

    // Timestamp for smoothing + detection
    const ts = performance.now()

    // Run pose detection
    const result = poseRef.current.detectForVideo(videoRef.current, ts)


    // POSE DETECTED
    if (result.landmarks && result.landmarks.length > 0) {

      const landmarks = result.landmarks[0]


      // ANGLE PROCESSING
      const rawAngles = calculateAllAngles(landmarks)
      const smoothedAngles = smoothAngles(rawAngles, ts / 1000)



      // Update UI state
      setCurrentAngles(smoothedAngles)


      // REAL-TIME AUDIO FEEDBACK
      const audio = getAudioFeedback(language)

      if (anglesOfInterest && anglesOfInterest.length > 0) {

        const primary = anglesOfInterest[0]
        const angle = smoothedAngles[primary]

        if (angle !== undefined) {

          // KNEE EXERCISE
          if (exerciseType === "knee-extension") {

            if (angle < 90) {
              playAudio(audio.knee.up, "knee_up")
            }
            else if (angle > 165) {
              playAudio(audio.knee.down, "knee_down")
            }
            else if (angle >= 140 && angle <= 165) {
              playAudio(audio.knee.hold, "knee_hold")
            }
            else if (angle >= 90 && angle < 120) {
              playAudio(audio.knee.correction, "knee_wrong")
            }
          }

          // SCAP EXERCISE
          if (exerciseType === "scap-wall-slides") {

            if (angle < 120) {
              playAudio(audio.scap.up, "scap_up")
            }
            else if (angle > 165) {
              playAudio(audio.scap.down, "scap_down")
            }
            else if (angle >= 140 && angle <= 165) {
              playAudio(audio.scap.hold, "scap_hold")
            }
            else {
              playAudio(audio.scap.level, "scap_wrong")
            }
          }
        }
      }


      // ANGLE HISTORY STORAGE
      angleHistoryRef.current.push({
        timestamp: ts / 1000,
        angles: smoothedAngles
      })


      // PRIMARY ANGLE (locked for session) - reason for this is that mediapipe doesn't get confused when tracking one exercise
      // for example, when tracking knee extensisons, the model sometimes gets confused which leg it is that is extending and often makes judgement errors
      // Lazy-resolve if not set yet (template may have loaded after useEffect)
      if (!resolvedPrimaryRef.current && anglesOfInterest && anglesOfInterest.length > 0) {
        const tmpl = referenceTemplate ?? learnedTemplateRef.current
        resolvedPrimaryRef.current = resolvePrimaryAngle(anglesOfInterest, tmpl)
      }
      const sessionPrimary = resolvedPrimaryRef.current ?? (anglesOfInterest?.[0] || "right_knee")

      // PRIMARY ANGLE TRACKING
      {
          const val = smoothedAngles[sessionPrimary]
          if (val !== undefined) {
            primaryAngleHistoryRef.current.push({ t: ts / 1000, value: val })
            const cutoffT = (ts / 1000) - 12
            primaryAngleHistoryRef.current = primaryAngleHistoryRef.current.filter(p => p.t > cutoffT)
          }
        }

//  CLEAN ANGLE HISTORY
// Maintain sliding window (10s) for performance
        const cutoffTime = (ts / 1000) - 10
        angleHistoryRef.current = angleHistoryRef.current.filter(
          h => h.timestamp > cutoffTime
        )
        // STATE DETECTION (TEMPLATE / GENERIC)
        let stateLabel = ""
        if (learnedTemplateRef.current && anglesOfInterest && anglesOfInterest.length > 0) {
            // TEMPLATE STATE MAPPING
          const mapped = mapToTemplateState(smoothedAngles, learnedTemplateRef.current, anglesOfInterest, sessionPrimary)
          stateLabel = mapped?.name || ""
          if (stateLabel) setTemplateState(stateLabel)
          const primary = sessionPrimary
          const sortable = learnedTemplateRef.current.states.filter(s => s.angleRanges[primary])
            // TEMPLATE-BASED REP DETECTION
          if (mapped && sortable.length >= 2) {
            // Determine start state from repSequence[0] (the first state the exercise actually
            // begins in), then find the peak as the state furthest from it.
            // This mirrors the logic in exercise-state-learner.ts countRepetitions() and
            // fixes rep counting for exercises like scap wall slides where the starting
            // position is NOT the lowest-angle state (arms-at-sides resting position is lower
            // than the W start position, so a naïve sort would pick the wrong start).
            const tmplForRep = learnedTemplateRef.current!
            const firstSeqId = tmplForRep.repSequence?.[0]
            const actualStart =
              (firstSeqId ? sortable.find(s => s.id === firstSeqId) : undefined) ??
              [...sortable].sort((a, b) => a.angleRanges[primary].mean - b.angleRanges[primary].mean)[0]
            const startId = actualStart.id
            const startMean = actualStart.angleRanges[primary].mean
            const peakState = sortable.reduce((furthest, state) => {
              const curDist = Math.abs(state.angleRanges[primary].mean - startMean)
              const farDist = Math.abs(furthest.angleRanges[primary].mean - startMean)
              return curDist > farDist ? state : furthest
            }, sortable[0])
            const peakId = peakState.id
            const MIN_STATE_DURATION = 0.2
            if (mapped.id !== lastStateRef.current) {
              const dt = (ts / 1000) - stateChangeTimestampRef.current
              if (dt >= MIN_STATE_DURATION || lastStateRef.current === "") {
                // Relaxed logic: just check if we reached the target state, ignore where we came from
                // This handles intermediate states (start -> mid -> peak -> mid -> start)
                if (mapped.id === peakId) {
                  hasVisitedPeakRef.current = true
                  // Record rep quality NOW while repCyclePeakRef still holds the
                  // actual peak. By the time we return to startId (rep completion),
                  // the threshold section will have already reset repCyclePeakRef
                  // (when primaryVal drops below midpoint), so we can't check there.
                  const TOLERANCE = 0.9
                  const cycleP = repCyclePeakRef.current
                  repWasValidRef.current = refPeakRef.current > 0 && cycleP >= refPeakRef.current * TOLERANCE
                  repWasGoodRef.current = idealPeakRef.current > 0 && cycleP >= idealPeakRef.current * TOLERANCE
                }
                if (mapped.id === startId && hasVisitedPeakRef.current) {
                  // Use pre-recorded quality from peak detection time
                  if (repWasValidRef.current) {
                    setLiveValidReps(v => v + 1)
                  }
                  if (repWasGoodRef.current) {
                    setLiveGoodReps(g => g + 1)
                  }
                  repWasValidRef.current = false
                  repWasGoodRef.current = false

                  setRepCount(prev => {
                    const newCount = prev + 1
                    // ERROR CALCULATION
                   if (learnedTemplateRef.current && anglesOfInterest) {
                      const error = calculateRepError(
                        smoothedAngles,
                        learnedTemplateRef.current,
                        anglesOfInterest,
                        newCount,
                        ts / 1000
                      )
                      if (error) {
                        setRepErrors(prevErrors => {
                          const newErrors = [...prevErrors, error]
                          const summary = analyzeRepTrends(newErrors)
                          setErrorSummary(summary)
                          return newErrors
                        })
                      }
                    }
                    return newCount
                  })
                  hasVisitedPeakRef.current = false
                }
                lastStateRef.current = mapped.id
                stateChangeTimestampRef.current = ts / 1000
              }
            }
          }
        } else {
          const state = determineExerciseState(smoothedAngles)
          stateLabel = state
          if (state) {
            setCurrentState(state)
            updateRepCount(state)
          }
        }

        // Accumulate form score samples for session average
        const effectiveTemplate = learnedTemplateRef.current
        if (effectiveTemplate && anglesOfInterest && anglesOfInterest.length > 0) {
          const frameFormScore = computeFormScore(smoothedAngles, effectiveTemplate, anglesOfInterest, sessionPrimary)
          if (frameFormScore > 0) {
            formScoreSamplesRef.current.push(frameFormScore)
          }
        }

        // ── Dual-threshold live feedback (phase-aware) ──
        if (referenceTemplate && anglesOfInterest && anglesOfInterest.length > 0) {
          const primaryName = sessionPrimary
          const primaryVal = smoothedAngles[primaryName]
          if (primaryVal !== undefined) {
            // Extract reference peak (highest angle) and start (lowest angle)
            let refPeak = 0
            let refStart = Infinity
            for (const s of referenceTemplate.states) {
              const r = s.angleRanges[primaryName]
              if (r) {
                if (r.mean > refPeak) refPeak = r.mean
                if (r.mean < refStart) refStart = r.mean
              }
            }
            // Extract ideal peak
            const effectiveIdeal = allowProgression && idealTemplate ? idealTemplate : referenceTemplate
            let idealPeak = 0
            for (const s of effectiveIdeal.states) {
              const r = s.angleRanges[primaryName]
              if (r && r.mean > idealPeak) idealPeak = r.mean
            }

            // Sync refs so rep counting logic can use them
            // (the useEffect init may miss these if referenceTemplate loads async)
            refPeakRef.current = refPeak
            idealPeakRef.current = idealPeak

            // Track peak angle in current rep cycle (sticky: once high, stays high until reset)
            if (primaryVal > repCyclePeakRef.current) {
              repCyclePeakRef.current = primaryVal
            }

            const TOLERANCE = 0.9
            const midpoint = (refStart + refPeak) / 2

            // Validate that the person is actually in a recognized exercise position.
            // Checks current angles against the pre-computed template state list.
            // Prevents false "Ideal ROM reached" when not performing the exercise.
            const inExerciseRange = isWithinExerciseRange(
              smoothedAngles,
              allTemplateStates,
              anglesOfInterest!,
            )

            // Phase-aware: at rest position show neutral, during active phase use cycle peak
            let currentThresholdStatus: "below" | "valid" | "good" | "rest" = "rest"
            if (!inExerciseRange) {
              // Angles don't match any known exercise state — not performing this exercise
              currentThresholdStatus = "rest"
              repCyclePeakRef.current = primaryVal
            } else if (primaryVal < midpoint) {
              // At or near rest/flexed position - this is a valid position, not "bad"
              currentThresholdStatus = "rest"
              thresholdRest.current = true
              // Reset peak when returning to rest (beginning of new rep cycle)
              repCyclePeakRef.current = primaryVal
            } else {
              // Active/extending phase - use rep cycle peak for sticky status
              const statusAngle = repCyclePeakRef.current
              if (statusAngle >= idealPeak * TOLERANCE) {
                currentThresholdStatus = "good"
                thresholdGood.current = true
              } else if (statusAngle >= refPeak * TOLERANCE) {
                currentThresholdStatus = "valid"
                thresholdValid.current = true
              } else {
                currentThresholdStatus = "below"
              }
            }
            setLiveThresholdStatus(currentThresholdStatus)

          }
        }

        // Only use signal-based rep detection when NO template is available.
        // When a template exists, template-based state-transition detection
        // (above) is the sole rep counter — prevents double-counting.
        if (!learnedTemplateRef.current && anglesOfInterest && anglesOfInterest.length > 0) {
          updateRepCountFromSignal()
        }

        drawer.drawConnectors(landmarks, POSE_CONNECTIONS, {
          color: "#22c55e",
          lineWidth: 8,
        })
        
        drawer.drawLandmarks(landmarks, { 
          radius: 8, 
          fillColor: "#22c55e",
          color: "#16a34a",
          lineWidth: 3 
        })
        
        drawAngleAnnotations(ctx, landmarks, smoothedAngles)
      }

      rafRef.current = requestAnimationFrame(render)
    }

    rafRef.current = requestAnimationFrame(render)
  }


// Stores per-angle signal tracking (peaks, troughs, direction)
const repSignalStatesRef = useRef<{
  [key: string]: {
    lastPeak?: number
    lastTrough?: number
    lastDirection?: 'up' | 'down' | null
    lastChangeT?: number
  }
}>({})

// Global cooldown between reps
const lastRepTimeRef = useRef<number>(0)


// Signal rep detection
// Uses derivative + hysteresis to detect movement cycles
const updateRepCountFromSignal = () => {

  // Select tracking angles
  let trackingAngles: string[] = []

  // Use the single locked primary angle — no multi-tracking
  trackingAngles = [resolvedPrimaryRef.current ?? (anglesOfInterest?.[0] || "right_knee")]

  if (trackingAngles.length === 0) return

  const history = angleHistoryRef.current
  if (history.length < 8) return



  trackingAngles.forEach(angleName => {

    // Initialize state if not exists
    if (!repSignalStatesRef.current[angleName]) {
      repSignalStatesRef.current[angleName] = {
        lastDirection: null,
        lastChangeT: 0
      }
    }

    const state = repSignalStatesRef.current[angleName]



    const recent = history
      .slice(-30)
      .map(h => ({
        t: h.timestamp,
        value: h.angles[angleName]
      }))

    const validRecent =
      recent.filter(r => r.value !== undefined) as {
        t: number
        value: number
      }[]

    if (validRecent.length < 5) return

    const n = validRecent.length
    const deriv: number[] = []

    for (let i = 1; i < n; i++) {
      const dt = Math.max(
        0.016,
        validRecent[i].t - validRecent[i - 1].t
      )

      deriv.push(
        (validRecent[i].value - validRecent[i - 1].value) / dt
      )
    }



    const alpha = 0.3

    for (let i = 1; i < deriv.length; i++) {
      deriv[i] =
        alpha * deriv[i] +
        (1 - alpha) * deriv[i - 1]
    }



    const lastIdx = deriv.length - 1
    const curr = deriv[lastIdx]
    const nowT = validRecent[validRecent.length - 1].t

    const HYST_DERIV = 2
    const MIN_INTERVAL = 0.25

    const dir: 'up' | 'down' | null =
      curr > HYST_DERIV
        ? 'up'
        : curr < -HYST_DERIV
        ? 'down'
        : (state.lastDirection ?? null)

    if (!dir) return


    // Direction change detecion
    if (dir !== state.lastDirection) {

      // Prevent rapid oscillations (noise)
      if (nowT - (state.lastChangeT || 0) < MIN_INTERVAL) {
        state.lastDirection = dir
        return
      }

      // Peak Detection
      if (state.lastDirection === 'up' && dir === 'down') {
        state.lastPeak =
          validRecent[validRecent.length - 1].value
      }

      // trough detection
      if (state.lastDirection === 'down' && dir === 'up') {

        state.lastTrough =
          validRecent[validRecent.length - 1].value

      
      // valid rep checking
        if (
          state.lastPeak !== undefined &&
          state.lastTrough !== undefined
        ) {

          const rom = Math.abs(
            state.lastPeak - state.lastTrough
          )

          // Dynamic range estimation
          const windowVals = validRecent.map(p => p.value)
          const observedRange =
            windowVals.length > 0
              ? Math.max(...windowVals) -
                Math.min(...windowVals)
              : 0

          const MIN_ROM = Math.max(15, observedRange * 0.3)

          // Derive thresholds from reference template if available,
          // otherwise use generous defaults (this path only runs
          // when no learned template exists — see increment 3 guard).
          let PEAK_MIN = 140
          let TROUGH_MAX = 115

          const tmpl = referenceTemplate ?? learnedTemplateRef.current
          if (tmpl) {
            // Use template peak/trough with 90% tolerance
            let tPeak = 0, tStart = Infinity
            for (const s of tmpl.states) {
              const r = s.angleRanges[angleName]
              if (r) {
                if (r.mean > tPeak) tPeak = r.mean
                if (r.mean < tStart) tStart = r.mean
              }
            }
            if (tPeak > 0 && tStart < Infinity) {
              PEAK_MIN = tPeak * 0.9
              TROUGH_MAX = tStart * 1.1
            }
          }

          const peakOK = state.lastPeak >= PEAK_MIN
          const troughOK = state.lastTrough <= TROUGH_MAX

          // Final rep validation
          if (rom >= MIN_ROM && peakOK && troughOK) {

            // Global cooldown to avoid double count
            if (nowT - lastRepTimeRef.current > 1.0) {

              console.log(`REP COUNTED on ${angleName}!`)

              setRepCount(prev => prev + 1)
              lastRepTimeRef.current = nowT
            }

            // Reset peak for next cycle
            state.lastPeak = undefined
          }
        }
      }

      // Update direction + timestamp
      state.lastDirection = dir
      state.lastChangeT = nowT
    }
  })
}

//Angle annotations overlay
// Renders angle values on top of joints in canvas
const drawAngleAnnotations = (
  ctx: CanvasRenderingContext2D,
  landmarks: any[],
  angles: JointAngleData
) => {

  const width = canvasRef.current?.width || 640
  const height = canvasRef.current?.height || 480

  // No angles → nothing to draw
  if (!anglesOfInterest || anglesOfInterest.length === 0) return

  const primaryAngle = resolvedPrimaryRef.current ?? anglesOfInterest[0]

  // Maps angle name → landmark index + label offsets
  const angleToLandmarkMap: {
    [key: string]: { landmark: number; offsetX: number; offsetY: number }
  } = {
    'left_knee':      { landmark: POSE_LANDMARKS.LEFT_KNEE,      offsetX: -65, offsetY: -10 },
    'right_knee':     { landmark: POSE_LANDMARKS.RIGHT_KNEE,     offsetX:  15, offsetY: -10 },
    'left_elbow':     { landmark: POSE_LANDMARKS.LEFT_ELBOW,     offsetX: -65, offsetY: -10 },
    'right_elbow':    { landmark: POSE_LANDMARKS.RIGHT_ELBOW,    offsetX:  15, offsetY: -10 },
    'left_shoulder':  { landmark: POSE_LANDMARKS.LEFT_SHOULDER,  offsetX: -75, offsetY: -10 },
    'right_shoulder': { landmark: POSE_LANDMARKS.RIGHT_SHOULDER, offsetX:  15, offsetY: -10 },
    'left_hip':       { landmark: POSE_LANDMARKS.LEFT_HIP,       offsetX: -65, offsetY: -10 },
    'right_hip':      { landmark: POSE_LANDMARKS.RIGHT_HIP,      offsetX:  15, offsetY: -10 },
  }

  anglesOfInterest
    .filter(angleName =>
      angles[angleName] !== undefined &&
      angleToLandmarkMap[angleName]
    )
    .forEach(angleName => {
      const config = angleToLandmarkMap[angleName]
      const joint = landmarks[config.landmark]
      if (!joint) return

      ctx.fillStyle = "#00ffff"
      ctx.font = "bold 20px Arial"
      ctx.strokeStyle = "#000000"
      ctx.lineWidth = 4

      const text = `${Math.round(angles[angleName])}°`
      const x = joint.x * width + config.offsetX
      const y = joint.y * height + config.offsetY

      ctx.strokeText(text, x, y)
      ctx.fillText(text, x, y)
    })
}


// COMPONENT INITIALIZATION + CLEANUP


useEffect(() => {

  // Use reference template as learned template if provided
  if (referenceTemplate) {
    learnedTemplateRef.current = referenceTemplate as import("@/lib/exercise-state-learner").LearnedExerciseTemplate
  }

  // Resolve the primary angle once at init
  if (anglesOfInterest && anglesOfInterest.length > 0) {
    const tmpl = referenceTemplate ?? learnedTemplateRef.current
    resolvedPrimaryRef.current = resolvePrimaryAngle(anglesOfInterest, tmpl)
  }

  // Note: refPeakRef/idealPeakRef are synced in the per-frame render loop
  // (threshold status section) where referenceTemplate is guaranteed available.

   // CLEANUP ON UNMOUNT
  return () => {

    // Stop webcam stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    // Stop animation loop
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    // Release pose model
    if (poseRef.current) {
      poseRef.current.close()
      poseRef.current = null
    }
  }

}, [])

  // FULLSCREEN RENDER MODE
  if (fullscreen) {
    return (
      <div className="h-full w-full relative bg-black">
        {/* Start overlay when not streaming (hidden when session summary is showing) */}
        {!isStreaming && !isLoading && !sessionEnded && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col gap-3 items-center">
              <Button onClick={openWebcam} size="lg" className="gap-2 text-lg px-8 py-6">
                Start Webcam
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLanguage(prev => prev === "en" ? "ur" : "en")}
                className="text-white border-white/30 bg-black/40"
              >
                {language === "en" ? "English" : "اردو"}
              </Button>
              {enableTestMode && (
                <>
                  <input ref={fileInputRef} type="file" accept="video/*" onChange={handleTestVideoUpload} className="hidden" />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                    variant="outline"
                    size="lg"
                    className="gap-2 text-white border-white/30 bg-black/40"
                  >
                    Test with Video File
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-white text-lg animate-pulse">Loading...</div>
          </div>
        )}

        {/* Video + Canvas (fills container) */}
        <div className="relative w-full h-full">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain"
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full"
          />

          {isStreaming && (
            <>
              {/* Rep counter overlay */}
              <div className={`absolute top-4 left-4 bg-black/80 backdrop-blur-sm rounded-lg px-6 py-4 border-2 ${
                referenceTemplate
                  ? liveThresholdStatus === "good"
                    ? "border-green-500"
                    : liveThresholdStatus === "valid"
                      ? "border-yellow-500"
                      : liveThresholdStatus === "rest"
                        ? "border-blue-500"
                        : "border-red-500"
                  : "border-green-500"
              }`}>
                <div className={`text-sm font-semibold mb-1 ${
                  referenceTemplate
                    ? liveThresholdStatus === "good"
                      ? "text-green-400"
                      : liveThresholdStatus === "valid"
                        ? "text-yellow-400"
                        : liveThresholdStatus === "rest"
                          ? "text-blue-400"
                          : "text-red-400"
                    : "text-green-400"
                }`}>REPS</div>
                <div className="text-5xl font-bold text-white">{repCount}</div>
                {referenceTemplate && (
                  <div className="mt-2 text-[10px] space-y-0.5">
                    <div className={`font-semibold ${
                      liveThresholdStatus === "good"
                        ? "text-green-400"
                        : liveThresholdStatus === "valid"
                          ? "text-yellow-400"
                          : liveThresholdStatus === "rest"
                            ? "text-blue-400"
                            : "text-red-400"
                    }`}>
                      {liveThresholdStatus === "good" ? "Ideal ROM reached" :
                       liveThresholdStatus === "valid" ? "Reference ROM reached" :
                       liveThresholdStatus === "rest" ? "Ready" :
                       "Extend further"}
                    </div>
                  </div>
                )}
              </div>

              {/* State overlay */}
              {(currentState || templateState) && (
                <div className="absolute top-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-blue-500">
                  <div className="text-xs text-blue-400 font-semibold mb-0.5">STATE</div>
                  <div className="text-lg font-bold text-white capitalize">{templateState || currentState}</div>
                </div>
              )}

              {/* Live angles overlay (bottom) */}
              {Object.keys(currentAngles).length > 0 && (
                <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg p-2 border border-purple-500/50">
                  <div className="text-[10px] text-purple-400 font-semibold mb-0.5">LIVE ANGLES</div>
                  <div className="grid grid-cols-4 gap-1">
                    {anglesOfInterest && anglesOfInterest.length > 0 ? (
                      anglesOfInterest.map(angleName => {
                        const angle = currentAngles[angleName]
                        if (angle === undefined) return null
                        return (
                          <div key={angleName} className="flex flex-col">
                            <span className="text-[10px] text-gray-400 capitalize">
                              {angleName.replace(/_/g, ' ')}
                            </span>
                            <span className="text-sm font-bold text-white">
                              {Math.round(angle)}°
                            </span>
                          </div>
                        )
                      })
                    ) : (
                      Object.entries(currentAngles)
                        .filter(([name]) => !name.includes('segment'))
                        .slice(0, 6)
                        .map(([angleName, angle]) => (
                          <div key={angleName} className="flex flex-col">
                            <span className="text-[10px] text-gray-400 capitalize">
                              {angleName.replace(/_/g, ' ')}
                            </span>
                            <span className="text-sm font-bold text-white">
                              {Math.round(angle)}°
                            </span>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Test mode floating controls */}
        {testMode && isStreaming && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 flex gap-2 z-10">
            <Button onClick={togglePlayPause} variant="outline" size="sm" className="bg-black/60 text-white border-white/30">
              {isPlaying ? "Pause" : "Play"}
            </Button>
            <Button onClick={resetTestVideo} variant="outline" size="sm" className="bg-black/60 text-white border-white/30">
              Reset
            </Button>
            <Button onClick={stopTestMode} variant="destructive" size="sm">
              Stop
            </Button>
          </div>
        )}

        {/* End Session button for live webcam (non-test) */}
        {!testMode && isStreaming && onSessionEnd && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
            <Button
              onClick={endSession}
              variant="destructive"
              size="lg"
              className="gap-2 px-8 shadow-lg"
            >
              End Session
            </Button>
          </div>
        )}

        {/* Session ended summary overlay */}
        {sessionEnded && sessionSummary && (
          <div className="absolute inset-0 flex items-center justify-center z-30 bg-black/80 backdrop-blur-sm">
            <div className="bg-black/90 border border-white/20 rounded-xl p-6 max-w-sm w-full space-y-4 text-center">
              <h2 className="text-xl font-bold text-white">Session Complete</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[10px] text-white/50">Total Reps</div>
                  <div className="text-2xl font-bold text-white">{sessionSummary.reps_completed}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[10px] text-white/50">Valid Reps</div>
                  <div className="text-2xl font-bold text-green-400">{sessionSummary.valid_reps}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[10px] text-white/50">Good Reps</div>
                  <div className="text-2xl font-bold text-amber-400">{sessionSummary.good_reps}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-[10px] text-white/50">Avg Form</div>
                  <div className="text-2xl font-bold text-blue-400">{sessionSummary.form_score}%</div>
                </div>
              </div>
              <p className="text-sm text-white/50">Session saved automatically</p>
            </div>
          </div>
        )}

        {testMode && testVideoFile && (
          <div className="absolute top-16 left-4 bg-yellow-500/20 backdrop-blur-sm rounded px-2 py-1 z-10">
            <div className="text-xs text-yellow-300 font-semibold">TEST: {testVideoFile.name}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex gap-3">
        <Button onClick={openWebcam} disabled={isStreaming || isLoading} className="gap-2">
          {isLoading ? "Opening…" : "Open Webcam"}
        </Button>
        <Button
    variant="outline"
    onClick={() => setLanguage(prev => prev === "en" ? "ur" : "en")}
  >
    {language === "en" ? "English" : "اردو"}
  </Button>
        
        {enableTestMode && !isStreaming && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleTestVideoUpload}
              className="hidden"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isLoading}
              variant="outline"
              className="gap-2"
            >
              {isLoading ? "Loading…" : "test with Video File"}
            </Button>
          </>
        )}
        {testMode && isStreaming && (
          <>
            <Button onClick={togglePlayPause} variant="outline">
              {isPlaying ? "Pause" : "▶ Play"}
            </Button>
            <Button onClick={resetTestVideo} variant="outline">
              Reset
            </Button>
            <Button onClick={stopTestMode} variant="destructive">
              Stop Test
            </Button>
          </>
        )}
      </div>

      {testMode && testVideoFile && (
        <div className="bg-yellow-50 dark:bg-yellow-950 border-2 border-yellow-500 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="font-semibold text-yellow-900 dark:text-yellow-100">
                Test Mode Active
              </div>
              <div className="text-sm text-yellow-700 dark:text-yellow-300">
                Testing: {testVideoFile.name}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="relative w-full bg-black rounded-lg overflow-hidden" style={{ aspectRatio: 'auto' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-auto"
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
        />
        
        {isStreaming && (
          <>

            <div className={`absolute top-4 left-4 bg-black/80 backdrop-blur-sm rounded-lg px-6 py-4 border-2 ${
              referenceTemplate
                ? liveThresholdStatus === "good"
                  ? "border-green-500"
                  : liveThresholdStatus === "valid"
                    ? "border-yellow-500"
                    : liveThresholdStatus === "rest"
                      ? "border-blue-500"
                      : "border-red-500"
                : "border-green-500"
            }`}>
              <div className={`text-sm font-semibold mb-1 ${
                referenceTemplate
                  ? liveThresholdStatus === "good"
                    ? "text-green-400"
                    : liveThresholdStatus === "valid"
                      ? "text-yellow-400"
                      : liveThresholdStatus === "rest"
                        ? "text-blue-400"
                        : "text-red-400"
                  : "text-green-400"
              }`}>REPS</div>
              <div className="text-5xl font-bold text-white">{repCount}</div>
              {referenceTemplate && (
                <div className="mt-2 text-[10px] space-y-0.5">
                  <div className={`font-semibold ${
                    liveThresholdStatus === "good"
                      ? "text-green-400"
                      : liveThresholdStatus === "valid"
                        ? "text-yellow-400"
                        : liveThresholdStatus === "rest"
                          ? "text-blue-400"
                          : "text-red-400"
                  }`}>
                    {liveThresholdStatus === "good" ? "Ideal ROM reached" :
                     liveThresholdStatus === "valid" ? "Reference ROM reached" :
                     liveThresholdStatus === "rest" ? "Ready" :
                     "Extend further"}
                  </div>
                </div>
              )}
            </div>
            

            {(currentState || templateState) && (
              <div className="absolute top-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg px-3 py-2 border border-blue-500">
                <div className="text-xs text-blue-400 font-semibold mb-0.5">STATE</div>
                <div className="text-lg font-bold text-white capitalize">{templateState || currentState}</div>
              </div>
            )}
            
            {Object.keys(currentAngles).length > 0 && (
              <div className="absolute bottom-4 left-4 right-4 bg-black/80 backdrop-blur-sm rounded-lg p-2 border border-purple-500/50">
                <div className="text-[10px] text-purple-400 font-semibold mb-0.5">LIVE ANGLES</div>
                <div className="grid grid-cols-4 gap-1">
                  {anglesOfInterest && anglesOfInterest.length > 0 ? (
                    anglesOfInterest.map(angleName => {
                      const angle = currentAngles[angleName]
                      if (angle === undefined) return null
                      
                      return (
                        <div key={angleName} className="flex flex-col">
                          <span className="text-[10px] text-gray-400 capitalize">
                            {angleName.replace(/_/g, ' ')}
                          </span>
                          <span className="text-sm font-bold text-white">
                            {Math.round(angle)}°
                          </span>
                        </div>
                      )
                    })
                  ) : (
                    Object.entries(currentAngles)
                      .filter(([name]) => !name.includes('segment'))
                      .slice(0, 6)
                      .map(([angleName, angle]) => (
                        <div key={angleName} className="flex flex-col">
                          <span className="text-[10px] text-gray-400 capitalize">
                            {angleName.replace(/_/g, ' ')}
                          </span>
                          <span className="text-sm font-bold text-white">
                            {Math.round(angle)}°
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}

            {repDetails.length > 0 && (
              <div className="absolute bottom-4 left-4 bg-black/80 backdrop-blur-sm rounded-lg p-4 border-2 border-emerald-500">
                <div className="text-sm text-emerald-400 font-semibold mb-2">REP DETAILS</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-auto pr-1">
                  {repDetails.map(rep => (
                    <div key={rep.index} className="flex items-center justify-between gap-3">
                      <div className="text-white text-sm">
                        <span className="font-semibold">#{rep.index}</span>
                        <span className="ml-2 text-gray-300">{rep.primaryAngle.replace(/_/g, ' ')}</span>
                        <span className="ml-2">min <span className="font-bold">{rep.minAngle}°</span></span>
                        <span className="ml-2">max <span className="font-bold">{rep.maxAngle}°</span></span>
                      </div>
                      <div className={rep.correct ? "px-2 py-1 rounded bg-green-600/40 text-green-200 border border-green-500/60 text-xs" : "px-2 py-1 rounded bg-red-600/40 text-red-200 border border-red-500/60 text-xs"}>
                        {rep.correct ? "✔ correct" : "✖ incorrect"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="flex gap-3 mt-4">
        <Button onClick={openWebcam} disabled={isStreaming || isLoading} className="gap-2">
          {isLoading ? "Opening…" : "Open Webcam"}
        </Button>
        
        {enableTestMode && !isStreaming && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={handleTestVideoUpload}
              className="hidden"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={isLoading}
              variant="outline"
              className="gap-2"
            >
              {isLoading ? "Loading..." : "Test with Video File"}
            </Button>
          </>
        )}
        {testMode && isStreaming && (
          <>
            <Button onClick={togglePlayPause} variant="outline">
              {isPlaying ? "Pause" : "▶ Play"}
            </Button>
            <Button onClick={resetTestVideo} variant="outline">
              Reset
            </Button>
            <Button onClick={stopTestMode} variant="destructive">
              Stop Test
            </Button>
          </>
        )}
      </div>

      {testMode && testVideoFile && (
        <div className="mt-4 bg-yellow-50 dark:bg-yellow-950 border-2 border-yellow-500 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="font-semibold text-yellow-900 dark:text-yellow-100">
                Test Mode Active
              </div>
              <div className="text-sm text-yellow-700 dark:text-yellow-300">
                Testing: {testVideoFile.name}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {isStreaming && (
        <>
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
              Realtime Tracking Guide
            </h4>
            <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
              <li>Cyan values = Live joint angles</li>
              <li>Stand so your full body is visible</li>
              <li>Perform the exercise slowly and steadily</li>
              {anglesOfInterest?.some(a => a.includes('shoulder') || a.includes('elbow')) && (
                <li>Keep your arms clearly visible to the camera</li>
              )}
              {anglesOfInterest?.some(a => a.includes('knee') || a.includes('hip')) && (
                <li>Ensure your legs are clearly visible</li>
              )}
              {exerciseName && <li>Exercise: {exerciseName}</li>}
            </ul>
          </div>

          {learnedTemplateRef.current && repErrors.length > 0 && (
            <RepErrorGraph 
              repErrors={repErrors} 
              summary={errorSummary}
              width={600}
              height={300}
            />
          )}
        </>
      )}
    </Card>
  )
}

// PRIMARY ANGLE RESOLUTION (single source of truth)
// Only considers actual joint angles (not segment angles) so that
// segment noise can't steal the primary slot. Picks the joint angle
// with the greatest range across template states. Falls back to
// anglesOfInterest[0] when no template is available.

/** Joint-angle names (3-point angles). Segments are excluded. */
const JOINT_ANGLES = new Set([
  "left_knee", "right_knee",
  "left_elbow", "right_elbow",
  "left_hip", "right_hip",
  "left_shoulder", "right_shoulder",
])

function resolvePrimaryAngle(
  anglesOfInterest: string[],
  template?: import("@/lib/exercise-state-learner").LearnedExerciseTemplate | null,
): string {
  // Filter to joint-only angles that are in the interest list
  const jointCandidates = anglesOfInterest.filter(a => JOINT_ANGLES.has(a))
  const candidates = jointCandidates.length > 0 ? jointCandidates : anglesOfInterest

  if (!template || template.states.length < 2) return candidates[0]

  let bestAngle = candidates[0]
  let maxRange = -1

  for (const angle of candidates) {
    const means = template.states
      .map(s => s.angleRanges[angle]?.mean)
      .filter((m): m is number => m !== undefined)

    if (means.length < 2) continue
    const range = Math.max(...means) - Math.min(...means)
    if (range > maxRange) {
      maxRange = range
      bestAngle = angle
    }
  }

  return bestAngle
}




// FORM SCORE COMPUTATION
// Calculates how close current pose is to template
function computeFormScore(
  angles: JointAngleData,
  template: import("@/lib/exercise-state-learner").LearnedExerciseTemplate,
  anglesOfInterest: string[],
  primaryOverride?: string,
): number {

  const primary = primaryOverride ?? resolvePrimaryAngle(anglesOfInterest, template)
  const cur = angles[primary]

  if (cur === undefined) return 0

  const candidates = template.states.filter(
    s => s.angleRanges[primary]
  )

  if (candidates.length === 0) return 0


  // FIND NEAREST STATE (O(n) linear scan)
  let minDist = Infinity
  let nearest = candidates[0]
  for (const s of candidates) {
    const d = Math.abs(cur - s.angleRanges[primary].mean)
    if (d < minDist) { minDist = d; nearest = s }
  }


  // PER-ANGLE SCORING
  let scores: number[] = []

  anglesOfInterest.forEach(name => {

    const val = angles[name]
    const stats = nearest.angleRanges[name]

    if (val === undefined || !stats) return

    const { mean, stdDev, min, max } = stats

    // Clamp to avoid extreme noise
    const clampedVal = Math.max(min, Math.min(max, val))

    const z = Math.abs((clampedVal - mean) / (stdDev || 1))

    const score = Math.max(0, 100 - (z * 20))

    scores.push(score)
  })

  if (scores.length === 0) return 0

  const avg = scores.reduce((s, v) => s + v, 0) / scores.length

  return Math.max(0, Math.min(100, avg))
}


// exercise position validation
// Checks if the current angles fall within the global range of known template states.
// This prevents false "Ideal ROM reached" when the person isn't actually performing
// the exercise (e.g., standing with straight legs vs. seated knee extension).
//
// Computes the overall [min, max] across ALL states for each angle of interest,
// then checks if the current angles fall within that range (+ buffer).
// Returns true if the majority of angles are in range.

function isWithinExerciseRange(
  smoothedAngles: Record<string, number>,
  allStates: { angleRanges: Record<string, { min: number; max: number }> }[],
  anglesOfInterest: string[],
  buffer: number = 20
): boolean {
  if (allStates.length === 0 || anglesOfInterest.length === 0) return false

  let inRangeCount = 0
  let checkedCount = 0

  for (const angle of anglesOfInterest) {
    const actual = smoothedAngles[angle]
    if (actual === undefined) continue

    // Compute global min/max for this angle across all states
    let globalMin = Infinity
    let globalMax = -Infinity
    let found = false

    for (const state of allStates) {
      const range = state.angleRanges[angle]
      if (range) {
        if (range.min < globalMin) globalMin = range.min
        if (range.max > globalMax) globalMax = range.max
        found = true
      }
    }

    if (!found) continue
    checkedCount++

    if (actual >= globalMin - buffer && actual <= globalMax + buffer) {
      inRangeCount++
    }
  }

  if (checkedCount === 0) return false
  // Require at least half the angles to be in the template's range
  return inRangeCount / checkedCount >= 0.5
}


// Template state matching
// Maps current angles → closest template state
function mapToTemplateState(
  angles: JointAngleData,
  template: import("@/lib/exercise-state-learner").LearnedExerciseTemplate,
  anglesOfInterest: string[],
  primaryOverride?: string,
): { id: string; name: string } | null {

  const primary = primaryOverride ?? resolvePrimaryAngle(anglesOfInterest, template)

  const candidates = template.states.filter(
    s => s.angleRanges[primary]
  )

  if (candidates.length === 0) return null


  // Use Euclidean distance across all angles for robust matching (O(n) scan)
  let minDist = Infinity
  let nearest = candidates[0]

  for (const state of candidates) {
    let sumSquaredDiff = 0
    let count = 0

    for (const angle of anglesOfInterest) {
      const range = state.angleRanges[angle]
      const val = angles[angle]
      if (range && val !== undefined) {
        const diff = val - range.mean
        const scale = range.stdDev > 0 ? range.stdDev : 10
        sumSquaredDiff += (diff / scale) ** 2
        count++
      }
    }

    const dist = count > 0 ? Math.sqrt(sumSquaredDiff / count) : Infinity
    if (dist < minDist) {
      minDist = dist
      nearest = state
    }
  }

  return { id: nearest.id, name: nearest.name }
}

