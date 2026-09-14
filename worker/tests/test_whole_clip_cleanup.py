"""Whole-component deletion must never trim or re-time a retained point."""
import copy
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import whole_clip_cleanup as C


def select(points=None, segments=None, **kwargs):
    values = dict(points=points or [dict(t0=1., t1=3., serve_s=None),
                                    dict(t0=10., t1=15., serve_s=11.)],
                  segments=segments or [[.5, 3.5], [9.5, 15.5]],
                  raw_events=[2., 12.], clean_events=[12.], serves=[11.])
    values.update(kwargs)
    return C.retained_indices(**values)


def test_removes_only_unsupported_component():
    assert select() == [1]


@pytest.mark.parametrize('signal', ['serve', 'stamp', 'crossing'])
def test_any_supported_member_protects_entire_connected_export(signal):
    points = [dict(t0=1., t1=3.), dict(t0=3.1, t1=6.)]
    if signal == 'stamp':
        points[1]['serve_s'] = 4.
    assert select(points, [[.5, 6.5]], raw_events=[2., 4.],
                  clean_events=[4.] if signal == 'crossing' else [],
                  serves=[4.] if signal == 'serve' else []) == [0, 1]


def test_missing_observations_are_not_removal_evidence():
    assert select(raw_events=[]) == [0, 1]


@pytest.mark.parametrize('kwargs', [dict(raw_events=[float('nan')]),
    dict(clean_events=[float('inf')]), dict(serves=[None]),
    dict(segments=[[.5, .4]]), dict(segments=[[.5, 2.]]),
    dict(points=[dict(t0=float('nan'), t1=3.)])])
def test_malformed_or_uncovered_input_preserves_every_card(kwargs):
    n = len(kwargs.get('points', [0, 1]))
    assert select(**kwargs) == list(range(n))


def test_track_filter_keeps_entire_near_table_tracklet_without_mutation():
    track={0:(5., 5.), 1:(6., 5.), 30:(100., 100.),31:(101.,100.)}
    before=copy.deepcopy(track)
    assert C.filter_track(track, 30., [[0.,0.],[10.,0.],[10.,20.],[0.,20.]]) == {0:(5.,5.),1:(6.,5.)}
    assert track == before


def test_original_or_new_serve_protects_even_before_point_start():
    assert select(serves=[.5, 11.]) == [0, 1]


def test_second_opinion_evidence_uses_only_supplied_track_without_mutation():
    import points_v2
    corners={'A_near_1':[0.,100.], 'B_near_2':[100.,100.],
             'C_far_2':[100.,0.], 'D_far_1':[0.,0.]}
    track={0:(10.,50.), 1:(20.,50.)}
    before=copy.deepcopy(track)
    evidence=points_v2.Evidence({}, corners, None, 30., 2., 1920, track=track)
    assert evidence.track == before
    assert evidence.track is not track
    assert track == before


def test_cleanup_failure_returns_same_cards_and_reports_reason():
    cards=[dict(t0=1.,t1=3.)]
    kept, info=C.process_cards(cards, [[.5,3.5]], None, None, 1920, {}, [])
    assert kept is cards
    assert info['status']=='not_applied'


def test_cleanup_bad_evidence_does_not_take_down_original_pipeline():
    cards=[dict(t0=1.,t1=3.)]
    kept, info=C.process_cards(cards, [[.5,3.5]], object(), {'bad':1}, 1920, {}, [])
    assert kept is cards
    assert info['status']=='error'


def test_final_body_note_uses_published_cards_and_keeps_other_provenance():
    import points_pipeline as pipe
    notes=['points v2: 93 cards',
           'points bodies: 88 cards, 79 with a serve, model body-v2, ball cards kept 93']
    points=[dict(t0=1.,t1=3.,serve_s=2.),dict(t0=10.,t1=13.,serve_s=None)]
    result=pipe.final_body_notes(notes,points)
    assert result==['points v2: 93 cards',
                   'points bodies: 2 cards, 1 with a serve, model body-v2, ball cards kept 93']
    assert notes[1].startswith('points bodies: 88')
