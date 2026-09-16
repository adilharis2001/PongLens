import json,re
from pathlib import Path
V=Path('/Users/adil/.codex/visualizations/2026/09/12/01a095f4-f9a4-70b3-9ba8-50ac2967d965')
old=V/'ponglens-combined-cuts-review';out=V/'ponglens-combined-worker-review';out.mkdir(exist_ok=True)
D=json.loads((old/'data.js').read_text().split('=',1)[1].rstrip(';\n'));O=Path(__file__).parent
cases=[]
for key in ['8cb54f9f-51','50caea29-59','9e15ed10-61']:
 c=next(c.copy() for c in D['cases'] if c['id']==key)
 points=json.loads((O/'pipeline'/c['source']/'on/match.json').read_text())['points']
 expected=c['candidate'][1];p=min(points,key=lambda p:abs(p['t0']-expected[0])+abs(p['t1']-expected[1]))
 assert max(abs(p[k]-expected[i]) for i,k in enumerate(['t0','t1']))<.04
 c.update(id=key+'-corrected',baseline=c['candidate'],baseline_play=c['candidate_play'],candidate=[[p['t0'],p['t1']]],candidate_play=[[p['clip_t0'],p['clip_t1']]],next_review=True,featured=True,
          summary='Preparation clip removed · point retained',review_prompt='You marked the first clip as preparation only. This version keeps the point you liked.',
          media='../ponglens-combined-cuts-review/'+c['media'],poster='../ponglens-combined-cuts-review/'+c['poster'])
 cases.append(c)
counts=[]
for row in D['counts']:
 row=row.copy();source=next(c['source'] for c in D['cases'] if c['name']==row['name'])
 row['after']=len(json.loads((O/'pipeline'/source/'on/match.json').read_text())['points']);counts.append(row)
new=dict(D,cases=cases,counts=counts,experiment='combined-worker-v1',snapshot='2026-09-14-worker-export',next_review=[c['id'] for c in cases])
(out/'data.js').write_text('const DATA='+json.dumps(new,separators=(',',':'))+';\n')
css=re.search(r'<style>(.*?)</style>',(old/'index.html').read_text(),re.S)[1]
html='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PongLens corrected clips</title><style>'''+css+'''</style></head><body><main><div class="eyebrow">Local worker candidate · 14 September 2026</div><h1>Three corrected clips</h1><p>The three preparation-only clips you flagged are removed, and the points you liked are retained. These clips now use the worker's exported timings; the rest of the reviewed cuts remain the same apart from rounding to video frames. Play “Updated clip” for each example and mark whether it looks good.</p><div class="stats"><div class="stat"><strong>107 → 133</strong><span>Cards across your two Julian matches</span></div><div class="stat"><strong>9 recordings</strong><span>Replayed through the worker with the change on and off</span></div></div><div id="groups" hidden><button data-group="next" class="active">Corrections</button></div><div class="toolbar"><label>Match <select id="match-filter"><option value="all">All three examples</option></select></label><button id="download">Download feedback</button><span id="count" class="sub"></span></div><div id="cases" class="grid"></div><details><summary>Card counts across the nine recordings</summary><div class="tablewrap"><table id="results-table"><thead><tr><th>Recording</th><th>Current worker</th><th>New worker candidate</th></tr></thead><tbody></tbody></table></div></details><div class="footer">This candidate is not deployed. Your earlier answers are preserved on the <a href="../ponglens-combined-cuts-review/">previous review page</a>; answers here save separately.<br><a href="evidence/verification.json">Worker checks</a></div></main><script src="data.js?v=1"></script><script src="review.js?v=1"></script></body></html>'''
(out/'index.html').write_text(html)
s=(old/'review.js').read_text().replace("const KEY='ponglens-combined-cuts-review-v1'","const KEY='ponglens-combined-worker-review-v1'")
s=s.replace('for(const m of DATA.counts)',"for(const m of DATA.counts.filter(m=>DATA.cases.some(c=>c.name===m.name)))")
s=s.replace('▶ Proposed cuts','▶ Updated clip').replace('▶ Current cuts','▶ Before this correction').replace('Proposed cuts','Updated clip').replace('Current cuts','Before this correction').replace('Grey: current cards','Grey: previous proposal').replace('Cyan: proposed clips','Cyan: updated clip').replace('Rate the proposed version below.','Rate the updated clip below.').replace('2. How are these cuts?','2. Does the updated clip keep the whole point?').replace("['Good as shown','Still needs more splits','A rally is split incorrectly','A clip contains no point','A serve or finish is cut off','Too much waiting',\"Can’t tell\"]","['Good as shown','A serve or finish is cut off','Still needs work',\"Can’t tell\"]").replace('ponglens-combined-cuts-feedback.json','ponglens-combined-worker-feedback.json')
(out/'review.js').write_text(s)
print(out)
