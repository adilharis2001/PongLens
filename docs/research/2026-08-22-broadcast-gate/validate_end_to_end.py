"""End to end against the SHIPPED worker function, on the real corpus.
Scratchpad scripts proved the idea; this proves the code that will run."""
import concurrent.futures as cf, json, os, subprocess, sys, tempfile, glob
sys.path.insert(0,"/Users/adil/Desktop/Projects/PongLens")
import boto3
from botocore.config import Config
from worker import worker as w

def kc(s):
    return subprocess.run(["security","find-generic-password","-a","openclaw",
      "-s",s,"-w"],capture_output=True,text=True).stdout.strip()
ACC=os.environ.get("R2_ACCOUNT_ID") or kc("ponglens-r2-account")
KEY=os.environ.get("R2_ACCESS_KEY_ID") or kc("ponglens-r2-key-id")
SEC=os.environ.get("R2_SECRET_ACCESS_KEY") or kc("ponglens-r2-secret")
s3=boto3.client("s3",endpoint_url=f"https://{ACC}.r2.cloudflarestorage.com",
  aws_access_key_id=KEY,aws_secret_access_key=SEC,region_name="auto",
  config=Config(signature_version="s3v4"))
def presign(p):
    b,k=p.replace("r2://","").split("/",1)
    return s3.generate_presigned_url("get_object",
      Params={"Bucket":b,"Key":k},ExpiresIn=14400)

rows=[l.rstrip("\n").split("\t") for l in open("corpus.tsv") if l.strip()]
rows+=[["SYNTH",os.path.basename(p)[:-4],"240",p]
       for p in sorted(glob.glob("synth/SYNTH-*.mp4"))]

def run(a):
    label,name,dur,path=a
    src = path if path.startswith("synth/") else presign(path)
    wd=tempfile.mkdtemp(prefix="e2e-")
    try:
        cuts,examined=w._camera_cut_frames(src)
        verdict=w.looks_like_broadcast(src,wd)
        return (label,name,cuts,examined,verdict,None)
    except Exception as e:
        return (label,name,-1,-1,None,f"{type(e).__name__}: {e}")
    finally:
        subprocess.run(["rm","-rf",wd])

with cf.ThreadPoolExecutor(max_workers=5) as ex:
    out=list(ex.map(run,rows))

EXPECT_REJECT={"MaLong-Lebrun","MaLong-Calderano","Batra-Ito",
               "Lebrun-Calderano","Top14-Rallies"}
bad=[]
print(f"{'label':10} {'video':22} {'cuts':>5} {'seen':>6}  verdict   expected")
for label,name,cuts,examined,verdict,err in sorted(out,key=lambda r:(r[0],r[1])):
    if err: print(f"{label:10} {name:22}  {err}"); bad.append((name,err)); continue
    exp = name in EXPECT_REJECT
    ok = (verdict==exp)
    if not ok: bad.append((name,f"got {verdict} want {exp}"))
    print(f"{label:10} {name:22} {cuts:5d} {examined:6d}  "
          f"{'REJECT' if verdict else 'accept':7}  "
          f"{'REJECT' if exp else 'accept':7} {'' if ok else '  <<< MISMATCH'}")
print()
legit=[r for r in out if r[0] in ("AMATEUR","UNKNOWN","SYNTH") and r[4] is not None]
print(f"legitimate videos: {len(legit)}, wrongly rejected: "
      f"{sum(1 for r in legit if r[4])}")
bc=[r for r in out if r[0]=='BROADCAST' and r[4] is not None]
print(f"broadcasts: {len(bc)}, caught: {sum(1 for r in bc if r[4])}")
print("MISMATCHES:", bad if bad else "none")
json.dump([{"label":r[0],"name":r[1],"cuts":r[2],"verdict":r[4]} for r in out],
          open("e2e.json","w"),indent=1)
