"""Build private viewing clips; label coordinates still refer to the original JPEG.

Usage: python scripts/research/prepare-active-ball-context.py MANIFEST OUTPUT
Optional --upload sends clips to PongLens's existing private research bucket.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('manifest', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--upload', action='store_true')
args = parser.parse_args()
rows = json.loads(args.manifest.read_text())
args.output.mkdir(parents=True, exist_ok=True)

def build(row):
    target = args.output / f'{row["id"]}.mp4'
    if not target.exists():
        temporary = target.with_suffix('.tmp.mp4')
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-ss', str(max(0, row['time_s'] - 1.2)), '-i', row['source_file'],
            '-t', '2.4', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-threads', '2', str(temporary)], check=True)
        temporary.replace(target)
    return row['id'], target

with ThreadPoolExecutor(max_workers=4) as pool:
    outputs = list(pool.map(build, rows))
print(json.dumps({'clips': len(outputs), 'bytes': sum(p.stat().st_size for _, p in outputs)}), flush=True)
if args.upload:
    import boto3
    def secret(name):
        return subprocess.run(['security', 'find-generic-password', '-a', 'openclaw', '-s', name, '-w'], capture_output=True, text=True, check=True).stdout.strip()
    client = boto3.client('s3', endpoint_url='https://' + secret('ponglens-r2-account') + '.r2.cloudflarestorage.com', aws_access_key_id=secret('ponglens-r2-key-id'), aws_secret_access_key=secret('ponglens-r2-secret'), region_name='auto')
    def upload(entry):
        id, path = entry
        client.upload_file(str(path), 'ponglens-media', f'research/active-ball/v1/{id}/context.mp4', ExtraArgs={'ContentType': 'video/mp4', 'CacheControl': 'private, max-age=3600'})
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(upload, outputs))
    print(json.dumps({'private_clips_uploaded': len(outputs)}))
