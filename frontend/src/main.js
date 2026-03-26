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
let gameMeta    = {}
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

function gameCover(gameKey, displayName) {
  const boxart = gameMeta[gameKey]?.boxart
  if (boxart) {
    return `<img src="${BACKEND}${boxart}?t=${Date.now()}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" alt="${displayName}" onerror="this.style.display='none'" />`
  }
  const cols = gameColors(displayName || gameKey)
  return `<div style="position:absolute;inset:0;background:linear-gradient(160deg,${cols[0]},${cols[1]},${cols[2]});display:flex;align-items:center;justify-content:center">
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z"/></svg>
  </div>`
}

function clipThumbHtml(clip) {
  if (clip.preview) {
    // Wrap in a positioned div so CSS position:absolute children work correctly.
    // Use data-fallback on the img so onerror can swap in the gradient without
    // innerHTML quote-escaping issues.
    return `<div class="clip-thumb-bg" id="thumb-${clip.filename.replace(/\./g,'-')}">
      <img src="${BACKEND}${clip.preview}"
        style="width:100%;height:100%;object-fit:cover;display:block;"
        data-clip="${clip.filename}"
        onload="this.style.opacity=1"
        onerror="this.parentElement.className='clip-thumb-bg clip-thumb-fallback';this.remove()"
      />
    </div>`
  }
  return clipThumbFallback(clip)
}

function clipThumbFallback(clip) {
  const cols = gameColors(clip.game || 'unknown')
  return `<div class="clip-thumb-bg" style="background:linear-gradient(135deg,${cols[0]},${cols[2]});display:flex;align-items:center;justify-content:center;">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.3"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/></svg>
  </div>`
}

// ── lazy duration loading ─────────────────────────────────────────

// Map of filename -> duration string, populated lazily
const durCache = {}

async function loadDurations(clipList) {
  // Load durations for clips that don't have them yet, in small batches
  const missing = clipList.filter(c => !c.dur && !durCache[c.filename])
  if (!missing.length) return

  // fetch up to 5 at a time to avoid flooding flask
  const BATCH = 5
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH)
    await Promise.all(batch.map(async c => {
      const res = await api(`/clips/${encodeURIComponent(c.filename)}/preview`)
      // also trigger preview generation while we're at it
    }))
  }
}

function durLabel(clip) {
  return clip.dur || durCache[clip.filename] || '?:??'
}

// Poll for previews that are being generated in background
async function pollPreviews() {
  const needPreview = clips.filter(c => !c.preview)
  if (!needPreview.length) return

  let updated = false
  await Promise.all(needPreview.slice(0, 5).map(async c => {
    const res = await api(`/clips/${encodeURIComponent(c.filename)}/preview`)
    if (res?.preview) {
      c.preview = res.preview
      updated = true
      // Patch the DOM directly if the thumb container is already rendered,
      // so we don't need a full re-render that causes flicker.
      const id  = `thumb-${c.filename.replace(/\./g, '-')}`
      const el  = document.getElementById(id)
      if (el) {
        el.innerHTML = `<img src="${BACKEND}${res.preview}"
          style="width:100%;height:100%;object-fit:cover;display:block;"
          onload="this.style.opacity=1" />`
      }
    }
  }))

  // Only do a full re-render if something changed and DOM patching wasn't enough
  if (updated) {
    renderRecent()
    // don't call renderClips() here — that would reset scroll position
  }
}

// ── recording state UI ────────────────────────────────────────────

function setRecordingState(recording) {
  isRecording = recording
  const indicator = document.getElementById('rec-indicator')
  const statusEl  = document.getElementById('dash-status')
  const statusSub = document.getElementById('dash-status-sub')

  if (indicator) indicator.classList.toggle('active', recording)
  if (statusEl)  { statusEl.textContent = recording ? 'recording' : 'idle'; statusEl.style.color = recording ? 'var(--red)' : 'var(--muted)' }
  if (statusSub) { statusSub.textContent = recording ? 'buffer active' : 'not recording' }
}

// ── clips ─────────────────────────────────────────────────────────

async function loadClips() {
  const [data, meta] = await Promise.all([api('/clips'), api('/games/meta')])
  clips    = data || []
  gameMeta = meta || {}
  updateDashboardStats()
  renderRecent()
  renderClips()
  // start polling for any previews still being generated
  setTimeout(pollPreviews, 3000)
}

