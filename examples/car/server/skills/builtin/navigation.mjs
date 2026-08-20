import navigationTool from '../../tools/navigation.mjs'

export default {
  type: 'function',
  skill: {
    id: 'builtin.navigation',
    name: '导航',
    description: '处理地点搜索、路线规划、开始和停止导航',
    atomicTools: ['maps_text_search', 'maps_geo', 'maps_search_detail', 'maps_direction_driving'],
  },
  function: {
    ...navigationTool.function,
    description: '内置导航 Skill。用于地点搜索、路线规划、开始导航和停止导航，内部调用地图与路线原子工具。',
  },
  execute: navigationTool.execute,
}
