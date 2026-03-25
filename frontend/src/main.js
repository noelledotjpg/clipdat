const BACKEND = 'http://localhost:9847'

// ── api ───────────────────────────────────────────────────────────

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)
  try {
    const res = await fetch(BACKEND + path, opts)
    return await res.json()
  } catch {
    return null
  }
}

// ── icons ─────────────────────────────────────────────────────────

const PLAY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>`

// ── state ─────────────────────────────────────────────────────────

let clips       = []
let settings    = null
let currentView = 'gallery'
let currentGame = null
let isRecording = false

// ── toast ─────────────────────────────────────────────────────────

let toastTimer
window.toast = function(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500)
}

// ── game color palette ────────────────────────────────────────────

const PALETTE = [
  ['#1a2a1a','#2d4a1e','#3a5c24'],
  ['#1a1e2e','#2a3058','#3a44a0'],
  ['#2a1010','#4a1a1a','#c8392b'],
  ['#1a2a2a','#1e4a48','#24695c'],
  ['#2a1a2a','#4a2a58','#7a3aa0'],
  ['#2a2010','#4a3818','#695224'],
]

function gameColors(game) {
  let hash = 0
  for (const c of game) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

function gameCover(game) {
  const cols = gameColors(game)
  return `<div style="position:absolute;inset:0;background:linear-gradient(160deg,${cols[0]},${cols[1]},${cols[2]});display:flex;align-items:center;justify-content:center">
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z"/></svg>
  </div>`
}

function clipThumb(clip) {
  const cols = gameColors(clip.game)
  return `<div style="position:absolute;inset:0;background:linear-gradient(135deg,${cols[0]},${cols[2]});display:flex;align-items:center;justify-content:center">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>
  </div>`
}

// ── recording state UI ────────────────────────────────────────────

function setRecordingState(recording) {
  isRecording = recording
  const indicator = document.getElementById('rec-indicator')
  const statusEl  = document.getElementById('dash-status')
  const statusSub = document.getElementById('dash-status-sub')

  if (indicator) indicator.classList.toggle('active', recording)

  if (statusEl) {
    statusEl.textContent = recording ? 'recording' : 'idle'
    statusEl.style.color = recording ? 'var(--red)' : 'var(--muted)'
  }
  if (statusSub) {
    statusSub.textContent = recording ? 'buffer active' : 'not recording'
  }
}

// ── clips ─────────────────────────────────────────────────────────

async function loadClips() {
  const data = await api('/clips')
  clips = data || []
  updateDashboardStats()
  renderRecent()
  renderClips()
}

function updateDashboardStats() {
  const today      = clips.filter(c => c.date.startsWith('today')).length
  const totalBytes = clips.reduce((sum, c) => {
    const mb = parseFloat(c.size)
    return sum + (isNaN(mb) ? 0 : mb)
  }, 0)

  const storageEl = document.getElementById('dash-storage')
  if (storageEl) {
    if (totalBytes >= 1024) {
      storageEl.innerHTML = `${(totalBytes / 1024).toFixed(1)} <span style="font-size:13px;color:var(--muted)">GB</span>`
    } else {
      storageEl.innerHTML = `${Math.round(totalBytes)} <span style="font-size:13px;color:var(--muted)">MB</span>`
    }
  }

  const totalEl = document.getElementById('dash-total')
  if (totalEl) totalEl.textContent = clips.length

  const todayEl = document.getElementById('dash-today')
  if (todayEl) todayEl.textContent = `+${today}`

  // update buffer card from settings
  if (settings) {
    const buf = settings.capture.buffer_duration
    const bufEl = document.getElementById('dash-buffer')
    if (bufEl) {
      if (buf >= 60) {
        bufEl.innerHTML = `${buf / 60} <span style="font-size:16px;color:var(--muted)">m</span>`
      } else {
        bufEl.innerHTML = `${buf} <span style="font-size:16px;color:var(--muted)">s</span>`
      }
    }
  }
}

function getGroups(filter) {
  const data = filter
    ? clips.filter(c => c.name.toLowerCase().includes(filter) || c.game.toLowerCase().includes(filter))
    : clips
  const groups = {}
  data.forEach(c => { if (!groups[c.game]) groups[c.game] = []; groups[c.game].push(c) })
  return groups
}

async function deleteClip(filename) {
  const res = await api(`/clips/${encodeURIComponent(filename)}`, 'DELETE')
  if (res?.ok) {
    await loadClips()
    toast('clip deleted')
  } else {
    toast('failed to delete clip')
  }
}

async function showFile(filename) {
  await api(`/clips/${encodeURIComponent(filename)}/show`, 'POST')
}

async function openFolder() {
  await api('/clips/open-folder', 'POST')
}

function renderRecent() {
  const tbody = document.getElementById('recent-tbody')
  if (!tbody) return

  const recent = clips.slice(0, 3)
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted);padding:12px 10px;font-size:12px">no clips yet</td></tr>'
    return
  }

  tbody.innerHTML = recent.map(c => `<tr>
    <td class="td-name">${c.name}</td>
    <td class="td-game">${c.game}</td>
    <td class="td-dur">${c.dur}</td>
    <td class="td-size">${c.size}</td>
    <td class="td-date">${c.date}</td>
    <td class="td-act">
      <button data-show="${c.filename}">show file</button>
      <button class="del" data-del="${c.filename}">delete</button>
    </td>
  </tr>`).join('')

  tbody.querySelectorAll('[data-show]').forEach(btn =>
    btn.addEventListener('click', () => showFile(btn.dataset.show)))
  tbody.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => deleteClip(btn.dataset.del)))
}

function renderGallery(filter) {
  const content = document.getElementById('clips-content')
  if (!content) return

  if (currentGame) {
    const gameClips = clips.filter(c =>
      c.game === currentGame && (!filter || c.name.toLowerCase().includes(filter)))

    if (!gameClips.length) {
      content.innerHTML = `
        <button class="back-btn" id="back-btn">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
          all games
        </button>
        <div class="empty">no clips match your search</div>`
      document.getElementById('back-btn')?.addEventListener('click', () => { currentGame = null; renderGallery() })
      return
    }

    content.innerHTML = `
      <button class="back-btn" id="back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        all games
      </button>
      <div class="game-view-header">
        <div class="game-view-title">${currentGame}</div>
        <div class="game-view-count">${gameClips.length} clip${gameClips.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="clip-gallery">
        ${gameClips.map(c => `
          <div class="clip-card">
            <div class="clip-thumb">
              <div class="clip-thumb-bg">${clipThumb(c)}</div>
              <div class="clip-thumb-overlay">${PLAY_ICON}</div>
              <div class="clip-duration">${c.dur}</div>
            </div>
            <div class="clip-card-footer">
              <div class="clip-card-name">${c.name}</div>
              <div class="clip-card-meta">
                <span>${c.date}</span>
                <span>${c.size}</span>
              </div>
              <div class="clip-card-actions">
                <button class="clip-action-btn" data-show="${c.filename}">show file</button>
                <button class="clip-action-btn del" data-del="${c.filename}">delete</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `
    document.getElementById('back-btn')?.addEventListener('click', () => { currentGame = null; renderGallery() })
    content.querySelectorAll('[data-show]').forEach(btn =>
      btn.addEventListener('click', () => showFile(btn.dataset.show)))
    content.querySelectorAll('[data-del]').forEach(btn =>
      btn.addEventListener('click', () => deleteClip(btn.dataset.del)))
    return
  }

  const groups = getGroups(filter)
  if (!Object.keys(groups).length) {
    content.innerHTML = '<div class="empty">no clips yet — start recording and save a clip</div>'
    return
  }

  content.innerHTML = `<div class="game-grid">
    ${Object.entries(groups).map(([game, cs]) => `
      <div class="game-card" data-game="${game}">
        <div class="game-cover">
          <div class="game-cover-bg">${gameCover(game)}</div>
        </div>
        <div class="game-card-footer">
          <div class="game-card-name">${game}</div>
          <div class="game-card-count">${cs.length} clip${cs.length !== 1 ? 's' : ''}</div>
        </div>
      </div>
    `).join('')}
  </div>`

  content.querySelectorAll('.game-card').forEach(card =>
    card.addEventListener('click', () => { currentGame = card.dataset.game; renderGallery() }))
}

function renderList(filter) {
  const content = document.getElementById('clips-content')
  if (!content) return

  const groups = getGroups(filter)
  if (!Object.keys(groups).length) {
    content.innerHTML = '<div class="empty">no clips yet</div>'
    return
  }

  content.innerHTML = Object.entries(groups).map(([game, cs]) => `
    <div class="collection">
      <div class="collection-header">
        <div class="collection-name">${game}<span class="collection-count">${cs.length}</span></div>
      </div>
      <table class="clip-table">
        <thead><tr><th>name</th><th>dur</th><th>size</th><th>date</th><th></th></tr></thead>
        <tbody>${cs.map(c => `<tr>
          <td class="td-name">${c.name}</td>
          <td class="td-dur">${c.dur}</td>
          <td class="td-size">${c.size}</td>
          <td class="td-date">${c.date}</td>
          <td class="td-act">
            <button data-show="${c.filename}">show file</button>
            <button class="del" data-del="${c.filename}">delete</button>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  `).join('')

  content.querySelectorAll('[data-show]').forEach(btn =>
    btn.addEventListener('click', () => showFile(btn.dataset.show)))
  content.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => deleteClip(btn.dataset.del)))
}

function renderClips() {
  const filter = document.getElementById('clip-search')?.value.toLowerCase() || ''
  if (currentView === 'gallery') renderGallery(filter)
  else renderList(filter)
}

// ── settings ──────────────────────────────────────────────────────

async function loadSettings() {
  settings = await api('/settings')
  if (!settings) return
  applySettingsToUI()
}

function applySettingsToUI() {
  const s = settings

  setToggle('toggle-record-on-launch', s.general.record_on_launch)
  setToggle('toggle-active-window',    s.general.active_window_only)
  setToggle('toggle-clip-sound',       s.general.clip_save_sound)

  setSelect('sel-buffer',    String(s.capture.buffer_duration))
  setSelect('sel-res',       s.capture.resolution)
  setSelect('sel-fps',       String(s.capture.fps))
  setSelect('sel-encoder',   s.capture.encoder)
  setInput ('inp-folder',    s.output.folder)
  setInput ('inp-filename',  s.output.filename_template)
  setSelect('sel-container', s.output.container)
  setSelect('sel-quality',   s.output.quality)
  setToggle('toggle-open-folder', s.output.open_folder_after_save)

  setKeyBtn('key-save-clip',    s.hotkeys.save_clip)
  setKeyBtn('key-toggle-rec',   s.hotkeys.toggle_recording)
  setKeyBtn('key-open-browser', s.hotkeys.open_browser)

  renderTags('monitored-list', s.apps.monitored,      'monitored')
  renderTags('excluded-list',  s.apps.audio_excluded, 'excluded')

  updateDashboardStats()
}

function setToggle(id, val) { const el = document.getElementById(id); if (el) el.checked = !!val }
function setSelect(id, val) {
  const el = document.getElementById(id)
  if (!el) return
  for (const opt of el.options) { if (opt.value === val) { opt.selected = true; return } }
}
function setInput(id, val)  { const el = document.getElementById(id); if (el) el.value = val || '' }
function setKeyBtn(id, val) { const el = document.getElementById(id); if (el) el.textContent = val || '—' }
function getToggle(id) { const el = document.getElementById(id); return el ? el.checked : false }
function getSelect(id) { const el = document.getElementById(id); return el ? el.value : '' }
function getInput(id)  { const el = document.getElementById(id); return el ? el.value : '' }

function renderTags(listId, items, type) {
  const list = document.getElementById(listId)
  if (!list) return
  list.innerHTML = (items || []).map(item => `
    <div class="tag">${item}
      <button data-remove="${item}" data-type="${type}">✕</button>
    </div>
  `).join('')
  list.querySelectorAll('[data-remove]').forEach(btn =>
    btn.addEventListener('click', () => removeApp(btn.dataset.remove, btn.dataset.type)))
}

async function saveSettings() {
  if (!settings) return
  await api('/settings', 'POST', settings)
}

function collectSettings() {
  if (!settings) return

  settings.general.record_on_launch   = getToggle('toggle-record-on-launch')
  settings.general.active_window_only = getToggle('toggle-active-window')
  settings.general.clip_save_sound    = getToggle('toggle-clip-sound')

  settings.capture.buffer_duration = parseInt(getSelect('sel-buffer')) || 60
  settings.capture.resolution      = getSelect('sel-res')
  settings.capture.fps             = parseInt(getSelect('sel-fps')) || 60
  settings.capture.encoder         = getSelect('sel-encoder')

  settings.output.folder                 = getInput('inp-folder')
  settings.output.filename_template      = getInput('inp-filename')
  settings.output.container             = getSelect('sel-container')
  settings.output.quality               = getSelect('sel-quality')
  settings.output.open_folder_after_save = getToggle('toggle-open-folder')

  updateDashboardStats()
  saveSettings()
}

function watchSettings() {
  document.querySelectorAll('[data-setting]').forEach(el => {
    el.addEventListener('change', collectSettings)
    el.addEventListener('input',  collectSettings)
  })
}

// ── apps ──────────────────────────────────────────────────────────

function removeApp(name, type) {
  if (!settings) return
  if (type === 'monitored') {
    settings.apps.monitored = settings.apps.monitored.filter(a => a !== name)
    renderTags('monitored-list', settings.apps.monitored, 'monitored')
  } else {
    settings.apps.audio_excluded = settings.apps.audio_excluded.filter(a => a !== name)
    renderTags('excluded-list', settings.apps.audio_excluded, 'excluded')
  }
  saveSettings()
}

window.addApp = function(type) {
  const name = prompt('Enter executable name (e.g. cs2.exe)')
  if (!name?.trim()) return
  const exe = name.trim()
  if (!settings) return
  if (type === 'monitored') {
    if (!settings.apps.monitored.includes(exe)) settings.apps.monitored.push(exe)
    renderTags('monitored-list', settings.apps.monitored, 'monitored')
  } else {
    if (!settings.apps.audio_excluded.includes(exe)) settings.apps.audio_excluded.push(exe)
    renderTags('excluded-list', settings.apps.audio_excluded, 'excluded')
  }
  saveSettings()
  toast(`added ${exe}`)
}

// ── capture ───────────────────────────────────────────────────────

async function startRecording() {
  const res = await api('/capture/start', 'POST')
  if (res?.ok) {
    setRecordingState(true)
    toast('recording started')
  } else {
    toast(res?.error || 'failed to start — check ffmpeg path')
  }
}

async function stopRecording() {
  await api('/capture/stop', 'POST')
  setRecordingState(false)
  toast('recording stopped')
}

async function saveClip() {
  const game = currentGame || 'unknown'
  const res  = await api('/capture/clip', 'POST', { game })
  if (res?.ok) {
    toast(`clip saved — ${res.name}`)
    await loadClips()
    if (settings?.output.open_folder_after_save) openFolder()
  } else {
    toast(res?.error || 'failed to save clip')
  }
}

// ── backend polling ───────────────────────────────────────────────

async function pollBackend() {
  const data = await api('/status')

  const backendOk  = document.getElementById('status-backend-ok')
  const ffmpegOk   = document.getElementById('status-ffmpeg-ok')
  const ffmpegPath = document.getElementById('status-ffmpeg-path')
  const clipsDir   = document.getElementById('status-clips-dir')

  if (!data) {
    if (backendOk) { backendOk.textContent = 'offline'; backendOk.style.color = 'var(--red)' }
    if (ffmpegOk)  { ffmpegOk.textContent  = '—';       ffmpegOk.style.color  = 'var(--muted)' }
    return
  }

  if (backendOk)  { backendOk.textContent  = 'ok';                                backendOk.style.color  = 'var(--green)' }
  if (ffmpegOk)   { ffmpegOk.textContent   = data.ffmpeg ? 'found' : 'missing';   ffmpegOk.style.color   = data.ffmpeg ? 'var(--green)' : 'var(--red)' }
  if (ffmpegPath) { ffmpegPath.textContent  = data.ffmpeg_path || '—' }
  if (clipsDir)   { clipsDir.textContent    = data.clips_dir   || '—' }

  if (data.recording !== isRecording) setRecordingState(data.recording)
}

// ── global hotkeys (within app window) ───────────────────────────

function initGlobalHotkeys() {
  window.addEventListener('keydown', e => {
    // don't fire if user is typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    // don't fire if a key rebind listener is active
    if (document.querySelector('.key.listening')) return

    if (!settings) return
    const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key

    if (key === settings.hotkeys.save_clip) {
      e.preventDefault()
      saveClip()
    }
    if (key === settings.hotkeys.toggle_recording) {
      e.preventDefault()
      if (isRecording) stopRecording(); else startRecording()
    }
  })
}

// ── hotkey rebinding ──────────────────────────────────────────────

function initKeyButtons() {
  document.querySelectorAll('.key').forEach(key => {
    key.addEventListener('click', () => {
      document.querySelectorAll('.key').forEach(k => k.classList.remove('listening'))
      key.classList.add('listening')
      key.textContent = '…'
      const handler = e => {
        e.preventDefault()
        const label = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
        key.textContent = label
        key.classList.remove('listening')
        window.removeEventListener('keydown', handler)

        if (!settings) return
        if (key.id === 'key-save-clip')    settings.hotkeys.save_clip        = label
        if (key.id === 'key-toggle-rec')   settings.hotkeys.toggle_recording = label
        if (key.id === 'key-open-browser') settings.hotkeys.open_browser     = label
        saveSettings()
        toast('keybind saved')
      }
      window.addEventListener('keydown', handler)
    })
  })
}

// ── nav ───────────────────────────────────────────────────────────

function initNav() {
  document.querySelectorAll('.nav-item[data-panel], .link-btn[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'))
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
      document.getElementById('panel-' + btn.dataset.panel)?.classList.add('active')
      document.querySelector(`.nav-item[data-panel="${btn.dataset.panel}"]`)?.classList.add('active')
      if (btn.dataset.panel === 'clips') renderClips()
    })
  })
}

// ── view toggle ───────────────────────────────────────────────────

function initViewToggle() {
  document.getElementById('view-gallery')?.addEventListener('click', () => {
    currentView = 'gallery'; currentGame = null
    document.getElementById('view-gallery').classList.add('active')
    document.getElementById('view-list').classList.remove('active')
    renderClips()
  })
  document.getElementById('view-list')?.addEventListener('click', () => {
    currentView = 'list'; currentGame = null
    document.getElementById('view-list').classList.add('active')
    document.getElementById('view-gallery').classList.remove('active')
    renderClips()
  })
  document.getElementById('clip-search')?.addEventListener('input', renderClips)
}

// ── tray (via Electron IPC) ───────────────────────────────────────

function initTray() {
  document.getElementById('tray-btn')?.addEventListener('click', () => {
    // ipcRenderer is exposed via preload.js
    if (window.ipcRenderer) {
      window.ipcRenderer.send('minimize-to-tray')
    } else {
      // fallback for browser dev mode
      toast('failed to minimize to tray err: dev mode or ipc fail')
    }
  })
}

// ── folder buttons ────────────────────────────────────────────────

function initFolderButtons() {
  document.getElementById('dash-folder-btn')?.addEventListener('click', openFolder)
  document.getElementById('clips-folder-btn')?.addEventListener('click', openFolder)
}

// ── record on launch ──────────────────────────────────────────────

async function handleRecordOnLaunch() {
  if (settings?.general.record_on_launch) {
    // small delay to let the UI fully render first
    setTimeout(startRecording, 500)
  }
}

// ── init ──────────────────────────────────────────────────────────

async function init() {
  initNav()
  initViewToggle()
  initFolderButtons()
  initTray()
  initKeyButtons()
  initGlobalHotkeys()
  watchSettings()

  await Promise.all([loadSettings(), pollBackend()])
  await loadClips()

  handleRecordOnLaunch()

  setInterval(pollBackend, 5000)
  setInterval(loadClips,   30000)
}

init()