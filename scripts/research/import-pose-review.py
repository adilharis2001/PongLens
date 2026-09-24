"""Append the independent 479-point pose review run; default rolls back.

Source/evidence hashes bind suggestions to frozen observations. The older run's
winner predictions and every existing suggestion remain immutable. Pose coverage
is audited by the producer over all candidate × 150 feature values; this importer
checks its finite range and enforces the documented fallback gates.
"""
import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

RUN_ID = 'pose-last-bounce-20260924-v1'
FROZEN_RUN_ID = 'rally-review-20260923-v1'
CORPUS_SIZE = 479


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def shape(value, keys, name):
    require(type(value) is dict and set(value) == set(keys), f'Invalid {name} shape')


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def indexed(records, key, name):
    require(type(records) is list and len(records) == CORPUS_SIZE, f'{name} must contain all 479 points')
    require(all(type(r) is dict and type(r.get(key)) is str for r in records), f'Invalid {name} point ID')
    result = {r[key]: r for r in records}
    require(len(result) == CORPUS_SIZE, f'Duplicate {name} point ID')
    return result


def frozen_winners(payload, frozen):
    require(payload['winner'] == frozen['winner'] and payload['baselineWinner'] == frozen['baselineWinner'], 'Frozen winner predictions changed')


def validate(records, snapshot, frozen_records=None):
    require(type(snapshot) is dict and type(snapshot.get('evidence')) is dict, 'Invalid snapshot')
    rows = indexed(snapshot.get('rows'), 'id', 'Snapshot')
    by_id = indexed(records, 'point_id', 'Predictions')
    require(set(by_id) == set(rows), 'Corpus mismatch')
    require(set(rows) <= set(snapshot['evidence']), 'Missing evidence')
    frozen = indexed(frozen_records, 'point_id', 'Frozen predictions') if frozen_records is not None else None
    if frozen is not None:
        require(set(frozen) == set(rows), 'Frozen corpus mismatch')
    for pid, record in by_id.items():
        shape(record, ['point_id', 'payload', 'source_revision', 'source_sha256'], 'record')
        row, evidence = rows[pid], snapshot['evidence'][pid]
        payload = record['payload']
        shape(payload, ['version', 'runId', 'lastBounce', 'winner', 'baselineWinner', 'ranking'], 'payload')
        require(type(payload['version']) is int and payload['version'] == 2 and payload['runId'] == RUN_ID, 'Wrong payload version or run')
        require(type(record['source_revision']) is int and record['source_revision'] == row['revision'], 'Source revision mismatch')
        require(record['source_sha256'] == digest(dict(source=row['source'], evidence=evidence)), 'Source/evidence hash mismatch')
        winner, bounce, ranking = payload['winner'], payload['lastBounce'], payload['ranking']
        shape(winner, ['side', 'score', 'threshold'], 'winner')
        require(payload['baselineWinner'] in (None, 'near', 'far') and winner['side'] in (None, 'near', 'far'), 'Invalid winner side')
        for key in ['score', 'threshold']:
            value = winner[key]
            require(value is None or (finite(value) and .5 <= value <= 1), f'Invalid winner {key}')
        require(winner['side'] is None or (winner['score'] is not None and winner['threshold'] is not None and winner['score'] >= winner['threshold']), 'Winner does not clear its frozen threshold')
        if frozen is not None:
            frozen_winners(payload, frozen[pid]['payload'])
        shape(ranking, ['method', 'margin', 'poseCoverage', 'candidateCount', 'reason'], 'ranking')
        count, coverage, margin = ranking['candidateCount'], ranking['poseCoverage'], ranking['margin']
        require(type(count) is int and count >= 0, 'Invalid candidate count')
        require(finite(coverage) and 0 <= coverage <= 1, 'Invalid pose coverage')
        require((finite(margin) and margin >= 0) if count >= 2 else margin is None, 'Invalid ranking margin')
        if count == 0:
            require(coverage == 0 and bounce is None, 'No candidates must have no bounce or pose coverage')
            method, reason = 'unavailable', 'no_candidates'
        else:
            require(bounce is not None, 'Candidates require a last bounce')
            method, reason = ('ball_pose', 'available') if coverage >= .6 else ('ball_only', 'sparse_pose' if coverage > 0 else 'missing_pose')
        require(ranking['method'] == method and ranking['reason'] == reason, 'Pose coverage fallback gate mismatch')
        if bounce is not None:
            shape(bounce, ['id', 'rawTime', 'side', 'origin', 'agreement'], 'last bounce')
            require(type(bounce['id']) is str and bounce['side'] in ('near', 'far'), 'Invalid bounce identity or side')
            require(finite(bounce['agreement']) and 0 <= bounce['agreement'] <= 1, 'Invalid bounce agreement')
            source = row['source']
            require(finite(source['start']) and finite(source['end']) and finite(bounce['rawTime']) and source['start'] <= bounce['rawTime'] <= source['end'], 'Invalid bounce timestamp')
            if bounce['origin'] == 'detected':
                require(re.fullmatch(r'detected:(0|[1-9][0-9]*)', bounce['id']) is not None, 'Invalid detected bounce ID')
                index = int(bounce['id'].split(':')[1])
                require(index < len(evidence['bounces']), 'Detected bounce index outside evidence')
                detected_time, offset = evidence['bounces'][index]['t'], evidence['rawOffset']
                require(finite(detected_time) and finite(offset) and abs(detected_time + offset - bounce['rawTime']) < 1e-8, 'Detected bounce timestamp changed')
            else:
                require(bounce['origin'] == 'trajectory' and re.fullmatch(r'added:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', bounce['id']) is not None, 'Invalid trajectory bounce ID')


