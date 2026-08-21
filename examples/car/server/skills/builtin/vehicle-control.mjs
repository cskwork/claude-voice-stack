import carControlTool from '../../tools/car-control.mjs'
import getVehicleStateTool from '../../tools/get-vehicle-state.mjs'

const WINDOW_PARTS = ['windowFL', 'windowFR', 'windowRL', 'windowRR']
const ALL_PARTS = [...WINDOW_PARTS, 'sunroof', 'headlights']

const PART_LABELS = {
  windowFL: '主驾车窗',
  windowFR: '副驾车窗',
  windowRL: '左后车窗',
  windowRR: '右后车窗',
  windows: '全部车窗',
  sunroof: '天窗',
  headlights: '大灯',
  ac: '空调',
  all: '全部可控部件',
}

function resultText(result) {
  return typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result)
}

async function runAtomic(name, executor, args, context, subCalls) {
  const start = Date.now()
  let result
  try {
    result = await executor(args, context)
  } catch (err) {
    result = { result: `执行出错: ${err.message}` }
  }
  const info = {
    name,
    arguments: args,
    result: resultText(result),
    duration_ms: Date.now() - start,
  }
  subCalls.push(info)
  if (context?.onSubCall) context.onSubCall(info)
  return result
}

function expandParts(part, action) {
  if (part === 'windows') return WINDOW_PARTS
  if (part === 'all' && (action === 'open' || action === 'close')) return ALL_PARTS
  return [part]
}

export default {
  type: 'function',
  skill: {
    id: 'builtin.vehicle_control',
    name: '车控',
    description: '处理车窗、天窗、大灯、空调等车辆控制与状态查询',
    atomicTools: ['get_vehicle_state', 'car_control'],
  },
  function: {
    name: 'vehicle_control',
    description: '内置车控 Skill。用于查询或控制车辆状态，内部会先查询车辆状态，再调用车控原子工具执行变更。',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['query', 'open', 'close', 'set_temp', 'set_mode', 'set_fan'],
          description: 'query=查询状态, open=打开, close=关闭, set_temp=设置空调温度, set_mode=设置空调模式, set_fan=设置空调风量',
        },
        part: {
          type: 'string',
          enum: ['windowFL', 'windowFR', 'windowRL', 'windowRR', 'windows', 'sunroof', 'headlights', 'ac', 'all'],
          description: '控制对象。windows=全部车窗，all=全部可控开关部件',
        },
        temperature: {
          type: 'number',
          description: '空调目标温度，范围 16~32，仅 set_temp 使用',
        },
        mode: {
          type: 'string',
          enum: ['cool', 'heat'],
          description: '空调模式，仅 set_mode 使用',
        },
        fan: {
          type: 'number',
          description: '空调风量档位，范围 1~5，仅 set_fan 使用',
        },
      },
      required: ['action', 'part'],
    },
  },
  execute: async (params, context) => {
    const subCalls = []
    const state = await runAtomic('get_vehicle_state', getVehicleStateTool.execute, { part: params.part === 'windows' ? 'all' : params.part }, context, subCalls)
    const stateText = resultText(state).split('\n')[0]

    if (params.action === 'query') {
      return { result: stateText, subCalls }
    }

    if ((params.action === 'set_temp' || params.action === 'set_mode' || params.action === 'set_fan') && params.part !== 'ac') {
      return { result: '温度、模式和风量只能用于空调控制', subCalls }
    }

    const parts = expandParts(params.part, params.action)
    const actions = []
    const results = []

    for (const part of parts) {
      const args = {
        part,
        action: params.action,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        ...(params.mode ? { mode: params.mode } : {}),
        ...(params.fan != null ? { fan: params.fan } : {}),
      }
      const result = await runAtomic('car_control', carControlTool.execute, args, context, subCalls)
      results.push(resultText(result))
      if (result.action) actions.push(result.action)
    }

    const target = PART_LABELS[params.part] || params.part
    return {
      result: `${target}处理完成：${results.join('；')}`,
      actions,
      subCalls,
    }
  },
}
