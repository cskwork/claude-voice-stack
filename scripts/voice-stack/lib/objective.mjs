/**
 * Extract the execution constraints a delegation objective carries. The
 * foreground prompt asks GLM to write "Goal … Mode … Constraints …", but the
 * matcher is intentionally tolerant so a natural-language objective that still
 * preserves the restriction passes the gate.
 */
const RULES = [
  {
    id: 'do_not_edit',
    patterns: [
      /\b(do not|don't|dont|never|without|no)\s+(edit|modif\w*|chang\w*|touch\w*|writ\w*|alter\w*)/i,
      /\binspect[- ]only\b/i,
      /\bread[- ]only\b/i,
      /\bmode:\s*inspect\b/i,
      /수정하지\s*(마|말)/,
      /변경하지\s*(마|말)/,
    ],
  },
  {
    id: 'do_not_commit',
    patterns: [
      /\b(do not|don't|dont|never|without|no)\s+commit/i,
      /커밋하지\s*(마|말)/,
    ],
  },
  {
    id: 'no_production_data',
    patterns: [
      /\b(do not|don't|dont|never|without|no|avoid)\s+(use|touch|query|access)?\s*(the\s+)?production/i,
      /\bnon-production\b/i,
      /운영\s*(데이터|DB)[^.]*(사용하지|쓰지)/,
    ],
  },
  {
    id: 'ask_before_destructive',
    patterns: [
      /\b(ask|confirm|check)\b[^.]{0,40}\bdestructive/i,
      /\bdestructive\b[^.]{0,40}\b(ask|confirm)/i,
    ],
  },
]

export function extractConstraints(objective) {
  const text = String(objective || '')
  return RULES
    .filter(rule => rule.patterns.some(pattern => pattern.test(text)))
    .map(rule => rule.id)
}

export function objectiveMode(objective) {
  const match = /\bmode:\s*(inspect|edit)\b/i.exec(String(objective || ''))
  if (match) return match[1].toLowerCase()
  return extractConstraints(objective).includes('do_not_edit') ? 'inspect' : 'unknown'
}
