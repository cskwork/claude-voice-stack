import musicTool from '../../tools/music.mjs'

function resultText(result) {
  return typeof result?.result === 'string' ? result.result : JSON.stringify(result?.result)
}

export default {
  type: 'function',
  skill: {
    id: 'builtin.music',
    name: '音乐',
    description: '处理播放、暂停、切歌、搜索等音乐体验',
    atomicTools: ['music_playback_control'],
  },
  function: {
    ...musicTool.function,
    description: '内置音乐 Skill。用于播放、暂停、切歌和搜索音乐，内部调用音乐播放原子工具。',
  },
  execute: async (params, context) => {
    const start = Date.now()
    const result = await musicTool.execute(params, context)
    const info = {
      name: 'music_playback_control',
      arguments: params,
      result: resultText(result),
      duration_ms: Date.now() - start,
    }
    if (context?.onSubCall) context.onSubCall(info)
    return {
      ...result,
      subCalls: [info, ...(result.subCalls || [])],
    }
  },
}