def transaction(connection, records, snapshot, frozen_records=None):
    """Use the established locked append transaction, with separate v2 run guards."""
    from psycopg2.extras import Json, execute_values
    validate(records, snapshot, frozen_records)
    with connection.cursor() as cursor:
        cursor.execute("set local lock_timeout='10s'; set local statement_timeout='60s'")
        cursor.execute('lock table public.point_ending_research,public.point_ending_suggestions in share row exclusive mode')
        cursor.execute('lock table public.point_ending_evidence,public.point_ending_label_history in share mode')

        def state():
            cursor.execute('select to_jsonb(r) from public.point_ending_research r order by id')
            rows = [r[0] for r in cursor.fetchall()]
            cursor.execute('select to_jsonb(h) from public.point_ending_label_history h order by point_id,revision')
            history = [r[0] for r in cursor.fetchall()]
            return rows, digest(dict(rows=rows, history=history))

        live_rows, before = state()
        live = {r['id']: r for r in live_rows}
        cursor.execute('select point_id::text,payload from public.point_ending_evidence')
        evidence = dict(cursor.fetchall())
        query = 'select point_id::text,run_id,payload,source_revision,source_sha256 from public.point_ending_suggestions order by point_id,run_id'
        cursor.execute(query)
        old = cursor.fetchall()
        existing = {r[0]: r for r in old if r[1] == RUN_ID}
        frozen = {r[0]: r for r in old if r[1] == FROZEN_RUN_ID}
        ids = {r['point_id'] for r in records}
        require(set(frozen) == ids, 'Frozen earlier run is incomplete or has changed corpus')
        require(set(existing) <= ids, 'Existing pose run has unexpected points')
        inserts = []
        for record in records:
            pid = record['point_id']
            require(pid in live and pid in evidence, 'Live source/evidence missing')
            require(digest(dict(source=live[pid]['source'], evidence=evidence[pid])) == record['source_sha256'], 'Source/evidence changed')
            frozen_winners(record['payload'], frozen[pid][2])
            value = (pid, RUN_ID, record['payload'], record['source_revision'], record['source_sha256'])
            if pid in existing:
                require(existing[pid] == value, 'Immutable run differs')
            else:
                inserts.append(value)
        if inserts:
            execute_values(cursor, 'insert into public.point_ending_suggestions(point_id,run_id,payload,source_revision,source_sha256) values %s', [(p, run, Json(v), rev, h) for p, run, v, rev, h in inserts], page_size=500)
        require(state()[1] == before, 'Human labels/history changed')
        cursor.execute(query)
        after = cursor.fetchall()
        by_key = {(r[0], r[1]): r for r in after}
        require(len(after) == len(old) + len(inserts), 'Unexpected suggestion count after append')
        require(all(by_key.get((r[0], r[1])) == r for r in old), 'Earlier suggestions changed')
        require(all(by_key.get((r['point_id'], RUN_ID)) == (r['point_id'], RUN_ID, r['payload'], r['source_revision'], r['source_sha256']) for r in records), 'Inserted suggestions differ')
        return dict(run_id=RUN_ID, points=len(records), inserted=len(inserts), already_present=len(existing), human_history_sha256=before, human_rows_and_history_unchanged=True, prior_suggestions_unchanged=True, frozen_winners_unchanged=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--predictions', type=Path, required=True)
    parser.add_argument('--frozen-predictions', type=Path, help='Optional local copy of the previous run; the database copy is always checked')
    parser.add_argument('--apply', action='store_true', help='Commit after all guards pass; the default rolls back')
    args = parser.parse_args(argv)
    connection = None
    try:
        snapshot = json.loads(args.snapshot.read_text())
        records = json.loads(args.predictions.read_text())
        frozen = json.loads(args.frozen_predictions.read_text()) if args.frozen_predictions else None
        validate(records, snapshot, frozen)
        credential = subprocess.run(['security', 'find-generic-password', '-a', 'openclaw', '-s', 'ponglens-db-url', '-w'], capture_output=True, check=True, text=True).stdout.strip()
        import psycopg2
        connection = psycopg2.connect(credential, connect_timeout=15)
        result = transaction(connection, records, snapshot, frozen)
        if args.apply:
            connection.commit()
        else:
            connection.rollback()
        print(json.dumps(dict(**result, committed=args.apply), allow_nan=False))
    except Exception as error:
        if connection:
            connection.rollback()
        # Never log the exception text: a driver failure can contain credentials.
        print('Import failed; rolled back. Error type: ' + type(error).__name__, file=sys.stderr)
        return 1
    finally:
        if connection:
            connection.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
