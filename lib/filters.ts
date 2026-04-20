// ROHA to FUTURE ROHA
// testing modularing filters so keep all (if any more are needed - which probably will be needed to solve the problem in lines 298-313 in comparison recorder) here


/**
 * one Euro Filter for temporal smoothing of time-series signals.
 * Paper: https://cristal.univ-lille.fr/~casiez/1euro/
 */


export class OneEuroFilter {
  private x_prev = 0
  private dx_prev = 0
  private t_prev = 0
  private isFirstRun = true

  constructor(
    private min_cutoff = 1.0,
    private beta = 0.007,
    private d_cutoff = 1.0
  ) {}

  private smoothingFactor(t_e: number, cutoff: number): number {
    const r = 2 * Math.PI * cutoff * t_e
    return r / (r + 1)
  }

  private exponentialSmoothing(a: number, x: number, x_prev: number): number {
    return a * x + (1 - a) * x_prev
  }

  filter(x: number, t: number): number {
    if (this.isFirstRun) {
      this.isFirstRun = false
      this.x_prev = x
      this.t_prev = t
      return x
    }

    const t_e = this.t_prev === 0 ? 0 : t - this.t_prev
    if (t_e === 0) return x

    const dx = (x - this.x_prev) / t_e
    const edx = this.exponentialSmoothing(
      this.smoothingFactor(t_e, this.d_cutoff),
      dx,
      this.dx_prev
    )

    const cutoff = this.min_cutoff + this.beta * Math.abs(edx)
    const x_filtered = this.exponentialSmoothing(
      this.smoothingFactor(t_e, cutoff),
      x,
      this.x_prev
    )

    this.x_prev = x_filtered
    this.dx_prev = edx
    this.t_prev = t

    return x_filtered
  }

  reset() {
    this.x_prev = 0
    this.dx_prev = 0
    this.t_prev = 0
    this.isFirstRun = true
  }
}
