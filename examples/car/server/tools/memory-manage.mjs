import { readMemory, writeMemory, deleteMemory } from '../memory.mjs'

export const memoryRead = {
  type: 'function',
  function: {
    name: 'memory_read',
    description: '读取用户记忆，可按关键词检索。返回结果包含索引号，可用于删除',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '可选的关键词过滤',
        },
      },
    },
  },
  execute: async (params, context) => {
    const allItems = await readMemory(context?.clientId)
    let items = allItems
    if (params.query) {
      items = allItems.filter((i) => i.content.includes(params.query))
    }
    if (items.length === 0) return { result: '没有找到相关记忆' }
    const desc = items.map((i) => {
      const idx = allItems.indexOf(i)
      return `[${idx}] ${i.content}`
    }).join('\n')
    return { result: desc }
  },
}

export const memoryDeleteSkill = {
  type: 'function',
  function: {
    name: 'memory_delete',
    description: '按索引删除一条记忆，索引号从 memory_read 返回结果中获取',
    parameters: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: '要删除的记忆索引号',
        },
      },
      required: ['index'],
    },
  },
  execute: async (params, context) => {
    await deleteMemory(context?.clientId, params.index)
    return { result: '已删除' }
  },
}

export const memoryWrite = {
  type: 'function',
  function: {
    name: 'memory_write',
    description: '写入一条记忆，用于记住用户偏好、习惯或重要信息，长期保存',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '要记忆的内容',
        },
      },
      required: ['content'],
    },
  },
  execute: async (params, context) => {
    await writeMemory(context?.clientId, params.content)
    return { result: '已记住' }
  },
}

export default [memoryRead, memoryDeleteSkill, memoryWrite]
