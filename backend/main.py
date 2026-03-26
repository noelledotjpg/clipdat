import os
import sys
import json
import subprocess
import threading
import math
import base64
import urllib.request
from pathlib import Path
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── paths ─────────────────────────────────────────────────────────

def get_base():
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)
    return Path(__file__).parent

BASE            = get_base()
FFMPEG          = BASE / 'resources' / 'ffmpeg.exe'
FFPROBE         = BASE / 'resources' / 'ffprobe.exe'
SETTINGS_FILE   = BASE / 'settings.json'
CHUNK_DIR       = BASE / 'temp'
BOXART_DIR      = BASE / 'boxart'
PREVIEW_DIR     = BASE / 'previews'
GAME_META_FILE  = BASE / 'game_meta.json'
SOUND_CLIP      = BASE / 'resources' / 'clip_saved.wav'
SOUND_REC_START = BASE / 'resources' / 'rec_start.wav'
SOUND_REC_STOP  = BASE / 'resources' / 'rec_stop.wav'

CHUNK_DIR.mkdir(exist_ok=True)
BOXART_DIR.mkdir(exist_ok=True)
PREVIEW_DIR.mkdir(exist_ok=True)

def get_clips_dir():
    return Path(settings_get()['output']['folder'])

# ── settings ──────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    'general': {
        'record_on_launch':   False,
        'start_minimized':    False,
        'open_on_startup':    False,
        'native_titlebar':    True,
        'active_window_only': False,
        'clip_save_sound':    True,
        'rec_sounds':         True,
    },
    'capture': {
        'buffer_duration': 60,
        'resolution':      '1920x1080',
        'fps':             60,
        'encoder':         'h264_nvenc',
    },
    'output': {
        'folder':                 str(Path.home() / 'Videos' / 'ClipDat'),
        'filename_template':      '{game}_{date}_{time}',
        'container':              'mp4',
        'quality':                'high',
        'open_folder_after_save': False,
    },
    'hotkeys': {
        'save_clip':        'F8',
        'toggle_recording': 'F9',
        'open_browser':     'F10',
    },
    'apps': {
        'monitored':      [],
        'audio_excluded': [],
        'record_desktop': True,
    }
}

def settings_get():
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, 'r') as f:
                saved = json.load(f)
            merged = json.loads(json.dumps(DEFAULT_SETTINGS))
            for section, values in saved.items():
                if section in merged and isinstance(values, dict):
                    merged[section].update(values)
                else:
                    merged[section] = values
            return merged
        except Exception:
            pass
    return json.loads(json.dumps(DEFAULT_SETTINGS))

def settings_save(data):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(data, f, indent=2)

# ── game metadata ─────────────────────────────────────────────────

