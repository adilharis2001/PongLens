import json
import os
import subprocess

import pytest

import worker


def make_cut(path, *, audio=True):
    command = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=6",
    ]
    if audio:
        command += [
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6",
            "-map", "0:v", "-map", "1:a", "-c:a", "aac",
        ]
    else:
        command += ["-map", "0:v", "-an"]
    command += [
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30",
        "-movflags", "+faststart", str(path),
    ]
    subprocess.run(command, check=True)


def manifest():
    return {
        "v": 1,
        "rule": "quality-first-v1",
        "max_seconds": 150.0,
        "points_revision": "a" * 64,
        "duration_s": 3.7,
        "points": [
            {
                "point_id": "p1",
                "cut_start_s": 0.0,
                "cut_end_s": 2.0,
                "output_start_s": 0.0,
                "output_end_s": 2.0,
                "n_hits": 7,
                "connected_crossings": 6,
                "table_bounces": 3,
            },
            {
                "point_id": "p2",
                "cut_start_s": 3.0,
                "cut_end_s": 5.0,
                "output_start_s": 1.7,
                "output_end_s": 3.7,
                "n_hits": 6,
                "connected_crossings": 5,
                "table_bounces": 3,
            },
        ],
    }


def packet_times(path, stream):
    raw = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", stream,
        "-show_entries", "packet=dts_time", "-of", "json", str(path),
    ])
    rows = json.loads(raw)["packets"]
    return [float(row["dts_time"]) for row in rows if "dts_time" in row]


def keyframe_times(path):
    raw = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-skip_frame", "nokey", "-show_entries",
        "frame=best_effort_timestamp_time", "-of", "json", str(path),
    ])
    return [
        float(row["best_effort_timestamp_time"])
        for row in json.loads(raw)["frames"]
        if "best_effort_timestamp_time" in row
    ]


@pytest.mark.parametrize("source_has_audio", [True, False])
def test_renders_one_continuous_faststart_mp4_with_uniform_audio(
    tmp_path, source_has_audio
):
    cut = tmp_path / "cut.mp4"
    make_cut(cut, audio=source_has_audio)

    out, rendered_manifest = worker.render_auto_highlights(
        manifest(), str(cut), str(tmp_path)
    )

    assert os.path.exists(out)
    probe = worker._ffprobe_streams(out)
    video = next(s for s in probe["streams"] if s["codec_type"] == "video")
    audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
    assert video["codec_name"] == "h264"
    assert video["pix_fmt"] == "yuv420p"
    assert audio["codec_name"] == "aac"
    assert int(audio["sample_rate"]) == 48000
    assert int(audio["channels"]) == 2

    duration = float(probe["format"]["duration"])
    assert duration == pytest.approx(3.7, abs=0.18)
    assert rendered_manifest["duration_s"] == pytest.approx(duration, abs=0.02)
    assert rendered_manifest["points"][1]["output_start_s"] == pytest.approx(
        rendered_manifest["points"][0]["output_end_s"] - 0.3,
        abs=0.04,
    )

    data = open(out, "rb").read()
    assert data.find(b"moov") < data.find(b"mdat")
    for selector in ("v:0", "a:0"):
        times = packet_times(out, selector)
        assert times
        assert times == sorted(times)
        assert min(times) > -0.2
    keys = keyframe_times(out)
    assert keys
    assert max((b - a for a, b in zip(keys, keys[1:])), default=0) <= 1.05


def test_refuses_an_empty_manifest(tmp_path):
    cut = tmp_path / "cut.mp4"
    make_cut(cut)
    empty = manifest()
    empty["points"] = []
    with pytest.raises(ValueError, match="no points"):
        worker.render_auto_highlights(empty, str(cut), str(tmp_path))
