import os
import sys
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

def get_ffmpeg_path():
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'resources', 'ffmpeg.exe')

FFMPEG = get_ffmpeg_path()

@app.route('/status')
def status():
    return jsonify({
        'status': 'ok',
        'recording': False,
        'ffmpeg': os.path.exists(FFMPEG)
    })

if __name__ == '__main__':
    print(f'FFmpeg path: {FFMPEG}')
    print(f'FFmpeg found: {os.path.exists(FFMPEG)}')
    print(f'Backend running on http://localhost:9847')
    app.run(port=9847, debug=False)
