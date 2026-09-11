"""Attempt provenance, independent of whether usable media was delivered.

Only bounded reason codes leave the worker. The spool lives outside releases
and survives temporary database outages and process restarts.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import fcntl
import json
import logging
import os
from pathlib import Path
import tempfile
import subprocess

log = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc).isoformat()


def failure(stage, exc):
    """Classify known evidence refusals; unfamiliar exceptions stay errors."""
    message = str(exc)
    expected = {
        'both players seen in only': 'low_player_coverage',
        'only ': 'insufficient_pose_samples',
        'no table': 'no_table',
        'the decoder found no play': 'no_play_found',
        'the body assembler produced no cards': 'no_body_cards',
    }
    if type(exc).__name__ == 'BodyPointsUnavailable':
        for prefix, reason in expected.items():
            if message.startswith(prefix):
                return {'status': 'refused', 'reason_code': reason}
    kind = type(exc).__name__
    reason = f'{stage}_timeout' if isinstance(exc, (TimeoutError, subprocess.TimeoutExpired)) else f'{stage}_exception'
    return {'status': 'error', 'reason_code': reason, 'error_kind': kind[:80]}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, sort_keys=True, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def spool_root():
    return Path(os.environ.get('PONGLENS_PROCESSING_SPOOL',
        str(Path.home() / 'Library/Application Support/PongLensProcessingHealth/spool')))


@contextmanager
def spool_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.lock').open('a') as stream:
        fcntl.flock(stream, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(stream, fcntl.LOCK_UN)


def remove_delivered(path, record):
    # Compare and unlink under the same lock as publish, so a started
    # snapshot can never unlink a newer completion written by the worker.
    with spool_lock(path.parent):
        if path.exists() and json.loads(path.read_text()) == record:
            path.unlink()


def publish(record, send, directory=None):
    """Spool first, then deliver; no telemetry exception escapes into a job."""
    directory = Path(directory) if directory is not None else spool_root()
    path = directory / (hashlib.sha256(record['attempt_key'].encode()).hexdigest() + '.json')
    try:
        with spool_lock(directory):
            atomic_json(path, record)
    except Exception:
        log.exception('processing outcome spool unavailable')
        # Try the database even if local persistence failed.
        try:
            send(record)
            return True
        except Exception:
            log.exception('processing outcome delivery unavailable')
            return False
    try:
        send(record)
        # A concurrent monitor may already have delivered this snapshot.
        remove_delivered(path, record)
        return True
    except Exception:
        log.warning('processing outcome queued for retry', exc_info=True)
        return False


def flush_spool(send, directory=None):
    directory = Path(directory) if directory is not None else spool_root()
    count = 0
    for path in sorted(directory.glob('*.json')):
        try:
            record = json.loads(path.read_text())
            send(record)
            remove_delivered(path, record)
            count += 1
        except Exception:
            log.warning('processing outcome retry pending: %s', path.name)
    return count


def database_sender(connection):
    def send(record):
        with connection.cursor() as cursor:
            cursor.execute('select public.record_worker_processing_run(%s::jsonb)',
                           (json.dumps(record, allow_nan=False),))
    return send


@dataclass
class ProcessingRun:
    attempt_key: str
    job_id: str
    requested_pipeline: str
    settings: dict
    release_id: str | None = None
    body_model: str | None = None
    started_at: str = field(default_factory=now)
    finished_at: str | None = None
    delivered_pipeline: str | None = None
    status: str = 'running'
    reason_code: str | None = None
    body: dict = field(default_factory=dict)
    edges: dict = field(default_factory=dict)
    match_id: str | None = None
    output_ready_at: str | None = None

    def record(self):
        return {'schema': 1, 'attempt_key': self.attempt_key, 'job_id': self.job_id,
                'release_id': self.release_id, 'body_model': self.body_model,
                'requested_pipeline': self.requested_pipeline,
                'delivered_pipeline': self.delivered_pipeline, 'status': self.status,
                'reason_code': self.reason_code, 'started_at': self.started_at,
                'finished_at': self.finished_at, 'match_id': self.match_id,
                'details': {'settings': self.settings, 'body': self.body, 'edges': self.edges,
                            'output_ready_at': self.output_ready_at}}

    def attach(self, path):
        """Decorate the final selected output; never change a card."""
        path = Path(path)
        match = json.loads(path.read_text())
        child = match.get('processing') or {}
        self.delivered_pipeline = match.get('pipeline')
        self.body = self.body or child.get('body') or {}
        self.edges = self.edges or child.get('edges') or {}
        self.body_model = child.get('body_model') or self.body_model
        error = next((x for x in (self.body, self.edges) if x.get('status') == 'error'), None)
        if error:
            self.status, self.reason_code = 'degraded', error.get('reason_code', 'processing_exception')
        elif self.settings.get('config_errors'):
            self.status, self.reason_code = 'degraded', 'config_read_failed'
        elif self.requested_pipeline == 'bodies':
            if self.body.get('status') == 'used' and self.delivered_pipeline == 'bodies':
                self.status, self.reason_code = 'used', None
            elif self.body.get('status') == 'refused':
                self.status, self.reason_code = 'refused', self.body.get('reason_code')
            else:
                self.status, self.reason_code = 'unknown', 'missing_body_outcome'
        elif self.requested_pipeline == 'unknown':
            self.status, self.reason_code = 'unknown', 'config_read_failed'
        else:
            self.status, self.reason_code = 'not_requested', None
        self.output_ready_at = now()
        match['processing'] = {**self.record(), 'body': self.body, 'edges': self.edges}
        atomic_json(path, match)
        return self.record()


def release_identity():
    """No git-derived identity: unsealed runs must identify as unsealed."""
    name = os.environ.get('PONGLENS_MATCH_RELEASE')
    if not name:
        return None, os.environ.get('PONGLENS_BODY_MODEL')
    manifest = json.loads((Path(name) / 'manifest.json').read_text())
    model = manifest.get('body_model')
    if isinstance(model, dict):
        model = model.get('version')
    return manifest['release_id'], model


def configuration(options, get_config):
    """One body configuration snapshot, retaining the existing fail-open defaults."""
    errors = []
    pipeline = options.get('points_pipeline')
    source = 'job'
    if pipeline not in ('v1', 'v2', 'bodies'):
        source = 'app_config'
        try:
            pipeline = get_config('points_pipeline')
            pipeline = pipeline if pipeline in ('v2', 'bodies') else 'v1'
        except Exception:
            errors.append('points_pipeline')
            source, pipeline = 'unavailable', 'v1'
    try:
        anchor = get_config('body_serve_anchor') == 'on'
        close = get_config('body_rally_end') == 'on'
    except Exception:
        errors.append('body_card_edges')
        anchor, close = False, False
    return {'pipeline': pipeline, 'pipeline_source': source,
            'requested_pipeline': 'unknown' if source == 'unavailable' else pipeline,
            'serve_anchor': anchor, 'rally_end': close, 'config_errors': errors}
