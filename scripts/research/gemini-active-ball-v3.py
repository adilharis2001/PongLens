"""Prompt 2 with sufficient output budget after the format pilot truncated answers."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('gemini_prompt2', Path(__file__).with_name('gemini-active-ball-v2.py'))
revision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(revision)
revision.runner.CONFIG = {**revision.runner.CONFIG, 'maxOutputTokens': 8192}

if __name__ == '__main__':
    revision.runner.main()
