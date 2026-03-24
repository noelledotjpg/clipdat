const STATUS_URL = 'http://localhost:9847/status'

async function fetchStatus() {
  const statusEl = document.querySelector('#status')

  try {
    const res = await fetch(STATUS_URL)
    const data = await res.json()

    statusEl.innerHTML = `
      <p>Backend: <strong>${data.status}</strong></p>
      <p>FFmpeg found: <strong>${data.ffmpeg}</strong></p>
      <p>Recording: <strong>${data.recording}</strong></p>
    `
  } catch (err) {
    statusEl.innerHTML = `<p style="color: red;">Could not reach backend: ${err.message}</p>`
  }
}

document.querySelector('#app').innerHTML = `
  <h1>ClipDat</h1>
  <div id="status"><p>Connecting to backend...</p></div>
  <button id="refresh">Refresh</button>
`

document.querySelector('#refresh').addEventListener('click', fetchStatus)

fetchStatus()
