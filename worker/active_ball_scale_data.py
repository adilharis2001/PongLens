"""Deterministic corpus sampling and Gemini-teacher manifest conversion."""
import random


def _merged(intervals):
    result=[]
    for start,end in sorted(intervals):
        if end <= start: continue
        if result and start <= result[-1][1]: result[-1]=(result[-1][0],max(result[-1][1],end))
        else: result.append((start,end))
    return result


def _draw(intervals,count,rng,chosen,min_spacing=.4):
    lengths=[end-start for start,end in intervals]
    if not intervals or sum(lengths)<=0: raise ValueError('not enough eligible video time')
    attempts=0
    while count:
        attempts+=1
        if attempts>count*10000: raise ValueError('cannot satisfy sample spacing')
        interval=rng.choices(intervals,weights=lengths,k=1)[0]
        value=rng.uniform(*interval)
        # Leave one extra 30 fps frame beyond the .35s corpus contract so
        # rounding each target to a decoded frame cannot violate it.
        if any(abs(value-old)<min_spacing for old,_ in chosen): continue
        chosen.append((value,None));count-=1


def sample_times(points,duration,rally_count=72,gap_count=18,seed=0):
    """Return sorted (source_seconds, rally|gap), with 1.2s edge clearance."""
    if duration<2.4 or rally_count<0 or gap_count<0: raise ValueError('invalid sample request')
    rally=_merged([(max(1.2,float(p['t0'])+.15),min(duration-1.2,float(p['t1'])-.15)) for p in points])
    gaps=[];cursor=1.2
    for start,end in rally:
        if start-cursor>=.8:gaps.append((cursor+.2,start-.2))
        cursor=max(cursor,end)
    if duration-1.2-cursor>=.8:gaps.append((cursor+.2,duration-1.4))
    rng=random.Random(seed);picked=[]
    _draw(rally,rally_count,rng,picked)
    rally_values=[(time,'rally') for time,_ in picked]
    gap_picked=[]
    for _ in range(gap_count):
        before=len(picked)
        _draw(gaps,1,rng,picked)
        gap_picked.append(picked[before])
    return sorted(rally_values+[(time,'gap') for time,_ in gap_picked])


def validate_recording_splits(rows):
    seen={}
    for row in rows:
        digest=row['source_sha256'];split=row['split']
        if digest in seen and seen[digest]!=split: raise ValueError('recording leaks between splits')
        seen[digest]=split
    return rows


def teacher_manifest(rows,responses,provenance):
    result=[]
    for row in rows:
        response=responses.get(row['id']);prediction=response.get('prediction') if response else None
        item=dict(row)
        if prediction:
            item['label']={key:prediction.get(key) for key in ('state','x','y')}
            item['label']['provenance']=provenance;item['teacher_status']='usable'
        else:item['label']=None;item['teacher_status']='unusable'
        result.append(item)
    return result
