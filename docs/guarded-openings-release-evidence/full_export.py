"""Actual packaged clips and full cut, using frozen ball/pose observations."""
import os,sys,json,time,socket,subprocess
from pathlib import Path
from types import SimpleNamespace
R=Path(__file__).parent;W=Path(os.environ['PONGLENS_MATCH_RELEASE'])/'worker'
sys.path.insert(0,str(W));sys.dont_write_bytecode=True
import points_pipeline as PP
from points_pipeline import cut_position
original_connect=socket.socket.connect
def deny(self,address):
 if self.family in (socket.AF_INET,socket.AF_INET6):raise RuntimeError('Offline export')
 return original_connect(self,address)
socket.socket.connect=deny
mid='9e15ed10';inputs=Path('/private/tmp/ponglens-cut-followup-20260912')/mid/'full';out=R/'full-export';assert not out.exists()
sys.argv=['points_pipeline.py','points','--video',str(inputs/'video.mp4'),'--blurball',str(inputs/'detections.jsonl'),'--players',str(inputs/'players.json'),'--calibration-json',str(inputs.parent/'calibration.json'),'--outdir',str(out),'--pipeline','bodies','--serve-anchor','--rally-end','--cut-mode','plays','--serve-surface-pad','.45','--serve-merge-s','2.5']
start=time.perf_counter();PP.main();points_seconds=time.perf_counter()-start
mj=out/'match.json';before=json.loads(mj.read_text());expected=json.loads((inputs/'staged-result.json').read_text())['candidate']
fps=json.loads(subprocess.check_output([os.environ['PONGLENS_FFPROBE'],'-v','error','-select_streams','v:0','-show_entries','stream=avg_frame_rate','-of','json',str(inputs/'video.mp4')]))['streams'][0]['avg_frame_rate'];a,b=map(int,fps.split('/'));fps=a/b
assert len(before['points'])==len(expected)
assert [(p['t0'],p['t1']) for p in before['points']]==[(round(int(c['t0']*fps)/fps,2),round(int(c['t1']*fps)/fps,2)) for c in expected]
assert before['pipeline']=='bodies' and before['processing']['rally_policy']['status']=='used'
start=time.perf_counter();PP.cmd_cut(SimpleNamespace(video=str(inputs/'video.mp4'),out=str(out/'cut.mp4'),segments=str(mj),blurball=str(inputs/'detections.jsonl'),strictness='normal'));cut_seconds=time.perf_counter()-start
after=json.loads(mj.read_text());assert [(p['t0'],p['t1']) for p in before['points']]==[(p['t0'],p['t1']) for p in after['points']]
def packets(path,first=False):
 cmd=[os.environ['PONGLENS_FFPROBE'],'-v','error','-select_streams','v:0']
 if first:cmd+=['-read_intervals','%+#4']
 cmd+=['-show_packets','-show_data_hash','sha256','-show_entries','packet=pts_time,data_hash','-of','json',str(path)]
 return json.loads(subprocess.check_output(cmd))['packets']
hashes={p['data_hash']:float(p['pts_time']) for p in packets(out/'cut.mp4')};errors=[]
for i,offset in enumerate(after['cut_segment_offsets']):
 sample=packets(out/f'cut.mp4.parts/part_{i:03d}.mp4',True)[1:4];assert len(sample)==3
 errors += [abs(hashes[p['data_hash']]-float(p['pts_time'])-offset) for p in sample]
assert max(errors)<.001
clip_errors=[]
for p in after['points']:
 file=out/p['clip'];assert file.is_file()
 actual=float(json.loads(subprocess.check_output([os.environ['PONGLENS_FFPROBE'],'-v','error','-show_entries','format=duration','-of','json',str(file)]))['format']['duration'])
 clip_errors.append(abs(actual-(p['clip_t1']-p['clip_t0'])))
 assert abs(p['cut_t0']-cut_position(after['cut_segments'],after['cut_segment_offsets'],p['clip_t0']))<.025
 if p['rally_end_s'] is not None:
  assert abs(p['rally_end_cut_s']-cut_position(after['cut_segments'],after['cut_segment_offsets'],p['rally_end_s']))<.025
assert max(clip_errors)<.075
report=dict(release_id=os.environ['PONGLENS_RELEASE_ID'],match=mid,points=len(after['points']),segments=len(after['cut_segments']),points_and_clips_seconds=points_seconds,cut_and_mapping_seconds=cut_seconds,approved_boundaries=True,matched_frame_payloads=len(errors),max_clock_error_s=max(errors),max_clip_duration_error_s=max(clip_errors),all_point_and_end_seeks_verified=True,limits='Cached full-duration ball and poses; actual packaged assembly, individual clips and full original-resolution cut. No production job or publication.')
(R/'full-export-result.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
