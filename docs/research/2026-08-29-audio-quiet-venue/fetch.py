"""Audio for a named list of matches, raw if it is still in R2, else the cut.

  ./venv/bin/python fetch.py <work-dir> <match-id> [match-id ...]

Raw is preferred because it holds the real between-point silence; the cut
has only the dead space that survived the trim. Which one a match got is
recorded in info.json so nothing downstream has to guess, and every time
written alongside it says which clock it is on.

Video is deleted as soon as the audio is out. Stereo is kept apart when
the source has two channels.
"""
import json, os, subprocess, sys
import boto3, botocore
import psycopg2, psycopg2.extras

def kc(s):
    return subprocess.check_output(["security","find-generic-password","-a","openclaw","-s",s,"-w"]).decode().strip()

def probe(path):
    out = subprocess.check_output(
        ["ffprobe","-v","error","-select_streams","a:0","-show_entries",
         "stream=channels,sample_rate,codec_name","-show_entries","format=duration",
         "-of","json",path]).decode()
    j = json.loads(out)
    s = (j.get("streams") or [{}])[0]
    s["duration"] = float((j.get("format") or {}).get("duration") or 0)
    return s

def main():
    work = sys.argv[1]; ids = sys.argv[2:]
    os.makedirs(work, exist_ok=True)
    conn = psycopg2.connect(os.environ.get("DATABASE_URL") or kc("ponglens-db-url"))
    conn.set_session(readonly=True)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    acct = kc("ponglens-r2-account")
    s3 = boto3.client("s3", endpoint_url=f"https://{acct}.r2.cloudflarestorage.com",
                      aws_access_key_id=kc("ponglens-r2-key-id"),
                      aws_secret_access_key=kc("ponglens-r2-secret"), region_name="auto")

    def head(path):
        if not path: return None
        try:
            b, k = path.replace("r2://","").split("/",1)
            return s3.head_object(Bucket=b, Key=k)["ContentLength"]
        except botocore.exceptions.ClientError:
            return None

    for mid in ids:
        cur.execute("""select m.id, m.venue, m.opponent_name, m.created_at::date d,
                              m.user_side, m.first_server, m.duration_s, m.cut_path,
                              m.match_json_path, j.input_path
                       from public.matches m left join public.jobs j on j.id=m.job_id
                       where m.id=%s""", (mid,))
        m = cur.fetchone()
        if m is None:
            print(f"{mid}: no such match"); continue
        slug = mid[:8]
        d = os.path.join(work, slug); os.makedirs(d, exist_ok=True)
        mono, st, info_p = (os.path.join(d,"audio.wav"), os.path.join(d,"stereo.wav"),
                            os.path.join(d,"info.json"))
        print(f"\n=== {slug} {m['venue']} / {m['opponent_name']} {m['d']} ===", flush=True)
        if os.path.exists(info_p):
            print("  already have it"); continue
        src, clock = (m["input_path"], "source")
        if head(src) is None:
            src, clock = (m["cut_path"], "cut")
            if head(src) is None:
                print("  nothing in R2 for this match"); continue
        vid = os.path.join(d, "video.mp4")
        b, k = src.replace("r2://","").split("/",1)
        print(f"  downloading {clock} video…", flush=True)
        s3.download_file(b, k, vid + ".part"); os.replace(vid + ".part", vid)
        info = probe(vid)
        print(f"  {info.get('codec_name')} {info.get('channels')}ch "
              f"{info.get('sample_rate')}Hz  {info['duration']:.0f}s", flush=True)
        subprocess.run(["ffmpeg","-y","-loglevel","error","-i",vid,"-vn","-ac","1",
                        "-ar","48000","-c:a","pcm_s16le",mono], check=True)
        if int(info.get("channels") or 1) >= 2:
            subprocess.run(["ffmpeg","-y","-loglevel","error","-i",vid,"-vn","-ac","2",
                            "-ar","48000","-c:a","pcm_s16le",st], check=True)
        os.remove(vid)
        if m["match_json_path"]:
            try:
                b2, k2 = m["match_json_path"].replace("r2://","").split("/",1)
                s3.download_file(b2, k2, os.path.join(d,"match.json"))
            except botocore.exceptions.ClientError:
                pass
        json.dump({"id": mid, "slug": slug, "clock": clock,
                   "venue": m["venue"], "opponent": m["opponent_name"],
                   "date": str(m["d"]), "user_side": m["user_side"],
                   "first_server": m["first_server"], "duration_s": m["duration_s"],
                   "audio": info}, open(info_p,"w"), indent=2)
        print(f"  wrote audio on the {clock} clock", flush=True)

if __name__ == "__main__":
    main()
