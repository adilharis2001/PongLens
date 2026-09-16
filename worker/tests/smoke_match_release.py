"""Read-only media smoke for a staged release. Never starts the queue worker.

Outputs/logs are written only beneath the supplied test-state directory.
Run from the isolated checkout using an explicit content-addressed release.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from worker.match_release import prepare_run, verify  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--video', type=Path, required=True)
    parser.add_argument('--mode', choices=('imports', 'pose', 'table', 'side-changes', 'ball', 'parity', 'native'), required=True)
    args = parser.parse_args()
    release = args.release.resolve(strict=True)
    state = args.state.resolve()
    _, env, cwd = prepare_run(release, state)
    report = {'release_id': verify(release)['release_id'], 'mode': args.mode}
    worker = release / 'worker'
    def run(command, name, timeout=600):
        command = [str(x) for x in command]
        if name in ('pose', 'table', 'side-changes', 'ball'):
            # Exercise real native models with HTTP/TCP denied, not a warm
            # download cache or a mocked inference engine. Unix sockets used
            # by macOS accelerators remain available.
            offline = """import socket,runpy,sys
original_connect=socket.socket.connect
original_connect_ex=socket.socket.connect_ex
def connect(self,address):
    if self.family in (socket.AF_INET,socket.AF_INET6):
        raise RuntimeError('Model smoke forbids network access')
    return original_connect(self,address)
def connect_ex(self,address):
    if self.family in (socket.AF_INET,socket.AF_INET6):
        raise RuntimeError('Model smoke forbids network access')
    return original_connect_ex(self,address)
socket.socket.connect=connect
socket.socket.connect_ex=connect_ex
sys.argv=sys.argv[1:]
runpy.run_path(sys.argv[0],run_name='__main__')
"""
            command = [command[0], '-c', offline, *command[1:]]
        completed = subprocess.run(command, env=env, cwd=cwd,
                                   capture_output=True, text=True, timeout=timeout)
        (state / (name + '.log')).write_text(completed.stdout + '\n' + completed.stderr)
        if completed.returncode:
            raise RuntimeError(f'{name} failed with exit {completed.returncode}; inspect {state / (name + ".log")}')
        if 'Downloading:' in completed.stdout + completed.stderr:
            raise RuntimeError(f'{name} attempted to download a model')
        return completed.stdout
    if args.mode == 'imports':
        code = """import os,runpy
