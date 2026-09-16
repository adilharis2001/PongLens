"""Exercise the real reclip map without importing the credentialed daemon."""
import ast
import unittest
from pathlib import Path
from worker import cut_timeline

tree = ast.parse((Path(__file__).parents[1]/'worker.py').read_text())
definition = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == '_CutMap')
namespace = {'cut_timeline': cut_timeline}
exec(compile(ast.Module(body=[definition], type_ignores=[]), 'worker.py', 'exec'), namespace)
CutMap = namespace['_CutMap']


class ReclipMeasuredClock(unittest.TestCase):
    def test_reclip_uses_actual_second_segment_offset(self):
        cm = CutMap(dict(cut_segments=[[10,40],[100,130]],
                         cut_segment_offsets=[.021,30.25], points=[]))
        self.assertAlmostEqual(cm.locate(7,105,120),35.25)

    def test_bad_measured_map_refuses_cut_source_not_legacy_guess(self):
        for offsets in ([0], [0,float('nan')], [1,0], None, '12'):
            with self.subTest(offsets=offsets):
                cm=CutMap(dict(cut_segments=[[10,40],[100,130]],
                               cut_segment_offsets=offsets, points=[]))
                self.assertIsNone(cm.locate(7,105,120))

    def test_legacy_match_still_uses_legacy_mapping(self):
        self.assertEqual(CutMap(dict(cut_segments=[[10,40],[100,130]])).locate(7,105,120),35)


if __name__ == '__main__':
    unittest.main()
