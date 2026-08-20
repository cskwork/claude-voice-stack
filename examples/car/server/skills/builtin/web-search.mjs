import webSearchTool from '../../tools/web-search.mjs'

function resultText(result) {
  return typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result)
}

export default {
  type: 'function',
  skill: {
    id: 'builtin.web_search',
    name: '联网查询',
    description: '查询实时新闻、政策、价格、活动、限行、赛事等需要联网的信息',
    atomicTools: ['dashscope_web_search'],
  },
  function: {
    name: 'web_search',
    description: '内置联网查询 Skill。用于查询最新、今天、实时、新闻、政策、价格、活动、网上资料等需要联网的信息，内部调用 DashScope/通义联网搜索。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '需要联网查询的问题。应保留用户的关键限定词，例如城市、日期、对象、平台。',
        },
        strategy: {
          type: 'string',
          enum: ['turbo', 'max', 'agent'],
          description: '搜索策略。默认 turbo；复杂研究类问题可用 max 或 agent。',
        },
      },
      required: ['query'],
    },
  },
  execute: async (params = {}, context) => {
    if (context?.onProgress) {
      context.onProgress({ domain: 'web_search', stage: 'web_searching', message: '正在联网查询', speakPolicy: 'always' })
    }

    const start = Date.now()
    const result = await webSearchTool.execute(params, context)
    const info = {
      name: 'dashscope_web_search',
      arguments: { query: params.query, strategy: params.strategy || 'turbo' },
      result: resultText(result),
      duration_ms: Date.now() - start,
    }
    if (context?.onSubCall) context.onSubCall(info)

    if (context?.onProgress) {
      context.onProgress({ domain: 'web_search', stage: 'web_search_ready', message: '联网查询完成', speakPolicy: 'silent' })
    }

    return {
      result: result.result,
      action: {
        type: 'web_search',
        query: params.query,
        content: result.content,
        sources: result.sources || [],
        model: result.model,
      },
      subCalls: [info],
    }
  },
}
