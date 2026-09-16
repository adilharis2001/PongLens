"""Compare a cloud replay of a job with what the Mac published for it.

    python compare_parity.py --job-id <uuid> [--label modal-xxxxxxxx] [--json out.json]

Reads the Mac's published match.json (from the match row) and the cloud
replay's match.json and summary.json from the parity prefix, and reports the
decisions that matter: how many points, where each point starts and ends,
the cut segments, how the table was found and where its corners are, which
assembler ran, and what the detector saw. Encoded video is never compared.

Runs on the Mac with the worker's environment (boto3, psycopg2) and the
Keychain credentials.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile

import boto3
import psycopg2
import psycopg2.extras
from botocore.config import Config


def keychain(service: str) -> str:
    return subprocess.check_output(
        ['security', 'find-generic-password', '-a', 'openclaw', '-s', service, '-w']).decode().strip()


def r2():
    return boto3.client(
        's3', endpoint_url=f"https://{keychain('ponglens-r2-account')}.r2.cloudflarestorage.com",
        aws_access_key_id=keychain('ponglens-r2-key-id'),
        aws_secret_access_key=keychain('ponglens-r2-secret'),
        region_name='auto', config=Config(retries={'max_attempts': 3}))


def fetch_json(client, uri: str, directory: str):
    bucket, key = uri.removeprefix('r2://').split('/', 1)
    path = os.path.join(directory, key.replace('/', '__'))
    client.download_file(bucket, key, path)
    with open(path) as handle:
        return json.load(handle)


def corners(match: dict) -> dict | None:
    calibration = match.get('calibration') or {}
    return calibration.get('table_corners_px') if calibration.get('ok') else None


def compare(mac: dict, cloud: dict, tolerance_s: float = 0.35, corner_px: float = 12.0) -> dict:
    report: dict = {}
    mac_points = mac.get('points') or []
    cloud_points = cloud.get('points') or []
    report['points'] = {'mac': len(mac_points), 'cloud': len(cloud_points)}
    report['pipeline'] = {'mac': mac.get('pipeline'), 'cloud': cloud.get('pipeline')}
    report['cut_segments'] = {'mac': len(mac.get('cut_segments') or []),
                              'cloud': len(cloud.get('cut_segments') or [])}
    mac_cal, cloud_cal = mac.get('calibration') or {}, cloud.get('calibration') or {}
    report['calibration'] = {
        'mac': {'ok': bool(mac_cal.get('ok')), 'source': mac_cal.get('source')},
        'cloud': {'ok': bool(cloud_cal.get('ok')), 'source': cloud_cal.get('source')},
    }
    mac_corners, cloud_corners = corners(mac), corners(cloud)
    if mac_corners and cloud_corners:
        deltas = {name: round(((mac_corners[name][0] - cloud_corners[name][0]) ** 2 +
                               (mac_corners[name][1] - cloud_corners[name][1]) ** 2) ** 0.5, 1)
                  for name in mac_corners if name in cloud_corners}
        report['corner_delta_px'] = deltas
        report['corners_within_tolerance'] = all(v <= corner_px for v in deltas.values())
    else:
        report['corner_delta_px'] = None
        report['corners_within_tolerance'] = mac_corners is None and cloud_corners is None

    # Point boundaries: match by order when counts agree; otherwise by
    # nearest start, so one extra or missing point does not shift the rest.
    matched, unmatched_mac, unmatched_cloud = [], [], list(range(len(cloud_points)))
    for i, p in enumerate(mac_points):
        best, best_delta = None, None
        for j in unmatched_cloud:
            q = cloud_points[j]
            delta = abs(float(p.get('t0', 0)) - float(q.get('t0', 0)))
            if best is None or delta < best_delta:
                best, best_delta = j, delta
        if best is not None and best_delta <= 5.0:
            unmatched_cloud.remove(best)
            q = cloud_points[best]
            matched.append({
                'mac_idx': p.get('idx', i + 1), 'cloud_idx': q.get('idx', best + 1),
                'd_t0': round(float(q.get('t0', 0)) - float(p.get('t0', 0)), 3),
                'd_t1': round(float(q.get('t1', 0)) - float(p.get('t1', 0)), 3),
                'd_serve': (round(float(q['serve_s']) - float(p['serve_s']), 3)
                            if p.get('serve_s') is not None and q.get('serve_s') is not None else None),
                'winner': (p.get('suggestion') or {}).get('winner'),
                'cloud_winner': (q.get('suggestion') or {}).get('winner'),
                'how': (p.get('suggestion') or {}).get('how'),
                'cloud_how': (q.get('suggestion') or {}).get('how'),
            })
        else:
            unmatched_mac.append(p.get('idx', i + 1))
    report['matched'] = len(matched)
    report['only_mac'] = unmatched_mac
    report['only_cloud'] = [cloud_points[j].get('idx', j + 1) for j in unmatched_cloud]
    within = [m for m in matched if abs(m['d_t0']) <= tolerance_s and abs(m['d_t1']) <= tolerance_s]
    report['boundaries_within_tolerance'] = {'count': len(within), 'of': len(matched), 'tolerance_s': tolerance_s}
    report['max_abs_d_t0'] = max((abs(m['d_t0']) for m in matched), default=0.0)
    report['max_abs_d_t1'] = max((abs(m['d_t1']) for m in matched), default=0.0)
    report['winner_agreement'] = {
        'same': sum(1 for m in matched if m['winner'] == m['cloud_winner']),
        'of': len(matched),
    }
    report['how_agreement'] = {
        'same': sum(1 for m in matched if m['how'] == m['cloud_how']),
        'of': len(matched),
    }
    report['worst_points'] = sorted(matched, key=lambda m: -max(abs(m['d_t0']), abs(m['d_t1'])))[:5]
    report['notes'] = {'mac': mac.get('notes'), 'cloud': cloud.get('notes')}
    report['source'] = {'mac': mac.get('source'), 'cloud': cloud.get('source')}
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--label', default=None, help='parity label; default: the newest one under the job')
    parser.add_argument('--json', default=None, help='write the full report here')
    args = parser.parse_args()

    conn = psycopg2.connect(keychain('ponglens-db-url'))
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "select j.id, j.options->>'match_id' as match_id, m.match_json_path, m.status, "
            "j.source_duration_s from public.jobs j "
            "left join public.matches m on m.id = (j.options->>'match_id')::uuid where j.id = %s",
            (args.job_id,))
        row = cur.fetchone()
    if not row or not row['match_json_path']:
        raise SystemExit('no published match.json for that job')

    client = r2()
    label = args.label
    if not label:
        listing = client.list_objects_v2(Bucket='ponglens-media', Prefix=f'parity/{args.job_id}/', Delimiter='/')
        prefixes = [p['Prefix'].rstrip('/').rsplit('/', 1)[-1] for p in listing.get('CommonPrefixes', [])]
        if not prefixes:
            raise SystemExit('no cloud replay found for that job')
        label = sorted(prefixes)[-1]
    with tempfile.TemporaryDirectory() as directory:
        mac = fetch_json(client, row['match_json_path'], directory)
        cloud = fetch_json(client, f'r2://ponglens-media/parity/{args.job_id}/{label}/match.json', directory)
        try:
            summary = fetch_json(client, f'r2://ponglens-media/parity/{args.job_id}/{label}/summary.json', directory)
        except Exception:  # noqa: BLE001
            summary = {}
    report = compare(mac, cloud)
    report['job_id'] = args.job_id
    report['match_id'] = row['match_id']
    report['label'] = label
    report['cloud_timings_s'] = summary.get('timings_s')
    report['cloud_total_s'] = summary.get('total_s')
    report['source_duration_s'] = row['source_duration_s']

    print(f"job {args.job_id}  match {row['match_id']}  replay {label}")
    print(f"  points        mac {report['points']['mac']:>4}   cloud {report['points']['cloud']:>4}   "
          f"matched {report['matched']}  only-mac {report['only_mac']}  only-cloud {report['only_cloud']}")
    b = report['boundaries_within_tolerance']
    print(f"  boundaries    {b['count']}/{b['of']} within ±{b['tolerance_s']}s   "
          f"max |Δstart| {report['max_abs_d_t0']:.2f}s  max |Δend| {report['max_abs_d_t1']:.2f}s")
    print(f"  winner/how    {report['winner_agreement']['same']}/{report['winner_agreement']['of']} same winner, "
          f"{report['how_agreement']['same']}/{report['how_agreement']['of']} same reason")
    print(f"  cut segments  mac {report['cut_segments']['mac']}   cloud {report['cut_segments']['cloud']}")
    c = report['calibration']
    print(f"  table         mac {c['mac']['source']} ok={c['mac']['ok']}   cloud {c['cloud']['source']} ok={c['cloud']['ok']}   "
          f"corners within 12px: {report['corners_within_tolerance']}  {report['corner_delta_px']}")
    print(f"  pipeline      mac {report['pipeline']['mac']}   cloud {report['pipeline']['cloud']}")
    if summary:
        print(f"  cloud time    {summary.get('total_s')}s  stages {summary.get('timings_s')}")
    if args.json:
        with open(args.json, 'w') as handle:
            json.dump(report, handle, indent=2, default=str)
        print(f"  report        {args.json}")


if __name__ == '__main__':
    main()
