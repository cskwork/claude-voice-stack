import VehiclePanel from './VehiclePanel'
import SettingsPanel from './SettingsPanel'

export default function SettingsView({
  onOpenSettings,
  activeTab, onTabChange,
  selectedPersona, onSelectPersona,
  selectedVoice, onSelectVoice,
  selectedWake, onSelectWake,
  memories, onDeleteMemory,
}) {
  return (
    <div className="settings-grid">
      <VehiclePanel variant="settings" onOpenSettings={onOpenSettings} />
      <SettingsPanel
        activeTab={activeTab} onTabChange={onTabChange}
        selectedPersona={selectedPersona} onSelectPersona={onSelectPersona}
        selectedVoice={selectedVoice} onSelectVoice={onSelectVoice}
        selectedWake={selectedWake} onSelectWake={onSelectWake}
        memories={memories} onDeleteMemory={onDeleteMemory}
      />
    </div>
  )
}
