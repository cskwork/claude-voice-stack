// 精灵皮肤动画模型：基础图集对齐 Codex Pet，pet.json 可用
// animations.{name}.{frames,fps} 精确描述生成式皮肤的有效帧。
// 动画生命周期由悬浮球状态机控制，皮肤不能通过 loop/fallback 改写。

const DEFAULT_COLUMNS = 8
const DEFAULT_FRAME_WIDTH = 192
const DEFAULT_FRAME_HEIGHT = 208
const DEFAULT_ROWS = 9
const V2_ROWS = 11
const DEFAULT_FPS = 8
const MAX_FPS = 60

function idleAnimation() {
  const durations = [1680, 660, 660, 840, 840, 1920]
  return {
    frames: durations.map((durationMs, spriteIndex) => ({
      spriteIndex,
      durationMs,
    })),
    loopStart: 0,
    fallback: 'idle',
  }
}

function rowAnimation(
  rowIndex,
  frameCount,
  frameDurationMs,
  finalFrameDurationMs,
) {
  return {
    frames: Array.from({ length: frameCount }, (_, column) => ({
      spriteIndex: rowIndex * DEFAULT_COLUMNS + column,
      durationMs: column === frameCount - 1
        ? finalFrameDurationMs
        : frameDurationMs,
    })),
    loopStart: null,
    fallback: 'idle',
  }
}

export function defaultAnimations() {
  return {
    'idle': idleAnimation(),
    'running-right': rowAnimation(1, 8, 120, 220),
    'running-left': rowAnimation(2, 8, 120, 220),
    'waving': rowAnimation(3, 4, 140, 280),
    'jumping': rowAnimation(4, 5, 140, 280),
    'failed': rowAnimation(5, 8, 140, 240),
    'waiting': rowAnimation(6, 6, 150, 260),
    'running': rowAnimation(7, 6, 120, 220),
    'review': rowAnimation(8, 6, 150, 280),
  }
}

// 语音状态 → 动画名。状态由 orb-presentation.js 的仲裁器产出：
// 对话态（idle/listening/processing/speaking）与后台/系统态
// （attention/working/occupied/error/connecting/waking/hidden）。
export function spriteAnimationForOrbState({
  state,
  baseAnimation = 'idle',
} = {}) {
  switch (state) {
    case 'listening':
      return 'waiting'
    case 'processing':
      return 'review'
    case 'working':
      return 'running'
    case 'speaking':
      return 'waving'
    case 'starting':
      return 'waiting'
    case 'waking':
      return 'waving'
    case 'error':
      return 'failed'
    default:
      return baseAnimation
  }
}

export function spritePlaybackSelection({
  state,
  baseWorking = false,
  dragDirection = '',
  cue = null,
} = {}) {
  const fallback = baseWorking || state === 'working' ? 'running' : 'idle'
  const stateAnimation = spriteAnimationForOrbState({
    state,
    baseAnimation: fallback,
  })
  if (dragDirection === 'left' || dragDirection === 'right') {
    return {
      name: `running-${dragDirection}`,
      key: `drag:${dragDirection}`,
      loop: true,
      completion: 'none',
      fallback,
    }
  }
  if (cue?.id && cue.name) {
    return {
      name: cue.name,
      key: `cue:${cue.id}`,
      loop: false,
      completion: 'cue',
      fallback,
    }
  }
  return {
    name: stateAnimation,
    key: `state:${state}:${stateAnimation}`,
    loop: (
      state === 'starting'
      || stateAnimation === 'idle'
      || stateAnimation === 'running'
    ),
    completion: 'none',
    fallback,
  }
}

export function spriteGeometry(manifest = {}) {
  const version = manifest.spriteVersionNumber ?? 1
  const frame = manifest.frame && typeof manifest.frame === 'object'
    ? manifest.frame
    : {
        width: DEFAULT_FRAME_WIDTH,
        height: DEFAULT_FRAME_HEIGHT,
        columns: DEFAULT_COLUMNS,
        rows: version === 2 ? V2_ROWS : DEFAULT_ROWS,
      }
  for (const key of ['width', 'height', 'columns', 'rows']) {
    if (!Number.isInteger(frame[key]) || frame[key] <= 0) return null
  }
  return {
    width: frame.width,
    height: frame.height,
    columns: frame.columns,
    rows: frame.rows,
    frameCount: frame.columns * frame.rows,
  }
}

export function frameRect(geometry, spriteIndex) {
  return {
    x: (spriteIndex % geometry.columns) * geometry.width,
    y: Math.floor(spriteIndex / geometry.columns) * geometry.height,
    width: geometry.width,
    height: geometry.height,
  }
}

// 合并 pet.json 可选 animations 覆盖与默认轨道表。皮肤只控制有效帧与
// 帧率；旧清单里的 loop/fallback 会被有意忽略。
export function resolveAnimations(manifest = {}, frameCount = 0) {
  const animations = defaultAnimations()
  const specs = manifest.animations
  if (specs && typeof specs === 'object' && !Array.isArray(specs)) {
    for (const [name, spec] of Object.entries(specs)) {
      if (!spec || !Array.isArray(spec.frames) || spec.frames.length === 0) {
        throw new Error(`皮肤动画 ${name} 至少要包含一帧`)
      }
      const fps = spec.fps === undefined ? DEFAULT_FPS : spec.fps
      if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_FPS) {
        throw new Error(`皮肤动画 ${name} 的 fps 非法`)
      }
      const durationMs = 1000 / fps
      animations[name] = {
        frames: spec.frames.map(spriteIndex => ({ spriteIndex, durationMs })),
        loopStart: name === 'idle' ? 0 : null,
        fallback: 'idle',
      }
    }
  }
  for (const [name, animation] of Object.entries(animations)) {
    for (const frame of animation.frames) {
      if (
        !Number.isInteger(frame.spriteIndex)
        || frame.spriteIndex < 0
        || frame.spriteIndex >= frameCount
      ) {
        throw new Error(`皮肤动画 ${name} 引用了越界的帧索引`)
      }
    }
  }
  return animations
}

function totalDuration(animation) {
  return animation.frames.reduce((sum, frame) => sum + frame.durationMs, 0)
}

// 无状态帧解析（仿 Codex current_animation_frame）：由动画开始至今的
// elapsed 算当前帧与到下一帧的延时。one-shot 播完返回 null，由调用方
// 切到 fallback 轨道。
export function frameAtElapsed(animation, elapsedMs) {
  const total = totalDuration(animation)
  if (total <= 0) return null
  let position = Math.max(0, elapsedMs)
  if (position >= total) {
    if (animation.loopStart === null) return null
    const introDuration = animation.frames
      .slice(0, animation.loopStart)
      .reduce((sum, frame) => sum + frame.durationMs, 0)
    const loopDuration = total - introDuration
    if (loopDuration <= 0) return null
    position = introDuration + ((position - total) % loopDuration)
  }
  let cursor = 0
  for (const frame of animation.frames) {
    if (position < cursor + frame.durationMs) {
      return {
        spriteIndex: frame.spriteIndex,
        remainingMs: cursor + frame.durationMs - position,
      }
    }
    cursor += frame.durationMs
  }
  return null
}
