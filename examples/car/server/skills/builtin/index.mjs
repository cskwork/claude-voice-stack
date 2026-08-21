import { readdir } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const builtinSkills = []
const builtinSkillExecutors = {}
const builtinSkillCatalog = []

function registerSkill(skill) {
  if (!skill || !skill.function?.name) return
  builtinSkills.push(skill)
  builtinSkillExecutors[skill.function.name] = skill.execute
  builtinSkillCatalog.push({
    id: skill.skill?.id || `builtin.${skill.function.name}`,
    name: skill.skill?.name || skill.function.name,
    toolName: skill.function.name,
    description: skill.skill?.description || skill.function.description,
    atomicTools: skill.skill?.atomicTools || [],
  })
}

const files = await readdir(__dirname)
for (const file of files) {
  if (file === 'index.mjs' || !file.endsWith('.mjs')) continue
  const mod = await import(join(__dirname, file))
  const def = mod.default
  if (Array.isArray(def)) {
    def.forEach(registerSkill)
  } else {
    registerSkill(def)
  }
}

export { builtinSkills, builtinSkillExecutors, builtinSkillCatalog }