function updateDashboardStats() {
  const today      = clips.filter(c => c.date.startsWith('today')).length
  const totalBytes = clips.reduce((sum, c) => sum + (parseFloat(c.size) || 0), 0)

  const storageEl = document.getElementById('dash-storage')
  if (storageEl) {
    storageEl.innerHTML = totalBytes >= 1024
      ? `${(totalBytes / 1024).toFixed(1)} <span style="font-size:13px;color:var(--muted)">GB</span>`
      : `${Math.round(totalBytes)} <span style="font-size:13px;color:var(--muted)">MB</span>`
  }

  const totalEl = document.getElementById('dash-total')
  if (totalEl) totalEl.textContent = clips.length

  const todayEl = document.getElementById('dash-today')
  if (todayEl) todayEl.textContent = `+${today}`

  if (settings) {
    const buf   = settings.capture.buffer_duration
    const bufEl = document.getElementById('dash-buffer')
    if (bufEl) {
      bufEl.innerHTML = buf >= 60
        ? `${buf / 60} <span style="font-size:16px;color:var(--muted)">m</span>`
        : `${buf} <span style="font-size:16px;color:var(--muted)">s</span>`
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
  if (res?.ok) { await loadClips(); toast('clip deleted') }
  else toast('failed to delete clip')
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
    <td class="td-dur">${durLabel(c)}</td>
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

    const gameKey = gameClips[0]?.game_key || currentGame
    content.innerHTML = `
      <button class="back-btn" id="back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        all games
      </button>
      <div class="game-view-header">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="game-view-title">${currentGame}</div>
          <div class="game-view-count">${gameClips.length} clip${gameClips.length !== 1 ? 's' : ''}</div>
        </div>
        <button class="three-dots-btn" data-edit-game="${gameKey}" title="edit game">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>
      <div class="clip-gallery">
  ${gameClips.map(c => `
    <div class="clip-card">
      <div class="clip-thumb">
        ${clipThumbHtml(c)}
        <div class="clip-thumb-overlay">${PLAY_ICON}</div>
        <div class="clip-duration">${durLabel(c)}</div>
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
    content.querySelectorAll('[data-edit-game]').forEach(btn =>
      btn.addEventListener('click', e => { e.stopPropagation(); openGameModal(btn.dataset.editGame) }))
    content.querySelectorAll('.clip-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const card = thumb.closest('.clip-card')
        const fn   = card?.querySelector('[data-show]')?.dataset?.show
        const c    = clips.find(x => x.filename === fn)
        if (c) openVideoPlayer(c)
      })
    })
    return
  }

  const groups = getGroups(filter)
  if (!Object.keys(groups).length) {
    content.innerHTML = '<div class="empty">no clips yet — start recording and save a clip</div>'
    return
  }

  const gameKeyMap = {}
  clips.forEach(c => { if (c.game_key) gameKeyMap[c.game] = c.game_key })

  content.innerHTML = `<div class="game-grid">
    ${Object.entries(groups).map(([game, cs]) => {
      const gameKey = gameKeyMap[game] || game
      return `
      <div class="game-card" data-game="${game}" data-game-key="${gameKey}">
        <div class="game-cover">
          <div class="game-cover-bg">${gameCover(gameKey, game)}</div>
        </div>
        <div class="game-card-footer">
          <div class="game-card-name">${game}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="game-card-count">${cs.length} clip${cs.length !== 1 ? 's' : ''}</div>
            <button class="three-dots-btn" data-edit-game="${gameKey}" title="edit game">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </button>
          </div>
        </div>
      </div>`
    }).join('')}
  </div>`

  content.querySelectorAll('.game-card').forEach(card =>
    card.addEventListener('click', () => { currentGame = card.dataset.game; renderGallery() }))
  content.querySelectorAll('[data-edit-game]').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openGameModal(btn.dataset.editGame) }))
}

