import sys,os,json,pathlib,runpy,subprocess
sys.dont_write_bytecode=True
w=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
R=pathlib.Path('/private/tmp/ponglens-cut-followup-20260912')
if len(sys.argv)==3:
 for mid in ['fa96cd0e','50caea29','d59d7610','9e15ed10','9ef09000','19a1efc7']:
  subprocess.run([sys.executable,'-B',__file__,str(w),str(out),mid],check=True)
 reports=[json.load(open(out/(mid+'.json'))) for mid in ['fa96cd0e','50caea29','d59d7610','9e15ed10','9ef09000','19a1efc7']]
 (out/'summary.json').write_text(json.dumps(dict(matches=len(reports),cards=sum(r['cards'] for r in reports),all_exact=True),indent=2))
 sys.exit(0)
mid=sys.argv[3];r=R/mid/'full';sys.path.insert(0,str(w));import body_points as B
original=B.assemble
class Done(BaseException):pass
def capture(*args,**kw):
 cards,info=original(*args,**kw);want=json.load(open(r/'staged-result.json'))
 windows=lambda cs:[(c['t0'],c['t1']) for c in cs]
 assert windows(cards)==windows(want['candidate']),mid+' reviewed windows differ'
 assert [{k:v for k,v in c.items() if k!='t0'} for c in cards]==[{k:v for k,v in c.items() if k!='t0'} for c in want['baseline']],mid+' baseline fields differ'
 assert info['continuation_decisions']==want['baseline_info']['continuation_decisions']
 (out/(mid+'.json')).write_text(json.dumps(dict(match=mid,cards=len(cards),approved_windows_exact=True,all_other_fields_baseline=True,continuation_decisions_baseline=True,output=cards),indent=2))
 print(mid,len(cards),'cards: approved starts, baseline endings/fields/joins',flush=True)
 raise Done()
B.assemble=capture
sys.argv=[str(w/'points_pipeline.py'),'points','--video',str(r/'video.mp4'),'--blurball',str(r/'detections.jsonl'),'--outdir',str(out/(mid+'-assembly')),'--strictness','normal','--cut-mode','plays','--no-clips','--players',str(r/'players.json'),'--pipeline','bodies','--serve-anchor','--rally-end','--serve-surface-pad','.45','--serve-merge-s','2.5','--calibration-json',str(r.parent/'calibration.json')]
try:runpy.run_path(str(w/'points_pipeline.py'),run_name='__main__')
except Done:pass
assert (out/(mid+'.json')).exists(),'No body output'
