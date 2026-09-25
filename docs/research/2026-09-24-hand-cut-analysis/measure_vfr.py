"""Read-only step 0b: how many recent originals have a variable frame rate.

For each raw original: presign a GET exactly as the worker does (boto3 against
R2, keys from the login Keychain). Then read ONLY the container's index: walk
the top-level MP4/MOV boxes with small HTTP range requests, fetch the 'moov'
box (a few MB at most), and read the video track's sample tables (stts, ctts,
elst, mdhd). No sample data is downloaded and nothing is decoded.

From the tables: every frame's presentation time, sorted, with the edit list
applied the way players and ffmpeg apply it. Then compare each frame's real
time with the arithmetic the placement job uses today, frame index divided by
the average frame rate (ffprobe avg_frame_rate = frames / duration).
"""
import json
import statistics
import struct
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import boto3
import requests


def keychain(name):
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", "openclaw", "-s", name, "-w"],
        text=True).strip()


account = keychain("ponglens-r2-account")
client = boto3.client(
    "s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
    aws_access_key_id=keychain("ponglens-r2-key-id"),
    aws_secret_access_key=keychain("ponglens-r2-secret"), region_name="auto")


def presign(path):
    bucket, key = path[len("r2://"):].split("/", 1)
    return client.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=3600)


def ranged(url, start, length):
    response = requests.get(
        url, headers={"Range": f"bytes={start}-{start + length - 1}"}, timeout=120)
    response.raise_for_status()
    return response.content


def file_size(url):
    response = requests.get(url, headers={"Range": "bytes=0-0"}, timeout=60)
    response.raise_for_status()
    return int(response.headers["Content-Range"].split("/")[-1])


def find_moov(url):
    size = file_size(url)
    offset = 0
    while offset < size:
        header = ranged(url, offset, 16)
        box_size, kind = struct.unpack(">I4s", header[:8])
        header_len = 8
        if box_size == 1:
            box_size = struct.unpack(">Q", header[8:16])[0]
            header_len = 16
        elif box_size == 0:
            box_size = size - offset
        if kind == b"moov":
            return ranged(url, offset + header_len, box_size - header_len)
        offset += box_size
    raise RuntimeError("no moov box")


def children(data):
    offset = 0
    while offset + 8 <= len(data):
        box_size, kind = struct.unpack(">I4s", data[offset:offset + 8])
        header_len = 8
        if box_size == 1:
            box_size = struct.unpack(">Q", data[offset + 8:offset + 16])[0]
            header_len = 16
        elif box_size == 0:
            box_size = len(data) - offset
        yield kind.decode("latin1"), data[offset + header_len:offset + box_size]
        offset += box_size


def child(data, name):
    for kind, body in children(data):
        if kind == name:
            return body
    return None


def video_track(moov):
    movie_timescale = None
    mvhd = child(moov, "mvhd")
    if mvhd is not None:
        movie_timescale = struct.unpack(">I", mvhd[12:16] if mvhd[0] == 0 else mvhd[20:24])[0]
    for kind, trak in children(moov):
        if kind != "trak":
            continue
        mdia = child(trak, "mdia")
        hdlr = child(mdia, "hdlr")
        if hdlr[8:12] != b"vide":
            continue
        return trak, mdia, movie_timescale
    raise RuntimeError("no video track")


