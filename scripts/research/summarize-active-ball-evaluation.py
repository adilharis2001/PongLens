"""Score all completed responses, including invalid answers, against frozen labels."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'worker'))
from active_ball_benchmark import score

p = argparse.ArgumentParser()
p.add_argument('run', type=Path)
p.add_argument('--prior-run', type=Path)
a = p.parse_args()
rows = json.loads((a.run / 'benchmark.json').read_text())
responses = [json.loads(f.read_text()) for f in (a.run / 'responses').glob('*.json')]
by_id = {r['id']: r for r in responses}
assert len(by_id) == len(responses), 'Duplicate sample response'
assert set(by_id) <= {r['id'] for r in rows}, 'Unknown sample response'
completed = [r for r in rows if r['id'] in by_id]
predictions = {r['id']: r.get('prediction') for r in responses}
result = {
    'planned': len(rows), 'completed': len(completed),
    'estimated_usd': sum(r.get('estimated_usd', 0) for r in responses),
    'completed_metrics': score(completed, predictions),
    'by_venue': {v: score([r for r in completed if r['venue'] == v], predictions)
                 for v in sorted({r['venue'] for r in completed})},
}
if a.prior_run:
    prior = [json.loads(f.read_text()) for f in (a.prior_run / 'responses').glob('*.json')]
    prior_ids = {r['id'] for r in prior}
    overlap = [r for r in completed if r['id'] in prior_ids]
    result['previously_evaluated_subset'] = score(overlap, predictions)
    result['prior_on_same_subset'] = score(overlap, {r['id']: r.get('prediction') for r in prior})
    result['not_previously_evaluated_subset'] = score([r for r in completed if r['id'] not in prior_ids], predictions)
(a.run / 'summary.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
