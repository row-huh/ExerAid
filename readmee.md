
# Physiotherapy Guidance System - Technical Process Documentation

This document details the technical architecture, mathematical models, and algorithmic processes used in the Physiotherapy Guidance System. The system uses computer vision to analyze exercise form, learn from reference videos, and provide real-time feedback.

## 1. Core Architecture Overview

The system operates in three main phases:
1.  **Pose Detection & Analysis**: Extracting skeletal data from video.
2.  **Template Learning**: Creating a mathematical model of "correct" form from a reference video.
3.  **Real-time Comparison**: Comparing user performance against the learned template.

### Key Libraries
-   `src/lib/pose-analyzer.ts`: Core engine for landmark detection and angle calculation.
-   `src/lib/exercise-state-learner.ts`: Implements K-Means clustering to learn exercise states.
-   `src/lib/rep-error-calculator.ts`: Logic for scoring and feedback generation.
-   `src/lib/exercise-config.ts`: Configuration for specific exercises (angles to track).

---

## 2. Pose Detection & Signal Processing

### MediaPipe Integration
We use Google's **MediaPipe Pose Landmarker** (Full model) to detect 33 3D skeletal landmarks in real-time.
-   **Model**: `pose_landmarker_full.task` (Float16)
-   **Delegate**: GPU acceleration
-   **FPS**: Processed at ~30 FPS

### Temporal Smoothing (One Euro Filter)
Raw landmark data from MediaPipe can be jittery. We apply a **One Euro Filter** to smooth the signal while minimizing lag. This is crucial for accurate angle calculation.

**The Math:**
The filter uses an adaptive cutoff frequency based on the rate of change (velocity) of the signal.
-   **Low velocity (holding still)**: Low cutoff frequency -> High smoothing (reduces jitter).
-   **High velocity (moving fast)**: High cutoff frequency -> Low smoothing (reduces lag).

$$
\hat{x}_i = \alpha x_i + (1 - \alpha) \hat{x}_{i-1}
$$

Where $\alpha$ is the smoothing factor calculated dynamically based on velocity.

---

## 3. Angle Calculation

We calculate two types of angles to fully capture body mechanics.

### A. Joint Angles (3-Point)
Measures the interior angle at a joint formed by three landmarks (e.g., Hip-Knee-Ankle).

**Formula:**
Given points $A, B, C$ where $B$ is the vertex (joint):
$$
\theta = \left| \text{atan2}(C_y - B_y, C_x - B_x) - \text{atan2}(A_y - B_y, A_x - B_x) \right|
$$
*Result is normalized to 0-180 degrees.*

**Used for:**
-   Knee flexion/extension
-   Elbow flexion/extension
-   Shoulder abduction/adduction

### B. Segment Angles (2-Point Relative to Vertical)
Measures the absolute orientation of a body segment relative to the vertical axis (gravity). This is critical for exercises where limb position matters independent of joint flexion (e.g., keeping the thigh vertical during a leg extension).

**Formula:**
Given start point $S$ and end point $E$:
$$
\theta = \left| \text{atan2}(E_x - S_x, E_y - S_y) \right| \times \frac{180}{\pi}
$$
*Result is 0-180 degrees from vertical.*

**Used for:**
-   Thigh angle (Hip-Knee)
-   Lower leg angle (Knee-Ankle)
-   Torso alignment

---

## 4. Template Learning (The "Teacher")

Instead of hardcoding rules (e.g., "knee must be > 90Â°"), the system **learns** the correct form from a reference video.

### K-Means Clustering
We use **K-Means Clustering** to group all frames from the reference video into distinct "States".
-   **Input**: Vector of relevant angles for each frame.
-   **Output**: $K$ clusters representing key poses (e.g., "Start Position", "Mid-Rep", "Peak Contraction").

**Process:**
1.  Collect angle data for every frame of the reference video.
2.  Initialize $K$ centroids.
3.  Iteratively assign frames to the nearest centroid (Euclidean distance) and update centroids.
4.  Result: A set of "States", each defined by the mean and standard deviation of its angles.

### Repetition Logic
The system automatically identifies the structure of a repetition:
1.  **Start State**: Usually the state with the minimum (or maximum) extension.
2.  **Peak State**: The state mathematically furthest from the Start State.
3.  **Cycle**: A rep is defined as moving from `Start` -> `Peak` -> `Start`.

---

## 5. Real-time Comparison & Scoring (The "Judge")

When a user performs the exercise, we compare their live data to the learned template.

### State Matching
For every frame of the user's video:
1.  We identify the **Primary Angle** (e.g., Knee Angle for Knee Extension).
2.  We find the **Nearest State** in the template whose mean primary angle is closest to the user's current primary angle.

### Error Calculation
Once the user is matched to a state (e.g., "You are currently at the Peak Contraction point"), we compare all other tracked angles to that state's expected values.

**For each angle $i$:**
$$
\text{Error}_i = | \text{UserAngle}_i - \text{TemplateStateMean}_i |
$$

**Percent Error:**
$$
\text{PercentError}_i = \frac{\text{Error}_i}{\text{Range}_i} \times 100
$$
*(Where Range is the difference between Min and Max observed values for that angle)*

### Form Score
The overall form score is a weighted average derived from the total error.

$$
\text{Score} = \max(0, 100 - \frac{\text{AverageError}}{2})
$$

### Feedback Generation
The system identifies the angle with the highest error contribution and generates specific feedback:
-   If `UserAngle > Expected`: "Less bend" / "Lower"
-   If `UserAngle < Expected`: "More bend" / "Higher"

---

## 6. Data Flow Summary

1.  **Input**: Webcam Video Stream.
2.  **Pose Analyzer**:
    *   Detect Landmarks (MediaPipe).
    *   Smooth Landmarks (One Euro Filter).
    *   Calculate Angles (Trigonometry).
3.  **Comparison Engine**:
    *   Match current angles to Learned Template States.
    *   Calculate deviations (Errors).
4.  **UI Layer**:
    *   Render Skeleton Overlay.
    *   Display Real-time Feedback.
    *   Plot Error Graphs.

## 7. Supported Exercises

Currently optimized for:
1.  **Knee Extension**: Tracks Knee Angle, Thigh Segment, Leg Segment.
2.  **Scap Wall Slides**: Tracks Shoulder, Elbow, Arm Segment, Forearm Segment.

*New exercises can be added by defining their `anglesOfInterest` in `src/lib/exercise-config.ts`.*
message.txt
7 KB