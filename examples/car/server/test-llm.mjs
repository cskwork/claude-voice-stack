import OpenAI from 'openai'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
})

const model = process.env.DASHSCOPE_MODEL || 'qwen-plus'

async function testChat() {
  console.log(`Testing DashScope API (OpenAI SDK)...`)
  console.log(`Model: ${model}\n`)

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: '你是 Qwen Audio Agent Car，一个智能座舱语音助手。请简短回答。' },
      { role: 'user', content: '你好，介绍一下你自己' },
    ],
  })

  console.log('Response:')
  console.log(completion.choices[0].message.content)
  console.log(`\nTokens: prompt=${completion.usage.prompt_tokens}, completion=${completion.usage.completion_tokens}, total=${completion.usage.total_tokens}`)
  console.log('\n✓ LLM call chain works (OpenAI SDK)!')
}

testChat().catch(err => {
  console.error('Failed:', err.message)
  process.exit(1)
})