function renderList(filter) {
  const content = document.getElementById('clips-content')
  if (!content) return

  const groups    = getGroups(filter)
  const gameKeyMap = {}
  clips.forEach(c => { if (c.game_key) gameKeyMap[c.game] = c.game_key })

  if (!Object.keys(groups).length) {
    content.innerHTML = '<div class="empty">no clips yet</div>'
    return
  }

  content.innerHTML = Object.entries(groups).map(([game, cs]) => {
    const gameKey = gameKeyMap[game] || game
    return `
    <div class="collection">
      <div class="collection-header">
        <div class="collection-name">${game}<span class="collection-count">${cs.length}</span></div>
        <button class="three-dots-btn" data-edit-game="${gameKey}" title="edit game">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
        </button>
      </div>
      <table class="clip-table">
        <thead><tr><th>name</th><th>dur</th><th>size</th><th>date</th><th></th></tr></thead>
        <tbody>${cs.map(c => `<tr>
          <td class="td-name">${c.name}</td>
          <td class="td-dur">${durLabel(c)}</td>
          <td class="td-size">${c.size}</td>
          <td class="td-date">${c.date}</td>
          <td class="td-act">
            <button data-show="${c.filename}">show file</button>
            <button class="del" data-del="${c.filename}">delete</button>
          </td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`
  }).join('')

  content.querySelectorAll('[data-show]').forEach(btn =>
    btn.addEventListener('click', () => showFile(btn.dataset.show)))
  content.querySelectorAll('[data-del]').forEach(btn =>
    btn.addEventListener('click', () => deleteClip(btn.dataset.del)))
  content.querySelectorAll('[data-edit-game]').forEach(btn =>
    btn.addEventListener('click', () => openGameModal(btn.dataset.editGame)))
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

  // preferences panel
  setToggle('toggle-record-on-launch', s.general.record_on_launch)
  setToggle('toggle-start-minimized',  s.general.start_minimized)
  setToggle('toggle-open-on-startup',  s.general.open_on_startup)
  setToggle('toggle-native-titlebar',  s.general.native_titlebar)
  setToggle('toggle-active-window',    s.general.active_window_only)
  setToggle('toggle-clip-sound',       s.general.clip_save_sound)
  setToggle('toggle-rec-sounds',       s.general.rec_sounds)
  setToggle('toggle-open-folder',      s.output.open_folder_after_save)

  // video panel
  setSelect('sel-buffer',    String(s.capture.buffer_duration))
  setSelect('sel-res',       s.capture.resolution)
  setSelect('sel-fps',       String(s.capture.fps))
  setSelect('sel-encoder',   s.capture.encoder)
  setInput ('inp-folder',    s.output.folder)
  setInput ('inp-filename',  s.output.filename_template)
  setSelect('sel-container', s.output.container)
  setSelect('sel-quality',   s.output.quality)

  // hotkeys
  setKeyBtn('key-save-clip',    s.hotkeys.save_clip)
  setKeyBtn('key-toggle-rec',   s.hotkeys.toggle_recording)
  setKeyBtn('key-open-browser', s.hotkeys.open_browser)

  // audio panel
  const audio = s.audio || {}
  setInput('audio-desktop-device', audio.desktop_device || '')
  setInput('audio-mic-device',     audio.mic_device     || '')
  setToggle('audio-mic-enabled',   audio.mic_enabled    ?? false)
  setToggle('audio-separate',      audio.separate_tracks ?? false)
  const desktopVol = document.getElementById('audio-desktop-vol')
  const micVol     = document.getElementById('audio-mic-vol')
  if (desktopVol) desktopVol.value = audio.desktop_volume ?? 100
  if (micVol)     micVol.value     = audio.mic_volume     ?? 100
  updateAudioDeviceList()

  // apps
  renderTags('monitored-list', s.apps.monitored,      'monitored')
  renderTags('excluded-list',  s.apps.audio_excluded, 'excluded')
  setToggle('toggle-record-desktop', s.apps?.record_desktop ?? true)

  // dashboard quick settings (mirrors preferences)
  setToggle('qs-record-on-launch', s.general.record_on_launch)
  setToggle('qs-active-window',    s.general.active_window_only)
  setToggle('qs-clip-sound',       s.general.clip_save_sound)
  setToggle('qs-rec-sounds',       s.general.rec_sounds)
  setSelect('qs-buffer',           String(s.capture.buffer_duration))

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

  settings.general.record_on_launch   = getToggle('toggle-record-on-launch') || getToggle('qs-record-on-launch')
  settings.general.start_minimized    = getToggle('toggle-start-minimized')
  settings.general.open_on_startup    = getToggle('toggle-open-on-startup')
  settings.general.native_titlebar    = getToggle('toggle-native-titlebar')
  settings.general.active_window_only = getToggle('toggle-active-window') || getToggle('qs-active-window')
  settings.general.clip_save_sound    = getToggle('toggle-clip-sound') || getToggle('qs-clip-sound')
  settings.general.rec_sounds         = getToggle('toggle-rec-sounds') || getToggle('qs-rec-sounds')

  settings.capture.buffer_duration = parseInt(getSelect('sel-buffer') || getSelect('qs-buffer')) || 60
  settings.capture.resolution      = getSelect('sel-res')
  settings.capture.fps             = parseInt(getSelect('sel-fps')) || 60
  settings.capture.encoder         = getSelect('sel-encoder')

  settings.output.folder                 = getInput('inp-folder')
  settings.output.filename_template      = getInput('inp-filename')
  settings.output.container             = getSelect('sel-container')
  settings.output.quality               = getSelect('sel-quality')
  settings.output.open_folder_after_save = getToggle('toggle-open-folder')

  if (!settings.apps) settings.apps = {}
  settings.apps.record_desktop = getToggle('toggle-record-desktop')

  // audio
  if (!settings.audio) settings.audio = {}
  settings.audio.desktop_device  = getInput('audio-desktop-device')
  settings.audio.mic_device      = getInput('audio-mic-device')
  settings.audio.mic_enabled     = getToggle('audio-mic-enabled')
  settings.audio.separate_tracks = getToggle('audio-separate')
  const dvEl = document.getElementById('audio-desktop-vol')
  const mvEl = document.getElementById('audio-mic-vol')
  if (dvEl) settings.audio.desktop_volume = parseInt(dvEl.value) || 100
  if (mvEl) settings.audio.mic_volume     = parseInt(mvEl.value) || 100

  // keep quick settings in sync with preferences panel
  setToggle('qs-record-on-launch', settings.general.record_on_launch)
  setToggle('qs-active-window',    settings.general.active_window_only)
  setToggle('qs-clip-sound',       settings.general.clip_save_sound)
  setToggle('qs-rec-sounds',       settings.general.rec_sounds)

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

async function addApp(type) {
  // Try file picker first (Electron + backend), fall back to prompt
  const res = await api('/system/pick-exe', 'POST')
  let exe
  if (res?.ok && res.name) {
    exe = res.name
  } else if (res?.cancelled) {
    return  // user cancelled picker
  } else {
    // fallback: manual text entry
    const name = prompt('Enter executable name (e.g. cs2.exe)')
    if (!name?.trim()) return
    exe = name.trim()
  }
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

window.addApp = addApp

// ── capture ───────────────────────────────────────────────────────

async function startRecording() {
  const res = await api('/capture/start', 'POST')
  if (res?.ok) { setRecordingState(true); toast('recording started') }
  else toast(res?.error || 'failed to start — check ffmpeg path')
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

  if (backendOk)  { backendOk.textContent = 'ok';                              backendOk.style.color  = 'var(--green)' }
  if (ffmpegOk)   { ffmpegOk.textContent  = data.ffmpeg ? 'found' : 'missing'; ffmpegOk.style.color   = data.ffmpeg ? 'var(--green)' : 'var(--red)' }
  if (ffmpegPath) { ffmpegPath.textContent = data.ffmpeg_path || '—' }
  if (clipsDir)   { clipsDir.textContent   = data.clips_dir   || '—' }

  if (data.recording !== isRecording) setRecordingState(data.recording)
}

// ── global hotkeys ────────────────────────────────────────────────

function initGlobalHotkeys() {
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
    if (document.querySelector('.key.listening')) return
    if (!settings) return

    const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key

    if (key === settings.hotkeys.save_clip) {
      e.preventDefault(); saveClip()
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
        // notify main process to re-register global shortcuts
        if (window.ipcRenderer) window.ipcRenderer.send('update-hotkeys', settings.hotkeys)
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

// ── tray ──────────────────────────────────────────────────────────

function initTray() {
  document.getElementById('tray-btn')?.addEventListener('click', () => {
    if (window.ipcRenderer) window.ipcRenderer.send('minimize-to-tray')
    else toast('minimize to tray (Electron only)')
  })
}

// ── folder buttons ────────────────────────────────────────────────

function initFolderButtons() {
  document.getElementById('dash-folder-btn')?.addEventListener('click', openFolder)
  document.getElementById('clips-folder-btn')?.addEventListener('click', openFolder)
}

// ── sidebar collapse ──────────────────────────────────────────────

function initSidebarCollapse() {
  const btn     = document.getElementById('sidebar-collapse-btn')
  const sidebar = document.getElementById('sidebar')
  if (!btn || !sidebar) return

  const ICON_COLLAPSE = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`
  const ICON_EXPAND   = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`

  const savedCollapsed = localStorage.getItem('sidebar-collapsed') === 'true'
  if (savedCollapsed) sidebar.classList.add('collapsed')
  btn.innerHTML = savedCollapsed ? ICON_EXPAND : ICON_COLLAPSE
  btn.title     = savedCollapsed ? 'expand sidebar' : 'collapse sidebar'

  btn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed')
    const collapsed = sidebar.classList.contains('collapsed')
    btn.title     = collapsed ? 'expand sidebar' : 'collapse sidebar'
    btn.innerHTML = collapsed ? ICON_EXPAND : ICON_COLLAPSE
    localStorage.setItem('sidebar-collapsed', collapsed)
  })
}

// ── game edit modal ───────────────────────────────────────────────

let modalGameKey = null

function openGameModal(gameKey) {
  modalGameKey = gameKey
  const meta   = gameMeta[gameKey] || {}

  document.getElementById('game-modal-name').value = meta.display_name || gameKey

  const preview = document.getElementById('boxart-preview')
  if (meta.boxart) {
    preview.innerHTML = `<img src="${BACKEND}${meta.boxart}?t=${Date.now()}" style="max-height:120px;border-radius:6px;object-fit:cover" />`
  } else {
    preview.innerHTML = '<span style="color:var(--muted);font-size:12px">no box art set</span>'
  }

  document.getElementById('game-modal-overlay').classList.add('active')
  document.getElementById('game-modal-name').focus()
}

function closeGameModal() {
  document.getElementById('game-modal-overlay').classList.remove('active')
  modalGameKey = null
}

async function saveGameModal() {
  if (!modalGameKey) return
  const newName = document.getElementById('game-modal-name').value.trim()
  if (!newName) { toast('name cannot be empty'); return }

  const res = await api(`/games/${encodeURIComponent(modalGameKey)}/rename`, 'POST', { name: newName })
  if (res?.ok) { toast('game updated'); await loadClips(); closeGameModal() }
  else toast('failed to save')
}

function initGameModal() {
  document.getElementById('game-modal-close')?.addEventListener('click', closeGameModal)
  document.getElementById('game-modal-cancel')?.addEventListener('click', closeGameModal)
  document.getElementById('game-modal-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('game-modal-overlay')) closeGameModal()
  })
  document.getElementById('game-modal-save')?.addEventListener('click', saveGameModal)

  document.getElementById('boxart-url-btn')?.addEventListener('click', async () => {
    const url = prompt('Paste image URL (direct link to .jpg / .png)')
    if (!url?.trim()) return
    const res = await api(`/games/${encodeURIComponent(modalGameKey)}/boxart`, 'POST', { url: url.trim() })
    if (res?.ok) {
      toast('box art updated')
      gameMeta = await api('/games/meta') || {}
      const meta    = gameMeta[modalGameKey] || {}
      const preview = document.getElementById('boxart-preview')
      if (meta.boxart) preview.innerHTML = `<img src="${BACKEND}${meta.boxart}?t=${Date.now()}" style="max-height:120px;border-radius:6px;object-fit:cover" />`
      renderClips()
    } else toast('failed to fetch image')
  })

  document.getElementById('boxart-file-btn')?.addEventListener('click', () => {
    document.getElementById('boxart-file-input').click()
  })
  document.getElementById('boxart-file-input')?.addEventListener('change', async e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const res = await api(`/games/${encodeURIComponent(modalGameKey)}/boxart`, 'POST', { data: ev.target.result })
      if (res?.ok) {
        toast('box art uploaded')
        gameMeta = await api('/games/meta') || {}
        const meta    = gameMeta[modalGameKey] || {}
        const preview = document.getElementById('boxart-preview')
        if (meta.boxart) preview.innerHTML = `<img src="${BACKEND}${meta.boxart}?t=${Date.now()}" style="max-height:120px;border-radius:6px;object-fit:cover" />`
        renderClips()
      } else toast('upload failed')
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  })

  document.getElementById('boxart-remove-btn')?.addEventListener('click', async () => {
    const res = await api(`/games/${encodeURIComponent(modalGameKey)}/boxart`, 'DELETE')
    if (res?.ok) {
      toast('box art removed')
      gameMeta = await api('/games/meta') || {}
      document.getElementById('boxart-preview').innerHTML = '<span style="color:var(--muted);font-size:12px">no box art set</span>'
      renderClips()
    }
  })

  document.getElementById('game-modal-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveGameModal()
    if (e.key === 'Escape') closeGameModal()
  })
}

// ── apps panel wiring ─────────────────────────────────────────────

function initApps() {
  // Wire up "add executable" buttons via event listeners instead of
  // inline onclick — required for Electron's contextIsolation mode.
  document.querySelectorAll('[data-add-app]').forEach(btn => {
    btn.addEventListener('click', () => addApp(btn.dataset.addApp))
  })
}


// ── audio device list ─────────────────────────────────────────────

let audioDevices = []

async function updateAudioDeviceList() {
  const res = await api('/audio/devices')
  audioDevices = res?.devices || []
  populateDeviceSelect('audio-desktop-device-select', audioDevices)
  populateDeviceSelect('audio-mic-device-select',     audioDevices)
}

function populateDeviceSelect(id, devices) {
  const sel = document.getElementById(id)
  if (!sel) return
  const current = sel.dataset.bound || ''
  sel.innerHTML = `<option value="">-- none --</option>` +
    devices.map(d => `<option value="${d}" ${d === current ? 'selected' : ''}>${d}</option>`).join('')
  sel.addEventListener('change', () => {
    const inputId = id.replace('-select', '')
    const inp = document.getElementById(inputId)
    if (inp) { inp.value = sel.value; collectSettings() }
  })
}

function initAudio() {
  document.getElementById('audio-refresh-btn')?.addEventListener('click', updateAudioDeviceList)
  document.querySelectorAll('.audio-setting').forEach(el => {
    el.addEventListener('change', collectSettings)
    el.addEventListener('input',  collectSettings)
  })
  // volume label live update
  const dv = document.getElementById('audio-desktop-vol')
  const mv = document.getElementById('audio-mic-vol')
  if (dv) dv.addEventListener('input', () => {
    const l = document.getElementById('audio-desktop-vol-label')
    if (l) l.textContent = dv.value + '%'
  })
  if (mv) mv.addEventListener('input', () => {
    const l = document.getElementById('audio-mic-vol-label')
    if (l) l.textContent = mv.value + '%'
  })
}

// ── video player modal ────────────────────────────────────────────

let playerClip = null

function openVideoPlayer(clip) {
  playerClip = clip
  const modal  = document.getElementById('video-player-overlay')
  const video  = document.getElementById('video-player-el')
  const title  = document.getElementById('video-player-title')
  if (!modal || !video) return

  const src = `${BACKEND}/clips/${encodeURIComponent(clip.filename)}/stream`
  video.src = src
  if (title) title.textContent = clip.name
  modal.classList.add('active')
  video.play().catch(() => {})
}

function closeVideoPlayer() {
  const modal = document.getElementById('video-player-overlay')
  const video = document.getElementById('video-player-el')
  if (video) { video.pause(); video.src = '' }
  modal?.classList.remove('active')
  playerClip = null
}

function initVideoPlayer() {
  document.getElementById('video-player-close')?.addEventListener('click', closeVideoPlayer)
  document.getElementById('video-player-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('video-player-overlay')) closeVideoPlayer()
  })
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('video-player-overlay')?.classList.contains('active')) {
      closeVideoPlayer()
    }
  })
}

// ── record on launch ──────────────────────────────────────────────

async function handleRecordOnLaunch() {
  if (settings?.general.record_on_launch) {
    setTimeout(startRecording, 800)
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
  initSidebarCollapse()
  initGameModal()
  initApps()
  initAudio()
  initVideoPlayer()
  watchSettings()

  await Promise.all([loadSettings(), pollBackend()])
  await loadClips()

  handleRecordOnLaunch()

  setInterval(pollBackend, 5000)
  setInterval(pollPreviews, 10000)
  // Fast clip watcher: poll every 2s, only full reload when something changes
  setInterval(async () => {
    const res = await api('/clips/poll')
    if (res?.changed) await loadClips()
  }, 2000)
}

init()