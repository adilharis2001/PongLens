#!/usr/bin/env python3
"""Create private, review-only predictions from frozen machine evidence and labels.

No database, network, media or worker entry points. Every fit excludes the whole
recording being predicted. Only explicit category labels supervise classifiers.
"""
import argparse
import collections
import copy
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import numpy as np

RUN_ID = 'contact-review-20260922-v1'
REASONS = {'long','wide','net','missed_return','double_bounce','serve_fault','edge','continuing'}
KINDS = {'table','paddle','floor','net_clip','net_bounce','non_rally','other_table','ball_handling','ceiling','other_non_bounce'}
MIN_CLASS_COUNT = 5
MIN_CLASS_RECORDINGS = 2
MIN_STRENGTH = .35
MIN_MARGIN = .05
EXPERIMENT = None


def configure(path):
    global EXPERIMENT
    sys.path.insert(0,str(path.resolve().parent))
    spec = importlib.util.spec_from_file_location('contact_review_frozen_experiment',path)
    EXPERIMENT = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(EXPERIMENT)
    assert EXPERIMENT.model.CONFIG['penalty'] == .1


def machine_row(row):
    """Allowlist the machine inputs: never forward scores, owner text or taps."""
    f = row['features']
    return dict(point_id=row['point_id'],slug=row['slug'],
                features={k:copy.deepcopy(f[k]) for k in ['start','end','width','height','fps','track','candidates']},
                contacts=[{k:c[k] for k in ['t','x','y','side','visual_confidence'] if k in c} for c in row['contacts']],
                corners=copy.deepcopy(row['corners']),serve_s=row['serve_s'])


def align_bounces(row,evidence):
    """Return candidates in the immutable evidence array's order, not time order."""
    candidates=[c for c in row['features']['candidates'] if c['kind']=='bounce']
    used=set();out=[]
    if len(candidates)!=len(evidence['bounces']): raise ValueError('Detected bounce count changed')
    for b in evidence['bounces']:
        matches=[i for i,c in enumerate(candidates) if i not in used and
                 abs(c['t']-b['t'])<=.6/row['features']['fps'] and
                 math.hypot(c['x']-b['x']*evidence['width'],c['y']-b['y']*evidence['height'])<=2]
        if len(matches)!=1: raise ValueError('Detected bounce is not uniquely aligned')
        used.add(matches[0]);out.append(candidates[matches[0]])
    return out


def last_paddle(row):
    coords,_=EXPERIMENT.geometry(row['corners'])
    plausible=[]
    for c in row['contacts']:
        if c.get('side') not in ['near','far']: continue
        q=coords(c['x'],c['y'])
        if q['lateral']<=1 and ((-.99<=q['q']<=.25) if c['side']=='far' else (.75<=q['q']<=2)):
            plausible.append(c)
    return max(plausible,key=lambda c:c['t'],default=None)


def prepare(rows,evidence):
    out=[]
    for original in rows:
        r=machine_row(original)
        # The frozen extractor expects contacts in time order.
        r['contacts'].sort(key=lambda c:c['t'])
        events=[]
        for index,b in enumerate(align_bounces(r,evidence[r['point_id']])):
            e=EXPERIMENT.event_features(r,b);e['id']=f'detected:{index}';events.append(e)
        chronological=sorted(events,key=lambda e:e['t'])
        _,sequence=EXPERIMENT.sequence_features(r,chronological,[True]*len(events))
        last=last_paddle(r)
        ranks=[]
        for e in events:
            earlier=sum(a['t']<e['t'] for a in events);later=sum(a['t']>e['t'] for a in events)
            ranks.append(e['features']+[r['features']['end']-e['t'],earlier,later,
                         e['t']-last['t'] if last else None,len(events)])
        out.append(dict(point_id=r['point_id'],slug=r['slug'],events=events,
                        sequence=sequence,rank=ranks,paddle=last))
    return out


def training_samples(prepared,labels,held):
    samples=dict(events=[],reasons=[],last=[])
    for row in prepared:
        if row['slug']==held: continue
        label=labels.get(row['point_id'],{});base=dict(point_id=row['point_id'],slug=row['slug'])
        if label.get('reason') in REASONS and row['sequence'] is not None:
            samples['reasons'].append(dict(base,x=row['sequence'],y=label['reason']))
        review=label.get('bounceReview') or {};events={e['id']:e for e in row['events']}
        for annotation in review.get('events',[]):
            kind=annotation['kind'];kind='table' if kind in ['table','serve','rally'] else kind
            if annotation['id'] in events and kind in KINDS:
                samples['events'].append(dict(base,x=events[annotation['id']]['features'],y=kind,event_id=annotation['id']))
        if review.get('lastBounce') in events:
            for e,x in zip(row['events'],row['rank']):
                samples['last'].append(dict(base,x=x,y=int(e['id']==review['lastBounce']),event_id=e['id']))
    return samples


