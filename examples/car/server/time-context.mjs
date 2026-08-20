const TIME_ZONE = 'Asia/Shanghai'

function partsFor(date) {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]))
}

export function getCurrentTimeContext(date = new Date()) {
  const parts = partsFor(date)
  return {
    timeZone: TIME_ZONE,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: parts.weekday,
    text: `${parts.year}年${parts.month}月${parts.day}日 ${parts.weekday} ${parts.hour}:${parts.minute}:${parts.second}`,
  }
}

export function buildCurrentTimePrompt(date = new Date()) {
  const current = getCurrentTimeContext(date)
  return `【当前时间】
当前时区：${current.timeZone}
当前日期时间：${current.text}
当用户提到“今天、明天、昨天、现在、刚才、最近、本周、本月”等相对时间时，必须以这个时间为基准理解。不要说你无法感知当前时间；如果问题依赖实时外部事实，仍应调用对应工具查询。`
}
