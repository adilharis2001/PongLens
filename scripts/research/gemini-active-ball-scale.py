#!/usr/bin/env python3
"""Gemini 3.8 Flash Prompt 3 runner for the independent scale corpus."""
import importlib.util
from pathlib import Path


spec = importlib.util.spec_from_file_location("gemini_runner", Path(__file__).with_name("gemini-active-ball.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
runner.PROMPT = Path(__file__).with_name("gemini-active-ball-prompt3.txt").read_text()
runner.CONFIG = {**runner.CONFIG, "maxOutputTokens": 8192}
runner.CONTEXT_MODE = "normalized"


if __name__ == "__main__":
    runner.main()