def fit_classes(samples):
    counts=collections.Counter(s['y'] for s in samples)
    groups={kind:sorted({s['slug'] for s in samples if s['y']==kind}) for kind in counts}
    supported=sorted(k for k in counts if counts[k]>=MIN_CLASS_COUNT and len(groups[k])>=MIN_CLASS_RECORDINGS)
    result=dict(counts=dict(counts),recordings=groups,models={})
    if len(supported)<2: return result
    # Rare known classes remain negative examples; they never become a forced target.
    x=np.asarray([s['x'] for s in samples],float)
    for kind in supported:
        result['models'][kind]=EXPERIMENT.model.fit(x,[int(s['y']==kind) for s in samples])
    return result


def classify(x,state):
    if x is None or not state['models']: return None,{}
    scores={k:float(EXPERIMENT.model.predict(np.asarray([x],float),m)[0]) for k,m in state['models'].items()}
    ranked=sorted(scores,key=lambda k:(-scores[k],k));best=ranked[0]
    if scores[best]<MIN_STRENGTH or scores[best]-scores[ranked[1]]<MIN_MARGIN: return None,scores
    return best,scores


def suggestion(value,detail):
    return dict(value=value,confidence='tentative' if value is not None else 'uncertain',detail=detail)


def predict_fold(prepared,labels,held):
    samples=training_samples(prepared,labels,held)
    assert all(s['slug']!=held for ss in samples.values() for s in ss)
    event_model=fit_classes(samples['events']);reason_model=fit_classes(samples['reasons'])
    positives=[s for s in samples['last'] if s['y']]
    last_model=None
    if len(positives)>=5 and len({s['slug'] for s in positives})>=2 and any(not s['y'] for s in samples['last']):
        last_model=EXPERIMENT.model.fit(np.asarray([s['x'] for s in samples['last']],float),[s['y'] for s in samples['last']])
    predictions=[]
    for row in prepared:
        if row['slug']!=held: continue
        reason,_=classify(row['sequence'],reason_model)
        events=[]
        for e in row['events']:
            kind,_=classify(e['features'],event_model)
            # Side means the main table's half; it is undefined for other tables,
            # floor and handling. It is never inferred from an owner side label.
            side=e['side'] if kind in {'table','non_rally','net_bounce','net_clip','paddle'} else None
            events.append(dict(id=e['id'],kind=kind,side=side,
                               confidence='tentative' if kind else 'uncertain',
                               detail='Tentative category from ball motion and table geometry, trained on other recordings. Review this marker.' if kind else
                               'No clear supported category from the other recordings. Review this detected marker.'))
        last_id=None
        if last_model and row['rank']:
            scores=EXPERIMENT.model.predict(np.asarray(row['rank'],float),last_model)
            eligible=[i for i,e in enumerate(events) if e['kind']=='table']
            if eligible: last_id=events[max(eligible,key=lambda i:float(scores[i]))]['id']
        paddle=row['paddle']
        payload=dict(version=1,runId=RUN_ID,
            reason=suggestion(reason,'Tentative ending category learned from other recordings. Rare ending types have too few examples; review the clip.' if reason else
                              'The motion evidence does not clearly separate supported ending categories. Review the clip.'),
            lastRallyContact=suggestion(paddle['side'] if paddle else None,
                'Latest machine paddle candidate that passes the table-position check. It may miss the final stroke or include activity after the rally.' if paddle else
                'No machine paddle candidate passes the table-position check. Bounce sides are not used as a substitute.'),
            lastBounce=suggestion(last_id,
                'Tentative choice among detected table-bounce suggestions, learned from last-bounce marks in other recordings. Missing bounces cannot be recovered.' if last_id else
                'No supported last table-bounce suggestion. A missed bounce may need to be added during review.'),events=events)
        validate_payload(payload,len(row['events']))
        predictions.append(dict(point_id=row['point_id'],payload=payload))
    audit=dict(heldout=held,training={k:[{n:s[n] for n in ['point_id','slug','y','event_id'] if n in s} for s in ss] for k,ss in samples.items()},
               event_model=event_model,reason_model=reason_model,last_model=last_model,
               detected_last_bounce_training_points=len(positives))
    return predictions,audit


