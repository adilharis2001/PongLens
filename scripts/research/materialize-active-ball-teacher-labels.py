#!/usr/bin/env python3
"""Join immutable Gemini responses onto the source manifest with provenance."""
import argparse
import hashlib
import json
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from worker.active_ball_data import validate_dataset
from worker.active_ball_scale_data import teacher_manifest


PROVENANCE = "gemini_3_8_flash_prompt3"


def grouped_states(rows, key):
    return {value: {state: sum(row.get("label", {}).get("state") == state for row in rows if row.get("label") and row[key] == value)
                    for state in ("visible", "hidden", "absent", "unsure")}
            for value in sorted({row[key] for row in rows})}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("corpus", type=Path)
    parser.add_argument("run", type=Path)
    args = parser.parse_args()
    manifest_path = args.corpus / "manifest.json"
    inputs_path = args.run / "inputs.json"
    protocol = json.loads((args.run / "protocol.json").read_text())
    if protocol.get("model") != "gemini-3.8-flash":
        raise ValueError("unexpected Gemini model")
    if protocol.get("coordinate_context") != "normalized":
        raise ValueError("scale run must use normalized table coordinates")
    if protocol.get("input_sha256") != hashlib.sha256(inputs_path.read_bytes()).hexdigest():
        raise ValueError("protocol does not fingerprint current inputs")
    expected_prompt = (Path(__file__).with_name("gemini-active-ball-prompt3.txt")).read_text()
    if protocol.get("prompt") != expected_prompt:
        raise ValueError("scale run did not use frozen Prompt 3")

    rows = json.loads(manifest_path.read_text())
    responses = {}
    for path in sorted((args.run / "responses").glob("*.json")):
        response = json.loads(path.read_text())
        responses[response["id"]] = response
    materialized = teacher_manifest(rows, responses, PROVENANCE)
    validate_dataset(materialized, allow_shared_venues=True)
    output = args.run / "teacher-manifest.json"
    output.write_text(json.dumps(materialized, indent=2))
    summary = {
        "rows": len(materialized),
        "usable": sum(row["teacher_status"] == "usable" for row in materialized),
        "unusable": sum(row["teacher_status"] == "unusable" for row in materialized),
        "states": {state: sum(row.get("label", {}).get("state") == state for row in materialized if row.get("label")) for state in ("visible", "hidden", "absent", "unsure")},
        "states_by_split": grouped_states(materialized, "split"),
        "states_by_source": grouped_states(materialized, "source_name"),
        "states_by_venue": grouped_states(materialized, "venue"),
        "states_by_sample_kind": grouped_states(materialized, "sample_kind"),
        "estimated_usd": sum(float(response.get("estimated_usd", 0)) for response in responses.values()),
        "model_versions": sorted({response.get("raw", {}).get("modelVersion", "unknown") for response in responses.values()}),
        "provenance": PROVENANCE,
        "source_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
    }
    (args.run / "teacher-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
