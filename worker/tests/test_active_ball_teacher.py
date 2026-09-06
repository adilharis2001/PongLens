import unittest

from worker.active_ball_teacher import assign_candidate_targets, select_operating_point, score_predictions


class TeacherTrainingTests(unittest.TestCase):
    def test_visible_label_uses_nearest_candidate_and_ignores_boundary_band(self):
        candidates = [{'x': 12, 'y': 10}, {'x': 35, 'y': 10}, {'x': 80, 'y': 10}]
        labels = assign_candidate_targets(candidates, {'state': 'visible', 'x': 10, 'y': 10})
        self.assertEqual(labels, [1, None, 0])

    def test_nonvisible_label_makes_every_candidate_negative(self):
        candidates = [{'x': 12, 'y': 10}, {'x': 80, 'y': 10}]
        self.assertEqual(assign_candidate_targets(candidates, {'state': 'hidden', 'x': None, 'y': None}), [0, 0])

    def test_operating_point_uses_validation_rows_only(self):
        rows = [
            {'id': 'train', 'split': 'train', 'label': {'state': 'visible', 'x': 0, 'y': 0}},
            {'id': 'v1', 'split': 'validation', 'label': {'state': 'visible', 'x': 10, 'y': 10}},
            {'id': 'v2', 'split': 'validation', 'label': {'state': 'absent', 'x': None, 'y': None}},
        ]
        ranked = {
            'train': [{'x': 0, 'y': 0, 'score': .99}],
            'v1': [{'x': 11, 'y': 10, 'score': .8}, {'x': 60, 'y': 60, 'score': .2}],
            'v2': [{'x': 40, 'y': 40, 'score': .6}],
        }
        chosen = select_operating_point(rows, ranked, thresholds=[.5, .7, .9], margins=[0])
        self.assertEqual(chosen['threshold'], .7)
        self.assertEqual(chosen['metrics']['samples'], 2)

    def test_scoring_keeps_visible_and_negative_denominators(self):
        rows = [
            {'id': 'a', 'venue': 'V', 'label': {'state': 'visible', 'x': 10, 'y': 10}},
            {'id': 'b', 'venue': 'V', 'label': {'state': 'visible', 'x': 20, 'y': 20}},
            {'id': 'd', 'venue': 'V', 'label': {'state': 'visible', 'x': 100, 'y': 100}},
            {'id': 'c', 'venue': 'W', 'label': {'state': 'absent', 'x': None, 'y': None}},
        ]
        predictions = {'a': {'state': 'visible', 'x': 12, 'y': 10},
                       'b': {'state': 'hidden', 'x': None, 'y': None},
                       'd': {'state': 'visible', 'x': 150, 'y': 150},
                       'c': {'state': 'visible', 'x': 5, 'y': 5}}
        proposals = {'a': 2.0, 'b': 999.0, 'c': None}
        result = score_predictions(rows, predictions, proposals)
        self.assertEqual(result['visible_reference'], 3)
        self.assertEqual(result['within_20px'], 1)
        self.assertEqual(result['visible_missed'], 2)
        self.assertEqual(result['visible_abstained'], 1)
        self.assertEqual(result['wrong_location'], 1)
        self.assertEqual(result['false_visible'], 1)
        self.assertEqual(result['proposal_within_20px'], 1)
        self.assertEqual(result['by_venue']['V']['samples'], 3)


if __name__ == '__main__':
    unittest.main()
