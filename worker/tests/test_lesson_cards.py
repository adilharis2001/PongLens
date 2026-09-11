"""The two cards that bracket a recap: what the lesson was for, and what to
take away.

The card at the front is the interesting one. It pushes every chapter later
in the finished video, and that position is what both apps, the public page
and the downloadable cut all seek by, so these tests hold the arithmetic.
"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker.lesson_video import (MAX_GOALS, MAX_WORK_ON, card_seconds, normalize_edit,
                                 render, render_share_file, tighten_edit)

CHAPTERS = [{'title': 'One', 'cues': ['Keep this supported instruction.'], 'start_s': 30, 'end_s': 60},
            {'title': 'Two', 'cues': ['Keep this one as well.'], 'start_s': 120, 'end_s': 165}]
GOALS = ['You are working on your backhand opening.', 'You are working on reading the serve.']
WORK_ON = ['Practise recovering between shots.', 'Wait for the bounce before you commit.']


def edit(**over):
    return normalize_edit({'title': 'Lesson', 'chapters': CHAPTERS, **over}, 600)


def commands(calls):
    return [' '.join(str(x) for x in c.args[0]) for c in calls]


class CardTimingTests(unittest.TestCase):
    def test_a_lesson_that_stated_nothing_gets_no_card(self):
        self.assertEqual(card_seconds([]), 0.0)
        self.assertEqual(card_seconds(None), 0.0)
        made = edit()
        self.assertNotIn('goals', made)
        self.assertNotIn('work_on', made)

    def test_a_card_is_long_enough_to_read_and_never_endless(self):
        self.assertEqual(card_seconds(['a']), 5.1)
        self.assertEqual(card_seconds(['a', 'b']), 6.7)
        self.assertEqual(card_seconds(['a'] * 20), 12.0)

    def test_the_goals_card_pushes_every_chapter_later(self):
        plain = edit()
        with_goals = edit(goals=GOALS)
        lead = card_seconds(GOALS)
        self.assertEqual(plain['chapters'][0]['summary_start_s'], 0)
        self.assertEqual(with_goals['chapters'][0]['summary_start_s'], lead)
        self.assertEqual(with_goals['chapters'][1]['summary_start_s'],
                         plain['chapters'][1]['summary_start_s'] + lead)

    def test_the_closing_card_moves_nothing(self):
        self.assertEqual(edit(work_on=WORK_ON)['chapters'], edit()['chapters'])

    def test_the_cards_do_not_eat_the_fifteen_minute_budget(self):
        # 896 seconds of chapters sits just inside the limit; the two cards
        # would carry it past 900 if they were counted against it.
        long_chapters = [{'title': f'C{i}', 'cues': ['Keep this instruction.'],
                          'start_s': i * 130, 'end_s': i * 130 + 112} for i in range(8)]
        made = normalize_edit({'title': 'Lesson', 'chapters': long_chapters, 'goals': GOALS, 'work_on': WORK_ON}, 2000)
        self.assertEqual(len(made['chapters']), 8)
        self.assertGreater(made['chapters'][-1]['summary_end_s'], 900)


class CardContentTests(unittest.TestCase):
    def test_the_lists_are_capped_and_trimmed(self):
        made = edit(goals=['  g%d  ' % i for i in range(9)], work_on=['w%d' % i for i in range(9)])
        self.assertEqual(len(made['goals']), MAX_GOALS)
        self.assertEqual(len(made['work_on']), MAX_WORK_ON)
        self.assertEqual(made['goals'][0], 'g0')

    def test_blank_lines_are_dropped_rather_than_drawn(self):
        made = edit(goals=['A real goal.', '   ', ''])
        self.assertEqual(made['goals'], ['A real goal.'])

    def test_a_list_never_says_the_same_thing_twice(self):
        made = tighten_edit(edit(work_on=[
            'When a ball is difficult to read, wait for the bounce and react quickly.',
            "When a ball's bounce is difficult to read, wait for the bounce and then react quickly.",
            'Practise recovering between shots.']))
        self.assertEqual(len(made['work_on']), 2)

    def test_a_takeaway_may_repeat_what_the_notes_already_say(self):
        # Adil, 2026-09-11: the short list is read on the way home, so it is
        # meant to restate the fuller notes rather than avoid them.
        line = 'Practise recovering between shots.'
        made = tighten_edit(edit(work_on=[line], themes=[{'name': 'Recovery', 'points': [line]}]))
        self.assertEqual(made['work_on'], [line])
        self.assertEqual(made['themes'][0]['points'], [line])


class CardRenderTests(unittest.TestCase):
    def render(self, made, panels=False):
        # The render checks its own output against the clock it planned, so
        # the stub answers with the length that plan implies.
        length = (sum(c['end_s'] - c['start_s'] for c in made['chapters'])
                  + card_seconds(made.get('goals')) + card_seconds(made.get('work_on')))
        with tempfile.TemporaryDirectory() as directory, \
             patch('worker.lesson_video.run') as run_, \
             patch('worker.lesson_video.draw_card') as card, \
             patch('worker.lesson_video.draw_panel'), \
             patch('worker.lesson_video.lesson_color_filter', return_value=''), \
             patch('worker.lesson_video.probe', return_value={'format': {'duration': str(length)}, 'streams': []}):
            render(Path(directory) / 'source.mov', made, directory, panels=panels)
            return commands(run_.mock_calls), [c.args[0] for c in card.mock_calls]

    def test_both_cuts_open_and_close_on_the_cards(self):
        cmds, headings = self.render(edit(goals=GOALS, work_on=WORK_ON), panels=True)
        self.assertEqual(headings, ['Lesson goals', 'Things to work on'])
        concats = [c for c in cmds if '-f concat' in c]
        self.assertEqual(len(concats), 2)

    def test_a_lesson_with_neither_list_renders_exactly_as_before(self):
        cmds, headings = self.render(edit())
        self.assertEqual(headings, [])
        self.assertFalse([c for c in cmds if 'anullsrc' in c])

    def test_the_card_clip_is_silent_and_matches_the_chapters_around_it(self):
        cmds, _ = self.render(edit(goals=GOALS))
        card = next(c for c in cmds if 'anullsrc' in c)
        self.assertIn('-ar 48000 -ac 2', card)
        self.assertIn(f'-t {card_seconds(GOALS)}', card)


class ShareFileCardTests(unittest.TestCase):
    def test_the_downloadable_cut_carries_the_cards_across(self):
        made = edit(goals=GOALS, work_on=WORK_ON)
        with tempfile.TemporaryDirectory() as directory, \
             patch('worker.lesson_video.run') as run_, \
             patch('worker.lesson_video.draw_panel'), \
             patch('worker.lesson_video.probe', return_value={'format': {'duration': str(
                 sum(c['summary_end_s'] - c['summary_start_s'] for c in made['chapters'])
                 + card_seconds(made.get('goals')) + card_seconds(made.get('work_on')))}}):
            render_share_file(Path(directory) / 'playback.mp4', made, directory)
            cmds = commands(run_.mock_calls)
        # The cards are already drawn into the clean recap, so they are copied
        # without a panel: first the opening stretch, last the closing one.
        plain = [c for c in cmds if 'overlay=' not in c and '-f concat' not in c]
        self.assertEqual(len(plain), 2)
        self.assertIn(f'-ss 0 -t {card_seconds(GOALS)}', plain[0])
        self.assertIn(f"-ss {made['chapters'][-1]['summary_end_s']}", plain[1])


class PosterTests(unittest.TestCase):
    def test_the_poster_skips_the_card_and_shows_the_lesson(self):
        from worker.lesson_video import write_lesson_poster
        with tempfile.TemporaryDirectory() as directory, patch('worker.lesson_video.run') as run_:
            write_lesson_poster(Path(directory) / 'playback.mp4', directory, card_seconds(GOALS))
            self.assertIn(f'-ss {round(card_seconds(GOALS) + 0.1, 3)}', commands(run_.mock_calls)[0])
        with tempfile.TemporaryDirectory() as directory, patch('worker.lesson_video.run') as run_:
            write_lesson_poster(Path(directory) / 'playback.mp4', directory)
            self.assertIn('-ss 0.1', commands(run_.mock_calls)[0])


if __name__ == '__main__':
    unittest.main()
