"""Broadcast question ONLY, as its own call. The table-tennis gate is left
exactly as it is in production -- three trials showed that folding a second
question into it destabilised it (Batra-Ito tt went 12/4/3 of 12, and
CONTENT_CHECK_MIN_POSITIVE is 3)."""
import base64, concurrent.futures as cf, glob, json, os, subprocess, sys
import requests
KEY=(os.environ.get("OPENAI_API_KEY") or subprocess.run(
    ["security","find-generic-password","-a","openclaw","-s","openai-api-key","-w"],
    capture_output=True,text=True).stdout.strip())
MODEL=os.environ.get("MODEL","gpt-5-nano")
PROMPT=open(os.environ.get("PROMPT","prompt3.txt")).read()
TRIALS=int(os.environ.get("TRIALS","3"))

def ask(name):
    fs=sorted(glob.glob(f"frames/{name}/*.jpg"))
    content=[{"type":"text","text":PROMPT.format(n=len(fs))}]
    for f in fs:
        b64=base64.b64encode(open(f,"rb").read()).decode()
        content.append({"type":"image_url","image_url":{
            "url":f"data:image/jpeg;base64,{b64}","detail":"low"}})
    body={"model":MODEL,"messages":[{"role":"user","content":content}],
          "max_completion_tokens":2000}
    if MODEL.startswith(("gpt-5","o3","o4")): body["reasoning_effort"]="low"
    else: body["temperature"]=0
    r=requests.post("https://api.openai.com/v1/chat/completions",
      headers={"Authorization":f"Bearer {KEY}"},json=body,timeout=180)
    r.raise_for_status(); d=r.json()
    t=d["choices"][0]["message"]["content"] or ""
    v=json.loads(t[t.find("["):t.rfind("]")+1])
    return len(fs), sum(1 for x in v if str(x).strip().lower()=="yes")

def job(a):
    label,name,dur,path=a
    try:
        rs=[ask(name) for _ in range(TRIALS)]
        return (label,name,rs[0][0],[c for _,c in rs],None)
    except Exception as e:
        return (label,name,0,[],f"{type(e).__name__}: {e}")

rows=[l.rstrip("\n").split("\t") for l in open(
      os.environ.get("CORPUS","corpus.tsv")) if l.strip()]
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    out=list(ex.map(job,rows))
res=[]
print(f"{'label':10} {'video':22} {'n':>3}  trials      med  max")
for label,name,n,cs,err in sorted(out,key=lambda r:(r[0],r[1])):
    if err: print(f"{label:10} {name:22} {'':>3}  {err}"); continue
    s=sorted(cs); med=s[len(s)//2]
    print(f"{label:10} {name:22} {n:3d}  {'/'.join(map(str,cs)):10} {med:4d} {max(cs):4d}")
    res.append({"label":label,"name":name,"n":n,"tv":cs,"med":med})
json.dump(res,open(os.environ.get("OUT","vision3.json"),"w"),indent=1)
