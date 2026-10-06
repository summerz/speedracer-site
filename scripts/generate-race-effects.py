#!/usr/bin/env python3
"""Generate bounded SFX through the installed Agent Audio MCP (no license acceptance).

Run with Agent Audio's dedicated Python. Originals stay in ignored incoming-resources;
only trimmed MP3s and provenance enter the game. Existing WAVs are never overwritten.
"""
import asyncio
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import array
import math
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]
ORIGINALS = ROOT / 'incoming-resources/agent-audio'
DEST = ROOT / 'src/assets/audio/agent-audio'
REVISED_CUES = {'start', 'boost-full', 'off-track', 'warning-up', 'warning-down', 'lap', 'final-lap'}
LATEST_CUES = {'boost-full', 'electric-impact', 'finish'}


def source_revision(name):
    return 3 if name in LATEST_CUES else 2 if name in REVISED_CUES else 1


SPECS = [
    ('impact', .65, 'A single violent futuristic drone collision, close dry heavy metal chassis crunch and bass thud, sharp immediate attack, brief gritty debris decay, isolated one shot.'),
    ('electric-impact', .48, 'A single quick contact with a futuristic energy barrier, sharp thin electrical snap immediately followed by a smooth bright sizzling discharge and short airy tail. Lightweight electronic shock, dry close sound, crisp rather than gritty, no bass thud, no metal crunch, no explosion, no heavy distortion, no alarm.'),
    ('off-track', .5, 'A hovering racing drone briefly brushing a magnetic track boundary, smooth airy friction swish and soft elastic electronic buzz bending downward, light contact sliding past, close dry sound, no crash, no explosion, no debris, no heavy impact.'),
    ('boost-on', .6, 'A single futuristic jet booster igniting, sudden airy pressure whoosh rising rapidly in pitch, tight bass attack and short rush of air, isolated one shot.'),
    ('boost-stage2', .7, 'A single powerful science fiction warp acceleration, deep pressure slam immediately followed by a fast bright air tearing sweep upward, short dry tail, isolated one shot.'),
    ('boost-full', .72, 'One single bright crystalline chime strike for a futuristic energy battery fully charged, very high sparkling glass timbre, a clear sustained ding dissolving into tiny shimmering overtones, soft rounded attack and gently fading tail. One hit only, one continuous pitch, no second note, no ascending sequence, no radar bleep, no alarm, no bass.'),
    ('boost-complete', .65, 'A quick sequence of three warm rounded electronic plucks rising in pitch, compact triumphant reward confirmation, immediate notes and short dry decay.'),
    ('warning-up', .38, 'A single short precise digital radar bleep, clean bright rounded square wave pulse at a steady high pitch, compact retro futuristic computer interface signal, dry and immediate, no flute, no whistle, no glissando, no buzzing alarm.'),
    ('warning-down', .38, 'A single short precise digital computer bleep, smooth rounded pulse wave at a steady middle high pitch, compact retro futuristic interface signal, dry and immediate, soft edges, no flute, no whistle, no growl, no glissando, no buzzing alarm.'),
    ('height', .18, 'A single tiny precise futuristic servo click with a soft electronic tick, light and dry, very brief tactile switch sound, immediate attack.'),
    ('countdown', .22, 'A single tight low digital radar blip, pure focused electronic pulse, immediate attack and very brief dry decay, race countdown signal.'),
    ('start', .45, 'A single clear bright high digital race GO signal, focused tuned electronic ping with a crisp quick attack and a short sparkling tail, confident arcade launch cue, immediately audible, no turbine, no horn, no bass swell, no fanfare.'),
    ('lap', .65, 'A single light clean tuned electronic synth pluck, bright rounded mallet attack and short clear ringing decay at a steady pitch, nimble futuristic arcade notification timbre, no brass, no horn, no chord, no fanfare.'),
    ('final-lap', .75, 'A single bright tuned digital synth pluck, crisp sparkling electronic mallet attack and short clear ringing decay at a steady pitch, energetic futuristic arcade notification timbre, no brass, no horn, no chord, no fanfare.'),
    ('finish', 1.1, 'A single restrained futuristic analog synthesizer minor chord for the end of a neon drone race, dark warm minor triad with a luminous upper octave, rounded clean attack immediately audible, subtle stereo-like shimmering resonance and smooth decaying tail. Cinematic understated completion, close electronic sound, no triumphant fanfare, no brass, no cute jingle, no melody run, no drums, no bass impact.'),
    ('thunder', 2.5, 'A single nearby thunder crack followed immediately by deep broad rolling thunder rumble, dark rainy city ambience, natural powerful low frequency texture, isolated thunder clap.'),
]


