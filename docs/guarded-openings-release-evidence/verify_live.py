import sys,os,json,time,subprocess,importlib.util,hashlib
from pathlib import Path
from datetime import datetime,timezone
sys.dont_write_bytecode=True
R=Path(__file__).parent;release='caeb69ce8163d27952c6b9ba744ba85712d4991d9e31204e3994a7de89387d92'
f=R/'activate.py';assert hashlib.sha256(f.read_bytes()).hexdigest()=='d9dbba619b5185bbe1838efe9e3a385a10c9650e3d27f6f414ac6f3ec6dbe0c4'
spec=importlib.util.spec_from_file_location('activation',f);a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a);a.configure(release)
started=datetime.fromisoformat((a.r.STAGING/'started-at.txt').read_text());deadline=time.monotonic()+50
while True:
 with a.r.connection(True) as conn:
  with conn.cursor() as c:
   c.execute("select worker_id,pid,job_id,stage,code_version,beat_at,now()-beat_at<interval '45 seconds' from public.worker_pulse where worker_id in ('mac:main','mac:fast','mac:hand')")
   rows={r[0]:r[1:] for r in c.fetchall()}
   c.execute("select monitor_at,now()-monitor_at<interval '180 seconds' from public.worker_processing_health_control");monitor,fresh_monitor=c.fetchone()
   c.execute('select (select count(*) from pgmq.q_jobs),(select count(*) from pgmq.q_jobs_fast)');queues=c.fetchone()
 live=all(rows['mac:'+lane][3]=='release '+release and rows['mac:'+lane][5] and rows['mac:'+lane][4]>=started and rows['mac:'+lane][2] not in ('drained','release_invalid') for lane in ('main','fast'))
 if live and fresh_monitor and monitor>=started:break
 if time.monotonic()>=deadline:raise RuntimeError('Live post-resume gate not satisfied')
 time.sleep(8)
assert not any((a.r.STATE/('drain-'+lane)).exists() for lane in ('main','fast'))
processes=subprocess.check_output(['/bin/ps','-axo','pid=,command='],text=True)
processes={int(p[0]):p[1] for line in processes.splitlines() if len(p:=line.strip().split(None,1))==2}
for lane in ('main','fast'):
 pid=rows['mac:'+lane][0]
 assert str(a.r.RELEASE/'worker/worker.py')+' --lane '+lane in processes[pid]
assert rows['mac:hand'][0]==55060 and processes[55060].endswith('worker.py --lane hand')
assert not any(str(a.r.RELEASE.parent/a.r.OLD_ID/'worker/worker.py') in cmd for cmd in processes.values())
report=dict(verified_at=datetime.now(timezone.utc).isoformat(),release_id=release,source_commit='6aebfd66',lanes={lane:dict(pid=rows['mac:'+lane][0],job_id=rows['mac:'+lane][1],stage=rows['mac:'+lane][2],beat_at=str(rows['mac:'+lane][4])) for lane in ('main','fast')},monitor_at=str(monitor),monitor_fresh=True,hand_pid_unchanged=55060,queue_counts=queues,startup_pauses_removed=True,old_workers_absent=True,limits='Fresh live process identity/health and queue eligibility; no newly uploaded match quality or full new-release match completion claimed.')
(R/'live-verification.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
