"""Adversarial LEGITIMATE videos: a real player who edits their own footage.
If the gate flags these, it is not safe to ship."""
import os, subprocess
import boto3
from botocore.config import Config
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
    return s3.generate_presigned_url("get_object",Params={"Bucket":b,"Key":k},ExpiresIn=10800)

SRC={  # four DIFFERENT venues -> maximum inter-clip visual difference
 "lyttc":"r2://ponglens-raw/a2e61027-2ee9-4026-a058-dc07441ee633/3e6b2e0a-d706-4fd9-ba22-16d721f4af45.mov",
 "westch":"r2://ponglens-raw/a2e61027-2ee9-4026-a058-dc07441ee633/fea2fe17-7021-421e-bb44-18c19cf9eaf8.mov",
 "matchp":"r2://ponglens-raw/a2e61027-2ee9-4026-a058-dc07441ee633/523dfdd8-4c87-4977-8868-8eae0a19dd9f.mov",
 "dobro":"r2://ponglens-raw/a2e61027-2ee9-4026-a058-dc07441ee633/21ebb0a7-d4fb-4a03-99f0-56d8ebcc0e73.mov",
}
os.makedirs("synth",exist_ok=True)
NORM=["-vf","scale=1280:720,fps=30","-c:v","libx264","-preset","veryfast",
      "-crf","23","-an"]
seg={}
for k,p in SRC.items():
    out=f"synth/src_{k}.mp4"
    if not os.path.exists(out):
        subprocess.run(["ffmpeg","-y","-v","error","-ss","120","-t","150","-i",
                        presign(p),*NORM,out],check=True,timeout=1800)
    seg[k]=out; print("segment",out,os.path.getsize(out))

def cut(src,ss,t,out):
    subprocess.run(["ffmpeg","-y","-v","error","-ss",str(ss),"-t",str(t),
                    "-i",src,*NORM,out],check=True)
def concat(parts,out):
    with open("synth/list.txt","w") as f:
        for p in parts: f.write(f"file '{os.path.abspath(p)}'\n")
    subprocess.run(["ffmpeg","-y","-v","error","-f","concat","-safe","0",
                    "-i","synth/list.txt","-c","copy",out],check=True)

# 1) three games joined end to end -> 2 hard cuts
parts=[]
for i,k in enumerate(["lyttc","westch","matchp"]):
    p=f"synth/c3_{i}.mp4"; cut(seg[k],10,80,p); parts.append(p)
concat(parts,"synth/SYNTH-concat3.mp4")

# 2) a self-made highlights reel: 15s chunks alternating across 4 venues
parts=[]; ks=list(SRC)
for i in range(16):
    k=ks[i%4]; p=f"synth/hl_{i:02d}.mp4"
    cut(seg[k],10+(i//4)*30,15,p); parts.append(p)
concat(parts,"synth/SYNTH-highlights.mp4")

# 3) handheld: continuous shake + brightness drift, no cuts at all
subprocess.run(["ffmpeg","-y","-v","error","-i",seg["lyttc"],
  "-vf","crop=1100:620:'80+60*sin(t*1.7)':'50+40*sin(t*2.3)',"
        "scale=1280:720,eq=brightness='0.12*sin(t*0.7)',fps=30",
  "-c:v","libx264","-preset","veryfast","-crf","23","-an",
  "synth/SYNTH-handheld.mp4"],check=True)

for f in ["SYNTH-concat3","SYNTH-highlights","SYNTH-handheld"]:
    d=subprocess.run(["ffprobe","-v","error","-show_entries","format=duration",
        "-of","csv=p=0",f"synth/{f}.mp4"],capture_output=True,text=True).stdout.strip()
    print(f, d)
