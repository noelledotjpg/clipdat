import os
import sys
import json
import subprocess
import threading
import math
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

BASE          = get_base()
FFMPEG        = BASE / 'resources' / 'ffmpeg.exe'
FFPROBE       = BASE / 'resources' / 'ffprobe.exe'
SETTINGS_FILE = BASE / 'settings.json'
CHUNK_DIR     = BASE / 'temp'
CHUNK_DIR.mkdir(exist_ok=True)

def get_clips_dir():
    return Path(settings_get()['output']['folder'])

# ── settings ──────────────────────────────────────────────────────

DEFAULT_SETTINGS = {
    'general': {
        'record_on_launch': True,
        'active_window_only': False,
        'clip_save_sound': True,
    },
    'capture': {
        'buffer_duration': 60,
        'resolution': '1920x1080',
        'fps': 60,
        'encoder': 'h264_nvenc',
    },
    'output': {
        'folder': str(Path.home() / 'Videos' / 'ClipDat'),
        'filename_template': '{game}_{date}_{time}',
        'container': 'mp4',
        'quality': 'high',
        'open_folder_after_save': False,
    },
    'hotkeys': {
        'save_clip': 'F8',
        'toggle_recording': 'F9',
        'open_browser': 'F10',
    },
    'apps': {
        'monitored': [],
        'audio_excluded': [],
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
        '-f', 'gdigrab',
        '-framerate', str(cap['fps']),
        '-i', 'desktop',
        '-s', f'{w}x{h}',
    ] + enc + [
        '-f', 'segment',
        '-segment_time', '5',
        '-segment_wrap', str(wrap),
        '-reset_timestamps', '1',
        '-y',
        chunk_pattern,
    ]

# ── clip metadata ─────────────────────────────────────────────────

def probe_duration(filepath):
    if not FFPROBE.exists():
        return '?:??'
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
        return '?:??'

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

    parts = p.stem.split('_')
    game  = parts[0].replace('-', ' ').title() if parts else 'Unknown'

    return {
        'name':     p.stem,
        'filename': p.name,
        'game':     game,
        'size':     f'{size_mb:.1f} MB',
        'date':     date_str,
        'dur':      probe_duration(p),
        'path':     str(p),
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

# NOTE: open-folder must be registered BEFORE /<filename> routes
# to prevent Flask matching "open-folder" as a filename parameter.
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
    return jsonify({'ok': True})

@app.route('/clips/<filename>/show', methods=['POST'])
def show_clip(filename):
    target = get_clips_dir() / filename
    if target.exists():
        subprocess.Popen(['explorer', '/select,', str(target)])
    return jsonify({'ok': True})

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

    chunks = sorted(CHUNK_DIR.glob('chunk_*.mp4'))
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

    return jsonify({'ok': True, 'file': str(out_file), 'name': name})

# ── main ──────────────────────────────────────────────────────────

if __name__ == '__main__':
    print(f'FFmpeg path:  {FFMPEG}')
    print(f'FFmpeg found: {FFMPEG.exists()}')
    print(f'Clips folder: {settings_get()["output"]["folder"]}')
    print(f'Backend running on http://localhost:9847')
    app.run(port=9847, debug=False)