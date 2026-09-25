"""Frozen machine rule extraction; no dataset access or fitting."""


CONFIG = dict(version=1, table_length_m=2.74, table_width_m=1.525,
              net_margin_m=.20, minimum_confidence=.7, bounce_delay_s=.05)

def decide(stroke, net_row, candidates, crossings):
    result = dict(winner=None, branch='unresolved', phase='unknown',
                  physical_end_s=None, cut_s=None, evidence={})
    def abstain(reason):
        result['reason'] = reason
        return result
    net = net_row['prediction']
    mid = CONFIG['table_length_m']/2
    if net['status'] == 'predicted':
        evidence = net['evidence']
        sequence = next((s for s in net_row['sequences']
                         if abs(s['first']-evidence['first_bounce_s'])<1e-6), None)
        half = evidence['bounce_half']
        clear = sequence and any(
            abs(b['v']-mid)>CONFIG['net_margin_m'] and
            ('near' if b['v']<mid else 'far') == half
            for b in sequence['bounces'])
        if not clear:
            return abstain('net_settling_half_unresolved')
        result.update(winner=net['winner_side'], branch='existing_net',
                      phase='terminal_hypothesis', reason='net_with_clear_settling_half',
                      evidence=evidence)
        return result
    if net['reason'] in ['multiple_rallies_possible', 'crossing_after_net_motion']:
        return abstain('net_or_rally_phase_ambiguous')
    contact = stroke.get('last_contact')
    if not contact or contact['side'] not in ['near','far']:
        return abstain('last_contact_unknown')
    if any(s['first']>=contact['t'] and s['n_bounces']>=2 for s in net_row['sequences']):
        return abstain('post_contact_low_bounce_sequence')
    if (contact.get('visual_confidence') or 0)<CONFIG['minimum_confidence']:
        return abstain('contact_confidence_unsupported')
    if stroke.get('guarded_winner') is None:
        return abstain('final_track_or_contact_unsupported')
    bounces = [b for b in candidates if b['kind']=='bounce' and
               b['t']>=contact['t']+CONFIG['bounce_delay_s'] and
               b.get('u') is not None and b.get('v') is not None and
               0<=b['u']<=CONFIG['table_width_m'] and 0<=b['v']<=CONFIG['table_length_m']]
    if any(('near' if b['v']<=mid else 'far')==contact['side'] for b in bounces):
        return abstain('post_contact_landing_sides_conflict')
    receiving = [b for b in bounces if abs(b['v']-mid)>CONFIG['net_margin_m'] and
                 (b.get('visual_confidence') or 0)>=CONFIG['minimum_confidence'] and
                 any(contact['t']<t<b['t'] for t in crossings)]
    if not receiving:
        return abstain('receiving_landing_not_supported')
    result.update(winner=contact['side'], branch='receiving_bounce',
                  phase='unreturned_shot_hypothesis', reason='guarded_receiving_landing',
                  evidence=dict(contact=contact, receiving_bounces=receiving))
    return result
