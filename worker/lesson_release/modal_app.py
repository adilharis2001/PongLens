"""Optional independent lesson app. Deploy only from a sealed payload."""
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from package import LINUX_FFMPEG_PACKAGE, verify
import modal

manifest=verify(ROOT)
REMOTE='/opt/lesson/'+ROOT.parent.name+'/payload'
app=modal.App('ponglens-lesson-video')
image=(modal.Image.debian_slim(python_version='3.12')
       .apt_install(f'ffmpeg={LINUX_FFMPEG_PACKAGE}')
       .run_commands(
           f"test \"$(dpkg-query -W -f='${{Version}}' ffmpeg)\" = '{LINUX_FFMPEG_PACKAGE}'",
           'ffmpeg -hide_banner -filters | grep -q zscale',
           'ffmpeg -hide_banner -encoders | grep -q libx264',
           'ffmpeg -hide_banner -encoders | grep -q aac',
       )
       .pip_install_from_requirements(str(ROOT/'requirements.lock'))
       .env({'PYTHONDONTWRITEBYTECODE':'1'})
       .add_local_dir(str(ROOT),REMOTE,copy=True))

@app.function(image=image,secrets=[modal.Secret.from_name('ponglens-lesson-video-runtime')],
              schedule=modal.Period(minutes=1),timeout=10800,cpu=4,memory=8192,
              ephemeral_disk=40*1024,min_containers=0,max_containers=1,retries=0)
@modal.concurrent(max_inputs=1)
def poll_once():
    # Database cloud_enabled defaults false. No model volumes or match jobs.
    subprocess.run([sys.executable,'-I','-B',REMOTE+'/runner.py','--cloud','--once'],check=True)

@app.function(image=image,timeout=60,cpu=1,memory=512,min_containers=0,max_containers=1)
def verify_release():
    # No secret or claims: operator can verify deployment identity independently.
    result=subprocess.run([sys.executable,'-I','-B',REMOTE+'/runner.py','--cloud','--check'],check=True,capture_output=True,text=True)
    return {'worker_release_id':result.stdout.strip(),'bundle_id':ROOT.parent.name}
