#!/usr/bin/env python3
"""Re-encode user-supplied OSTs. Requires ffmpeg/ffprobe; originals stay untouched."""
import argparse
import concurrent.futures
import json
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=pathlib.Path, default=pathlib.Path('incoming-resources/ost'))
parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path('public/music/ost'))
parser.add_argument('--bitrate', choices=('64k', '80k', '96k', '112k', '128k'), default='96k',
                    help='MP3 stereo bitrate (default: 96k)')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)


def encode(path):
    info = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'quiet', '-show_format', '-of', 'json', str(path)]))
    duration = float(info['format']['duration'])
    analysis = subprocess.run([
        'ffmpeg', '-hide_banner', '-i', str(path), '-af',
        'silencedetect=noise=-50dB:d=0.15,loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json',
        '-f', 'null', '-'], capture_output=True, text=True, check=True).stderr
    measured = json.loads(analysis[analysis.rfind('{'):analysis.rfind('}') + 1])
    intervals = [(float(s), float(e)) for s, e in re.findall(
        r'silence_start: ([\d.]+).*?silence_end: ([\d.]+)', analysis, re.S)]
    start = next((e for s, e in intervals if s == 0), 0)
    end = next((s for s, e in reversed(intervals) if e >= duration - .1), duration)
    norm = ('loudnorm=I=-18:TP=-1.5:LRA=11:measured_I={input_i}:'
            'measured_TP={input_tp}:measured_LRA={input_lra}:'
            'measured_thresh={input_thresh}:offset={target_offset}:linear=true').format(**measured)
    target = args.output / path.name.lower().replace('_', '-')
    subprocess.run([
        'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(path), '-vn',
        '-af', f'atrim=start={start}:end={end},asetpts=PTS-STARTPTS,{norm}',
        '-ar', '44100', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', args.bitrate,
        '-map_metadata', '-1', '-id3v2_version', '0', str(target)], check=True)
    return {'source': path.name, 'file': target.name, 'originalBytes': path.stat().st_size,
            'bytes': target.stat().st_size, 'trimStart': start, 'trimEnd': round(duration - end, 3)}


files = sorted(args.source.glob('*.mp3'))
if not files:
    parser.error(f'No MP3 files found in {args.source}')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for report in pool.map(encode, files):
        print(json.dumps(report, ensure_ascii=False), flush=True)
