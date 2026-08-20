const activeTimers = new Map()

export const timerSet = {
  type: 'function',
  function: {
    name: 'timer_set',
    description: '设置一个定时提醒',
    parameters: {
      type: 'object',
      properties: {
        delay_seconds: {
          type: 'number',
          description: '延迟秒数',
        },
        message: {
          type: 'string',
          description: '提醒内容',
        },
      },
      required: ['delay_seconds', 'message'],
    },
  },
  execute: async (params, context) => {
    const id = `timer_${Date.now()}`
    const timer = setTimeout(() => {
      if (context.onNotify) {
        context.onNotify(params.message)
      }
      activeTimers.delete(id)
    }, params.delay_seconds * 1000)

    activeTimers.set(id, { timer, message: params.message })
    return {
      result: `已设置定时提醒，${params.delay_seconds}秒后提醒：${params.message}（ID: ${id}）`,
    }
  },
}

export const timerCancel = {
  type: 'function',
  function: {
    name: 'timer_cancel',
    description: '取消一个已设置的定时提醒',
    parameters: {
      type: 'object',
      properties: {
        timer_id: {
          type: 'string',
          description: '要取消的定时器ID',
        },
      },
      required: ['timer_id'],
    },
  },
  execute: async (params) => {
    const entry = activeTimers.get(params.timer_id)
    if (!entry) return { result: `未找到定时器 ${params.timer_id}` }
    clearTimeout(entry.timer)
    activeTimers.delete(params.timer_id)
    return { result: `已取消定时提醒：${entry.message}` }
  },
}

export default [timerSet, timerCancel]
