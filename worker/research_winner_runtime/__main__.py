"""JSON stdin/stdout boundary for offline copied-worker subprocesses."""
import argparse
import json
import sys
from . import score_point


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-evaluation', action='store_true', help='Permit explicitly marked held-recording fixtures')
    args = parser.parse_args()
    request = json.load(sys.stdin)
    result = score_point(request['input'], request['artifact'], request['baseline'],
                         allow_evaluation=args.allow_evaluation)
    # Diagnostics can be large; preserve features and scores but keep the worker reply bounded.
    result.pop('path', None)
    result.pop('history', None)
    json.dump(result, sys.stdout, allow_nan=False)
    sys.stdout.write('\n')


if __name__ == '__main__':
    main()
