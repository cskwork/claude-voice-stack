import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const KEY = process.env.AMAP_MCP_KEY
const MCP_URL = `https://mcp.amap.com/mcp?key=${KEY}`

let callListener = null

export function setCallListener(fn) { callListener = fn }
export function clearCallListener() { callListener = null }

function emitCall(info) {
  if (callListener) callListener(info)
}

async function callMcp(toolName, args) {
  const start = Date.now()
  const body = {
    jsonrpc: '2.0',
    id: start,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  }

  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  })

  const contentType = res.headers.get('content-type') || ''
  let result = null

  if (contentType.includes('text/event-stream')) {
    const text = await res.text()
    const lines = text.split('\n')
    for (const line of lines) {
      if (line.startsWith('data:')) {
        try {
          const data = JSON.parse(line.slice(5).trim())
          if (data.result) { result = data.result; break }
        } catch {}
      }
    }
  } else {
    const data = await res.json()
    if (data.result?.isError) {
      console.error(`[AMap MCP] ${toolName} error:`, data.result.content?.[0]?.text)
    } else {
      result = data.result || null
    }
  }

  const info = { name: toolName, arguments: args, duration_ms: Date.now() - start, result: extractText(result)?.substring(0, 100) || '' }
  emitCall(info)
  return result
}

function extractText(result) {
  if (!result?.content) return null
  const item = result.content.find(c => c.type === 'text')
  return item?.text || null
}

export async function geocode(address, city) {
  const args = { address }
  if (city) args.city = city
  const result = await callMcp('maps_geo', args)
  const text = extractText(result)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    const geo = parsed.results?.[0] || parsed.geocodes?.[0]
    if (geo?.location) return geo.location
  } catch {}
  const match = text.match(/([\d.]+),([\d.]+)/)
  return match ? `${match[1]},${match[2]}` : null
}

export async function searchPlace(keywords, city) {
  const args = { keywords }
  if (city) args.city = city
  const result = await callMcp('maps_text_search', args)
  const text = extractText(result)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    const poi = parsed.pois?.[0]
    if (poi) {
      if (poi.location) return { location: poi.location, name: poi.name }
      if (poi.id) {
        const loc = await getPoiLocation(poi.id)
        if (loc) return { location: loc, name: poi.name }
      }
    }
  } catch {}
  return null
}

async function getPoiLocation(poiId) {
  const result = await callMcp('maps_search_detail', { id: poiId })
  const text = extractText(result)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed.location || null
  } catch {}
  return null
}

export async function drivingRoute(origin, destination, strategy = 0) {
  const start = Date.now()
  const url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&key=${KEY}&extensions=all&strategy=${strategy}`
  const res = await fetch(url)
  const data = await res.json()

  if (data.status !== '1') {
    console.error('[AMap] driving error:', data.info)
    emitCall({ name: 'maps_direction_driving', arguments: { origin, destination }, duration_ms: Date.now() - start, result: `错误: ${data.info}` })
    return null
  }

  const path = data.route?.paths?.[0]
  if (!path) return null

  const polyline = path.steps?.map(s => s.polyline).filter(Boolean).join(';') || ''
  const rawTrafficSegments = path.steps?.flatMap(step => {
    if (!Array.isArray(step.tmcs)) return []
    return step.tmcs
      .filter(tmc => tmc?.polyline)
      .map(tmc => ({
        status: tmc.status || '未知',
        distance: parseInt(tmc.distance) || 0,
        polyline: tmc.polyline,
      }))
  }) || []
  const trafficSegments = rawTrafficSegments.reduce((segments, item) => {
    const prev = segments[segments.length - 1]
    if (prev?.status === item.status) {
      prev.distance += item.distance
      prev.polyline = `${prev.polyline};${item.polyline}`
    } else {
      segments.push({ ...item })
    }
    return segments
  }, [])
  const dist = parseInt(path.distance) || 0
  const dur = parseInt(path.duration) || 0

  emitCall({ name: 'maps_direction_driving', arguments: { origin, destination }, duration_ms: Date.now() - start, result: `${(dist/1000).toFixed(1)}km, ${Math.ceil(dur/60)}分钟` })

  return { distance: dist, duration: dur, polyline, trafficSegments }
}

export async function getWeather(city = '杭州') {
  const result = await callMcp('maps_weather', { city })
  const text = extractText(result)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    const today = parsed.forecasts?.[0]
    if (!today) return parsed
    return {
      city: parsed.city || city,
      date: today.date,
      dayweather: today.dayweather,
      nightweather: today.nightweather,
      daytemp: today.daytemp,
      nighttemp: today.nighttemp,
      daywind: today.daywind,
      nightwind: today.nightwind,
      daypower: today.daypower,
      nightpower: today.nightpower,
      forecasts: parsed.forecasts || [],
    }
  } catch {
    return { city, raw: text }
  }
}
