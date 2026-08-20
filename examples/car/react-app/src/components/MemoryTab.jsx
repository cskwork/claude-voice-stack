const TrashIcon = () => (
  <svg className="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v9h-2V9Zm4 0h2v9h-2V9ZM7 9h2v10h8V9h2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9Z" fill="currentColor" /></svg>
)

export default function MemoryTab({ memories, onDelete }) {
  return (
    <div className="memory-scroll">
      <ul className="memory-list" aria-label="智能体记忆列表">
        {memories.map(m => (
          <li key={m.id} className="memory-item">
            <span>
              <strong>{m.text}</strong>
              <time>{m.time}</time>
            </span>
            <button className="trash-btn" aria-label="删除记忆" onClick={() => onDelete(m.id)}>
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
      {memories.length === 0 && <div className="empty-state" style={{ display: 'block' }}>暂无智能体记忆</div>}
    </div>
  )
}