def game_meta_get():
    if GAME_META_FILE.exists():
        try:
            with open(GAME_META_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def game_meta_save(data):
    with open(GAME_META_FILE, 'w') as f:
        json.dump(data, f, indent=2)

# ── sounds ────────────────────────────────────────────────────────

def _play(path):
    try:
        import winsound
        if path.exists():
            winsound.PlaySound(str(path), winsound.SND_FILENAME | winsound.SND_ASYNC)
        else:
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
    except Exception:
        pass

def play_sound(kind):
    s = settings_get().get('general', {})
    if kind == 'clip' and s.get('clip_save_sound', True):
        threading.Thread(target=_play, args=(SOUND_CLIP,), daemon=True).start()
    elif kind in ('rec_start', 'rec_stop') and s.get('rec_sounds', True):
        wav = SOUND_REC_START if kind == 'rec_start' else SOUND_REC_STOP
        threading.Thread(target=_play, args=(wav,), daemon=True).start()

# ── flush stale temp chunks ───────────────────────────────────────

def flush_temp_chunks():
    for f in CHUNK_DIR.glob('chunk_*.mp4'):
        try: f.unlink()
        except Exception: pass
    concat = CHUNK_DIR / '_concat.txt'
    if concat.exists():
        try: concat.unlink()
        except Exception: pass

# ── capture state ─────────────────────────────────────────────────

capture_process = None
capture_lock    = threading.Lock()

ENCODERS = {
    'h264_nvenc': ['-c:v', 'h264_nvenc', '-preset', 'p4'],
    'h264_amf':   ['-c:v', 'h264_amf'],
    'h264_sw':    ['-c:v', 'libx264', '-preset', 'fast'],
    'h265_nvenc': ['-c:v', 'hevc_nvenc', '-preset', 'p4'],
}

def build_ffmpeg_args(s):
    cap  = s['capture']
    w, h = cap['resolution'].split('x')
    enc  = ENCODERS.get(cap['encoder'], ENCODERS['h264_sw'])
    wrap = max(2, math.ceil(cap['buffer_duration'] / 5))
    chunk_pattern = str(CHUNK_DIR / 'chunk_%04d.mp4')

    return [
        str(FFMPEG),
        # video: screen capture
        '-f', 'gdigrab',
        '-framerate', str(cap['fps']),
        '-i', 'desktop',
        # audio: system audio via dshow (Stereo Mix / WASAPI loopback)
        '-f', 'dshow',
        '-i', 'audio=virtual-audio-capturer',
        '-s', f'{w}x{h}',
    ] + enc + [
        # audio codec
        '-c:a', 'aac',
        '-b:a', '192k',
        '-f', 'segment',
        '-segment_time', '5',
        '-segment_wrap', str(wrap),
        '-reset_timestamps', '1',
        '-y',
        chunk_pattern,
    ]

# ── clip metadata ─────────────────────────────────────────────────

def generate_preview(filepath):
    """Generate a thumbnail 1s into the clip. Returns URL path or None."""
    p        = Path(filepath)
    out_file = PREVIEW_DIR / f'{p.stem}.jpg'
    if out_file.exists():
        return f'/previews/{p.stem}.jpg'
    if not FFMPEG.exists():
        return None
    try:
        result = subprocess.run([
            str(FFMPEG), '-i', str(p),
            '-ss', '00:00:01', '-frames:v', '1',
            '-q:v', '3', '-y', str(out_file)
        ], capture_output=True, timeout=10)
        if out_file.exists():
            return f'/previews/{p.stem}.jpg'
    except Exception:
        pass
    return None

def probe_duration(filepath):
    """Return 'M:SS' string or None if unavailable."""
    if not FFPROBE.exists():
        return None
    try:
        result = subprocess.run(
            [str(FFPROBE), '-v', 'quiet', '-print_format', 'json',
             '-show_format', str(filepath)],
            capture_output=True, text=True, timeout=5
        )
        info = json.loads(result.stdout)
        secs = float(info['format']['duration'])
        m, s = divmod(int(secs), 60)
        return f'{m}:{s:02d}'
    except Exception:
        return None

def file_to_clip(filepath):
    p       = Path(filepath)
    stat    = p.stat()
    size_mb = stat.st_size / (1024 * 1024)
    mtime   = datetime.fromtimestamp(stat.st_mtime)
    now     = datetime.now()
    delta   = now - mtime

    if delta.days == 0:
        date_str = f'today {mtime.strftime("%H:%M")}'
    elif delta.days == 1:
        date_str = f'yesterday {mtime.strftime("%H:%M")}'
    else:
        date_str = mtime.strftime('%Y-%m-%d %H:%M')

    parts    = p.stem.split('_')
    game_key = parts[0].replace('-', ' ').title() if parts else 'Unknown'

    meta      = game_meta_get()
    game_disp = meta.get(game_key, {}).get('display_name', game_key)

    boxart_file = BOXART_DIR / f'{game_key}.jpg'
    boxart_url  = f'/boxart/{game_key}.jpg' if boxart_file.exists() else None

    preview_file = PREVIEW_DIR / f'{p.stem}.jpg'
    preview_url  = f'/previews/{p.stem}.jpg' if preview_file.exists() else None

    # kick off background preview generation if missing
    if not preview_url:
        threading.Thread(target=generate_preview, args=(p,), daemon=True).start()

    return {
        'name':     p.stem,
        'filename': p.name,
        'game':     game_disp,
        'game_key': game_key,
        'size':     f'{size_mb:.1f} MB',
        'date':     date_str,
        'dur':      probe_duration(p),   # sync probe — fast with ffprobe
        'path':     str(p),
        'boxart':   boxart_url,
        'preview':  preview_url,
    }

# ── routes ────────────────────────────────────────────────────────

@app.route('/status')
def status():
    s = settings_get()
    recording = capture_process is not None and capture_process.poll() is None
    return jsonify({
        'status':      'ok',
        'recording':   recording,
        'ffmpeg':      FFMPEG.exists(),
        'ffmpeg_path': str(FFMPEG),
        'clips_dir':   s['output']['folder'],
    })

@app.route('/settings', methods=['GET'])
def get_settings():
    return jsonify(settings_get())

@app.route('/settings', methods=['POST'])
def post_settings():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'no data'}), 400
    settings_save(data)
    return jsonify({'ok': True})

