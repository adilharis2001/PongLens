"""Dump EVERY frame's scene score so the threshold is chosen from data,
and so 'no cuts' is distinguishable from 'nothing decoded'."""
import concurrent.futures as cf, json, os, re, subprocess
import boto3
from botocore.config import Config

def kc(s):
    return subprocess.run(["security","find-generic-password","-a","openclaw",
                           "-s",s,"-w"],capture_output=True,text=True).stdout.strip()
ACC = os.environ.get("R2_ACCOUNT_ID") or kc("ponglens-r2-account")
KEY = os.environ.get("R2_ACCESS_KEY_ID") or kc("ponglens-r2-key-id")
SEC = os.environ.get("R2_SECRET_ACCESS_KEY") or kc("ponglens-r2-secret")
s3 = boto3.client("s3", endpoint_url=f"https://{ACC}.r2.cloudflarestorage.com",
                  aws_access_key_id=KEY, aws_secret_access_key=SEC,
                  region_name="auto", config=Config(signature_version="s3v4"))
def presign(path):
    b,k = path.replace("r2://","").split("/",1)
    return s3.generate_presigned_url("get_object",
        Params={"Bucket":b,"Key":k}, ExpiresIn=10800)

WIN, NWIN, FPS = 60, 4, 5
PAT = re.compile(r"lavfi\.scene_score=([0-9.eE+-]+)")

def window_scores(url, start, dur):
    p = subprocess.run(
        ["ffmpeg","-nostdin","-ss",f"{start:.1f}","-t",f"{dur:.1f}","-i",url,
         "-an","-sn","-vf",
         f"scale=320:-2,fps={FPS},select='gte(scene\\,0)',metadata=print:file=-",
         "-f","null","-"], capture_output=True, text=True, timeout=900)
    return [float(x) for x in PAT.findall(p.stdout)], p.returncode

def run(line):
    label, name, dur, path = line.rstrip("\n").split("\t")
    duration = float(dur)
    span, lo = duration*0.90, duration*0.05
    win = min(WIN, max(span/NWIN, 2.0))
    starts = [lo + (span-win)*i/max(NWIN-1,1) for i in range(NWIN)]
    if span <= win*1.2: starts, win = [lo], span
    url = presign(path)
    all_scores, rcs = [], []
    for s in starts:
        sc, rc = window_scores(url, s, win)
        all_scores += sc[1:]              # drop first frame of each seek
        rcs.append(rc)
    return {"label":label,"name":name,"duration":duration,
            "secs":win*len(starts),"frames":len(all_scores),
            "rc":rcs,"scores":all_scores}

lines=[l for l in open("corpus.tsv") if l.strip()]
with cf.ThreadPoolExecutor(max_workers=6) as ex:
    res=list(ex.map(run,lines))
json.dump(res,open("scores.json","w"))
print(f"{'label':10} {'video':22} {'frames':>7} {'max':>6} {'p99':>6} {'>=.3':>5} {'>=.4':>5} rc")
for r in sorted(res,key=lambda r:(r["label"],-max(r["scores"] or [0]))):
    s=sorted(r["scores"]); n=len(s)
    mx=s[-1] if n else -1; p99=s[int(n*0.99)] if n else -1
    print(f"{r['label']:10} {r['name']:22} {n:7d} {mx:6.2f} {p99:6.2f} "
          f"{sum(1 for x in s if x>=0.3):5d} {sum(1 for x in s if x>=0.4):5d} {set(r['rc'])}")