m=runpy.run_path(os.path.join(os.environ['PONGLENS_MATCH_RELEASE'],'worker','worker.py'))
assert m['VENV_PY']==os.environ['PONGLENS_PIPELINE_PY']
assert m['BLURBALL_INFER']==os.environ['PONGLENS_BLURBALL_INFER']
assert m['YTDLP']==os.environ['PONGLENS_YTDLP']
assert m['_code_version']()=='release '+os.environ['PONGLENS_RELEASE_ID']
print('Worker imported without running main; fixed source/interpreter/media identity verified')
"""
        report['result'] = run([env['PONGLENS_WORKER_PY'], '-c', code], 'imports').strip()
    elif args.mode == 'pose':
        meta = json.loads(run([env['PONGLENS_FFPROBE'], '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height', '-of', 'json', args.video], 'video'))['streams'][0]
        w, h = meta['width'], meta['height']
        corners = {'A_near_1': [w*.25,h*.8], 'B_near_2': [w*.75,h*.8],
                   'C_far_2': [w*.6,h*.4], 'D_far_1': [w*.4,h*.4]}
        output = state / 'players.json'
        run([env['PONGLENS_RTMPOSE_PY'], worker / 'extract_players_rtmpose.py',
            '--video', args.video, '--output', output, '--rect', f'0,0,{w},{h}',
            '--corners', json.dumps(corners), '--model', env['PONGLENS_RTMPOSE_MODEL'],
            '--det-model', env['PONGLENS_RTMPOSE_DET_MODEL'], '--device', 'coreml',
            '--sample-fps', '10', '--end', '2'], 'pose')
        data = json.loads(output.read_text())
        assert len(data['frames']) >= 10
        assert any(frame.get('near') or frame.get('far') for frame in data['frames'])
        report['samples'] = len(data['frames'])
        report['provider'] = data.get('provider')
    elif args.mode == 'table':
        output = state / 'table.json'
        run([env['PONGLENS_TABLE_KEYPOINT_PY'], worker / 'table_keypoints.py',
             '--video', args.video, '--out', output], 'table')
        report['result'] = json.loads(output.read_text())
        assert report['result'].get('ok'), report['result']
        assert report['result'].get('frames_sampled') == 16, report['result']
    elif args.mode == 'side-changes':
        meta = json.loads(run([env['PONGLENS_FFPROBE'], '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height', '-of', 'json', args.video], 'video'))['streams'][0]
        w, h = meta['width'], meta['height']
        clips = state / 'side-change-clips'
        clips.mkdir(exist_ok=True)
        for idx, start in ((1, 0), (2, 2)):
            run([env['PONGLENS_FFMPEG'], '-v', 'error', '-y', '-ss', str(start), '-i', args.video,
                 '-t', '2', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24',
                 clips / f'point-{idx:03d}.mp4'], f'clip-{idx}')
        match = {'width': w, 'height': h, 'calibration': {'ok': True, 'width': w, 'height': h,
                 'table_corners_px': {'A_near_1': [w*.25,h*.8], 'B_near_2': [w*.75,h*.8],
                                      'C_far_2': [w*.6,h*.4], 'D_far_1': [w*.4,h*.4]}},
                 'points': [{'idx': idx, 't0': start, 't1': start+2, 'cut_t0': 0}
                            for idx, start in ((1, 0), (2, 2))]}
        source = state / 'side-change-match.json'
        source.write_text(json.dumps(match))
        output = state / 'side-changes.json'
        # Deliberately omit --det-model, exactly as production does. This was
        # the missed default path that downloaded into the old release.
        run([env['PONGLENS_RTMPOSE_PY'], worker / 'extract_side_changes_rtmpose.py',
             '--clips-dir', clips, '--match-json', source, '--output', output,
             '--model', env['PONGLENS_RTMPOSE_MODEL'], '--backend', env['PONGLENS_RTMPOSE_BACKEND'],
             '--device', env['PONGLENS_RTMPOSE_DEVICE']], 'side-changes')
        result = json.loads(output.read_text())
        assert result['compute']['frames_decoded'] == 14, result['compute']
        assert result['coverage']['total'] == 2
        detector_sha = hashlib.sha256(Path(env['PONGLENS_RTMPOSE_DET_MODEL']).read_bytes()).hexdigest()
        assert result['model']['det_checkpoint_sha256'] == detector_sha
        report['result'] = {key: result[key] for key in ('status', 'model', 'coverage', 'compute')}
    elif args.mode == 'ball':
        output = state / 'ball.jsonl'
        run([env['PONGLENS_PIPELINE_PY'], env['PONGLENS_BLURBALL_INFER'], '--video', args.video,
             '--out', output, '--device', 'mps', '--max-frames', '12'], 'ball')
        records = [json.loads(line) for line in output.read_text().splitlines() if line.strip()]
        assert records, 'Ball model produced no frame records'
        report['frames'] = len(records)
    elif args.mode == 'native':
        manifest = verify(release)
        roots = [Path(root).resolve() for entry in manifest['runtime'].values() for root in entry['roots']]
        modules = {'worker': 'numpy,psycopg2', 'pipeline': 'numpy,cv2,torch,scipy.linalg',
                   'rtmpose': 'numpy,cv2,onnxruntime', 'table': 'numpy,cv2,torch'}
        report['interpreters'] = {}
        for runtime, imports in modules.items():
            code = ('import ctypes,json\nimport ' + imports + '\n'
                'dyld=ctypes.CDLL(None)\n'
                'dyld._dyld_image_count.restype=ctypes.c_uint32\n'
                'dyld._dyld_get_image_name.argtypes=[ctypes.c_uint32]\n'
                'dyld._dyld_get_image_name.restype=ctypes.c_char_p\n'
                'print(json.dumps([dyld._dyld_get_image_name(i).decode() for i in range(dyld._dyld_image_count())]))\n')
            paths = json.loads(run([manifest['runtime'][runtime]['executable'], '-c', code], 'native-' + runtime))
            external = [Path(p).resolve() for p in paths if not p.startswith(('/System/', '/usr/lib/'))]
            unanchored = [str(p) for p in external if not any(p == root or root in p.parents for root in roots)]
            assert not unanchored, unanchored
            report['interpreters'][runtime] = {'loaded_images': len(paths), 'checked_external_images': len(external)}
    else:
        report['result'] = run([env['PONGLENS_WORKER_PY'], '-m', 'pytest',
            '-p', 'no:cacheprovider', '-q',
            worker / 'tests/test_body_points_parity.py', worker / 'tests/test_serve_v3_parity.py'], 'parity', timeout=900)
    # A model loader must not have downloaded or rewritten a sealed asset.
    verify(release, report['release_id'])
    (state / (args.mode + '-report.json')).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
