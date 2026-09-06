"""Second prompt revision, informed by user feedback on the first 12 results.

Uses the original runner and evaluation contract; run in a separate directory.
"""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('gemini_runner', Path(__file__).with_name('gemini-active-ball.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.PROMPT += '''
Before reporting visible, check the candidate against the BEFORE and AFTER stills and the context clip. White floor/court markings (including pickleball or badminton lines), table edge lines, net tape and small exposed fragments of these lines are common decoys. A player's body may hide most of a straight line, leaving a short white segment that looks like a ball. Check whether the patch connects or aligns with a longer line when the player moves, and whether it remains fixed relative to the floor, table or background. A patch appearing or disappearing because a player uncovers or covers it is not evidence of independent ball motion. Account for camera motion by comparing with nearby background features.
A real ball can be blurred, overlap a line, or move little between two adjacent frames, so do not reject it solely for elongation, proximity to a line, or one small displacement. Establish a consistent ball identity from the wider clip and adjacent frames. Do not extrapolate a coordinate onto a background feature when the actual ball is behind a player or outside the TARGET image. If play continues but the ball itself cannot be seen in TARGET, use hidden; if that cannot be established, use unsure. In the short explanation, state the visual evidence that distinguishes the candidate from a stationary marking, or explains its absence/occlusion.'''

if __name__ == '__main__':
    runner.main()