@app.route('/clips', methods=['GET'])
def list_clips():
    clips_dir = get_clips_dir()
    if not clips_dir.exists():
        return jsonify([])
    exts  = {'.mp4', '.mkv', '.mov'}
    files = sorted(
        [f for f in clips_dir.iterdir() if f.suffix.lower() in exts],
        key=lambda f: f.stat().st_mtime,
        reverse=True
    )
    return jsonify([file_to_clip(f) for f in files])

# NOTE: open-folder must come before /<filename> routes
@app.route('/clips/open-folder', methods=['POST'])
def open_clips_folder():
    clips_dir = get_clips_dir()
    clips_dir.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(['explorer', str(clips_dir)])
    return jsonify({'ok': True})

@app.route('/clips/<filename>', methods=['DELETE'])
def delete_clip(filename):
    target = get_clips_dir() / filename
    if not target.exists():
        return jsonify({'error': 'not found'}), 404
    target.unlink()
    # clean up associated preview
    stem    = Path(filename).stem
    preview = PREVIEW_DIR / f'{stem}.jpg'
    if preview.exists():
        try: preview.unlink()
        except Exception: pass
    return jsonify({'ok': True})

@app.route('/clips/<filename>/show', methods=['POST'])
def show_clip(filename):
    target = get_clips_dir() / filename
    if target.exists():
        subprocess.Popen(['explorer', '/select,', str(target)])
    return jsonify({'ok': True})

@app.route('/clips/<filename>/preview', methods=['GET'])
def get_clip_preview(filename):
    """Return or trigger preview generation for a single clip."""
    target = get_clips_dir() / filename
    if not target.exists():
        return jsonify({'error': 'not found'}), 404
    url = generate_preview(target)
    return jsonify({'preview': url})

@app.route('/previews/<filename>')
def serve_preview(filename):
    from flask import send_from_directory
    return send_from_directory(str(PREVIEW_DIR), filename)

@app.route('/capture/toggle', methods=['POST'])
def capture_toggle():
    """Toggle recording on/off — used by global shortcut and tray."""
    recording = capture_process is not None and capture_process.poll() is None
    if recording:
        return capture_stop()
    else:
        return capture_start()

