"""Optional independent lesson app. Deploy only from a sealed payload."""
import os
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parent
BUNDLE_ID=os.environ.get('PONGLENS_LESSON_BUNDLE_ID',ROOT.parent.name)
REMOTE='/opt/lesson/'+BUNDLE_ID+'/payload'
PAYLOAD=ROOT if (ROOT/'package.py').exists() else Path(REMOTE)
sys.path.insert(0,REMOTE)
sys.path.insert(0,str(ROOT))
from package import linux_media_install_commands, verify
import modal

manifest=verify(PAYLOAD)
app=modal.App('ponglens-lesson-video')
image=(modal.Image.debian_slim(python_version='3.12')
       .run_commands(*linux_media_install_commands())
       .pip_install_from_requirements(str(PAYLOAD/'requirements.lock'))
       .env({'PYTHONDONTWRITEBYTECODE':'1','PONGLENS_LESSON_BUNDLE_ID':BUNDLE_ID})
       .add_local_dir(str(PAYLOAD),REMOTE,copy=True))

@app.function(image=image,secrets=[modal.Secret.from_name('ponglens-lesson-video-runtime')],
              schedule=modal.Period(minutes=1),timeout=10800,cpu=4,memory=8192,
              min_containers=0,max_containers=1,retries=0)
@modal.concurrent(max_inputs=1)
def poll_once():
    # Modal's default 512 GiB ephemeral quota covers the 20 GiB source limit
    # and render intermediates. Database cloud_enabled defaults false.
    subprocess.run([sys.executable,'-I','-B',REMOTE+'/runner.py','--cloud','--once'],check=True)

@app.function(image=image,timeout=60,cpu=1,memory=512,min_containers=0,max_containers=1)
def verify_release():
    # No secret or claims: operator can verify deployment identity independently.
    result=subprocess.run([sys.executable,'-I','-B',REMOTE+'/runner.py','--cloud','--check'],check=True,capture_output=True,text=True)
    return {'worker_release_id':result.stdout.strip(),'bundle_id':BUNDLE_ID}
