import assert from 'node:assert/strict'
import test from 'node:test'
import { desktopOrbClassName } from '../src/orb-presentation.js'

test('keeps speaking animation active while microphone input is muted', () => {
  assert.equal(desktopOrbClassName({
    state: 'speaking',
    enabled: false,
  }), 'desktop-orb-stage speaking input-muted')
})

test('exposes listening level, error, and dragging states to the desktop orb', () => {
  assert.equal(desktopOrbClassName({
    state: 'listening',
    enabled: true,
    error: true,
    dragging: true,
  }), 'desktop-orb-stage listening enabled error dragging')
})

test('keeps sleeping lifecycle distinct from an error', () => {
  const className = desktopOrbClassName({
    state: 'sleeping',
    enabled: true,
    lifecycle: 'sleeping',
  })
  assert.match(className, /\bsleeping\b/)
  assert.doesNotMatch(className, /\berror\b/)
})
