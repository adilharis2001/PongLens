import unittest
from worker.active_ball_data import validate_dataset, training_rows


def row(sample, match, venue, split, state='visible', reviewed=True):
    return dict(id=sample, match_id=match, venue=venue, split=split,
                frame=10, time_s=1/3, width=1920, height=1080,
                label=dict(state=state, x=500 if state == 'visible' else None,
                           y=400 if state == 'visible' else None,
                           provenance='human' if reviewed else 'proposal'))


class DatasetTests(unittest.TestCase):
    def test_match_cannot_leak_between_splits(self):
        with self.assertRaisesRegex(ValueError, 'match'):
            validate_dataset([row('a','m','v','train'), row('b','m','v','test')])

    def test_held_out_venue_cannot_leak_into_training(self):
        with self.assertRaisesRegex(ValueError, 'venue'):
            validate_dataset([row('a','m1','v','train'), row('b','m2','v','test')])

    def test_duplicate_recording_cannot_leak_under_different_match_names(self):
        a=row('a','m1','v1','train');b=row('b','m2','v2','test')
        a['source_sha256']=b['source_sha256']='same-recording'
        with self.assertRaisesRegex(ValueError,'recording'):
            validate_dataset([a,b])

    def test_unreviewed_and_unsure_are_never_negative_truth(self):
        rows = [row('a','m','v','train'), row('b','m','v','train',reviewed=False),
                row('c','m','v','train',state='unsure'), row('d','m','v','train',state='absent')]
        self.assertEqual([r['id'] for r in training_rows(rows)], ['a','d'])

    def test_source_pixel_coordinates_must_be_inside_frame(self):
        r = row('a','m','v','train'); r['label']['x'] = 1920
        with self.assertRaisesRegex(ValueError, 'coordinates'):
            validate_dataset([r])

    def test_hidden_state_cannot_invent_a_location(self):
        r = row('a','m','v','train'); r['label']['state'] = 'hidden'
        with self.assertRaisesRegex(ValueError, 'coordinates'):
            validate_dataset([r])


if __name__ == '__main__':
    unittest.main()
