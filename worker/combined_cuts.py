"""Reviewed combined point-attempt policy; consumes detector evidence, never scores."""
import numpy as np

def propose(d, base):
 cr=np.array(d['crossings']);bt=np.array(d['bounces']);ev=np.unique(np.r_[cr,bt]);T=np.array(d['body_T']);P=np.array(d['body_p']);sequences=d['sequences']
 def peak(a,b):
  q=P[(T>=a)&(T<=b)];return float(max(q)) if len(q) else 0.
 def low(a,b):
  q=P[(T>=a)&(T<=b)];return float(min(q)) if len(q) else 1.
 def ncr(a,b):return int(((cr>=a)&(cr<=b)).sum())
 def nbt(a,b):return int(((bt>=a)&(bt<=b)).sum())
 def net_ok(s):return s['n_bounces']>=3 or (s['n_bounces']>=2 and bool(s.get('net_motion')))
 def settled(s):
  if s['n_bounces']>=3:return True
  x,y=s['bounces'][0],s['bounces'][1];m=s.get('net_motion')
  return bool(m and (m['absorbed'] or abs(m['out_wps'])<abs(m['in_wps'])) and abs(y['v']-x['v'])<.2 and abs(y['u']-x['u'])>.07 and (y['u']<.2 or y['u']>1.325))
 cands=[dict(s,kind='v3' if s['kept'] else 'v3_recovered') for s in d['candidate_features']]
 # A rejected player-box check may still describe a proper two-half bounce pair.
 # It can only restart after a detected net death, never nominate an ordinary split alone.
 extra=[]
 for row in d.get('gate_log',[]):
  if row[1]!='hands' or len(row)<3 or not row[2].get('pair'):continue
  a=row[0]/d['fps'];c=a-.81
  if any(abs(c-s['contact'])<1.3 for s in cands+extra):continue
  extra.append(dict(contact=c,arrival=a,side=None,paired=True,kept=False,held_start=None,held_end=None,kind='paired_after_net'))
 # Existing V2 motifs are useful restarts after a net death even when V3 misses the hands.
 for c in d['motifs']:
  if not any(abs(c-s['contact'])<1.3 for s in cands+extra):extra.append(dict(contact=c,arrival=c+.81,side=None,paired=True,kept=False,held_start=None,held_end=None,kind='paired_after_net'))
 cands=sorted(cands+extra,key=lambda s:s['contact']);decisions=[];out=[];rejected=[];preparations=[];terminals=[]
 for original in base:
  start,end=original['t0'],original['t1'];a=start;previous=None;cuts=[]
  seed_parts=[q for q in d['cards_gap4'] if min(end,q['t1'])-max(start,q['t0'])>.5]
  seed_pairs=list(zip(seed_parts,seed_parts[1:])) if len(seed_parts)>1 else []
  nearby=[s for s in cands if start-1.0<=s['contact']<end-.6]
  for s in nearby:
   c,arrival=s['contact'],s['arrival'];held=(s.get('held_end') or 0)-(s.get('held_start') or 0)
   if c-a<2.8:
    previous=s;continue
   priors=[p for p in nearby if p['contact']<c-2.6 and p['kind']!='paired_after_net']
   prev=max((p['contact'] for p in priors),default=a-.2)
   if c-prev<3.2:continue
   deaths=[q for q in sequences if max(a+.7,prev+.9)<=q['first'] and q['last']<c-1.0 and net_ok(q)]
   # A sequence in the original serve's bounce pair is never a death.
   death=next((q for q in deaths if q['first']>prev+1.15),None)
   before=ev[(ev>=a)&(ev<=arrival+.5)]
   min_gap=2.2 if death or held>=.25 else 2.6
   gaps=[(float(x),float(y)) for x,y in zip(before,before[1:]) if y-x>=min_gap and c-1.3<=y<=arrival+.5 and x<c-.65]
   gap=max(gaps,key=lambda v:v[1]-v[0],default=None)
   if gap is None and s['kind']=='v3' and s['paired'] and held>=.25:
    cross_before=cr[(cr>=a)&(cr<=arrival+.5)]
    cg=[(float(x),float(y)) for x,y in zip(cross_before,cross_before[1:]) if y-x>=2.2 and c-1.3<=y<=arrival+.5 and x<c-.65 and nbt(x+.05,c-.8)==0]
    gap=max(cg,key=lambda v:v[1]-v[0],default=None)
   nc=ncr(arrival-.05,min(end,arrival+2.5))
   right_live=(nc>=1 and peak(arrival+.2,min(end,arrival+2.5))>=(.90 if nc==1 else .84))
   right_dead=any(c+.95<q['first']<min(end,c+3.5) and net_ok(q) for q in sequences)
   left_live=(ncr(a,min(c-1.,end))>=1 and (nbt(a,c-1.)>=1 or peak(a,c-1.)>=.9) and (bool(priors) or death is not None or ncr(a,c-1.)>=2))
   if priors:
    p0=max(priors,key=lambda p:p['contact']);pheld=(p0.get('held_end') or 0)-(p0.get('held_start') or 0)
    prior_active=peak(p0['arrival']+.2,min(c-1,p0['arrival']+2.5))>=.88
    prior_fault=pheld>=.5 and p0.get('held_side')==p0.get('side')
    left_live=left_live and (prior_active or prior_fault or death is not None)
   seed=next(((l,r) for l,r in seed_pairs if abs((r.get('serve_s') or -100)-c)<.7),None)
   eligible=(s['kind']=='v3' or (s['kind']=='v3_recovered' and (s['paired'] or held>=.15)) or (s['kind']=='paired_after_net' and death is not None))
   if not (eligible and left_live and (right_live or right_dead) and (gap or death or seed)):
    rejected.append(dict(card=original['idx'],contact=c,kind=s['kind'],eligible=bool(eligible),left=bool(left_live),right=bool(right_live or right_dead),gap=gap,death=death['first'] if death else None));continue
   right=c-1.6
   if death:
    left=max(death['first']+.9,death['bounces'][1]['t']+.35)
    # Three low bounces settle the event even if a cleanup ball crosses later.
    # A two-bounce episode with sustained subsequent exchanges remains ambiguous.
    later=cr[(cr>death['last']+.7)&(cr<right)]
    if not settled(death) and len(later)>=3:
     if not gap:continue
     death=None
   if death is None:
    if gap:left=gap[0]+1.15
    elif seed:left=seed[0]['t1']
    else:continue
   if left>right-.10:
    # Keep complete footage across tight restarts rather than deleting a fixed gap.
    seam=min(c-.65,max(right,left));left=seam;right=seam+.03
   if left-a<1.5 or end-right<1.5 or right>c-.6:continue
   cuts.append(dict(left_end=left,right_start=right,serve=c,reason='net_then_restart' if death else 'serve_after_pause',candidate_kind=s['kind'],net_bounces=death['n_bounces'] if death else None,_terminal=death,gap=gap,original_card=original['idx']))
   a=right;previous=s
  # A failed next serve may never reach the table. Require a stopped body response,
  # floor-bounce evidence after the previous exchange, then a fresh body/ball burst.
  e=ev[(ev>=start)&(ev<=end)]
  for x,y in zip(e,e[1:]):
   if y-x<3.1 or x-start<1.5 or end-y<1.2:continue
   floor=[t for t in d['long_bounces'] if x<t<min(x+1.3,y)]
   if not floor or ncr(start,x)<2 or peak(max(start,x-2),x+.3)<.88:continue
   if low(x+.6,y-.6)>.72 or peak(y,min(end,y+1.8))-low(x+.6,y-.6)<.18:continue
   if ncr(y,min(end,y+2))<2:continue
   if any(abs(k['serve']-(y-.81))<2.7 for k in cuts):continue
   left=floor[0]+.65;right=y-1.8
   if left>right-.05:right=left+.03
   if right>y-.65 or left-start<1.5:continue
   cuts.append(dict(left_end=left,right_start=right,serve=y-.81,reason='long_shot_then_new_attempt',candidate_kind='body_and_ball_restart',net_bounces=None,gap=[float(x),float(y)],original_card=original['idx']))
  cuts.sort(key=lambda c:c['right_start'])
  # Split all independently supported attempts in chronological order.
  a=start
  for number, cut in enumerate(cuts):
   # Only a newly isolated, brief prefix is eligible. Readiness/ball handling
   # alone cannot create a point. Keep strong play or a held service attempt,
   # including short faults; do not apply this to whole original cards.
   own_attempt=any(a-.6<=s['contact']<cut['left_end']-.5 and
       (s.get('held_end') or 0)-(s.get('held_start') or 0)>=.5 and
       s.get('held_side') is not None and s.get('held_side')==s.get('side')
       for s in cands)
   preparation=(number==0 and cut['left_end']-a<=3.0 and
                peak(a,cut['left_end'])<.9 and not own_attempt)
   if preparation:
    preparations.append(dict(t0=a,t1=cut['left_end'],original_card=original['idx'],
                             reason='brief_prefix_without_play_or_service_hold'))
   else:
    out.append(dict(original,t0=a,t1=cut['left_end'],why=cut['reason'],research_end=True))
   if cut.get('_terminal') and not preparation:
    terminals.append(dict(t0=a,t1=cut['left_end'],sequence=cut['_terminal']))
   a=cut['right_start'];decisions.append({k:v for k,v in cut.items() if k!='_terminal'})
  out.append(dict(original,t0=a,t1=end,serve_s=cuts[-1]['serve'] if cuts else original.get('serve_s')))
 # Tail shortening asks about the last independent point, never the entire parent.
 tails=[]
 for card in out:
  a,b=card['t0'],card['t1'];sv=card.get('serve_s');sv=sv if sv is not None and a-1<=sv<b else a
  terminal=[q for q in sequences if max(a+1,sv+1.15)<=q['first'] and q['last']<b-.6 and net_ok(q)]
  for q in terminal:
   later=cr[(cr>q['last']+.75)&(cr<b)]
   # Permit one isolated cleanup crossing, not another exchange.
   clusters=[]
   for t in later:
    if not clusters or t-clusters[-1]>.25:clusters.append(t)
   if len(clusters)>1:continue
   stop=max(q['first']+.95,q['bounces'][1]['t']+.4)
   if stop<b-.35 and stop-a>=1.5:
    terminals.append(dict(t0=a,t1=stop,sequence=q));tails.append(dict(original_start=a,old_end=b,new_end=stop,bounces=q['n_bounces']));card['t1']=stop;card['research_end']=True;break
 # Guarded opening: only remove setup with no earlier active events.
 heads=[]
 for card in out:
  a,b=card['t0'],card['t1'];svs=[s for s in cands if s['kind']=='v3' and a+2.0<s['contact']<min(a+7,b-1)]
  if not svs:continue
  s=svs[0];new=s['contact']-1.6
  if card.get('serve_s') is not None and new>card['serve_s']-.6:continue
  if new-a>.5 and ncr(a-.3,new-.3)==0 and nbt(a-.3,new-.3)==0:
   heads.append(dict(old_start=a,new_start=new,end=b));card['t0']=new
 for i,c in enumerate(out):
  c['idx']=i+1;c['t0']=round(c['t0'],2);c['t1']=round(c['t1'],2);c['clip_t0']=max(0,round(c['t0']-.3,2));c['clip_t1']=round(c['t1']+.4,2)
  if c.get('end_evidence_s') is not None:c['end_evidence_s']=min(c['t1'],max(c['t0'],c['end_evidence_s']))
 return dict(cards=out,decisions=decisions,tails=tails,heads=heads,rejected=rejected,preparations=preparations,terminals=terminals)



