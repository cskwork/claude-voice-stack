const SONGS = [
  { title: '晴天', artist: '周杰伦', album: '叶惠美' },
  { title: '七里香', artist: '周杰伦', album: '七里香' },
  { title: '稻香', artist: '周杰伦', album: '魔杰座' },
  { title: '夜曲', artist: '周杰伦', album: '十一月的萧邦' },
  { title: '简单爱', artist: '周杰伦', album: '范特西' },
  { title: '青花瓷', artist: '周杰伦', album: '我很忙' },
]

function searchSongs(query) {
  const q = query.toLowerCase()
  return SONGS.filter(s => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.album.toLowerCase().includes(q))
}

export default {
  type: 'function',
  function: {
    name: 'music',
    description: '音乐播放控制，支持播放、暂停、上一首、下一首、搜索。当前歌单：' + SONGS.map(s => s.title).join('、'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['play', 'pause', 'next', 'prev', 'search'],
          description: 'play=播放, pause=暂停, next=下一首, prev=上一首, search=搜索',
        },
        query: {
          type: 'string',
          description: '搜索/播放的歌曲名或关键词（play/search时可用）',
        },
      },
      required: ['action'],
    },
  },
  execute: async (params) => {
    const { action, query } = params
    switch (action) {
      case 'play': {
        if (query) {
          const matches = searchSongs(query)
          if (matches.length > 0) {
            return {
              result: `正在播放：${matches[0].title} - ${matches[0].artist}（${matches[0].album}）`,
              action: { type: 'music', action: 'play', query: matches[0].title },
            }
          }
        }
        return {
          result: query ? `未找到"${query}"，已继续播放当前歌曲` : '已继续播放',
          action: { type: 'music', action: 'play', query },
        }
      }
      case 'pause':
        return {
          result: '已暂停播放',
          action: { type: 'music', action: 'pause' },
        }
      case 'next':
        return {
          result: '已切换到下一首',
          action: { type: 'music', action: 'next' },
        }
      case 'prev':
        return {
          result: '已切换到上一首',
          action: { type: 'music', action: 'prev' },
        }
      case 'search': {
        if (!query) return { result: '请提供搜索关键词' }
        const matches = searchSongs(query)
        if (matches.length === 0) return { result: `未找到与"${query}"相关的歌曲` }
        const list = matches.map(s => `${s.title} - ${s.artist}（${s.album}）`).join('\n')
        return {
          result: `找到 ${matches.length} 首相关歌曲：\n${list}`,
          action: { type: 'music', action: 'search', query },
        }
      }
      default:
        return { result: '未知音乐操作' }
    }
  },
}
