"""Measured source-to-cut clock for newly encoded match videos.

MP4 parts can be longer than their requested source windows. The concat
demuxer advances by each container's duration, not that requested window.
Keep source/card boundaries unchanged and publish the actual cut offsets.
Older match JSON without offsets retains its original mapping contract.
"""
from __future__ import annotations

import copy
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path


def segment_offsets(match):
    segments = match.get('cut_segments') or []
    offsets = match.get('cut_segment_offsets')
    if 'cut_segment_offsets' not in match:
        result, total = [], 0.0
        for a, b in segments:
            result.append(total)
            total += b-a
        return result
    if not isinstance(offsets, list) or len(offsets) != len(segments):
        raise ValueError('cut offset count differs from segment count')
    result = [float(x) for x in offsets]
    if any(not math.isfinite(x) or x < 0 for x in result):
        raise ValueError('invalid measured cut offset')
    if any(b <= a for a,b in zip(result, result[1:])):
        raise ValueError('measured cut offsets are not increasing')
    return result


def position(segments, offsets, second):
    for (a,b), offset in zip(segments, offsets):
        if second < a:
            return offset
        if second <= b:
            return offset + second-a
    return offsets[-1] + segments[-1][1]-segments[-1][0] if segments else 0.0


def _probe(path):
    result = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'format=start_time,duration:stream=start_time',
        '-of', 'json', str(path)], timeout=60))
    timing = (float(result['format']['start_time']),
              float(result['format']['duration']),
              float(result['streams'][0]['start_time']))
    if not all(math.isfinite(x) for x in timing) or timing[1] <= 0:
        raise ValueError('invalid encoded segment clock')
    return timing


def measure(parts, segments, output):
    if not parts or len(parts) != len(segments):
        raise ValueError('encoded parts differ from source segments')
    timings = [_probe(p) for p in parts]
    output_start, output_duration, video_start = _probe(output)
    # Preserve the muxer's initial audio-preroll shift as well as every
    # per-part increment. A format's start is subtracted by concat.
    first_start, _, first_video = timings[0]
    shift = video_start-first_video+first_start
    offsets, total = [], 0.0
    for start, duration, _ in timings:
        offsets.append(round(shift+total-start, 6))
        total += duration
    timeline = dict(schema=1, cut_segments=segments,
                    cut_segment_offsets=offsets,
                    cut_timing=dict(method='mp4-concat-measured-v1',
                                    duration_s=output_duration,
                                    format_start_s=output_start))
    segment_offsets(timeline)
    return timeline


def apply(match, timeline):
    if timeline.get('schema') != 1:
        raise ValueError('unsupported cut timeline schema')
    segments = timeline['cut_segments']
    offsets = segment_offsets(timeline)
    if not segments or 'cut_segment_offsets' not in timeline:
        raise ValueError('missing measured cut timeline')
    previous = match.get('cut_segments')
    if previous and previous != segments:
        raise ValueError('cut timeline belongs to different source segments')
    result = copy.deepcopy(match)
    result.update(cut_segments=segments, cut_segment_offsets=offsets,
                  cut_timing=timeline['cut_timing'])
    for point in result.get('points', []):
        point['cut_t0'] = round(position(segments, offsets, float(point['clip_t0'])), 6)
        end = point.get('rally_end_s')
        point['rally_end_cut_s'] = (
            round(position(segments, offsets, float(end)), 6) if end is not None else None)
    return result


def write_json(path, value):
    """Atomic replacement: a failed write cannot leave half a cut map."""
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=path.name+'.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as handle:
            json.dump(value, handle, indent=2, allow_nan=False)
            handle.write('\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def reconcile_file(match_path, timeline_path):
    with open(match_path) as handle:
        match = json.load(handle)
    with open(timeline_path) as handle:
        timeline = json.load(handle)
    write_json(match_path, apply(match, timeline))