METHOD_VERSION = 'combined-cuts-v1'


def final_cards(result, baseline):
    """Return assembler records, never copied export/cut-clock metadata."""
    out = []
    for proposed in result['cards']:
        a, b = proposed['t0'], proposed['t1']
        parent = max(baseline, key=lambda c: min(b, c['t1'])-max(a, c['t0']))
        preceding = [d for d in result['decisions']
                     if d['original_card']==parent['idx'] and d['right_start']<=a+.011]
        serve = max(preceding, key=lambda d:d['right_start'])['serve'] if preceding else parent.get('serve_s')
        if serve is not None and not a-1<=serve<=b:
            serve = None
        end = parent.get('end_evidence_s')
        # A parent's body stop is not an observation of an earlier child's end.
        if round(parent['t1'], 2)!=b or end is None or not a<=end<=b:
            end = None
        out.append(dict(t0=a, t1=b, serve_s=serve,
                        why=proposed.get('why'), end_evidence_s=end))
    return out


def terminal_for_card(result, card):
    """Retain only the episode actually selected for this child's visible end.

    Later confirming bounces can live outside a trimmed clip. The winning
    side still has to pass the original net-motion/ambiguity checks.
    """
    for t in reversed(result.get('terminals', [])):
        seq = t['sequence']
        if (abs(round(t['t1'],2)-card['t1'])<=.011 and
                card['t0']<=seq['first'] and seq['bounces'][1]['t']<=card['t1']):
            return dict(kind='ending', sequence=seq, confirmed=seq['bounces'][1]['t'])
    return None


