import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../../.env.local') })

const DASHSCOPE_GENERATION_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
const DEFAULT_MODEL = process.env.DASHSCOPE_WEB_SEARCH_MODEL || 'qwen-plus'

function normalizeSources(searchInfo = {}) {
  return (searchInfo.search_results || []).slice(0, 6).map(item => ({
    index: item.index,
    title: item.title,
    url: item.url,
    siteName: item.site_name,
  }))
}

function sourceSummary(sources) {
  if (!sources.length) return ''
  return `来源：${sources.map(item => `${item.index}. ${item.siteName || item.title}`).join('；')}`
}

function compactContent(content = '') {
  const cleaned = String(content).replace(/\n{3,}/g, '\n\n').trim()
  if (cleaned.length <= 900) return cleaned
  return `${cleaned.slice(0, 900)}...`
}

export default {
  type: 'function',
  function: {
    name: 'dashscope_web_search',
    description: '使用 DashScope/通义联网搜索生成实时答案并返回搜索来源，仅供内置联网查询 Skill 调用',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '需要联网查询的问题',
        },
        strategy: {
          type: 'string',
          enum: ['turbo', 'max', 'agent'],
          description: '搜索策略。turbo=默认较快，max=更充分，agent=模型自主多轮检索',
        },
      },
      required: ['query'],
    },
  },
  execute: async (params = {}) => {
    const query = String(params.query || '').trim()
    if (!query) return { result: '请提供要联网查询的问题' }

    const body = {
      model: DEFAULT_MODEL,
      input: {
        messages: [
          {
            role: 'system',
            content: '你是车机里的联网查询助手。请基于实时搜索结果回答，保持中性、简洁、适合语音播报，优先给出结论；如果有来源，请在关键结论后用[1]这样的角标标注。不要展开无关细节。',
          },
          { role: 'user', content: query },
        ],
      },
      parameters: {
        result_format: 'message',
        enable_search: true,
        search_options: {
          forced_search: true,
          enable_source: true,
          enable_citation: true,
          search_strategy: params.strategy || 'turbo',
        },
      },
    }

    const res = await fetch(DASHSCOPE_GENERATION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) {
      return { result: `联网查询失败：${data.message || data.code || res.status}` }
    }

    const content = compactContent(data.output?.choices?.[0]?.message?.content || '')
    const sources = normalizeSources(data.output?.search_info)
    return {
      result: [content, sourceSummary(sources)].filter(Boolean).join('\n'),
      content,
      sources,
      model: DEFAULT_MODEL,
    }
  },
}
