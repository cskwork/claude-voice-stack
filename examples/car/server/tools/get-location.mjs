export default {
  type: 'function',
  function: {
    name: 'get_location',
    description: '获取车辆当前位置信息',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  execute: async (params, context) => {
    const location = context.location || {
      city: '杭州市',
      district: '余杭区',
      address: '文一西路969号',
      lng: 120.026,
      lat: 30.28,
    }
    return {
      result: JSON.stringify(location),
    }
  },
}
