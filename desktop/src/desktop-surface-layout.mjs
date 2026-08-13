export const DESKTOP_ORB_WIDTH = 172
export const DESKTOP_ORB_HEIGHT = 204
export const DESKTOP_TASK_SURFACE_WIDTH = 360
export const DESKTOP_TASK_CARD_HEIGHT = 54
export const DESKTOP_TASK_CARD_GAP = 8
export const DESKTOP_TASK_STACK_PADDING = 8
export const DESKTOP_TASK_STACK_LIFT = 14

export function desktopSurfaceSize(taskCount, {
  workAreaHeight = Number.POSITIVE_INFINITY,
} = {}) {
  const count = Math.max(0, Math.floor(Number(taskCount) || 0))
  if (count === 0) {
    return { width: DESKTOP_ORB_WIDTH, height: DESKTOP_ORB_HEIGHT }
  }
  const stackHeight = (
    count * DESKTOP_TASK_CARD_HEIGHT
    + Math.max(0, count - 1) * DESKTOP_TASK_CARD_GAP
    + DESKTOP_TASK_STACK_PADDING * 2
  )
  const requestedHeight = (
    DESKTOP_ORB_HEIGHT
    + stackHeight
    - DESKTOP_TASK_STACK_LIFT
  )
  return {
    width: DESKTOP_TASK_SURFACE_WIDTH,
    height: Math.min(
      requestedHeight,
      Math.max(DESKTOP_ORB_HEIGHT, workAreaHeight),
    ),
  }
}

export function resizeDesktopSurfaceBounds(bounds, size, workArea) {
  const right = bounds.x + bounds.width
  const x = Math.min(
    Math.max(workArea.x, right - size.width),
    workArea.x + workArea.width - size.width,
  )
  const y = Math.min(
    Math.max(workArea.y, bounds.y),
    workArea.y + workArea.height - size.height,
  )
  return { x, y, width: size.width, height: size.height }
}
