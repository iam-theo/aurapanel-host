import { useEffect, useState } from 'react'
import { Server, Shield, Bell, Database, Globe, KeyRound, User } from 'lucide-react'
import { api } from '../lib/api'

const SECTIONS = [
  { id: 'general', label: 'General', icon: Server },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'databases', label: 'Database Backups', icon: Database },
  { id: 'network', label: 'Network', icon: Globe },
  { id: 'profile', label: 'Profile', icon: User },
]

export default function Settings() {
  const [section, setSection] = useState('general')
  const [overview, setOverview] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.get('/system/overview').then(setOverview).catch(() => {})
  }, [])

  const notify = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="p-6 flex gap-6">
      <div className="w-56 shrink-0 space-y-0.5">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            className={`nav-item w-full ${section === s.id ? 'active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            <s.icon size={17} />
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-6">
        {section === 'general' && (
          <div className="space-y-6 max-w-2xl">
            <SettingCard title="Server Settings" description="Basic configuration for the managed server.">
              <Field label="Hostname" value={overview?.hostname || '-'} defaultValue={overview?.hostname || ''} onSave={notify} />
              <Field label="Timezone" value="Africa/Johannesburg" defaultValue="Africa/Johannesburg" onSave={notify} />
              <Toggle label="Auto-restart services on failure" defaultChecked onSave={notify} />
              <Toggle label="Resource monitoring alerts" defaultChecked onSave={notify} />
            </SettingCard>
            {saved && <p className="text-sm text-panel-green">Settings saved successfully.</p>}
          </div>
        )}

        {section === 'security' && (
          <div className="space-y-6 max-w-2xl">
            <SettingCard title="Security" description="Firewall and access control.">
              <Toggle label="Enable UFW firewall" defaultChecked onSave={notify} />
              <Toggle label="Block SSH root login" defaultChecked onSave={notify} />
              <Toggle label="Rate limiting on nginx" defaultChecked onSave={notify} />
              <Field label="SSH Port" value="22" defaultValue="22" onSave={notify} />
              <Field label="Fail2Ban" value="Active" defaultValue="Active" onSave={notify} />
            </SettingCard>
            {saved && <p className="text-sm text-panel-green">Security settings saved successfully.</p>}
          </div>
        )}

        {section === 'notifications' && (
          <div className="space-y-6 max-w-2xl">
            <SettingCard title="Notifications" description="Alert preferences for server events.">
              <Toggle label="Email notifications" defaultChecked onSave={notify} />
              <Toggle label="Server down alerts" defaultChecked onSave={notify} />
              <Toggle label="Resource usage warnings" defaultChecked onSave={notify} />
              <Toggle label="Weekly summary report" onSave={notify} />
              <Field label="Alert email" value="admin@digital-auracle.com" defaultValue="admin@digital-auracle.com" onSave={notify} />
            </SettingCard>
            {saved && <p className="text-sm text-panel-green">Notification settings saved successfully.</p>}
          </div>
        )}

        {section === 'databases' && (
          <div className="space-y-6 max-w-2xl">
            <SettingCard title="Database Backups" description="Automatic backup configuration.">
              <Toggle label="Daily backups" defaultChecked onSave={notify} />
              <Toggle label="Offsite backup replication" defaultChecked onSave={notify} />
              <Field label="Retention (days)" value="30" defaultValue="30" onSave={notify} />
              <Field label="Backup time" value="02:00" defaultValue="02:00" onSave={notify} />
            </SettingCard>
            {saved && <p className="text-sm text-panel-green">Backup settings saved successfully.</p>}
          </div>
        )}

        {section === 'network' && (
          <div className="space-y-6 max-w-2xl">
            <SettingCard title="Network" description="Network interfaces and firewall rules.">
              <div className="space-y-3">
                {overview?.network?.map(n => (
                  <div key={n.iface} className="flex items-center justify-between bg-panel-bg rounded-lg p-3 border border-panel-border">
                    <div>
                      <p className="font-medium text-sm">{n.iface}</p>
                      <p className="text-xs text-panel-muted font-mono">{n.ip4}</p>
                    </div>
                    <span className="status-badge online">Connected</span>
                  </div>
                ))}
                {!overview && <div className="h-20 animate-pulse bg-panel-bg rounded-lg" />}
              </div>
              <Toggle label="Enable UFW firewall" defaultChecked onSave={notify} />
            </SettingCard>
            {saved && <p className="text-sm text-panel-green">Network settings saved successfully.</p>}
          </div>
        )}

        {section === 'profile' && (
          <div className="space-y-6 max-w-2xl">
            <SettingCard title="Profile" description="Your account information.">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-full bg-panel-accent flex items-center justify-center text-2xl font-bold text-white">DA</div>
                <div>
                  <p className="font-semibold">digital-auracle</p>
                  <p className="text-xs text-panel-muted">Administrator</p>
                </div>
              </div>
              <Field label="Full name" value="Digital Auracle Admin" defaultValue="Digital Auracle Admin" onSave={notify} />
              <Field label="Email" value="admin@digital-auracle.com" defaultValue="admin@digital-auracle.com" onSave={notify} />
              <Field label="Company" value="Digital Auracle" defaultValue="Digital Auracle" onSave={notify} />
            </SettingCard>
            {saved && <p className="text-sm text-panel-green">Profile updated successfully.</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function SettingCard({ title, description, children }) {
  return (
    <div className="panel-card">
      <h3 className="font-medium text-panel-text text-base mb-1">{title}</h3>
      <p className="text-sm text-panel-muted mb-5">{description}</p>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function Field({ label, value, defaultValue, onSave }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-panel-muted flex-1">{label}</label>
      <input className="input-field max-w-xs" defaultValue={defaultValue} />
      <button className="btn-accent !py-1.5" onClick={onSave}>Save</button>
    </div>
  )
}

function Toggle({ label, defaultChecked, onSave }) {
  const [checked, setChecked] = useState(defaultChecked)
  return (
    <div className="flex items-center justify-between gap-4">
      <label className="text-sm text-panel-text flex-1">{label}</label>
      <button
        onClick={() => { setChecked(!checked); onSave() }}
        className={`w-11 h-6 rounded-full transition-colors relative ${checked ? 'bg-panel-accent' : 'bg-panel-border'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </div>
  )
}