def presentation_times(moov):
    trak, mdia, movie_timescale = video_track(moov)
    mdhd = child(mdia, "mdhd")
    timescale = struct.unpack(">I", mdhd[12:16] if mdhd[0] == 0 else mdhd[20:24])[0]
    stbl = child(child(mdia, "minf"), "stbl")
    stts = child(stbl, "stts")
    count = struct.unpack(">I", stts[4:8])[0]
    deltas = []
    for index in range(count):
        n, delta = struct.unpack(">II", stts[8 + 8 * index:16 + 8 * index])
        deltas.extend([delta] * n)
    dts, total = [], 0
    for delta in deltas:
        dts.append(total)
        total += delta
    offsets = [0] * len(dts)
    ctts = child(stbl, "ctts")
    if ctts is not None:
        version = ctts[0]
        count = struct.unpack(">I", ctts[4:8])[0]
        position = 0
        for index in range(count):
            n, value = struct.unpack(
                ">Ii", ctts[8 + 8 * index:16 + 8 * index])
            for _ in range(n):
                if position < len(offsets):
                    offsets[position] = value
                position += 1
    pts = [d + o for d, o in zip(dts, offsets)]
    # Edit list: the first media-time edit decides where playback starts.
    media_start = 0
    empty = 0
    edts = child(trak, "edts")
    if edts is not None:
        elst = child(edts, "elst")
        version = elst[0]
        count = struct.unpack(">I", elst[4:8])[0]
        position = 8
        for _ in range(count):
            if version == 1:
                duration, media_time = struct.unpack(">Qq", elst[position:position + 16])
                position += 20
            else:
                duration, media_time = struct.unpack(">Ii", elst[position:position + 8])
                position += 12
            if media_time == -1:
                empty += duration
                continue
            media_start = media_time
            break
    shift = (empty / movie_timescale if movie_timescale else 0.0)
    seconds = sorted((p - media_start) / timescale + shift for p in pts)
    # Frames before the edit's start are decoded for reference and never
    # shown (ffmpeg flags them discard; players skip them).
    shown = [s for s in seconds if s >= -1e-9]
    return shown, len(seconds) - len(shown)


def measure(row):
    url = presign(row["raw_path"])
    meta = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=avg_frame_rate,r_frame_rate,nb_frames,codec_name,width,height:format=duration",
         "-of", "json", url], capture_output=True, text=True, timeout=600,
        check=True).stdout)
    st = meta["streams"][0]
    num, den = st["avg_frame_rate"].split("/")
    fps = float(num) / float(den)
    times, hidden = presentation_times(find_moov(url))
    intervals = [b - a for a, b in zip(times, times[1:])]
    median = statistics.median(intervals)
    irregular = sum(1 for d in intervals if abs(d - median) > 0.1 * median)
    drift = [t - i / fps for i, t in enumerate(times)]
    worst = max(range(len(drift)), key=lambda i: abs(drift[i]))
    return {
        "id": row["id"], "cut_source": row["cut_source"], "raw": row["raw_path"],
        "codec": st.get("codec_name"), "size": f"{st.get('width')}x{st.get('height')}",
        "avg_fps": round(fps, 4), "r_fps": st.get("r_frame_rate"),
        "nb_frames": st.get("nb_frames"), "frames": len(times), "hidden": hidden,
        "duration": meta["format"].get("duration"),
        "median_interval_ms": round(median * 1000, 3),
        "min_interval_ms": round(min(intervals) * 1000, 3),
        "max_interval_ms": round(max(intervals) * 1000, 3),
        "irregular_intervals": irregular,
        "irregular_pct": round(100 * irregular / max(1, len(intervals)), 3),
        "max_drift_s": round(abs(drift[worst]), 3),
        "max_drift_frames": round(abs(drift[worst]) * fps, 1),
        "max_drift_at_s": round(times[worst], 1),
    }


def safe(row):
    try:
        return measure(row)
    except Exception as error:  # noqa: BLE001
        return {"id": row["id"], "raw": row["raw_path"], "error": repr(error)[:300]}


def main():
    rows = json.load(open(sys.argv[1]))
    seen, unique = set(), []
    for row in rows:
        if row["raw_path"] in seen:
            continue
        seen.add(row["raw_path"])
        unique.append(row)
    if len(sys.argv) > 3:
        unique = unique[:int(sys.argv[3])]
    results = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for result in pool.map(safe, unique):
            results.append(result)
            print(json.dumps(result), flush=True)
    json.dump(results, open(sys.argv[2], "w"), indent=1)


if __name__ == "__main__":
    main()
