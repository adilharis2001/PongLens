"""How far apart two machines' ball detections are for the same upload.

    python compare_detections.py --job-id <uuid> --a mac-62295e48 --b modal-34fd8773

Reads both replays' `blurball.jsonl` from the parity prefix and reports, per
frame: how often both saw a ball, only one did, or neither; and where both
did, how far apart the positions are. This is the number that explains a
card-boundary difference downstream: the assembler reads these detections
and nothing else about the ball.
"""
from __future__ import annotations

import argparse
import json
import math
import subprocess
import tempfile

import boto3
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


def load(client, job_id: str, label: str, directory: str) -> dict:
    path = f'{directory}/{label}.jsonl'
    client.download_file('ponglens-media', f'parity/{job_id}/{label}/blurball.jsonl', path)
    frames = {}
    with open(path) as handle:
        for line in handle:
            record = json.loads(line)
            frames[int(record['f'])] = record
    return frames


def compare(a: dict, b: dict) -> dict:
    frames = sorted(set(a) | set(b))
    both = only_a = only_b = neither = 0
    distances = []
    conf_deltas = []
    for f in frames:
        ra, rb = a.get(f), b.get(f)
        seen_a = bool(ra and ra.get('x') is not None)
        seen_b = bool(rb and rb.get('x') is not None)
        if seen_a and seen_b:
            both += 1
            distances.append(math.hypot(ra['x'] - rb['x'], ra['y'] - rb['y']))
            conf_deltas.append(abs(float(ra.get('conf', 0)) - float(rb.get('conf', 0))))
        elif seen_a:
            only_a += 1
        elif seen_b:
            only_b += 1
        else:
            neither += 1
    distances.sort()
    def pct(p):
        return round(distances[min(len(distances) - 1, int(p * len(distances)))], 2) if distances else None
    return {
        'frames': len(frames),
        'both': both, 'only_a': only_a, 'only_b': only_b, 'neither': neither,
        'agree_on_presence_pct': round(100 * (both + neither) / max(1, len(frames)), 2),
        'distance_px': {'median': pct(0.5), 'p90': pct(0.9), 'p99': pct(0.99),
                        'within_2px_pct': round(100 * sum(1 for d in distances if d <= 2) / max(1, len(distances)), 1)},
        'conf_delta_mean': round(sum(conf_deltas) / max(1, len(conf_deltas)), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--job-id', required=True)
    parser.add_argument('--a', required=True)
    parser.add_argument('--b', required=True)
    args = parser.parse_args()
    client = r2()
    with tempfile.TemporaryDirectory() as directory:
        a = load(client, args.job_id, args.a, directory)
        b = load(client, args.job_id, args.b, directory)
    report = compare(a, b)
    report.update({'job_id': args.job_id, 'a': args.a, 'b': args.b})
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
