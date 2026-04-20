import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "left_knee" → "Left Knee" */
export function formatAngleName(angle: string): string {
  return angle.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Tailwind text-color class based on a 0-100 similarity score */
export function getSimilarityColor(score: number): string {
  return score >= 80 ? "text-green-500" : score >= 60 ? "text-yellow-500" : "text-red-500"
}

/** Tailwind bg-color class based on a 0-100 similarity score */
export function getSimilarityBg(score: number): string {
  return score >= 80 ? "bg-green-500" : score >= 60 ? "bg-yellow-500" : "bg-red-500"
}

/** Tailwind bg-color class for an angle deviation card (degrees) */
export function getDeviationBg(degrees: number): string {
  return degrees < 10
    ? "bg-green-50 dark:bg-green-950/20"
    : degrees < 20
      ? "bg-yellow-50 dark:bg-yellow-950/20"
      : "bg-red-50 dark:bg-red-950/20"
}
