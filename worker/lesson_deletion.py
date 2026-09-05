"""Delete only explicitly cancelled lesson outputs; retry account sweeps durably."""
import logging
import uuid

log=logging.getLogger('lesson-video')
BUCKET='ponglens-media'

def cleanup_cancelled_attempt(rt,row,keys):
    """Do not mistake a lost publication response for an unpublished result."""
    if not keys:return False
    try:
        cancelled=rt.rest('rpc/lesson_video_attempt_cancelled','POST',{'p_owner':row['owner_id'],'p_id':row['id']})
        if cancelled is not True:return False
        for key in keys:rt.s3.delete_object(Bucket=BUCKET,Key=key)
        return True
    except Exception:
        # Account marker is durable and will retry the whole prefix later.
        log.warning('Lesson attempt cleanup deferred',exc_info=True)
        return False

def sweep_owner(s3,owner):
    prefix='lesson-video/'+str(uuid.UUID(owner))+'/'
    key_marker=upload_marker=None
    while True:
        args={'Bucket':BUCKET,'Prefix':prefix}
        if key_marker:args['KeyMarker']=key_marker
        if upload_marker:args['UploadIdMarker']=upload_marker
        page=s3.list_multipart_uploads(**args)
        for item in page.get('Uploads',[]):
            try:s3.abort_multipart_upload(Bucket=BUCKET,Key=item['Key'],UploadId=item['UploadId'])
            except Exception as error:
                if getattr(error,'response',{}).get('Error',{}).get('Code')!='NoSuchUpload':raise
        if not page.get('IsTruncated'):break
        key_marker,upload_marker=page.get('NextKeyMarker'),page.get('NextUploadIdMarker')
        if not key_marker:raise RuntimeError('Multipart listing omitted its continuation marker')
    token=None
    while True:
        args={'Bucket':BUCKET,'Prefix':prefix}
        if token:args['ContinuationToken']=token
        page=s3.list_objects_v2(**args)
        for item in page.get('Contents',[]):s3.delete_object(Bucket=BUCKET,Key=item['Key'])
        if not page.get('IsTruncated'):break
        token=page.get('NextContinuationToken')
        if not token:raise RuntimeError('Object listing omitted its continuation token')

def drain_deletions(rt):
    """DB supplies due markers; acknowledgement follows a successful sweep only."""
    try:targets=rt.rest('rpc/lesson_video_deletion_targets','POST',{}) or []
    except Exception:
        log.warning('Lesson account cleanup lookup deferred',exc_info=True)
        return
    for target in targets:
        try:
            owner=target['owner_id'];sweep_owner(rt.s3,owner)
            rt.rest('rpc/ack_lesson_video_deletion_sweep','POST',{'p_owner':owner})
        except Exception:log.warning('Lesson account cleanup deferred',exc_info=True)
