/**
 * Exercise configurations with specific angles to track
 */

export interface AngleConfig {
  type: "joint" | "segment"
  name: string
  description: string
}

export interface ExerciseConfig {
  id: string
  name: string
  description: string
  // Specific angles to track (not just joints)
  anglesOfInterest: string[]
  // Human-readable angle descriptions
  angleConfigs: AngleConfig[]
}

export const EXERCISE_CONFIGS: ExerciseConfig[] = [
  {
    id: "knee-extension",
    name: "Knee Extension",
    description: "Extending the knee from bent to straight position",
    anglesOfInterest: [
      // Joint angles (3-point)
      "left_knee",      // Hip-Knee-Ankle angle
      "right_knee",     // Hip-Knee-Ankle angle
      // Segment angles (2-point relative to vertical)
      "left_leg_segment",    // Knee-Ankle segment
      "right_leg_segment",   // Knee-Ankle segment
      "left_thigh_segment",  // Hip-Knee segment
      "right_thigh_segment", // Hip-Knee segment
    ],
    angleConfigs: [
      { type: "joint", name: "left_knee", description: "Left knee joint angle (hip-knee-ankle)" },
      { type: "joint", name: "right_knee", description: "Right knee joint angle (hip-knee-ankle)" },
      { type: "segment", name: "left_leg_segment", description: "Left lower leg angle from vertical (knee-ankle)" },
      { type: "segment", name: "right_leg_segment", description: "Right lower leg angle from vertical (knee-ankle)" },
      { type: "segment", name: "left_thigh_segment", description: "Left thigh angle from vertical (hip-knee)" },
      { type: "segment", name: "right_thigh_segment", description: "Right thigh angle from vertical (hip-knee)" },
    ],
  },
  {
    id: "scap-wall-slides",
    name: "Scap Wall Slides",
    description: "Bilateral arm exercise against a wall - slide arms up and down maintaining contact with wall",
    anglesOfInterest: [
      "left_shoulder",
      "right_shoulder",
      "left_elbow",
      "right_elbow",
      "left_arm_segment",
      "right_arm_segment",
      "left_forearm_segment",
      "right_forearm_segment",
    ],
    angleConfigs: [
      { type: "joint", name: "left_shoulder", description: "Left shoulder joint angle (elbow-shoulder-hip)" },
      { type: "joint", name: "right_shoulder", description: "Right shoulder joint angle (elbow-shoulder-hip)" },
      { type: "joint", name: "left_elbow", description: "Left elbow joint angle (shoulder-elbow-wrist)" },
      { type: "joint", name: "right_elbow", description: "Right elbow joint angle (shoulder-elbow-wrist)" },
      { type: "segment", name: "left_arm_segment", description: "Left upper arm angle from vertical (shoulder-elbow)" },
      { type: "segment", name: "right_arm_segment", description: "Right upper arm angle from vertical (shoulder-elbow)" },
      { type: "segment", name: "left_forearm_segment", description: "Left forearm angle from vertical (elbow-wrist)" },
      { type: "segment", name: "right_forearm_segment", description: "Right forearm angle from vertical (elbow-wrist)" },
    ],
  },
]

export function getExerciseConfig(exerciseId: string): ExerciseConfig | undefined {
  return EXERCISE_CONFIGS.find((config) => config.id === exerciseId)
}

export function filterAnglesByExercise(
  allAngles: string[],
  exerciseId: string,
): string[] {
  const config = getExerciseConfig(exerciseId)
  if (!config) return allAngles
  
  return allAngles.filter((angle) => config.anglesOfInterest.includes(angle))
}

