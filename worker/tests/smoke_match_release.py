"""Read-only media smoke for a staged release. Never starts the queue worker.

Outputs/logs are written only beneath the supplied test-state directory.
Run from the isolated checkout using an explicit content-addressed release.
"""
import argparse
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
    parser.add_argument('--mode', choices=('imports', 'pose', 'table', 'parity', 'native'), required=True)
    args = parser.parse_args()
    release = args.release.resolve(strict=True)
    state = args.state.resolve()
    _, env, cwd = prepare_run(release, state)
    report = {'release_id': verify(release)['release_id'], 'mode': args.mode}
    worker = release / 'worker'
    def run(command, name, timeout=600):
        completed = subprocess.run([str(x) for x in command], env=env, cwd=cwd,
                                   capture_output=True, text=True, timeout=timeout)
        (state / (name + '.log')).write_text(completed.stdout + '\n' + completed.stderr)
        if completed.returncode:
            raise RuntimeError(f'{name} failed with exit {completed.returncode}; inspect {state / (name + ".log")}')
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
        report['result'] = run([env['PONGLENS_WORKER_PY'], '-m', 'pytest', '-q',
            worker / 'tests/test_body_points_parity.py', worker / 'tests/test_serve_v3_parity.py'], 'parity', timeout=900)
    # A model loader must not have downloaded or rewritten a sealed asset.
    verify(release, report['release_id'])
    (state / (args.mode + '-report.json')).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
