import unittest

import worker.worker as worker


class RawRetentionTests(unittest.TestCase):
    def test_raw_uploads_are_retained_for_thirty_days(self):
        self.assertEqual(worker.R2_RAW_RETENTION_DAYS, 30)
