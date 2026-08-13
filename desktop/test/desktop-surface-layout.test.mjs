import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DESKTOP_ORB_HEIGHT,
  DESKTOP_ORB_WIDTH,
  DESKTOP_TASK_SURFACE_WIDTH,
  desktopSurfaceSize,
  resizeDesktopSurfaceBounds,
} from '../src/desktop-surface-layout.mjs'

test('keeps the compact orb surface without task cards', () => {
  assert.deepEqual(desktopSurfaceSize(0), {
    width: DESKTOP_ORB_WIDTH,
    height: DESKTOP_ORB_HEIGHT,
  })
})

test('grows downward for task cards and caps at the work area', () => {
  assert.deepEqual(desktopSurfaceSize(2, { workAreaHeight: 900 }), {
    width: DESKTOP_TASK_SURFACE_WIDTH,
    height: 330,
  })
  assert.deepEqual(desktopSurfaceSize(20, { workAreaHeight: 700 }), {
    width: DESKTOP_TASK_SURFACE_WIDTH,
    height: 700,
  })
})

test('preserves the right edge while keeping the surface on screen', () => {
  assert.deepEqual(resizeDesktopSurfaceBounds(
    { x: 1000, y: 24, width: 172, height: 170 },
    { width: 360, height: 330 },
    { x: 0, y: 0, width: 1200, height: 800 },
  ), { x: 812, y: 24, width: 360, height: 330 })
})
