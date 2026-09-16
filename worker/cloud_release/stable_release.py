"""Make the sealed verifier's change detection work on a container filesystem.

`match_release` proves a release has not changed in two steps: full content
hashes on first use, then a cheap prefilter on every later check that
compares each file's device, inode, size, mtime and ctime to what it saw
last time. It also refuses to proceed when that metadata differs between
the start and the end of a single verification ("Release changed during
verification"), which is what catches an administrator editing a live
dependency mid-call on the Mac.

On Modal's image filesystem the device and inode numbers are not stable:
reading a file's contents for the first time changes what `stat` reports
for it afterwards. Inside an immutable image that is noise, not a change,
and taken literally it stops the sealed worker from ever claiming a job.

`stabilize` narrows the metadata record to size and mtime, the two fields
the filesystem does keep, and leaves everything else exactly as sealed:
the content hashes, the file inventory, the runtime anchors and the
identity check. The Mac never loads this module.
"""
from __future__ import annotations

import hashlib
from pathlib import Path


def stabilize(match_release) -> None:
    if getattr(match_release, '_ponglens_cloud_stabilized', False):
        return
    original = match_release._inventory

    def _inventory(root, *, anchored=False, metadata=False, filtered=False):
        result = original(root, anchored=anchored, metadata=metadata, filtered=filtered)
        if metadata:
            for record in result.values():
                stat = record.get('stat')
                if stat and len(stat) == 5:
                    # [dev, ino, size, mtime_ns, ctime_ns] -> [size, mtime_ns]
                    record['stat'] = [stat[2], stat[3]]
        return result

    match_release._inventory = _inventory
    match_release._ponglens_original_inventory = original
    match_release._ponglens_cloud_stabilized = True


def diagnose(match_release, root) -> list[str]:
    """Which metadata fields move when a file is read. For the build log."""
    root = Path(root)
    walk = getattr(match_release, '_ponglens_original_inventory', match_release._inventory)
    before = walk(root, metadata=True)
    for path in root.rglob('*'):
        if path.is_file():
            digest = hashlib.sha256()
            with path.open('rb') as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                    digest.update(chunk)
    after = walk(root, metadata=True)
    lines = [f'entries before {len(before)} after {len(after)}']
    names = ('dev', 'ino', 'size', 'mtime_ns', 'ctime_ns')
    shown = 0
    for name in sorted(set(before) | set(after)):
        one, two = before.get(name), after.get(name)
        if one == two:
            continue
        if one and two and one.get('stat') and two.get('stat'):
            moved = [names[i] for i in range(5) if one['stat'][i] != two['stat'][i]]
            lines.append(f'{name or "<root>"}: {moved} changed after reading; {one} -> {two}')
        else:
            lines.append(f'{name or "<root>"}: {one} -> {two}')
        shown += 1
        if shown >= 6:
            break
    return lines
