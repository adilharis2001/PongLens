"""Guards against importing invalid or misleading pose review suggestions."""
import copy
import hashlib
import importlib.util
import json
import unittest
import io
import tempfile
from contextlib import redirect_stdout, redirect_stderr
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

path = Path(__file__).with_name('import-pose-review.py')
spec = importlib.util.spec_from_file_location('pose_import', path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture():
    rows, evidence, records = [], {}, []
    for i in range(479):
        pid = f'00000000-0000-4000-8000-{i:012x}'
        source = {'start': 100, 'end': 110, 'fps': 30}
        ev = {'rawOffset': 100, 'bounces': [{'t': 4}, {'t': 6}]}
        rows.append({'id': pid, 'source': source, 'revision': 3})
        evidence[pid] = ev
        h = hashlib.sha256(json.dumps({'source': source, 'evidence': ev}, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        records.append({'point_id': pid, 'source_revision': 3, 'source_sha256': h, 'payload': {
            'version': 2, 'runId': 'pose-last-bounce-20260924-v1',
            'lastBounce': {'id': 'detected:1', 'rawTime': 106, 'side': 'far', 'origin': 'detected', 'agreement': .8},
            'winner': {'side': 'near', 'score': .9, 'threshold': .8}, 'baselineWinner': 'far',
            'ranking': {'method': 'ball_pose', 'margin': .25, 'poseCoverage': .6, 'candidateCount': 2, 'reason': 'available'},
        }})
    return records, {'rows': rows, 'evidence': evidence, 'history': []}


class Validation(unittest.TestCase):
    def setUp(self):
        self.records, self.snapshot = fixture()
        self.payload = self.records[0]['payload']

    def validate(self):
        m.validate(self.records, self.snapshot)

    def rejects(self):
        with self.assertRaises(ValueError):
            self.validate()

    def test_accepts_complete_frozen_corpus(self):
        self.validate()

    def test_accepts_each_coverage_gate_and_single_candidate(self):
        for coverage, method, reason in [(0, 'ball_only', 'missing_pose'), (.599, 'ball_only', 'sparse_pose'), (.6, 'ball_pose', 'available'), (1, 'ball_pose', 'available')]:
            with self.subTest(coverage=coverage):
                self.payload['ranking'].update(poseCoverage=coverage, method=method, reason=reason, candidateCount=1, margin=None)
                self.validate()

    def test_no_candidates_requires_explicit_unavailable_state(self):
        self.payload['lastBounce'] = None
        self.payload['ranking'].update(candidateCount=0, margin=None, poseCoverage=0, method='unavailable', reason='no_candidates')
        self.validate()
        self.payload['ranking']['method'] = 'ball_only'
        self.rejects()

    def test_rejects_partial_duplicate_or_unknown_points(self):
        for transform in [lambda rs: rs.pop(), lambda rs: rs.__setitem__(0, copy.deepcopy(rs[1])), lambda rs: rs[0].__setitem__('point_id', 'unknown')]:
            with self.subTest(transform=transform):
                self.records, self.snapshot = fixture()
                transform(self.records)
                self.rejects()

    def test_rejects_wrong_snapshot_revision_or_evidence_hash(self):
        for field, value in [('source_revision', 4), ('source_revision', True), ('source_sha256', '0' * 64)]:
            with self.subTest(field=field, value=value):
                self.records, self.snapshot = fixture()
                self.records[0][field] = value
                self.rejects()
        self.records, self.snapshot = fixture()
        self.snapshot['evidence'][self.records[0]['point_id']]['bounces'][1]['t'] = 6.1
        self.rejects()

    def test_rejects_wrong_payload_version_run_and_extra_fields(self):
        for field, value in [('version', 1), ('version', True), ('runId', 'rally-review-20260923-v1'), ('extra', 'surprise')]:
            with self.subTest(field=field):
                self.records, self.snapshot = fixture()
                self.records[0]['payload'][field] = value
                self.rejects()

    def test_rejects_malformed_nested_shapes(self):
        for field in ['lastBounce', 'winner', 'ranking']:
            for mutation in ['missing', 'extra', 'list']:
                with self.subTest(field=field, mutation=mutation):
                    self.records, self.snapshot = fixture()
                    p = self.records[0]['payload']
                    if mutation == 'missing': p[field].pop(next(iter(p[field])))
                    elif mutation == 'extra': p[field]['extra'] = 1
                    else: p[field] = []
                    self.rejects()

    def test_rejects_wrong_detected_id_or_timestamp(self):
        for field, value in [('id', 'detected:01'), ('id', 'detected:-1'), ('id', 'detected:2'), ('id', 'added:00000000-0000-4000-8000-000000000000'), ('rawTime', 106.000001), ('rawTime', 111), ('side', 'left'), ('origin', 'invented')]:
            with self.subTest(field=field, value=value):
                self.records, self.snapshot = fixture()
                self.records[0]['payload']['lastBounce'][field] = value
                self.rejects()

    def test_accepts_trajectory_only_with_real_uuid_and_valid_window(self):
        self.payload['lastBounce'].update(id='added:00000000-0000-4000-8000-000000000000', origin='trajectory', rawTime=105)
        self.validate()
        self.payload['lastBounce']['id'] = 'added:' + '-' * 36
        self.rejects()

    def test_rejects_invalid_numbers_in_every_numeric_payload_field(self):
        for group, key in [('lastBounce', 'rawTime'), ('lastBounce', 'agreement'), ('winner', 'score'), ('winner', 'threshold'), ('ranking', 'margin'), ('ranking', 'poseCoverage'), ('ranking', 'candidateCount')]:
            for value in [float('nan'), float('inf'), float('-inf'), True, '0.8']:
                with self.subTest(group=group, key=key, value=value):
                    self.records, self.snapshot = fixture()
                    self.records[0]['payload'][group][key] = value
                    self.rejects()

    def test_rejects_coverage_gate_mismatches_and_invalid_margin(self):
        mutations = [dict(poseCoverage=-.1), dict(poseCoverage=1.1), dict(poseCoverage=0), dict(poseCoverage=.599), dict(method='ball_only'), dict(reason='missing_pose'), dict(margin=-.1), dict(margin=None), dict(candidateCount=1), dict(candidateCount=-1), dict(candidateCount=1.5), dict(method='unavailable', reason='no_candidates'), dict(candidateCount=0, margin=None, poseCoverage=0, method='unavailable', reason='no_candidates')]
        for changes in mutations:
            with self.subTest(changes=changes):
                self.records, self.snapshot = fixture()
                self.records[0]['payload']['ranking'].update(changes)
                self.rejects()

    def test_rejects_missing_bounce_when_candidates_exist(self):
        self.payload['lastBounce'] = None
        self.rejects()

    def test_rejects_invalid_winner_calls_and_agreement(self):
        for group, changes in [('winner', {'score': .7}), ('winner', {'score': None}), ('winner', {'threshold': None}), ('winner', {'side': 'left'}), ('lastBounce', {'agreement': -.1}), ('lastBounce', {'agreement': 1.1})]:
            with self.subTest(group=group, changes=changes):
                self.records, self.snapshot = fixture()
                self.records[0]['payload'][group].update(changes)
                self.rejects()

    def test_optional_frozen_records_protect_winner_and_baseline(self):
        frozen = copy.deepcopy(self.records)
        m.validate(self.records, self.snapshot, frozen)
        self.payload['winner']['side'] = 'far'
        with self.assertRaises(ValueError): m.validate(self.records, self.snapshot, frozen)
        self.payload['winner']['side'] = 'near'
        self.payload['baselineWinner'] = None
        with self.assertRaises(ValueError): m.validate(self.records, self.snapshot, frozen)


class MemoryConnection:
    """External database boundary only; importer still plans and verifies the append."""
    def __init__(self, records, snapshot):
        self.rows = copy.deepcopy(snapshot['rows'])
        self.evidence = copy.deepcopy(snapshot['evidence'])
        self.history = [{'point_id': self.rows[0]['id'], 'revision': 1, 'label': {'note': 'human'}}]
        self.suggestions = [(r['point_id'], m.FROZEN_RUN_ID, copy.deepcopy(r['payload']), r['source_revision'], r['source_sha256']) for r in records]
        self.inserted = 0
        self.committed = self.rolled_back = self.closed = False
        self.after_insert = lambda: None

    def cursor(self): return self
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, query):
        if query.startswith(('set local ', 'lock table ')): self.result = []
        elif query.startswith('select to_jsonb(r)'): self.result = [(copy.deepcopy(r),) for r in self.rows]
        elif query.startswith('select to_jsonb(h)'): self.result = [(copy.deepcopy(r),) for r in self.history]
        elif query.startswith('select point_id::text,payload'): self.result = list(copy.deepcopy(self.evidence).items())
        elif query.startswith('select point_id::text,run_id'): self.result = copy.deepcopy(sorted(self.suggestions, key=lambda r: r[:2]))
        else: raise AssertionError('Unexpected query')
    def fetchall(self): return self.result
    def commit(self): self.committed = True
    def rollback(self): self.rolled_back = True
    def close(self): self.closed = True
    def append(self, cursor, query, values, page_size):
        if not query.startswith('insert into public.point_ending_suggestions('): raise AssertionError('Wrong write table')
        for pid, run, payload, rev, sha in values:
            self.suggestions.append((pid, run, copy.deepcopy(payload.adapted), rev, sha))
        self.inserted += len(values)
        self.after_insert()


class AppendGuards(unittest.TestCase):
    def setUp(self):
        self.records, self.snapshot = fixture()
        self.db = MemoryConnection(self.records, self.snapshot)

    def run_transaction(self):
        with patch('psycopg2.extras.execute_values', self.db.append):
            return m.transaction(self.db, self.records, self.snapshot)

    def test_append_preserves_every_previous_suggestion_and_human_answer(self):
        prior = copy.deepcopy(self.db.suggestions)
        human = copy.deepcopy([self.db.rows, self.db.history])
        result = self.run_transaction()
        self.assertEqual(result['inserted'], 479)
        self.assertEqual(self.db.suggestions[:479], prior)
        self.assertEqual([self.db.rows, self.db.history], human)
        result = self.run_transaction()
        self.assertEqual(result['inserted'], 0)
        self.assertEqual(result['already_present'], 479)
        self.assertEqual(len(self.db.suggestions), 958)

    def test_late_immutable_run_conflict_is_rejected_before_any_insert(self):
        record = copy.deepcopy(self.records[-1])
        record['payload']['lastBounce']['side'] = 'near'
        self.db.suggestions.append((record['point_id'], m.RUN_ID, record['payload'], record['source_revision'], record['source_sha256']))
        with self.assertRaisesRegex(ValueError, 'Immutable run differs'): self.run_transaction()
        self.assertEqual(self.db.inserted, 0)

    def test_live_source_change_is_rejected_before_any_insert(self):
        self.db.rows[-1]['source']['end'] = 111
        with self.assertRaisesRegex(ValueError, 'Source/evidence changed'): self.run_transaction()
        self.assertEqual(self.db.inserted, 0)

    def test_frozen_winner_change_or_missing_old_run_is_rejected_before_insert(self):
        self.records[-1]['payload']['winner']['side'] = 'far'
        with self.assertRaisesRegex(ValueError, 'Frozen winner'): self.run_transaction()
        self.assertEqual(self.db.inserted, 0)
        self.db.suggestions.pop()
        with self.assertRaisesRegex(ValueError, 'Frozen earlier run'): self.run_transaction()
        self.assertEqual(self.db.inserted, 0)

    def test_guard_detects_trigger_changing_human_history_or_old_suggestions(self):
        for target in ['history', 'old']:
            with self.subTest(target=target):
                self.db = MemoryConnection(self.records, self.snapshot)
                def mutate():
                    if target == 'history': self.db.history[0]['label']['note'] = 'changed'
                    else: self.db.suggestions[0][2]['baselineWinner'] = None
                self.db.after_insert = mutate
                with self.assertRaisesRegex(ValueError, 'Human labels/history changed|Earlier suggestions changed'): self.run_transaction()

    def test_cli_rolls_back_by_default_and_commits_only_with_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'snapshot.json').write_text(json.dumps(self.snapshot))
            (root / 'predictions.json').write_text(json.dumps(self.records))
            args = ['--snapshot', str(root / 'snapshot.json'), '--predictions', str(root / 'predictions.json')]
            for apply in [False, True]:
                with self.subTest(apply=apply):
                    self.db = MemoryConnection(self.records, self.snapshot)
                    with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(stdout='private-credential')), patch('psycopg2.connect', return_value=self.db), patch('psycopg2.extras.execute_values', self.db.append), redirect_stdout(io.StringIO()):
                        self.assertEqual(m.main(args + (['--apply'] if apply else [])), 0)
                    self.assertEqual(self.db.committed, apply)
                    self.assertEqual(self.db.rolled_back, not apply)
                    self.assertTrue(self.db.closed)

    def test_cli_rolls_back_a_guard_failure_without_printing_secrets(self):
        self.db.rows[-1]['source']['end'] = 111
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'snapshot.json').write_text(json.dumps(self.snapshot))
            (root / 'predictions.json').write_text(json.dumps(self.records))
            output = io.StringIO()
            with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(stdout='private-credential')), patch('psycopg2.connect', return_value=self.db), redirect_stderr(output):
                self.assertEqual(m.main(['--snapshot', str(root / 'snapshot.json'), '--predictions', str(root / 'predictions.json'), '--apply']), 1)
            self.assertTrue(self.db.rolled_back)
            self.assertFalse(self.db.committed)
            self.assertTrue(self.db.closed)
            self.assertNotIn('private-credential', output.getvalue())


if __name__ == '__main__':
    unittest.main()
