"use client"

import { Card } from "./ui/card"
import { Button } from "./ui/button"
import type { LearnedExerciseTemplate } from "@/lib/exercise-state-learner"

interface LearnedTemplateViewProps {
  template: LearnedExerciseTemplate
  onSaveTemplate?: () => void
}

export function LearnedTemplateView({ template, onSaveTemplate }: LearnedTemplateViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2">Learned Exercise Template</h2>
            <p className="text-muted-foreground">
              Automatically detected <strong>{template.states.length} key states</strong> from your reference video
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t">
          <div>
            <div className="text-sm text-muted-foreground">Duration</div>
            <div className="text-lg font-semibold">{template.totalDuration.toFixed(1)}s</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Detected Reps</div>
            <div className="text-lg font-semibold">{template.recommendedReps}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">FPS</div>
            <div className="text-lg font-semibold">{template.metadata.fps}</div>
          </div>
        </div>
      </Card>

      {/* States */}
      <div className="space-y-4">
        <h3 className="text-xl font-semibold">Detected States</h3>
        
        {template.states.map((state, index) => (
          <Card key={state.id} className="p-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold">
                {index + 1}
              </div>
              
              <div className="flex-1">
                <h4 className="text-lg font-semibold mb-1">{state.name}</h4>
                <p className="text-sm text-muted-foreground mb-3">{state.description}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
                  {Object.entries(state.angleRanges).map(([angleName, range]) => (
                    <div 
                      key={angleName}
                      className="bg-muted/50 rounded-md p-3"
                    >
                      <div className="text-sm font-medium capitalize">
                        {angleName.replace(/_/g, " ")}
                      </div>
                      <div className="text-2xl font-bold mt-1">
                        {Math.round(range.mean)}°
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Range: {Math.round(range.min)}° - {Math.round(range.max)}° 
                        (±{Math.round(range.stdDev)}°)
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="text-sm">
                  <strong>Appears {state.occurrences.length} time(s):</strong>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {state.occurrences.map((occ, occIdx) => (
                      <span 
                        key={occIdx}
                        className="inline-block bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded px-2 py-1 text-xs"
                      >
                        {occ.startTime.toFixed(1)}s - {occ.endTime.toFixed(1)}s 
                        ({occ.duration.toFixed(1)}s)
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* State Sequence Flow */}
      <Card className="p-6">
        <h3 className="text-xl font-semibold mb-4">Exercise Flow</h3>
        <div className="flex items-center gap-2 flex-wrap">
          {template.repSequence.map((stateId, index) => {
            const state = template.states.find(s => s.id === stateId)
            return (
              <div key={index} className="flex items-center gap-2">
                <div className="bg-primary text-primary-foreground rounded-lg px-4 py-2 font-medium">
                  {state?.name || stateId}
                </div>
                {index < template.repSequence.length - 1 && (
                  <span className="text-2xl text-muted-foreground">→</span>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Transitions */}
      {template.transitions.length > 0 && (
        <Card className="p-6">
          <h3 className="text-xl font-semibold mb-4">Transitions</h3>
          <div className="space-y-3">
            {template.transitions.map((transition, index) => {
              const fromState = template.states.find(s => s.id === transition.fromState)
              const toState = template.states.find(s => s.id === transition.toState)
              
              return (
                <div key={index} className="bg-muted/50 rounded-md p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">{fromState?.name}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">{toState?.name}</span>
                    <span className="ml-auto text-sm text-muted-foreground">
                      {transition.duration.toFixed(2)}s
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                    {Object.entries(transition.angleChanges).map(([angleName, change]) => (
                      <div key={angleName} className="text-xs">
                        <span className="capitalize">{angleName.replace(/_/g, " ")}:</span>
                        <span className={`ml-1 font-medium ${
                          change.delta > 0 ? "text-green-600" : "text-red-600"
                        }`}>
                          {change.delta > 0 ? "+" : ""}{Math.round(change.delta)}°
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Actions */}
      {onSaveTemplate && (
        <div className="flex justify-end">
          <Button onClick={onSaveTemplate} size="lg">
            Save Template for Comparisons
          </Button>
        </div>
      )}
    </div>
  )
}
