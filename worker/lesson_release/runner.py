#!/usr/bin/env python3
"""Verify the sealed lesson payload before importing processing code."""
import argparse
import os
from pathlib import Path
import runpy
import sys

sys.dont_write_bytecode=True
PAYLOAD=Path(__file__).resolve().parent
sys.path.insert(0,str(PAYLOAD))
from package import verify, verify_runtime, load_runtime_env

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--config',type=Path)
    parser.add_argument('--cloud',action='store_true')
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--check',action='store_true',help='Verify locally, without credentials or claims')
    args=parser.parse_args()
    manifest=verify(PAYLOAD)
    if args.config:
        c=verify_runtime(args.config)
        if Path(c['payload'])!=PAYLOAD:raise ValueError('Launcher/config release mismatch')
        if Path(sys.prefix)!=Path(c['venv']):raise ValueError('Use this release\'s own virtual environment')
        os.environ.update(load_runtime_env(c.get('secrets_file')))
        runtime=Path(c['runtime'])
        binary_dir=runtime/('tools-'+PAYLOAD.parent.name)
        binary_dir.mkdir(exist_ok=True)
        for name in ('ffmpeg','ffprobe'):
            target=binary_dir/name
            if target.is_symlink():
                if target.resolve()!=Path(c[name]):raise ValueError('Pinned media-tool link changed')
            elif target.exists():raise ValueError('Unexpected media-tool launcher')
            else:target.symlink_to(c[name])
        os.environ['PATH']=str(binary_dir)+':/usr/bin:/bin'
        os.environ['LESSON_VIDEO_WORKDIR']=str(runtime/'work')
    elif not args.cloud:
        raise ValueError('Mac execution requires an installed runtime config')
    os.environ['LESSON_VIDEO_FONT']=str(PAYLOAD/'lesson-font.ttf')
    os.environ.setdefault('LESSON_VIDEO_WORKER_ID','modal' if args.cloud else 'mac')
    os.environ['PYTHONDONTWRITEBYTECODE']='1'
    if args.check:
        print(manifest['worker_release_id'])
        return
    sys.argv=[str(PAYLOAD/'lesson_video.py')]+(['--cloud'] if args.cloud else [])+(['--once'] if args.once else [])
    runpy.run_path(str(PAYLOAD/'lesson_video.py'),run_name='__main__')
if __name__=='__main__':main()
