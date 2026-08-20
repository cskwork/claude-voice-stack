import weatherTool from '../../tools/weather.mjs'

function resultText(result) {
  return typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result)
}

export default {
  type: 'function',
  skill: {
    id: 'builtin.weather',
    name: '天气',
    description: '查询当前位置或指定城市的天气、气温、风力和未来预报',
    atomicTools: ['maps_weather'],
  },
  function: {
    name: 'weather',
    description: '内置天气 Skill。用于查询当前城市或指定城市天气、气温、下雨、风力和未来预报，内部调用高德天气原子能力。',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称或 adcode。用户未指定城市时默认杭州。',
        },
      },
    },
  },
  execute: async (params = {}, context) => {
    if (context?.onProgress) {
      context.onProgress({ domain: 'weather', stage: 'weather_querying', message: '正在查询天气', speakPolicy: 'if_slow' })
    }
    const start = Date.now()
    const result = await weatherTool.execute(params, context)
    const info = {
      name: 'maps_weather',
      arguments: { city: params.city || '杭州' },
      result: resultText(result),
      duration_ms: Date.now() - start,
    }
    if (context?.onSubCall) context.onSubCall(info)
    if (context?.onProgress) {
      context.onProgress({ domain: 'weather', stage: 'weather_ready', message: '天气已更新', speakPolicy: 'silent' })
    }
    return {
      result: result.result,
      action: result.action,
      subCalls: [info],
    }
  },
}
