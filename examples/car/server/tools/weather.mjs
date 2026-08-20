import { getWeather } from '../amap-mcp.mjs'

function formatWeather(data) {
  if (!data) return '天气查询失败'
  if (data.raw) return data.raw
  const city = data.city || '当前城市'
  const weather = data.dayweather || data.nightweather || '未知'
  const temp = data.daytemp ? `${data.daytemp}°` : ''
  const low = data.nighttemp ? `夜间${data.nighttemp}°` : ''
  const wind = data.daywind && data.daypower ? `${data.daywind}风${data.daypower}级` : ''
  return [city, weather, temp, low, wind].filter(Boolean).join('，')
}

export default {
  type: 'function',
  function: {
    name: 'weather_query',
    description: '查询指定城市天气的原子能力，仅供内置天气 Skill 调用',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称或 adcode，例如杭州、北京市、330100',
        },
      },
    },
  },
  execute: async (params = {}) => {
    const city = params.city || '杭州'
    const data = await getWeather(city)
    return {
      result: formatWeather(data),
      weather: data,
      action: data ? { type: 'weather', weather: data } : null,
    }
  },
}
