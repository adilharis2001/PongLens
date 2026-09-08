"""Candidate supervision, operating-point selection and evaluation metrics."""
import math
import statistics


def assign_candidate_targets(candidates,label,positive_px=20,negative_px=40):
    if label['state']!='visible': return [0]*len(candidates)
    distances=[math.hypot(c['x']-label['x'],c['y']-label['y']) for c in candidates]
    nearest=min(range(len(candidates)),key=distances.__getitem__) if candidates else None
    return [1 if i==nearest and distances[i]<=positive_px else 0 if distances[i]>=negative_px else None
            for i in range(len(candidates))]


def prediction_from_ranked(ranked,threshold,margin):
    ordered=sorted(ranked,key=lambda r:r['score'],reverse=True)
    if not ordered or ordered[0]['score']<threshold:return {'state':'hidden','x':None,'y':None}
    if len(ordered)>1 and ordered[0]['score']-ordered[1]['score']<margin:return {'state':'unsure','x':None,'y':None}
    return {'state':'visible','x':ordered[0]['x'],'y':ordered[0]['y']}


def _flat_score(rows,predictions,proposal_distances=None):
    out={'samples':len(rows),'visible_reference':0,'visible_missed':0,'visible_abstained':0,
         'wrong_location':0,'false_visible':0,
         'state_agreement':0,'within_10px':0,'within_20px':0,'within_40px':0,
         'proposal_within_20px':0,'proposal_within_40px':0,'proposal_within_64px':0,
         'median_error_when_both_visible_px':None}
    errors=[];proposal_distances=proposal_distances or {}
    for row in rows:
        label=row['label'];prediction=predictions.get(row['id']);visible=label['state']=='visible'
        out['visible_reference']+=visible
        distance=proposal_distances.get(row['id'])
        if visible and distance is not None:
            for limit in (20,40,64):out[f'proposal_within_{limit}px']+=distance<=limit
        if not prediction:
            out['visible_missed']+=visible;out['visible_abstained']+=visible;continue
        out['state_agreement']+=prediction['state']==label['state']
        out['visible_abstained']+=visible and prediction['state']!='visible'
        out['false_visible']+=not visible and prediction['state']=='visible'
        if visible and prediction['state']=='visible':
            error=math.hypot(prediction['x']-label['x'],prediction['y']-label['y']);errors.append(error)
            for limit in (10,20,40):out[f'within_{limit}px']+=error<=limit
            out['wrong_location']+=error>20
            out['visible_missed']+=error>20
        elif visible:out['visible_missed']+=1
    if errors:out['median_error_when_both_visible_px']=statistics.median(errors)
    return out


def score_predictions(rows,predictions,proposal_distances=None):
    result=_flat_score(rows,predictions,proposal_distances)
    result['by_venue']={venue:_flat_score([r for r in rows if r['venue']==venue],predictions,proposal_distances)
                        for venue in sorted({r['venue'] for r in rows})}
    return result


def select_operating_point(rows,ranked,thresholds=None,margins=None):
    validation=[r for r in rows if r['split']=='validation']
    if not validation:raise ValueError('validation rows required')
    thresholds=thresholds or [.3,.4,.5,.6,.7,.8,.9]
    margins=margins or [0,.05,.1,.15]
    choices=[]
    for threshold in thresholds:
        for margin in margins:
            predictions={r['id']:prediction_from_ranked(ranked.get(r['id'],[]),threshold,margin) for r in validation}
            metrics=_flat_score(validation,predictions)
            objective=metrics['within_20px']-metrics['false_visible']
            choices.append((objective,metrics['within_20px'],-metrics['visible_missed'],-threshold,-margin,threshold,margin,metrics))
    *_,threshold,margin,metrics=max(choices)
    return {'threshold':threshold,'margin':margin,'metrics':metrics}
