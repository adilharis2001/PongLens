import unittest
from datetime import datetime, timedelta, timezone

from worker.worker import unreferenced_entry_objects


class JournalMediaRetentionTests(unittest.TestCase):
    def test_selects_only_old_unreferenced_entry_images(self):
        now = datetime(2026, 7, 29, tzinfo=timezone.utc)
        cutoff = now - timedelta(days=2)
        old_orphan = {
            "Key": "entry/user-1/orphan.jpg",
            "LastModified": cutoff - timedelta(seconds=1),
        }
        referenced = {
            "Key": "entry/user-1/kept.jpg",
            "LastModified": cutoff - timedelta(days=4),
        }
        recent = {
            "Key": "entry/user-1/recent.jpg",
            "LastModified": cutoff + timedelta(seconds=1),
        }

        selected = unreferenced_entry_objects(
            [old_orphan, referenced, recent],
            {"r2://ponglens-media/entry/user-1/kept.jpg"},
            cutoff,
        )

        self.assertEqual(selected, [{"Key": old_orphan["Key"]}])


if __name__ == "__main__":
    unittest.main()
