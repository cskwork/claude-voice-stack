export default {
  type: 'function',
  function: {
    name: 'car_control',
    description: '控制车辆部件，包括车窗、天窗、大灯的开关，以及空调的开关、温度、模式和风量调节',
    parameters: {
      type: 'object',
      properties: {
        part: {
          type: 'string',
          enum: ['windowFL', 'windowFR', 'windowRL', 'windowRR', 'sunroof', 'headlights', 'ac'],
          description: '车辆部件: windowFL=主驾车窗, windowFR=副驾车窗, windowRL=左后车窗, windowRR=右后车窗, sunroof=天窗, headlights=大灯, ac=空调',
        },
        action: {
          type: 'string',
          enum: ['open', 'close', 'set_temp', 'set_mode', 'set_fan'],
          description: '操作类型: open=打开, close=关闭, set_temp=设置温度, set_mode=设置模式, set_fan=设置风量(仅空调)',
        },
        temperature: {
          type: 'number',
          description: '目标温度(°C)，仅 action=set_temp 时使用，范围 16~32',
        },
        mode: {
          type: 'string',
          enum: ['cool', 'heat'],
          description: '空调模式，仅 action=set_mode 时使用: cool=制冷, heat=制热',
        },
        fan: {
          type: 'number',
          description: '风量档位，仅 action=set_fan 时使用，范围 1~5',
        },
      },
      required: ['part', 'action'],
    },
  },
  execute: async (params) => {
    const labels = {
      windowFL: '主驾车窗',
      windowFR: '副驾车窗',
      windowRL: '左后车窗',
      windowRR: '右后车窗',
      sunroof: '天窗',
      headlights: '大灯',
      ac: '空调',
    }
    const label = labels[params.part] || params.part

    if (params.part === 'ac') {
      if (params.action === 'set_temp') {
        const temp = params.temperature
        if (temp == null) return { result: '请指定目标温度' }
        if (temp < 16 || temp > 32) return { result: `温度超出范围，空调温度需在 16~32°C 之间，当前设置 ${temp}°C 无效` }
        return {
          result: `已将空调温度设置为 ${temp}°C`,
          action: { type: 'car_control', part: 'ac', state: 1, temperature: temp },
        }
      }
      if (params.action === 'set_mode') {
        const mode = params.mode
        if (!mode) return { result: '请指定空调模式（cool 或 heat）' }
        const modeLabel = mode === 'cool' ? '制冷' : '制热'
        return {
          result: `已将空调切换为${modeLabel}模式`,
          action: { type: 'car_control', part: 'ac', state: 1, mode },
        }
      }
      if (params.action === 'set_fan') {
        const fan = params.fan
        if (fan == null) return { result: '请指定风量档位' }
        if (fan < 1 || fan > 5) return { result: `风量超出范围，需在 1~5 档之间，当前设置 ${fan} 档无效` }
        return {
          result: `已将空调风量设置为 ${fan} 档`,
          action: { type: 'car_control', part: 'ac', state: 1, fan },
        }
      }
    }

    const actionLabel = params.action === 'open' ? '打开' : '关闭'
    return {
      result: `已${actionLabel}${label}`,
      action: {
        type: 'car_control',
        part: params.part,
        state: params.action === 'open' ? 1 : 0,
      },
    }
  },
}
