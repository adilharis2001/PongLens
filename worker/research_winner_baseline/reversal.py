"""Frozen machine rule extraction; no dataset access or fitting."""
import math


CONFIG=dict(version=1,candidate_source='active database placement only where core window equals machine; original machine placement otherwise',min_reversal_confidence=.7,min_post_observations=6,post_window_s=.5,max_gap_s=.25,max_adjacent_jump_width_fraction=.10,stationary_step_width_fraction=2/1920,max_stationary_fraction=.8,bounce_min_delay_s=.05,table_width_m=1.525,table_length_m=2.74)

def predict(f):
 contacts=sorted([c for c in f['candidates'] if c['kind']=='contact'],key=lambda c:c['t']);r=dict(idx=f['idx'],window=[f['start'],f['end']],raw_winner=None,guarded_winner=None,reasons=[],physical_end_s=None)
 if not contacts:r['reasons']=['no_reversal' if f['placement_available'] else 'placement_unavailable'];return r
 c=contacts[-1];r['last_reversal']={k:c[k] for k in ['t','side','visual_confidence','x','y']}
 if c['side'] not in ['near','far']:r['reasons']=['unknown_reversal_side'];return r
 receiver='far' if c['side']=='near' else 'near'
 bs=[b for b in f['candidates'] if b['kind']=='bounce' and b['t']>=c['t']+CONFIG['bounce_min_delay_s']]
 projected=[b for b in bs if b['u'] is not None and b['v'] is not None and 0<=b['u']<=CONFIG['table_width_m'] and 0<=b['v']<=CONFIG['table_length_m']]
 recv=[b for b in projected if ('far' if b['v']>CONFIG['table_length_m']/2 else 'near')==receiver]
 unknown=[b for b in bs if b['u'] is None or b['v'] is None]
 r.update(receiving_bounce_candidates=[b['t'] for b in recv],unknown_bounce_candidates=[b['t'] for b in unknown],branch='receiving_bounce_present' if recv else 'receiving_bounce_absent',raw_winner=c['side'] if recv else receiver)
 post=[p for p in f['track'] if c['t']<=p[0]<=c['t']+CONFIG['post_window_s']]
 gaps=[b[0]-a[0] for a,b in zip(post,post[1:])];steps=[math.hypot((b[1]-a[1])*f['width'],(b[2]-a[2])*f['height'])/f['width'] for a,b in zip(post,post[1:]) if b[0]-a[0]<=1.5/f['fps']]
 stationary=sum(s<CONFIG['stationary_step_width_fraction'] for s in steps)/len(steps) if steps else None
 r.update(post_observations=len(post),post_max_gap=max(gaps) if gaps else None,post_max_adjacent_jump=max(steps) if steps else None,post_stationary_fraction=stationary)
 if (c['visual_confidence'] or 0)<CONFIG['min_reversal_confidence']:r['reasons'].append('weak_reversal')
 if len(post)<CONFIG['min_post_observations']:r['reasons'].append('sparse_post_track')
 if f['end']<c['t']+CONFIG['post_window_s']:r['reasons'].append('short_machine_window')
 if not post or post[-1][0]<c['t']+CONFIG['post_window_s']-.1:r['reasons'].append('missing_post_tail')
 if gaps and max(gaps)>CONFIG['max_gap_s']:r['reasons'].append('post_track_gap')
 if steps and max(steps)>CONFIG['max_adjacent_jump_width_fraction']:r['reasons'].append('large_track_jump')
 if stationary is not None and stationary>=CONFIG['max_stationary_fraction']:r['reasons'].append('stationary_track')
 if unknown and not recv:r['reasons'].append('unprojected_bounce_ambiguity')
 if not r['reasons']:r['guarded_winner']=r['raw_winner']
 return r
