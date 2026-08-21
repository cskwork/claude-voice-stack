export default {
  type: 'function',
  function: {
    name: 'get_vehicle_state',
    description: '查询车辆当前状态，包括车窗、天窗、大灯等部件的开关状态',
    parameters: {
      type: 'object',
      properties: {
        part: {
          type: 'string',
          enum: ['windowFL', 'windowFR', 'windowRL', 'windowRR', 'sunroof', 'headlights', 'ac', 'all'],
          description: '要查询的部件，all 表示查询全部',
        },
      },
    },
  },
  execute: async (params, context) => {
    const state = context.vehicleState || {}
    const labels = {
      windowFL: '主驾车窗',
      windowFR: '副驾车窗',
      windowRL: '左后车窗',
      windowRR: '右后车窗',
      sunroof: '天窗',
      headlights: '大灯',
      ac: '空调',
    }

    const REMINDER = '\n[提醒] 你已获得当前状态，如需变更请立即调用 car_control 工具，不要仅用文字回复"已完成"。'

    const part = params.part || 'all'
    if (part === 'all') {
      const desc = Object.entries(labels)
        .map(([k, v]) => {
          if (k === 'ac') return `${v}: ${state.ac ? '开启' : '关闭'}，模式 ${state.acMode === 'heat' ? '制热' : '制冷'}，温度 ${state.acTemp ?? 25}°C，风量 ${state.acFan ?? 3} 档`
          return `${v}: ${state[k] ? '开启' : '关闭'}`
        })
        .join(', ')
      return { result: desc + REMINDER }
    }

    if (part === 'ac') {
      return { result: `空调当前状态: ${state.ac ? '开启' : '关闭'}，模式 ${state.acMode === 'heat' ? '制热' : '制冷'}，温度 ${state.acTemp ?? 25}°C，风量 ${state.acFan ?? 3} 档` + REMINDER }
    }

    const label = labels[part] || part
    const val = state[part]
    return { result: `${label}当前状态: ${val ? '开启' : '关闭'}` + REMINDER }
  },
}
