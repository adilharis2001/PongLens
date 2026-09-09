import re, glob, os
F = "/private/tmp/claude-501/-Users-adil-Desktop-Projects-PongLens/fe440c55-7cd5-491a-9a1d-660657dc7716/scratchpad/fullframe"
NAMES = {"77fc4dee":"Lester","89b35ee0":"YYL","d15aad4d":"Louis","10322849":"Rob","2eab3e3d":"Terry2","7e02fbb9":"Julian",
         "bfc9b31b":"AntonAug","cebaa6d4":"Rowel","f3237587":"Koko2","1c08539e":"Tim","5c90151a":"Hugo22","5fd822ec":"Hugo11","95a07786":"Wayne"}
tags = ["base","durw4","durw2","durw1","pmin15","durw4_pmin15","bias05","bias05_durw4","bias1"]
print(f"{'config':14s} {'points':>6s} {'found':>6s} {'missed':>6s} {'clean':>6s} {'fusedP':>6s} {'split':>6s} {'stray':>6s} {'cards':>6s}   per-match missed")
for t in tags:
    p = f"{F}/sweep_{t}.log"
    if not os.path.exists(p): print(f"{t:14s} (not run)"); continue
    tot = dict(points=0, found=0, clean=0, fusedP=0, split=0, stray=0, segs=0); per = []
    for ln in open(p):
        mm = re.match(r"^([0-9a-f]{8})\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", ln)
        if not mm: continue
        m, pts, found, clean, fusedP, split, stray, segs, cost = mm.groups()
        for k, v in zip(("points","found","clean","fusedP","split","stray","segs"), (pts, found, clean, fusedP, split, stray, segs)): tot[k] += int(v)
        if int(pts) - int(found): per.append(f"{NAMES[m]} {int(pts)-int(found)}")
    print(f"{t:14s} {tot['points']:6d} {tot['found']:6d} {tot['points']-tot['found']:6d} {tot['clean']:6d} {tot['fusedP']:6d} {tot['split']:6d} {tot['stray']:6d} {tot['segs']:6d}   {', '.join(per)}")
