import { useRef, useState, useEffect } from 'react'
import navigatorImage from '../assets/skills/navigator.png'
import musicMasterImage from '../assets/skills/music-master.png'
import vehicleControlImage from '../assets/skills/vehicle-control.png'
import flashBuyImage from '../assets/taobao_flashbuy.png'

const BUILTIN_SKILLS = [
  { id: 'route', title: '领航员', desc: '智能规划路线，实时避堵导航。', image: navigatorImage },
  { id: 'rest', title: '音乐大师', desc: '懂你口味，随心推荐好歌。', image: musicMasterImage },
  { id: 'control', title: '车控大管家', desc: '语音操控车窗、空调与灯光。', image: vehicleControlImage },
  { id: 'flashbuy', title: '闪购达人', desc: '外卖奶茶随手点，车旁快送。', logo: flashBuyImage },
]

const TrashIcon = () => (
  <svg className="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v10h8V9h2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9Z" fill="currentColor" /></svg>
)

const CodeIcon = () => (
  <svg className="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4Zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4Z" fill="currentColor" /></svg>
)

function BuiltinCard({ skill }) {
  const ref = useRef(null)
  const handleClick = () => {
    ref.current?.animate(
      [{ transform: 'translateY(0)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }],
      { duration: 220, easing: 'ease-out' }
    )
  }
  return (
    <button ref={ref} className={`skill-card ${skill.id}`} style={skill.image ? { '--skill-image': `url(${skill.image})` } : undefined} onClick={handleClick}>
      {skill.logo && <img className="skill-card-logo" src={skill.logo} alt="" aria-hidden="true" />}
      <strong>{skill.title}</strong>
      <span>{skill.desc}</span>
    </button>
  )
}

function SkillDetail({ name, clientId, onClose }) {
  const [content, setContent] = useState(null)

  useEffect(() => {
    fetch(`/api/skills/${encodeURIComponent(name)}?clientId=${clientId}`)
      .then(r => r.json())
      .then(d => setContent(d.content))
      .catch(() => setContent('加载失败'))
  }, [clientId, name])

  return (
    <div className="skill-detail-overlay" onClick={onClose}>
      <div className="skill-detail" onClick={e => e.stopPropagation()}>
        <div className="skill-detail-header">
          <strong>{name}</strong>
          <button className="skill-detail-close" onClick={onClose} aria-label="关闭">
            <svg className="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        <pre className="skill-detail-content">{content || '加载中...'}</pre>
      </div>
    </div>
  )
}

export default function SkillTab({ customSkills = [], onDeleteSkill, clientId }) {
  const [detailName, setDetailName] = useState(null)

  return (
    <div className="skill-scroll">
      <h2 className="section-title">内置技能</h2>
      <div className="builtin-grid">
        {BUILTIN_SKILLS.map(s => <BuiltinCard key={s.id} skill={s} />)}
      </div>

      <div className="custom-head">
        <span>我的技能</span>
      </div>
      <div className="custom-grid" aria-label="自定义技能">
        {customSkills.map(s => (
          <article key={s.name} className="custom-skill">
            <span><strong>{s.name}</strong><span>{s.description}</span></span>
            <div className="custom-skill-actions">
              <button className="code-btn" aria-label={`查看${s.name}详情`} onClick={() => setDetailName(s.name)}><CodeIcon /></button>
              {!s.readonly && <button className="trash-btn" aria-label={`删除${s.name}`} onClick={() => onDeleteSkill?.(s.name)}><TrashIcon /></button>}
            </div>
          </article>
        ))}
      </div>
      {customSkills.length === 0 && <div className="empty-state" style={{ display: 'block' }}>暂无自定义技能，通过对话创建</div>}

      {detailName && <SkillDetail name={detailName} clientId={clientId} onClose={() => setDetailName(null)} />}
    </div>
  )
}
