export type Segment = {
  startSeconds: number
  durationSeconds: number
  endSeconds: number
  text: string
}

export type EvaluatedToken = {
  text: string
  correct: boolean
}
