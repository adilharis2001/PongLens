"""Compare predictions with frozen human labels; location misses retain denominator."""
import math
import statistics

def score(rows,predictions):
    out={'samples':len(rows),'valid_predictions':0,'invalid_or_missing':0,'state_agreement':0,'visible_reference':0,'visible_missed':0,'false_visible':0,'within_10px':0,'within_20px':0,'within_40px':0,'confusion':{},'median_error_when_both_visible_px':None}
    errors=[]
    for row in rows:
        human=row['label'];prediction=predictions.get(row['id'])
        visible=human['state']=='visible';out['visible_reference']+=visible
        if prediction is None:
            out['invalid_or_missing']+=1
            out['visible_missed']+=visible
            continue
        out['valid_predictions']+=1
        pair=human['state']+' -> '+prediction['state'];out['confusion'][pair]=out['confusion'].get(pair,0)+1
        out['state_agreement']+=human['state']==prediction['state']
        out['visible_missed']+=visible and prediction['state']!='visible'
        out['false_visible']+=not visible and prediction['state']=='visible'
        if visible and prediction['state']=='visible':
            error=math.hypot(human['x']-prediction['x'],human['y']-prediction['y']);errors.append(error)
            for limit in [10,20,40]:out[f'within_{limit}px']+=error<=limit
    if errors:out['median_error_when_both_visible_px']=statistics.median(errors)
    return out
