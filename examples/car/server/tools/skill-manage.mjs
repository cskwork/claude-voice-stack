import { readFile, writeFile, mkdir, readdir, rm } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const customSkillsRoot = resolve(__dirname, '../custom-skills')

function getClientSkillsDir(clientId = 'default') {
  return resolve(customSkillsRoot, clientId)
}

async function readSkillFile(path) {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

function parseSkillMeta(content, fallbackName, source) {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const nameMatch = match[1].match(/name:\s*(.+)/)
  const descMatch = match[1].match(/description:\s*(.+)/)
  return {
    name: nameMatch ? nameMatch[1].trim() : fallbackName,
    description: descMatch ? descMatch[1].trim() : '',
    source,
    readonly: source === 'global',
  }
}

async function loadCatalogFromDir(dir, source) {
  try {
    const dirs = await readdir(dir)
    const catalog = []
    for (const item of dirs) {
      const skillPath = resolve(dir, item, 'SKILL.md')
      const content = await readSkillFile(skillPath)
      if (!content) continue
      const meta = parseSkillMeta(content, item, source)
      if (meta) catalog.push(meta)
    }
    return catalog
  } catch {
    return []
  }
}

export const skillRun = {
  type: 'function',
  function: {
    name: 'skill_run',
    description: '加载并查看一个自定义 Skill 的详细执行指令',
    parameters: {
      type: 'object',
      properties: {
        skill_name: {
          type: 'string',
          description: '自定义 Skill 的名称',
        },
      },
      required: ['skill_name'],
    },
  },
  execute: async (params, context) => {
    const clientSkillPath = resolve(getClientSkillsDir(context?.clientId), params.skill_name, 'SKILL.md')
    const globalSkillPath = resolve(customSkillsRoot, params.skill_name, 'SKILL.md')
    const content = await readSkillFile(clientSkillPath) || await readSkillFile(globalSkillPath)
    if (content) return { result: content }
    return { result: `未找到自定义 Skill：${params.skill_name}` }
  },
}

export const skillCreate = {
  type: 'function',
  function: {
    name: 'skill_create',
    description: '创建一个新的自定义 Skill',
    parameters: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: 'Skill 标识名（用作文件夹名）',
        },
        description: {
          type: 'string',
          description: 'Skill 简介',
        },
        instructions: {
          type: 'string',
          description: 'Skill 执行指令（Markdown 格式）',
        },
      },
      required: ['skill_id', 'description', 'instructions'],
    },
  },
  execute: async (params, context) => {
    const skillDir = resolve(getClientSkillsDir(context?.clientId), params.skill_id)
    await mkdir(skillDir, { recursive: true })
    const content = `---
name: ${params.skill_id}
description: ${params.description}
version: 1.0.0
author: user
---

${params.instructions}
`
    await writeFile(resolve(skillDir, 'SKILL.md'), content)
    return { result: `已创建自定义 Skill：${params.skill_id}` }
  },
}

export async function deleteCustomSkill(clientId = 'default', name) {
  const skillDir = resolve(getClientSkillsDir(clientId), name)
  await rm(skillDir, { recursive: true, force: true })
}

export async function loadCustomSkillCatalog(clientId = 'default') {
  const byName = new Map()
  const globalCatalog = await loadCatalogFromDir(customSkillsRoot, 'global')
  const clientCatalog = await loadCatalogFromDir(getClientSkillsDir(clientId), 'user')

  for (const skill of globalCatalog) {
    byName.set(skill.name, skill)
  }
  for (const skill of clientCatalog) {
    byName.set(skill.name, skill)
  }
  return [...byName.values()]
}

export default [skillRun, skillCreate]
