import unittest

from worker.active_ball_data import validate_dataset
from worker.active_ball_scale_data import sample_times, validate_recording_splits, teacher_manifest


class ScaleCorpusTests(unittest.TestCase):
    def test_sampling_is_deterministic_balanced_and_clear_of_edges(self):
        points = [{'t0': 5.0, 't1': 10.0}, {'t0': 15.0, 't1': 20.0}, {'t0': 24.0, 't1': 32.0}]
        first = sample_times(points, 40.0, rally_count=6, gap_count=3, seed=7)
        second = sample_times(points, 40.0, rally_count=6, gap_count=3, seed=7)
        self.assertEqual(first, second)
        self.assertEqual(sum(kind == 'rally' for _, kind in first), 6)
        self.assertEqual(sum(kind == 'gap' for _, kind in first), 3)
        self.assertTrue(all(1.2 <= time <= 38.8 for time, _ in first))
        self.assertTrue(all(b[0] - a[0] >= .35 for a, b in zip(first, first[1:])))

    def test_gap_samples_respect_rally_sample_spacing(self):
        rows = sample_times([{'t0': 5.0, 't1': 10.0}], 15.0, rally_count=8, gap_count=4, seed=12)
        self.assertTrue(all(b[0] - a[0] >= .4 for a, b in zip(rows, rows[1:])))

    def test_recording_hash_cannot_cross_splits(self):
        validate_recording_splits([{'source_sha256': 'a', 'split': 'train'}, {'source_sha256': 'b', 'split': 'test'}])
        with self.assertRaisesRegex(ValueError, 'recording leaks'):
            validate_recording_splits([{'source_sha256': 'a', 'split': 'train'}, {'source_sha256': 'a', 'split': 'test'}])

    def test_scale_dataset_can_repeat_a_venue_but_not_a_match(self):
        base = {'width': 100, 'height': 100, 'frame': 1, 'time_s': 1.0, 'label': None, 'venue': 'V'}
        rows = [{**base, 'id': 'a', 'match_id': 'A', 'split': 'train', 'source_sha256': 'a'},
                {**base, 'id': 'b', 'match_id': 'B', 'split': 'test', 'source_sha256': 'b'}]
        validate_dataset(rows, allow_shared_venues=True)
        with self.assertRaisesRegex(ValueError, 'venue leaks'):
            validate_dataset(rows)

    def test_teacher_manifest_preserves_metadata_and_skips_unusable_answers(self):
        rows = [{'id': 'a', 'split': 'train', 'venue': 'V', 'source_sha256': 's'},
                {'id': 'b', 'split': 'test', 'venue': 'W', 'source_sha256': 't'}]
        responses = {'a': {'prediction': {'state': 'visible', 'x': 12.0, 'y': 8.0, 'reason': 'ball'}},
                     'b': {'prediction': None}}
        result = teacher_manifest(rows, responses, 'gemini_3_8_flash_prompt3')
        self.assertEqual(result[0]['split'], 'train')
        self.assertEqual(result[0]['source_sha256'], 's')
        self.assertEqual(result[0]['label'], {'state': 'visible', 'x': 12.0, 'y': 8.0, 'provenance': 'gemini_3_8_flash_prompt3'})
        self.assertIsNone(result[1]['label'])
        self.assertEqual(result[1]['teacher_status'], 'unusable')


if __name__ == '__main__':
    unittest.main()
