export default {
  type: 'function',
  function: {
    name: 'context_compact',
    description: '压缩对话历史，保留最近N轮对话，将早期对话生成摘要',
    parameters: {
      type: 'object',
      properties: {
        keep_last: {
          type: 'number',
          description: '保留最近多少轮对话，默认10',
        },
      },
    },
  },
  execute: async (params, context) => {
    const keepLast = params.keep_last || 10
    if (context.compactHistory) {
      await context.compactHistory(keepLast)
      return { result: `已压缩对话历史，保留最近 ${keepLast} 轮` }
    }
    return { result: '当前上下文不支持压缩' }
  },
}
