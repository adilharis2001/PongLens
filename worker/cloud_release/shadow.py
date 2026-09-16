"""Replay one already-processed upload through the sealed pipeline, without
publishing anything.

Runs inside the prepared release environment (the worker's own interpreter,
`PYTHONPATH` on the sealed `worker/`), on the Mac or in the cloud, and calls
the very functions `process_job` calls, in the same order, with the same
per-job settings read from the database: ball detection (with the table
crop when the settings ask for it), the points pass, the second detection
pass on a vision-found table, the body pass, the cut. The job row is read
and never written; the match is never touched; the outputs go to a scratch
prefix in the media bucket for comparison.

    python shadow.py --job-id <uuid> --out r2://ponglens-media/parity/<job>/<label>
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import uuid


def upload(client, bucket: str, key: str, path: str, content_type: str) -> None:
    client.upload_file(path, bucket, key, ExtraArgs={'ContentType': content_type})


def probe_summary(ffprobe: str, path: str) -> dict:
    try:
        raw = subprocess.check_output(
            [ffprobe, '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
            text=True, timeout=120)
        info = json.loads(raw)
        video = next((s for s in info['streams'] if s.get('codec_type') == 'video'), {})
        return {
            'duration_s': round(float(info['format']['duration']), 3),
            'size_bytes': int(info['format']['size']),
            'width': video.get('width'), 'height': video.get('height'),
            'r_frame_rate': video.get('r_frame_rate'),
        }
    except Exception as error:  # noqa: BLE001
        return {'error': str(error)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--out', required=True, help='r2://bucket/prefix for the outputs')
    parser.add_argument('--label', default=None)
    args = parser.parse_args()

    import psycopg2.extras
    import worker
    import processing_outcome

    timings: dict[str, float] = {}
    started = time.time()

    def mark(name: str, since: float) -> None:
        timings[name] = round(time.time() - since, 1)

    conn = worker.connect()
    worker.COST_METER.connection = None  # never meter a replay as production compute
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute('select id, user_id, kind, input_path, options, created_at from public.jobs where id = %s',
                    (args.job_id,))
        job = cur.fetchone()
    if job is None:
        raise SystemExit(f'no job {args.job_id}')
    options = job['options'] or {}
    input_path = job['input_path']
    strictness = options.get('strictness', 'normal')
    if strictness not in worker.VALID_STRICTNESS:
        strictness = 'normal'

    bucket, prefix = args.out.removeprefix('r2://').split('/', 1)
    prefix = prefix.rstrip('/')
    workdir = tempfile.mkdtemp(prefix=f'ponglens-shadow-{args.job_id[:8]}-')
    summary: dict = {
        'job_id': args.job_id,
        'kind': job['kind'],
        'label': args.label,
        'platform': platform.platform(),
        'release_id': processing_outcome.release_identity()[0],
        'mac_release_id': None,
        'strictness': strictness,
        'options': {k: options.get(k) for k in (
            'points', 'placement', 'match_id', 'trim_start_s', 'trim_end_s', 'ball_crop',
            'points_pipeline', 'reviewed_net_splits', 'combined_cuts', 'whole_clip_cleanup')},
        'out': args.out,
    }
    manifest_path = os.path.join(os.environ.get('PONGLENS_MATCH_RELEASE', ''), 'manifest.json')
    if os.path.exists(manifest_path):
        with open(manifest_path) as handle:
            manifest = json.load(handle)
        summary['mac_release_id'] = manifest.get('mac_release_id', manifest.get('release_id'))
        summary['pipeline_id'] = manifest.get('pipeline_id')
    try:
        t = time.time()
        r2_input = worker.parse_r2_path(input_path)
        if not r2_input:
            raise SystemExit('only R2-backed uploads can be replayed')
        ext = os.path.splitext(input_path)[1] or '.mp4'
        local_input = os.path.join(workdir, 'input' + ext)
        worker.r2().download_file(r2_input[0], r2_input[1], local_input)
        mark('download', t)
        summary['source'] = probe_summary(os.environ.get('PONGLENS_FFPROBE', 'ffprobe'), local_input)

        camera_offset_s = 0.0
        if options.get('match_id') is not None:
            t0 = float(options.get('trim_start_s') or 0.0)
            t1 = options.get('trim_end_s')
            if t1 is not None:
                real = worker.probe_duration_s(local_input)
                if t0 > 0.5 or (real is not None and float(t1) < real - 0.5):
                    local_input = worker.apply_trim(local_input, workdir, t0, float(t1))
                    camera_offset_s = t0
        summary['camera_offset_s'] = camera_offset_s

        body_settings = processing_outcome.configuration(options, lambda key: worker.get_config(conn, key))
        if options.get('reviewed_net_splits') is True:
            body_settings['reviewed_net_splits'] = True
        if options.get('combined_cuts') is True:
            body_settings['combined_cuts'] = True
            if options.get('whole_clip_cleanup') is True:
                body_settings['whole_clip_cleanup'] = True
        summary['body_settings'] = body_settings

        ball_crop = options.get('ball_crop')
        if ball_crop is None:
            ball_crop = worker.ball_crop_enabled(conn)
        crop_corners = options.get('ball_crop_corners')
        if not (isinstance(crop_corners, dict) and len(crop_corners) == 4
                and all(isinstance(v, (list, tuple)) and len(v) == 2 for v in crop_corners.values())):
            crop_corners = None
        attempt_key = f'shadow:{args.job_id}'
        fake_job = str(uuid.uuid4())  # progress writes go to a row that does not exist

        t = time.time()
        blurball_out = worker.detect_ball(local_input, workdir, attempt_key=attempt_key,
                                          table_crop=bool(ball_crop), corners=crop_corners)
        mark('ball', t)
        summary['ball_crop'] = worker.read_ball_crop_sidecar(workdir)

        serve_pad, serve_merge = worker.serve_motif_settings(conn)
        points_kwargs = dict(
            pipeline=body_settings['pipeline'],
            serve_anchor=body_settings['serve_anchor'],
            rally_end=body_settings['rally_end'],
            endon_fallback=worker.endon_fallback_enabled(conn),
            serve_surface_pad=serve_pad,
            serve_merge_s=serve_merge,
            placement_serve_seed=worker.placement_serve_seed_enabled(conn),
            attempt_key=attempt_key)
        summary['points_kwargs'] = {k: v for k, v in points_kwargs.items() if k != 'attempt_key'}

        t = time.time()
        outdir = worker.run_points_subprocess(
            local_input, blurball_out, workdir, options,
            detections_note=worker.detections_note_from_sidecar(worker.read_ball_crop_sidecar(workdir)),
            **points_kwargs)
        mark('points', t)
        t = time.time()
        outdir = worker.rerun_points_on_vision_crop(
            local_input, blurball_out, workdir, options,
            ball_crop=bool(ball_crop), points_kwargs=points_kwargs)
        mark('vision_second_pass', t)
        if points_kwargs.get('pipeline') == 'bodies':
            t = time.time()
            outdir = worker.run_body_points_pass(
                conn, fake_job, local_input, blurball_out, workdir, options, points_kwargs=points_kwargs)
            mark('bodies', t)
        match_json = os.path.join(outdir, 'match.json')
        with open(match_json) as handle:
            match = json.load(handle)
        segments_json = match_json if match.get('cut_segments') else None
        t = time.time()
        result = worker.run_cut(local_input, workdir, blurball_out, strictness,
                                segments_json=segments_json, attempt_key=attempt_key)
        mark('cut', t)
        summary['cut'] = probe_summary(os.environ.get('PONGLENS_FFPROBE', 'ffprobe'), result)
        summary['points'] = len(match.get('points') or [])
        summary['cut_segments'] = len(match.get('cut_segments') or [])
        summary['pipeline'] = match.get('pipeline')
        summary['calibration_ok'] = bool((match.get('calibration') or {}).get('ok'))
        summary['calibration_source'] = (match.get('calibration') or {}).get('source')
        summary['note'] = match.get('note')

        client = worker.r2()
        uploaded = []
        for name, path, content_type in (
            ('match.json', match_json, 'application/json'),
            ('calibration.json', os.path.join(outdir, 'calibration.json'), 'application/json'),
            ('ball_crop.json', os.path.join(workdir, 'ball_crop.json'), 'application/json'),
            ('blurball.jsonl', blurball_out, 'application/x-ndjson'),
            ('players.json', os.path.join(workdir, 'players.json'), 'application/json'),
        ):
            if os.path.exists(path):
                upload(client, bucket, f'{prefix}/{name}', path, content_type)
                uploaded.append(name)
        ballfirst = os.path.join(outdir + '.ballfirst', 'match.json')
        if os.path.exists(ballfirst):
            upload(client, bucket, f'{prefix}/match.ballfirst.json', ballfirst, 'application/json')
            uploaded.append('match.ballfirst.json')
        summary['uploaded'] = uploaded
        summary['timings_s'] = timings
        summary['total_s'] = round(time.time() - started, 1)
        summary['status'] = 'ok'
        summary_path = os.path.join(workdir, 'summary.json')
        with open(summary_path, 'w') as handle:
            json.dump(summary, handle, indent=2, default=str)
        upload(client, bucket, f'{prefix}/summary.json', summary_path, 'application/json')
    except Exception as error:  # noqa: BLE001
        summary['status'] = 'failed'
        summary['error'] = f'{type(error).__name__}: {error}'
        summary['timings_s'] = timings
        summary['total_s'] = round(time.time() - started, 1)
        raise
    finally:
        print('SHADOW-SUMMARY ' + json.dumps(summary, default=str), flush=True)
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == '__main__':
    main()
