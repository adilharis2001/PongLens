"""Compare integrated source with frozen owner-reviewed outputs; no worker/DB."""
import argparse,sys,json,time,socket
from pathlib import Path
from types import SimpleNamespace
import numpy as np

ap=argparse.ArgumentParser();ap.add_argument('--worker',required=True);ap.add_argument('--out',required=True)
args=ap.parse_args();W=Path(args.worker);OUT=Path(args.out);OUT.mkdir(exist_ok=False)
sys.dont_write_bytecode=True;sys.path.insert(0,str(W));import body_points as BP
def deny(*a,**k):raise RuntimeError('offline validation forbids network')
socket.socket.connect=deny
ARCH=Path('/Users/adil/Desktop/Projects/PongLens/docs/research/2026-09-11-rally-preserving-worker/table-supported-continuation-2026-09-12')
STORE=Path('/Users/adil/ponglens-models/body-poses');read=lambda p:json.loads(p.read_text())
fixture=read(W/'serve_v3/fixture.json')['matches'];model=BP.load_model();results=[]
for path in sorted((ARCH/'records').glob('*.json')):
    short=path.stem;expected=read(path)['candidate_cards']
    if short=='8cb54f9f':
        b=read(Path('/private/tmp/ponglens-rally-search-ycRx83/evidence.json'))
        players=read(Path('/private/tmp/brianlab/work/players.json'))
        evidence=SimpleNamespace(cross=np.asarray(b['cross']),bt_table=np.asarray(b['bt_table']),bt_endline=np.asarray(b['bt_endline']),serves=b['serves'])
        corners,duration,first=b['quad'],b['duration'],None
        serves,dead=b['edges']['serves'],b['edges']['dead']
    else:
        b=read(STORE/short/'ball.json');players=read(STORE/short/'players.json')
        evidence=SimpleNamespace(cross=np.asarray(b['crossings']),bt_table=np.asarray(b['bt_table']),serves=b['serves'])
        corners,duration,first=b['corners'],b['duration'],b.get('first_ball_t0')
        serves,dead=fixture[short]['serves'],fixture[short]['dead']
    start=time.perf_counter()
    cards,info=BP.assemble(players,corners,evidence,duration,first_ball_t0=first,model=model,v3_serves=serves,v3_dead=dead,anchor=True,close=True)
    actual=[(c['t0'],c['t1']) for c in cards];want=[(c['t0'],c['t1']) for c in expected]
    baseline=json.loads((Path('/private/tmp/ponglens-rally-release-checks-gwWyGB/sealed-corpus')/(short+'.json')).read_text())
    assert len(cards)==len(baseline['cards'])
    assert [{k:v for k,v in c.items() if k!='t0'} for c in cards]==[{k:v for k,v in c.items() if k!='t0'} for c in baseline['cards']]
    assert info['continuation_decisions']==baseline['info']['continuation_decisions']
    assert all(c['t0']>=b['t0'] for c,b in zip(cards,baseline['cards']))
    result=dict(recording=short,cards=len(cards),exactly_matches_frozen=actual==want,seconds=time.perf_counter()-start,policy=info['rally_policy'])
    results.append(result);print(json.dumps(result),flush=True)
    (OUT/(short+'.json')).write_text(json.dumps(dict(cards=cards,info=info),indent=2))
    assert [x[1] for x in actual]==[x[1] for x in want],short
(OUT/'results.json').write_text(json.dumps(results,indent=2))