def encode(name, maximum):
    originals = ORIGINALS / f'race-sfx-v{source_revision(name)}'
    source = originals / f'{name}.wav'
    # Decode uniformly; choose the first meaningful attack using 5 ms energy windows.
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source),
                                  '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'])
    values = array.array('f', raw)
    if sys.byteorder != 'little':
        values.byteswap()
    assert values and all(math.isfinite(v) for v in values), name
    peak = max(abs(v) for v in values)
    assert peak > .001, f'{name}: silent source'
    window = 220
    energies = [math.sqrt(sum(v*v for v in values[i:i+window]) / len(values[i:i+window]))
                for i in range(0, len(values), window)]
    threshold = max(energies) * .12
    onset = max(0, next(i for i, e in enumerate(energies) if e >= threshold) * window / 44100 - .005)
    # Normalize the retained event, not an unrelated later peak in the 3-second source.
    peak = max(abs(v) for v in values[int(onset*44100):int((onset+maximum)*44100)])
    target = originals / f'{name}-encoded.mp3'
    edit = 'onset trim, peak normalization, 3 ms attack / 40 ms tail fades'
    filters = ['-af', f'atrim=start={onset}:duration={maximum},asetpts=PTS-STARTPTS,'
               f'volume={.72/peak},afade=t=in:d=0.003,afade=t=out:st={maximum-.04}:d=0.04']
    if name in ('warning-up', 'warning-down'):
        # Reuse the generated timbre at two pitches so the direction cannot be lost
        # when trimming a longer model phrase. Both pulses remain model audio.
        ratio = 1.5 if name == 'warning-up' else .75
        peak = max(abs(v) for v in values[int(onset*44100):int((onset+.17)*44100)])
        filters = ['-filter_complex',
                   f'[0:a]atrim=start={onset}:duration=0.17,asetpts=PTS-STARTPTS,volume={.68/peak},asplit[a][b];'
                   '[a]atrim=duration=0.13,afade=t=in:d=0.003,afade=t=out:st=0.09:d=0.04[a1];'
                   f'[b]asetrate={44100*ratio},aresample=44100,atrim=duration=0.13,'
                   'afade=t=in:d=0.003,afade=t=out:st=0.09:d=0.04,adelay=180:all=1[b1];'
                   '[a1][b1]amix=inputs=2:normalize=0,apad=whole_dur=0.38[out]', '-map', '[out]']
        edit = f'generated timbre, two 130 ms pulses / 50 ms gap, second pitch x{ratio}, fades'
    elif name in ('lap', 'final-lap'):
        # Build an audible rising motif from the generated pluck, rather than
        # truncating whatever melody happened to occupy a longer source phrase.
        ratios = [1, 2**(4/12), 1.5]
        if name == 'final-lap':
            ratios.append(2)
        pulse = .16
        spacing = .18
        retained = max(.35, pulse * max(ratios))
        peak = max(abs(v) for v in values[int(onset*44100):int((onset+retained)*44100)])
        splits = ''.join(f'[p{i}]' for i in range(len(ratios)))
        graph = [f'[0:a]atrim=start={onset}:duration={retained},asetpts=PTS-STARTPTS,'
                 f'volume={.68/peak},asplit={len(ratios)}{splits}']
        for i, ratio in enumerate(ratios):
            graph.append(f'[p{i}]asetrate={44100*ratio},aresample=44100,atrim=duration={pulse},'
                         f'afade=t=in:d=0.003,afade=t=out:st={pulse-.04}:d=0.04,'
                         f'adelay={round(i*spacing*1000)}:all=1[n{i}]')
        graph.append(''.join(f'[n{i}]' for i in range(len(ratios))) +
                     f'amix=inputs={len(ratios)}:normalize=0,apad=whole_dur={maximum}[out]')
        filters = ['-filter_complex', ';'.join(graph), '-map', '[out]']
        edit = f'generated pluck, rising pitch ratios {ratios}, {pulse}s notes / {spacing}s spacing, fades'
    elif name in LATEST_CUES:
        # Preserve the generated gesture: charge is a single ringing strike,
        # barrier contact a short discharge, finish a sustained synth chord.
        low, high, tail = {'boost-full': (1300, 12000, .16),
                           'electric-impact': (500, 7500, .09),
                           'finish': (160, 8500, .22)}[name]
        filters = ['-af', f'atrim=start={onset}:duration={maximum},asetpts=PTS-STARTPTS,'
                   f'highpass=f={low},lowpass=f={high},volume={.65/peak},'
                   f'afade=t=in:d=0.004,afade=t=out:st={maximum-tail}:d={tail}']
        edit = f'single generated gesture, onset trim, {low}-{high} Hz band, peak gain, 4 ms attack / {tail}s tail fade'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), *filters,
                    '-t', str(maximum), '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k',
                    '-map_metadata', '-1', str(target)], check=True, timeout=20)
    decoded = array.array('f', subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'f32le', '-']))
    if sys.byteorder != 'little':
        decoded.byteswap()
    assert decoded and all(math.isfinite(v) for v in decoded), name
    final_peak = max(abs(v) for v in decoded)
    rms = math.sqrt(sum(v*v for v in decoded) / len(decoded))
    assert .001 < rms and final_peak < .99, f'{name}: silence/clipping'
    # Keep the playable asset intact if encoding or validation fails.
    target = target.replace(DEST / f'{name}.mp3')
    return {'file': target.name, 'sourcePath': str(source.relative_to(ROOT)),
            'sourceRevision': source_revision(name),
            'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size,
            'durationSeconds': len(decoded)/44100, 'sourceTrimStartSeconds': onset,
            'sampleRate': 44100, 'channels': 1, 'peak': final_peak, 'rms': rms, 'edit': edit}


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cues', nargs='+', choices=[spec[0] for spec in SPECS],
                        help='Replace only these cues, preserving other manifest entries.')
    args = parser.parse_args()
    log_dir = ORIGINALS / 'race-sfx-v3'
    log_dir.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    runtime = Path(os.environ.get('AGENT_AUDIO_REPO', Path.home()/'.local/share/agent-audio'))
    env = {**os.environ, 'AGENT_AUDIO_HOME': os.environ.get('AGENT_AUDIO_HOME', str(Path.home()/'.agent-audio'))}
    params = StdioServerParameters(command=str(runtime/'.venv/bin/python'), args=['-I', '-m', 'agent_audio.mcp_server'], env=env)
    manifest_path = DEST / 'manifest.json'
    records = {e['cue']: e for e in json.loads(manifest_path.read_text())['effects']} if manifest_path.exists() else {}
    with (log_dir/'mcp-stderr.log').open('a') as errors:
        async with stdio_client(params, errlog=errors) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                status = await session.call_tool('audio_status', {})
                (log_dir/'status.json').write_text(status.model_dump_json(indent=2))
                if status.isError:
                    raise RuntimeError('Agent Audio runtime unavailable; see status.json')
                for name, maximum, description in SPECS:
                    if args.cues and name not in args.cues:
                        continue
                    originals = ORIGINALS / f'race-sfx-v{source_revision(name)}'
                    originals.mkdir(parents=True, exist_ok=True)
                    source = originals/f'{name}.wav'
                    prompt = description + ' No voice, no background music, no repeated loop. The sound starts immediately.'
                    if not source.exists():
                        result = await session.call_tool('generate_audio', {'prompt': prompt, 'seconds': 3, 'output_path': str(source)})
                        (originals/f'{name}-mcp.json').write_text(result.model_dump_json(indent=2))
                        if result.isError or not source.is_file():
                            raise RuntimeError(f'Generation failed for {name}; no synthesized substitution')
                    record = {'cue': name, 'prompt': prompt, **encode(name, maximum)}
                    records[name] = record
                    print(f'{name}: {record["durationSeconds"]:.2f}s / {record["bytes"]} bytes / peak {record["peak"]:.3f}', flush=True)
    manifest = {'version': 3, 'generator': 'Agent Audio 0.1.0, standalone Python MCP SDK stdio client',
                'model': 'Stable Audio 3 Medium / official MLX runtime',
                'modelRevision': 'da6edc54ddba10bfd79a077102ded687f80e882b',
                'format': 'MP3, mono, 44.1 kHz, 96 kbps', 'listeningVerified': False,
                'licenseAcceptancePerformed': False,
                'effects': [records[name] for name, *_ in SPECS if name in records]}
    temporary = manifest_path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(manifest, indent=2)+'\n')
    temporary.replace(manifest_path)


if __name__ == '__main__':
    asyncio.run(main())
