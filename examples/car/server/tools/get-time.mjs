export default {
  type: 'function',
  function: {
    name: 'get_time',
    description: '获取当前日期和时间',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  execute: async () => {
    const now = new Date()
    return {
      result: JSON.stringify({
        datetime: now.toISOString(),
        date: now.toLocaleDateString('zh-CN'),
        time: now.toLocaleTimeString('zh-CN'),
        weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()],
      }),
    }
  },
}
