import sys,json,pickle,pathlib,hashlib
sys.dont_write_bytecode=True
w=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(w))
import body_points as B,points_v2 as V
R=pathlib.Path('/private/tmp/ponglens-cut-followup-20260912');rows=[]
for f in sorted(R.glob('*/*/edge-inputs.pkl')):
 args,kw=pickle.load(open(f,'rb'));want=json.load(open(f.parent/'result.json'))['candidate']
 actual=V.resolve(B._guarded_anchor_and_close(*args,**kw)[0])
 assert actual==want, str(f)
 rows.append(dict(case=str(f.parent.relative_to(R)),cards=len(actual),exact=True))
old=pathlib.Path('/private/tmp/ponglens-expanded-cut-audit')
expected={x['match']:x['variants']['1.2']['cards'] for x in json.load(open(R/'development-results.json'))}
for f in sorted(old.glob('*-edge-inputs.json')):
 mid=f.name[:8]
 if mid not in expected:continue
 d=json.load(open(f));args=[d[k] for k in ['cards','serves','cross','bt_table','dead','duration']]
 actual=V.resolve(B._guarded_anchor_and_close(*args,anchor=True,close=True,bt_endline=d['bt_endline'])[0])
 assert actual==expected[mid],mid
 rows.append(dict(case=mid+'-development',cards=len(actual),exact=True))
report=dict(worker=str(w),body_points_sha256=hashlib.sha256((w/'body_points.py').read_bytes()).hexdigest(),cases=len(rows),cards=sum(x['cards'] for x in rows),rows=rows)
pathlib.Path(sys.argv[2]).write_text(json.dumps(report,indent=2));print('Exact reviewed edge parity:',len(rows),'cases,',report['cards'],'cards')
