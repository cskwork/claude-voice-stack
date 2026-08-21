export default {
  type: 'function',
  function: {
    name: 'notify_user',
    description: '主动向用户推送一条通知消息',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: '通知内容',
        },
        level: {
          type: 'string',
          enum: ['info', 'warning', 'success'],
          description: '通知级别，默认 info',
        },
      },
      required: ['message'],
    },
  },
  execute: async (params) => {
    return {
      result: `已发送通知：${params.message}`,
      action: {
        type: 'notification',
        message: params.message,
        level: params.level || 'info',
      },
    }
  },
}