@app.route('/capture/start', methods=['POST'])
def capture_start():
    global capture_process
    with capture_lock:
        if capture_process and capture_process.poll() is None:
            return jsonify({'ok': True, 'note': 'already recording'})
        if not FFMPEG.exists():
            return jsonify({'error': 'ffmpeg not found at ' + str(FFMPEG)}), 500
        args = build_ffmpeg_args(settings_get())
        capture_process = subprocess.Popen(
            args,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    play_sound('rec_start')
    return jsonify({'ok': True})

@app.route('/capture/stop', methods=['POST'])
def capture_stop():
    global capture_process
    with capture_lock:
        if capture_process and capture_process.poll() is None:
            capture_process.terminate()
            try:
                capture_process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                capture_process.kill()
            capture_process = None
    play_sound('rec_stop')
    return jsonify({'ok': True})

@app.route('/capture/clip', methods=['POST'])
def save_clip():
    s       = settings_get()
    out_dir = get_clips_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    body      = request.get_json(silent=True, force=True) or {}
    game_name = body.get('game', 'unknown')
    template  = s['output']['filename_template']
    container = s['output']['container']
    now       = datetime.now()

    name = (template
        .replace('{game}', game_name.lower().replace(' ', '-'))
        .replace('{date}', now.strftime('%Y-%m-%d'))
        .replace('{time}', now.strftime('%H-%M-%S')))

    out_file = out_dir / f'{name}.{container}'

    # Sort chunks by modification time so wrap-around order is correct.
    # Alphabetical sort breaks when the counter wraps (chunk_0000 sorts
    # before chunk_0011 even though it was written later).
    chunks = sorted(CHUNK_DIR.glob('chunk_*.mp4'), key=lambda f: f.stat().st_mtime)
    if not chunks:
        return jsonify({'error': 'no buffer chunks — is recording active?'}), 400

    concat_file = CHUNK_DIR / '_concat.txt'
    with open(concat_file, 'w') as f:
        for c in chunks:
            f.write(f"file '{c}'\n")

    result = subprocess.run(
        [str(FFMPEG),
         '-f', 'concat', '-safe', '0',
         '-i', str(concat_file),
         '-c', 'copy', '-y', str(out_file)],
        capture_output=True
    )

    if result.returncode != 0:
        return jsonify({
            'error':  'ffmpeg concat failed',
            'detail': result.stderr.decode(errors='replace')
        }), 500

    for c in chunks:
        try: c.unlink()
        except Exception: pass
    try: concat_file.unlink()
    except Exception: pass

    threading.Thread(target=generate_preview, args=(out_file,), daemon=True).start()
    play_sound('clip')
    return jsonify({'ok': True, 'file': str(out_file), 'name': name})

# ── game metadata routes ──────────────────────────────────────────

@app.route('/games/meta', methods=['GET'])
def get_game_meta():
    return jsonify(game_meta_get())

@app.route('/games/<game_key>/rename', methods=['POST'])
def rename_game(game_key):
    body     = request.get_json(silent=True) or {}
    new_name = (body.get('name') or '').strip()
    if not new_name:
        return jsonify({'error': 'name required'}), 400
    meta = game_meta_get()
    if game_key not in meta:
        meta[game_key] = {}
    meta[game_key]['display_name'] = new_name
    game_meta_save(meta)
    return jsonify({'ok': True})

@app.route('/games/<game_key>/boxart', methods=['POST'])
def upload_boxart(game_key):
    body = request.get_json(silent=True) or {}
    if 'url' in body:
        try:
            req = urllib.request.Request(body['url'], headers={'User-Agent': 'clipdat/1.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                img_data = resp.read()
        except Exception as e:
            return jsonify({'error': f'fetch failed: {e}'}), 400
    elif 'data' in body:
        raw = body['data']
        if ',' in raw:
            raw = raw.split(',', 1)[1]
        try:
            img_data = base64.b64decode(raw)
        except Exception:
            return jsonify({'error': 'invalid base64'}), 400
    else:
        return jsonify({'error': 'provide url or data'}), 400

    out = BOXART_DIR / f'{game_key}.jpg'
    out.write_bytes(img_data)

    meta = game_meta_get()
    if game_key not in meta:
        meta[game_key] = {}
    meta[game_key]['boxart'] = f'/boxart/{game_key}.jpg'
    game_meta_save(meta)
    return jsonify({'ok': True, 'path': f'/boxart/{game_key}.jpg'})

@app.route('/games/<game_key>/boxart', methods=['DELETE'])
def delete_boxart(game_key):
    out = BOXART_DIR / f'{game_key}.jpg'
    if out.exists():
        out.unlink()
    meta = game_meta_get()
    if game_key in meta:
        meta[game_key].pop('boxart', None)
        game_meta_save(meta)
    return jsonify({'ok': True})

@app.route('/boxart/<filename>')
def serve_boxart(filename):
    from flask import send_from_directory
    return send_from_directory(str(BOXART_DIR), filename)

# ── main ──────────────────────────────────────────────────────────

if __name__ == '__main__':
    print(f'FFmpeg path:  {FFMPEG}')
    print(f'FFmpeg found: {FFMPEG.exists()}')
    print(f'Clips folder: {settings_get()["output"]["folder"]}')
    print(f'Backend running on http://localhost:9847')
    app.run(port=9847, debug=False)