import { useEffect, useState } from 'react'
import { RefreshCw, Plus, Trash2, User as UserIcon, KeyRound, Copy } from 'lucide-react'
import { api } from '../lib/api'
import Modal, { Field, Button, EmptyState } from '../components/ui.jsx'

export default function SshKeys() {
  const [keys, setKeys] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('keys')
  const [showAdd, setShowAdd] = useState(false)
  const [toast, setToast] = useState(null)

  const toastMsg = (m) => { setToast(m); setTimeout(() => setToast(null), 3000) }

  const load = async () => {
    try {
      const [k, u] = await Promise.all([api.get('/users/ssh-keys'), api.get('/users/users')])
      setKeys(k); setUsers(u)
    } catch (e) { toastMsg(e.message) } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const delKey = async (id) => {
    if (!confirm('Remove this SSH key?')) return
    try { await api.del(`/users/ssh-keys/${id}`); await load(); toastMsg('SSH key removed') }
    catch (e) { toastMsg(e.message) }
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <div className="fixed top-5 right-5 z-50 bg-panel-green/20 border border-panel-green/40 text-panel-green px-4 py-2 rounded-md text-sm">{toast}</div>}

      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-panel-card p-1 rounded-lg border border-panel-border">
          <button className={`px-4 py-2 rounded-md text-sm ${tab === 'keys' ? 'bg-panel-accent text-white' : 'text-panel-muted'}`} onClick={() => setTab('keys')}><KeyRound size={15} className="inline mr-1.5 -mt-0.5" />SSH Keys ({keys.length})</button>
          <button className={`px-4 py-2 rounded-md text-sm ${tab === 'users' ? 'bg-panel-accent text-white' : 'text-panel-muted'}`} onClick={() => setTab('users')}><UserIcon size={15} className="inline mr-1.5 -mt-0.5" />Users ({users.length})</button>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={load}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
          {tab === 'keys' && <button className="btn-accent" onClick={() => setShowAdd(true)}><Plus size={16} /> Add Key</button>}
        </div>
      </div>

      {tab === 'keys' ? (
        <div className="panel-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-panel-border flex items-center gap-2 text-sm text-panel-muted">
            <KeyRound size={15} className="text-panel-green" />
            Authorized keys for digital-auracle (<code className="font-mono">~/.ssh/authorized_keys</code>)
          </div>
          <div className="divide-y divide-panel-border/50">
            {keys.map(k => (
              <div key={k.id} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-panel-cardHover/50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="status-badge bg-panel-blue/15 text-panel-blue">{k.type}</span>
                    <span className="font-medium text-panel-text truncate">{k.comment || 'Key ' + k.id}</span>
                  </div>
                  <p className="text-xs text-panel-muted font-mono truncate mt-1">{k.full}</p>
                </div>
                <button className="btn !px-2 !py-1 !bg-panel-red/20 !text-panel-red shrink-0" onClick={() => delKey(k.id)}><Trash2 size={13} /></button>
              </div>
            ))}
            {keys.length === 0 && !loading && <EmptyState icon={KeyRound} title="No SSH keys" subtitle="Add an authorized key to enable key-based login" />}
          </div>
        </div>
      ) : (
        <div className="panel-card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-panel-muted border-b border-panel-border bg-panel-bg/50">
              <th className="px-4 py-3 font-medium">Username</th><th className="px-4 py-3 font-medium">UID</th><th className="px-4 py-3 font-medium">Home</th><th className="px-4 py-3 font-medium">Shell</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.username} className="border-b border-panel-border/50 hover:bg-panel-cardHover/50">
                  <td className="px-4 py-3 font-medium flex items-center gap-2"><UserIcon size={14} className="text-panel-purple" />{u.username}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted font-mono">{u.uid}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted font-mono">{u.home}</td>
                  <td className="px-4 py-3 text-xs text-panel-muted font-mono">{u.shell}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && !loading && <EmptyState icon={UserIcon} title="No users" />}
        </div>
      )}

      <AddKeyModal open={showAdd} onClose={() => setShowAdd(false)} onAdded={(m) => { toastMsg(m); load() }} />
    </div>
  )
}

function AddKeyModal({ open, onClose, onAdded }) {
  const [pubkey, setPubkey] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async () => {
    if (!pubkey.trim()) return setErr('Paste a public key')
    setBusy(true); setErr(null)
    try {
      await api.post('/users/ssh-keys', { pubkey, comment })
      onAdded('SSH key added')
      onClose()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add SSH Key">
      <div className="space-y-4">
        <Field label="Public key" hint="ssh-rsa AAAA... or ssh-ed25519 AAAA...">
          <textarea className="input-field resize-none font-mono text-xs" rows={4} placeholder="ssh-ed25519 AAAAC3Nza..." value={pubkey} onChange={e => setPubkey(e.target.value)} spellCheck={false} />
        </Field>
        <Field label="Comment (optional)"><input className="input-field" placeholder="laptop" value={comment} onChange={e => setComment(e.target.value)} /></Field>
        {err && <p className="text-sm text-panel-red">{err}</p>}
        <p className="text-xs text-panel-muted bg-panel-bg rounded-md p-3 border border-panel-border">The key is appended to <code className="font-mono">~/.ssh/authorized_keys</code> for the current user.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Adding...' : 'Add Key'}</Button>
        </div>
      </div>
    </Modal>
  )
}