def process_cards(cards, predictions, evidence, corners, width, serves,
                  restart_evidence, body_evidence, gap4_cards):
    """Build reviewed evidence in the worker, and fail open to its prior cards.

    Predictions are re-evaluated per final attempt. Unchanged cards retain
    their original analysis, which may include confirming bounces after the
    visible end. Newly split cards never inherit the parent's winner.
    """
    import net_endings as N
    original_count = len(cards)
    info = dict(method_version=METHOD_VERSION, status='not_applied', added_cards=0)
    if not corners or not restart_evidence or not body_evidence:
        return cards, predictions, dict(info, reason='required_evidence_unavailable')
    try:
        sequences = N.extract_sequences(evidence.track, corners, evidence.fps,
                                        width, evidence.cross)
        context = dict(body_evidence, **restart_evidence,
            fps=evidence.fps, crossings=list(evidence.cross),
            bounces=list(evidence.bt_table), long_bounces=list(evidence.bt_endline),
            motifs=list(evidence.serves), sequences=sequences, cards_gap4=gap4_cards)
        # The review was made against serialized production cards. Normalize
        # that same frame clock once here; the exporter still owns clip clocks.
        base = [dict(c, idx=i+1,
                     t0=round(int(c['t0']*evidence.fps)/evidence.fps,2),
                     t1=round(int(c['t1']*evidence.fps)/evidence.fps,2))
                for i,c in enumerate(cards)]
        result = propose(context, base)
        final = final_cards(result, base)
        if not final or any(c['t1']<=c['t0'] for c in final):
            raise ValueError('invalid final point window')
        if any(l['t1']>r['t0']+.011 for l,r in zip(final,final[1:])):
            raise ValueError('overlapping final point windows')
        previous = {(c['t0'],c['t1']): (original, prediction)
                    for c,original,prediction in zip(base,cards,predictions)}
        updated = []
        for c in final:
            retained = previous.get((c['t0'],c['t1']))
            if retained:
                original, prediction = retained
                # Preserve exact pre-export times on completely unchanged cards.
                c.update(original)
                updated.append(prediction)
            else:
                prediction = N.predict_winner(c,sequences,evidence.cross,serves,
                                             terminal=terminal_for_card(result,c))
                prediction['evidence']['card_policy'] = METHOD_VERSION
                updated.append(prediction)
        return final, updated, dict(info, status='used', added_cards=len(final)-original_count,
            decisions=result['decisions'], tails=result['tails'], heads=result['heads'],
            removed_preparations=result['preparations'])
    except Exception as exc:
        return cards, predictions, dict(info, status='error', reason=type(exc).__name__)