def validate_payload(p,count):
    if set(p)!={'version','runId','reason','lastRallyContact','lastBounce','events'} or p['version']!=1 or p['runId']!=RUN_ID:
        raise ValueError('Invalid suggestion payload')
    for field,allowed in [('reason',REASONS),('lastRallyContact',{'near','far'})]:
        if p[field]['value'] is not None and p[field]['value'] not in allowed: raise ValueError('Invalid suggestion value')
    ids=[f'detected:{i}' for i in range(count)]
    if [e['id'] for e in p['events']]!=ids: raise ValueError('Every stored marker must be represented in order')
    last=p['lastBounce']['value']
    if last is not None and (last not in ids or p['events'][ids.index(last)]['kind']!='table'):
        raise ValueError('Last bounce must reference a detected table suggestion')
    for field in ['reason','lastRallyContact','lastBounce']:
        if set(p[field])!={'value','confidence','detail'}: raise ValueError('Invalid field keys')
    for e in p['events']:
        if set(e)!={'id','kind','side','confidence','detail'} or e['kind'] not in KINDS|{None} or e['side'] not in {'near','far',None}:
            raise ValueError('Invalid event')
    for entry in [p['reason'],p['lastRallyContact'],p['lastBounce']]+p['events']:
        if entry['confidence'] not in {'tentative','uncertain'} or not isinstance(entry['detail'],str) or len(entry['detail'])>240:
            raise ValueError('Invalid confidence or detail')


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text())
def write(path,value):
    with path.open('x') as f: json.dump(value,f,indent=2,allow_nan=False)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for flag in ['experiment','snapshot','inputs','output']: parser.add_argument('--'+flag,type=Path,required=True)
    args=parser.parse_args();configure(args.experiment)
    if args.output.exists(): raise FileExistsError('Choose a new private output directory; frozen outputs are never overwritten')
    tracked=[args.experiment,args.snapshot,args.inputs,Path(__file__),Path(EXPERIMENT.model.__file__),
             Path(sys.modules['same_shot_v1_1'].__file__)]
    hashes={str(p.resolve()):digest(p) for p in tracked}
    snapshot=read(args.snapshot);rows=read(args.inputs)['rows'];labels={r['id']:r['label'] for r in snapshot['rows']}
    if len(rows)!=len({r['point_id'] for r in rows}) or {r['point_id'] for r in rows}!=set(labels):
        raise ValueError('Input points and annotation snapshot must match exactly')
    prepared=prepare(rows,snapshot['evidence']);predictions=[];folds=[];checks=[]
    for held in sorted({r['slug'] for r in rows}):
        result,audit=predict_fold(prepared,labels,held)
        # Poison every human answer in the target recording. Refit, not merely
        # re-run inference, to check exclusion also holds in preprocessing/support.
        poisoned=copy.deepcopy(labels)
        for r in rows:
            if r['slug']==held:
                poisoned[r['point_id']]=dict(reason='wide',note='LEAKAGE CHECK',custom='LEAKAGE CHECK',lastRallyContact='far',
                    bounceReview=dict(lastBounce='detected:0',events=[dict(id=f'detected:{i}',kind='ceiling',side='far') for i in range(len(snapshot['evidence'][r['point_id']]['bounces']))]))
        repeated,repeated_audit=predict_fold(prepared,poisoned,held)
        if repeated!=result or repeated_audit!=audit: raise AssertionError('Held-out human labels changed a prediction or fitted state')
        checks.append(dict(heldout=held,all_target_labels_perturbed=True,predictions_and_fits_identical=True))
        predictions.extend(result);folds.append(audit)
        print(held,len(result),'points; exclusion check passed',flush=True)
    # Scores, exact taps, notes and source metadata cannot change feature extraction.
    noisy=copy.deepcopy(rows)
    for r in noisy:
        r.update(truth_winner='LEAKAGE CHECK',window={'tap':-999},label={'reason':'wide'},note='LEAKAGE CHECK',existing_net={'winner':'far'})
        r['features']['exact_tap']=-999
    if json.dumps(prepare(noisy,snapshot['evidence']),sort_keys=True)!=json.dumps(prepared,sort_keys=True):
        raise AssertionError('Owner metadata changed machine features')
    assert all(digest(Path(p))==h for p,h in hashes.items())
    predictions.sort(key=lambda p:p['point_id'])
    summary=dict(points=len(predictions),detected_events=sum(len(p['payload']['events']) for p in predictions),
        ending_counts=dict(collections.Counter(p['payload']['reason']['value'] or 'unresolved' for p in predictions)),
        event_counts=dict(collections.Counter(e['kind'] or 'unresolved' for p in predictions for e in p['payload']['events'])),
        last_paddle_suggestions=sum(p['payload']['lastRallyContact']['value'] is not None for p in predictions),
        last_bounce_suggestions=sum(p['payload']['lastBounce']['value'] is not None for p in predictions),
        confidence='Tentative and uncalibrated. No new annotation accuracy has been established.',
        not_inferred='Missing bounces, physical point ends, saved winners and notes are not generated.')
    args.output.mkdir(parents=True)
    write(args.output/'predictions.json',predictions);write(args.output/'folds.json',folds);write(args.output/'summary.json',summary)
    write(args.output/'verification.json',dict(input_hashes=hashes,input_hashes_unchanged=True,heldout_label_perturbations=checks,
        owner_metadata_perturbation_identical=True,all_stored_bounces_aligned=True,
        prediction_sha256=digest(args.output/'predictions.json'),config=dict(ridge_penalty=.1,min_class_count=MIN_CLASS_COUNT,
        min_class_recordings=MIN_CLASS_RECORDINGS,min_uncalibrated_strength=MIN_STRENGTH,min_margin=MIN_MARGIN),
        untouched='No database, network, media or production writes. Source labels and frozen experiment unchanged.'))
    print(json.dumps(summary,indent=2))

if __name__=='__main__': main()
