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
from lesson_cloud_dispatch import cloud_dispatch_ready
import modal

manifest=verify(PAYLOAD)
app=modal.App('ponglens-lesson-video')
runtime_secret=modal.Secret.from_name('ponglens-lesson-video-runtime')
image=(modal.Image.debian_slim(python_version='3.12')
       .run_commands(*linux_media_install_commands())
       .pip_install_from_requirements(str(PAYLOAD/'requirements.lock'))
       .env({'PYTHONDONTWRITEBYTECODE':'1','PONGLENS_LESSON_BUNDLE_ID':BUNDLE_ID})
       .add_local_dir(str(PAYLOAD),REMOTE,copy=True))
dispatch_image=(modal.Image.debian_slim(python_version='3.12')
                .env({'PYTHONDONTWRITEBYTECODE':'1','PONGLENS_LESSON_BUNDLE_ID':BUNDLE_ID})
                .add_local_dir(str(PAYLOAD),REMOTE,copy=True))

@app.function(image=image,secrets=[runtime_secret],timeout=10800,cpu=4,memory=8192,
              min_containers=0,max_containers=1,retries=0)
@modal.concurrent(max_inputs=1)
def run_cloud_job():
    # Modal's default 512 GiB ephemeral quota covers the 20 GiB source limit
    # and render intermediates. The database rechecks fallback eligibility
    # when this process tries to claim a lesson.
    subprocess.run([sys.executable,'-I','-B',REMOTE+'/runner.py','--cloud','--once'],check=True)

@app.function(image=dispatch_image,secrets=[runtime_secret],schedule=modal.Period(minutes=5),
              timeout=60,cpu=0.125,memory=128,scaledown_window=2,
              min_containers=0,max_containers=1,retries=0)
def dispatch_once():
    if cloud_dispatch_ready(manifest['worker_release_id']):
        run_cloud_job.spawn()
        return {'dispatched':True}
    return {'dispatched':False}

@app.function(image=image,timeout=60,cpu=1,memory=512,min_containers=0,max_containers=1)
def verify_release():
    # No secret or claims: operator can verify deployment identity independently.
    result=subprocess.run([sys.executable,'-I','-B',REMOTE+'/runner.py','--cloud','--check'],check=True,capture_output=True,text=True)
    return {'worker_release_id':result.stdout.strip(),'bundle_id':BUNDLE_ID}

@app.function(image=image,timeout=600,cpu=2,memory=4096,min_containers=0,max_containers=1)
def verify_media_parity():
    """Render tiny SDR and HLG fixtures without credentials or queue access."""
    import tempfile
    os.environ['PATH']='/opt/ponglens-ffmpeg/bin:/usr/bin:/bin'
    os.environ['LESSON_VIDEO_FONT']=REMOTE+'/lesson-font.ttf'
    subprocess.run([sys.executable,'-I','-B',REMOTE+'/runner.py','--cloud','--check'],check=True,capture_output=True,text=True)
    from lesson_video import normalize_edit,probe,render,run
    report={}
    with tempfile.TemporaryDirectory(prefix='lesson-media-parity-') as directory:
        root=Path(directory)
        for name,transfer in (('sdr','bt709'),('hdr','arib-std-b67')):
            source=root/(name+'.mp4')
            color=['-color_primaries','bt2020','-color_trc',transfer,'-colorspace','bt2020nc'] if name=='hdr' else ['-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709']
            run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000','-t','2','-c:v','libx264','-pix_fmt','yuv420p',*color,'-c:a','aac','-shortest',str(source)],120)
            output_dir=root/(name+'-render');output_dir.mkdir()
            edit=normalize_edit({'title':'Media parity','chapters':[{'title':'Check the lesson','cues':['Use the same media path in both execution locations.'],'start_s':0,'end_s':1.5}]},2)
            recap=render(source,edit,output_dir)
            outputs={}
            for output_name,output in (('recap',recap),('playback',output_dir/'playback.mp4')):
                info=probe(output);video=next(stream for stream in info['streams'] if stream.get('codec_type')=='video')
                outputs[output_name]={'codec':video.get('codec_name'),'pixel_format':video.get('pix_fmt'),'color_space':video.get('color_space'),'color_transfer':video.get('color_transfer'),'color_primaries':video.get('color_primaries'),'audio':any(stream.get('codec_type')=='audio' for stream in info['streams']),'duration':round(float(info['format']['duration']),3)}
                run(['ffmpeg','-v','error','-xerror','-i',str(output),'-f','null','-'],120)
            report[name]={'source_transfer':transfer,'outputs':outputs}
    return {'worker_release_id':manifest['worker_release_id'],'bundle_id':BUNDLE_ID,'fixtures':report}
