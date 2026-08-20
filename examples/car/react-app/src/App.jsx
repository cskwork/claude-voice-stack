import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import TopBar from './components/TopBar'
import Dock from './components/Dock'
import VehiclePanel from './components/VehiclePanel'
import MapPanel from './components/MapPanel'
import SettingsPanel from './components/SettingsPanel'
import ChatPanel from './components/ChatPanel'
import MusicPanel, { PLAYLIST } from './components/MusicPanel'
import FlashBuyPanel from './components/FlashBuyPanel'
import useVoiceSession from './hooks/useVoiceSession'

const INITIAL_CAR_STATE = {
  windowFL: 0,
  windowFR: 0,
  windowRL: 0,
  windowRR: 0,
  sunroof: 0,
  headlights: 0,
  ac: 1,
  acTemp: 25.0,
  acMode: 'cool',
  acFan: 3,
}

const VALID_TABS = ['persona', 'skill', 'memory']
const VALID_PERSONAS = ['聊愈师', '行动派', '疯批']
const VALID_VOICES = ['小酒窝', '台御姐', '阳光男', '酷酷男']
const DEFAULT_PERSONA = '聊愈师'
const DEFAULT_VOICE = '小酒窝'
const PERSONA_STORAGE_KEY = 'selectedPersona'
const VOICE_STORAGE_KEY = 'selectedVoice'
const MEMORY_MUTATION_TOOLS = new Set(['memory_write', 'memory_delete'])
const SKILL_MUTATION_TOOLS = new Set(['skill_create', 'skill_delete'])
const INITIAL_WEATHER_STATE = {
  city: '杭州市',
  dayweather: '多云',
  daytemp: '28',
}
const INITIAL_FLASH_BUY_STATE = {
  status: 'idle',
  message: '',
  category: 'food',
  items: [],
  cartItems: [],
  total: 0,
  preview: null,
  order: null,
}

function getClientId() {
  let id = localStorage.getItem('clientId')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('clientId', id)
  }
  return id
}

function getStoredChoice(key, fallback, validValues) {
  const value = localStorage.getItem(key)
  return validValues.includes(value) ? value : fallback
}

function parseHash() {
  const hash = window.location.hash.replace(/^#/, '')
  if (hash.startsWith('settings')) {
    const tab = hash.split('/')[1] || 'persona'
    return { screen: 'settings', tab: VALID_TABS.includes(tab) ? tab : 'persona' }
  }
  if (hash === 'music') return { screen: 'music', tab: 'persona' }
  if (hash === 'flashbuy') return { screen: 'flashbuy', tab: 'persona' }
  return { screen: 'main', tab: 'persona' }
}

export default function App() {
  const clientId = useMemo(() => getClientId(), [])
  const [screen, setScreen] = useState('main')
  const [settingsTab, setSettingsTab] = useState('persona')
  const [selectedPersona, setSelectedPersona] = useState(() => getStoredChoice(PERSONA_STORAGE_KEY, DEFAULT_PERSONA, VALID_PERSONAS))
  const [selectedVoice, setSelectedVoice] = useState(() => getStoredChoice(VOICE_STORAGE_KEY, DEFAULT_VOICE, VALID_VOICES))
  const [selectedWake, setSelectedWake] = useState('主驾')
  const [memories, setMemories] = useState([])
  const [carState, setCarState] = useState(INITIAL_CAR_STATE)
  const [showChat, setShowChat] = useState(false)
  const [chatMessages, setChatMessages] = useState([])
  const [customSkills, setCustomSkills] = useState([])
  const [navState, setNavState] = useState({ status: 'idle' })
  const navStateRef = useRef(navState)
  useEffect(() => { navStateRef.current = navState }, [navState])
  const [mapActions, setMapActions] = useState([])
  const [routeStrategy, setRouteStrategy] = useState(0)
  const [musicState, setMusicState] = useState({ playing: false, currentIndex: 0 })
  const [flashBuyState, setFlashBuyState] = useState(INITIAL_FLASH_BUY_STATE)
  const [weatherState, setWeatherState] = useState(INITIAL_WEATHER_STATE)
  const [voiceMuted, setVoiceMuted] = useState(true)
  const [thinking, setThinking] = useState(false)
  const voiceAssistantMessageIdRef = useRef(null)

  const musicPlay = useCallback(() => setMusicState(prev => ({ ...prev, playing: true })), [])
  const musicPause = useCallback(() => setMusicState(prev => ({ ...prev, playing: false })), [])
  const musicNext = useCallback(() => setMusicState(prev => ({ ...prev, currentIndex: (prev.currentIndex + 1) % PLAYLIST.length, playing: true })), [])
  const musicPrev = useCallback(() => setMusicState(prev => ({ ...prev, currentIndex: (prev.currentIndex - 1 + PLAYLIST.length) % PLAYLIST.length, playing: true })), [])
  const musicSelectTrack = useCallback((i) => setMusicState({ playing: true, currentIndex: i }), [])

  useEffect(() => {
    localStorage.setItem(PERSONA_STORAGE_KEY, selectedPersona)
  }, [selectedPersona])

  useEffect(() => {
    localStorage.setItem(VOICE_STORAGE_KEY, selectedVoice)
  }, [selectedVoice])

  const openMusic = useCallback(() => {
    setScreen('music')
    window.location.hash = '#music'
  }, [])

  const openFlashBuy = useCallback(() => {
    setScreen('flashbuy')
    window.location.hash = '#flashbuy'
  }, [])

  const handleFlashBuyAction = useCallback((event) => {
    if (event.type === 'set_category') {
      setFlashBuyState(prev => ({ ...prev, category: event.category, items: [] }))
    } else if (event.type === 'toggle_item') {
      setFlashBuyState(prev => {
        const item = (prev.items || []).find(row => row.id === event.itemId) || event.item
        if (!item) return prev
        const exists = prev.cartItems.some(row => (row.itemId || row.id) === event.itemId)
        const cartItems = exists
          ? prev.cartItems.filter(row => (row.itemId || row.id) !== event.itemId)
          : [...prev.cartItems, { ...item, itemId: item.id, quantity: 1 }]
        return {
          ...prev,
          status: cartItems.length ? 'cart_updated' : 'selecting',
          message: cartItems.length ? '已更新购物车' : '请选择商品',
          cartItems,
          total: cartItems.reduce((sum, row) => sum + row.price * (row.quantity || 1), 0),
          preview: null,
          order: null,
        }
      })
    } else if (event.type === 'confirm_order') {
      setFlashBuyState(prev => {
        if (!prev.cartItems.length && !prev.preview) return prev
        const order = {
          id: `SG${Math.floor(1000 + Math.random() * 9000)}`,
          status: '骑手取货中',
          eta: prev.preview?.eta || prev.cartItems[0]?.eta || '25分钟',
          total: prev.preview?.total || prev.total,
        }
        return {
          ...prev,
          status: 'completed',
          message: '已完成下单',
          order,
          cartItems: [],
          preview: null,
        }
      })
    }
  }, [])

  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch(`/api/memories?clientId=${clientId}`)
      const items = await res.json()
      setMemories(items.map((m, i) => ({ id: i, text: m.content, time: m.time })))
    } catch (error) {
      console.warn('Failed to fetch memories', error)
    }
  }, [clientId])

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch(`/api/skills?clientId=${clientId}`)
      const items = await res.json()
      setCustomSkills(items)
    } catch (error) {
      console.warn('Failed to fetch skills', error)
    }
  }, [clientId])

  const fetchChatHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/history?clientId=${clientId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const items = await res.json()
      if (Array.isArray(items)) setChatMessages(items)
    } catch (error) {
      console.warn('Failed to fetch chat history', error)
    }
  }, [clientId])

  const deleteSkill = useCallback(async (name) => {
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}?clientId=${clientId}`, { method: 'DELETE' })
      const items = await res.json()
      setCustomSkills(items)
    } catch (error) {
      console.warn('Failed to delete skill', error)
    }
  }, [clientId])

  const toggleCarPart = useCallback((part) => {
    setCarState(prev => ({ ...prev, [part]: prev[part] === 0 ? 1 : 0 }))
  }, [])

  const navigateHome = useCallback(() => {
    setScreen('main')
    window.location.hash = '#main'
  }, [])

  const openSettings = useCallback((tab = 'persona') => {
    setScreen('settings')
    setSettingsTab(tab)
    window.location.hash = `#settings/${tab}`
  }, [])

  const changeTab = useCallback((tab) => {
    setSettingsTab(tab)
    window.location.hash = `#settings/${tab}`
  }, [])

  const deleteMemory = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/memories/${id}?clientId=${clientId}`, { method: 'DELETE' })
      const items = await res.json()
      setMemories(items.map((m, i) => ({ id: i, text: m.content, time: m.time })))
    } catch (error) {
      console.warn('Failed to delete memory', error)
    }
  }, [clientId])

  const toggleChat = useCallback(() => {
    setShowChat(prev => !prev)
  }, [])

  const toggleVoiceMute = useCallback(() => {
    setVoiceMuted(prev => !prev)
  }, [])

  const handleAgentActions = useCallback((actions) => {
    for (const action of actions) {
      if (action.type === 'car_control') {
        if (action.part === 'ac') {
          setCarState(prev => ({
            ...prev,
            ac: action.state,
            ...(action.temperature != null ? { acTemp: action.temperature } : {}),
            ...(action.mode ? { acMode: action.mode } : {}),
            ...(action.fan != null ? { acFan: action.fan } : {}),
          }))
        } else if (action.part in INITIAL_CAR_STATE) {
          setCarState(prev => ({ ...prev, [action.part]: action.state }))
        }
      } else if (action.type === 'music') {
        if (action.action === 'play') {
          if (action.query) {
            const q = action.query.toLowerCase()
            const idx = PLAYLIST.findIndex(t => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
            if (idx >= 0) setMusicState({ playing: true, currentIndex: idx })
            else setMusicState(prev => ({ ...prev, playing: true }))
          } else {
            setMusicState(prev => ({ ...prev, playing: true }))
          }
          if (navStateRef.current.status !== 'navigating') {
            setScreen('music')
            window.location.hash = '#music'
          }
        } else if (action.action === 'pause') {
          setMusicState(prev => ({ ...prev, playing: false }))
        } else if (action.action === 'next') {
          setMusicState(prev => ({ ...prev, currentIndex: (prev.currentIndex + 1) % PLAYLIST.length, playing: true }))
        } else if (action.action === 'prev') {
          setMusicState(prev => ({ ...prev, currentIndex: (prev.currentIndex - 1 + PLAYLIST.length) % PLAYLIST.length, playing: true }))
        }
      } else if (action.type === 'navigation') {
        if (action.action === 'start') {
          setMapActions([])
          if (action.strategy != null) setRouteStrategy(action.strategy)
          setNavState({ status: 'navigating', destination: action.destination, via: action.via, route: action.route })
          setScreen('main')
          window.location.hash = '#main'
        } else if (action.action === 'stop') {
          setMapActions([])
          setNavState({ status: 'idle' })
        }
      } else if (action.type === 'flashbuy') {
        if (action.action === 'open') {
          setScreen('flashbuy')
          window.location.hash = '#flashbuy'
        } else if (action.action === 'status') {
          setFlashBuyState(prev => ({
            ...prev,
            status: action.status || prev.status,
            message: action.message || prev.message,
            order: action.status === 'ordering' ? null : prev.order,
          }))
        } else if (action.action === 'results') {
          setFlashBuyState(prev => ({
            ...prev,
            status: action.status || 'selecting',
            message: action.message || '已找到附近可送商品',
            category: action.category || prev.category,
            items: action.items || [],
            preview: null,
            order: null,
          }))
        } else if (action.action === 'cart') {
          setFlashBuyState(prev => ({
            ...prev,
            status: action.status || 'cart_updated',
            message: action.message || '已更新购物车',
            category: action.category || prev.category,
            cartItems: action.items || [],
            total: action.total || 0,
            preview: null,
            order: null,
          }))
        } else if (action.action === 'preview') {
          setFlashBuyState(prev => ({
            ...prev,
            status: action.status || 'awaiting_confirm',
            message: action.message || '请确认订单后下单',
            category: action.category || prev.category,
            preview: action.preview || null,
            cartItems: action.preview?.items || prev.cartItems,
            total: action.preview?.total ?? prev.total,
            order: null,
          }))
        } else if (action.action === 'completed') {
          setFlashBuyState(prev => ({
            ...prev,
            status: 'completed',
            message: action.message || '已完成下单',
            order: action.order || null,
            cartItems: [],
            preview: null,
          }))
        } else if (action.action === 'cancelled') {
          setFlashBuyState({ ...INITIAL_FLASH_BUY_STATE, message: action.message || '已取消当前闪购流程' })
        }
      } else if (action.type === 'weather') {
        if (action.weather) setWeatherState(action.weather)
      }
    }
  }, [])

  const handleVoiceMessage = useCallback((event) => {
    if (!event) return

    const updateAssistantMessage = (updater) => {
      const id = voiceAssistantMessageIdRef.current || crypto.randomUUID()
      voiceAssistantMessageIdRef.current = id
      setChatMessages(prev => {
        const next = [...prev]
        let index = next.findIndex(msg => msg.id === id)
        if (index < 0) {
          next.push({ id, role: 'assistant', content: '' })
          index = next.length - 1
        }
        next[index] = updater(next[index])
        return next.slice(-80)
      })
    }

    if (event.thinkingDelta) {
      updateAssistantMessage(msg => ({
        ...msg,
        thinking: `${msg.thinking || ''}${event.thinkingDelta}`,
      }))
      return
    }

    if (event.toolCall) {
      if (MEMORY_MUTATION_TOOLS.has(event.toolCall.name)) fetchMemories()
      if (SKILL_MUTATION_TOOLS.has(event.toolCall.name)) fetchSkills()
      updateAssistantMessage(msg => ({
        ...msg,
        thinkingMs: msg.thinkingMs || 1,
        debug: {
          ...(msg.debug || {}),
          tool_calls: [...(msg.debug?.tool_calls || []), event.toolCall],
        },
      }))
      return
    }

    if (event.progress) {
      updateAssistantMessage(msg => ({
        ...msg,
        debug: {
          ...(msg.debug || {}),
          progress: [...(msg.debug?.progress || []), event.progress],
          tool_calls: msg.debug?.tool_calls || [],
        },
      }))
      return
    }

    if (event.debug) {
      const toolCalls = event.debug.tool_calls || []
      if (toolCalls.some(toolCall => MEMORY_MUTATION_TOOLS.has(toolCall.name))) fetchMemories()
      if (toolCalls.some(toolCall => SKILL_MUTATION_TOOLS.has(toolCall.name))) fetchSkills()
      updateAssistantMessage(msg => {
        const thinking = msg.thinking || event.debug.thinking || ''
        return {
          ...msg,
          ...(thinking ? { thinking, thinkingMs: event.debug.duration_ms || msg.thinkingMs || 1 } : {}),
          debug: {
            ...(msg.debug || {}),
            ...event.debug,
            progress: msg.debug?.progress || [],
            tool_calls: msg.debug?.tool_calls || [],
          },
        }
      })
      return
    }

    if (event.role === 'user') {
      voiceAssistantMessageIdRef.current = null
      if (!event.content) return
      setChatMessages(prev => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: event.content },
      ].slice(-80))
      return
    }

    if (event.role !== 'assistant') return
    if (!event.content) return

    if (event.delta) {
      updateAssistantMessage(msg => ({ ...msg, content: `${msg.content || ''}${event.content}` }))
      return
    }

    if (event.final) {
      updateAssistantMessage(msg => ({ ...msg, content: event.content || msg.content }))
      voiceAssistantMessageIdRef.current = null
    }
  }, [fetchMemories, fetchSkills])

  const handleMapAction = useCallback((event) => {
    if (event.action === 'clear') {
      setMapActions([])
    } else {
      setMapActions(prev => [...prev, event])
      setScreen('main')
      window.location.hash = '#main'
    }
  }, [])

  const { voiceState, inputLevel, outputLevel, progress: voiceProgress } = useVoiceSession({
    muted: voiceMuted,
    clientId,
    persona: selectedPersona,
    routeStrategy,
    thinking,
    onAgentActions: handleAgentActions,
    onMapAction: handleMapAction,
    onVoiceMessage: handleVoiceMessage,
  })

  const handleClearHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/history?clientId=${clientId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      voiceAssistantMessageIdRef.current = null
      setChatMessages([])
    } catch (error) {
      console.warn('Failed to clear chat history', error)
    }
  }, [clientId])

  useEffect(() => {
    if (!['navigation', 'flashbuy'].includes(voiceProgress?.domain)) return undefined
    const frame = requestAnimationFrame(() => {
      if (voiceProgress.domain === 'navigation') {
        setScreen('main')
        window.location.hash = '#main'
      } else {
        setScreen('flashbuy')
        window.location.hash = '#flashbuy'
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [voiceProgress])

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchMemories()
      fetchSkills()
      fetchChatHistory()
    })
    const onHashChange = () => {
      const { screen: s, tab } = parseHash()
      setScreen(s)
      setSettingsTab(tab)
    }
    window.addEventListener('hashchange', onHashChange)
    onHashChange()
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [fetchMemories, fetchSkills, fetchChatHistory])

  return (
    <main className="device" aria-label="车机语音交互原型">
      <section className="screen">
        <TopBar weather={weatherState} />

        <div className="screen-view is-active">
          <div className="main-grid">
            <VehiclePanel
              onOpenSettings={() => openSettings('persona')}
              carState={carState}
              onTogglePart={toggleCarPart}
              voiceMuted={voiceMuted}
              voiceState={voiceState}
              voiceProgress={voiceProgress}
              inputLevel={inputLevel}
              outputLevel={outputLevel}
              persona={selectedPersona}
              onSelectPersona={setSelectedPersona}
              onToggleVoiceMute={toggleVoiceMute}
            />
            {screen === 'main' && (
              <MapPanel navState={navState} navProgress={voiceProgress} mapActions={mapActions} routeStrategy={routeStrategy} onStrategyChange={setRouteStrategy} />
            )}
            {screen === 'music' && (
              <MusicPanel musicState={musicState} onPlay={musicPlay} onPause={musicPause} onNext={musicNext} onPrev={musicPrev} onSelectTrack={musicSelectTrack} />
            )}
            {screen === 'flashbuy' && (
              <FlashBuyPanel flashBuyState={flashBuyState} onFlashBuyAction={handleFlashBuyAction} />
            )}
            {screen === 'settings' && (
              <SettingsPanel
                activeTab={settingsTab} onTabChange={changeTab}
                selectedPersona={selectedPersona} onSelectPersona={setSelectedPersona}
                selectedVoice={selectedVoice} onSelectVoice={setSelectedVoice}
                selectedWake={selectedWake} onSelectWake={setSelectedWake}
                memories={memories} onDeleteMemory={deleteMemory}
                customSkills={customSkills} onDeleteSkill={deleteSkill}
                clientId={clientId}
              />
            )}
          </div>
          {showChat && <ChatPanel onClose={toggleChat} messages={chatMessages} onMessagesChange={setChatMessages} onActions={handleAgentActions} onClearHistory={handleClearHistory} onMemoryChange={fetchMemories} onSkillChange={fetchSkills} onMapAction={handleMapAction} onNavigate={navigateHome} routeStrategy={routeStrategy} soul={selectedPersona} clientId={clientId} voiceActive={!voiceMuted} thinking={thinking} onThinkingChange={setThinking} />}
        </div>

        <Dock screen={screen} onNavigateHome={navigateHome} onOpenSettings={() => openSettings('persona')} onToggleChat={toggleChat} carState={carState} musicState={musicState} onTogglePlay={musicState.playing ? musicPause : musicPlay} onOpenMusic={openMusic} onOpenFlashBuy={openFlashBuy} />
      </section>
    </main>
  )
}
