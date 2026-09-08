import unittest
from worker.lesson_deletion import cleanup_cancelled_attempt, drain_deletions

class S3:
 def __init__(self):self.deleted=[];self.aborted=[]
 def delete_object(self,**kw):self.deleted.append(kw['Key'])
 def abort_multipart_upload(self,**kw):self.aborted.append(kw['UploadId'])
 def list_multipart_uploads(self,**kw):return {'Uploads':[{'Key':kw['Prefix']+'x/recap.mp4','UploadId':'pending'}]}
 def list_objects_v2(self,**kw):return {'Contents':[{'Key':kw['Prefix']+'x/original.mov'}]}
class RT:
 def __init__(self,result):self.result=result;self.s3=S3();self.calls=[]
 def rest(self,path,method='GET',data=None):
  self.calls.append((path,data))
  if isinstance(self.result,Exception):raise self.result
  if 'deletion_targets' in path:return [{'owner_id':'11111111-1111-1111-1111-111111111111'}]
  return self.result
class DeletionTests(unittest.TestCase):
 def test_network_error_never_deletes_potentially_published_output(self):
  rt=RT(RuntimeError('network'))
  self.assertFalse(cleanup_cancelled_attempt(rt,{'id':'id','owner_id':'owner'},['attempt-key']))
  self.assertEqual(rt.s3.deleted,[])
 def test_only_confirmed_cancelled_attempt_is_removed(self):
  rt=RT(False);self.assertFalse(cleanup_cancelled_attempt(rt,{'id':'id','owner_id':'owner'},['attempt-key']));self.assertEqual(rt.s3.deleted,[])
  rt.result=True;self.assertTrue(cleanup_cancelled_attempt(rt,{'id':'id','owner_id':'owner'},['attempt-key','clean-key']));self.assertEqual(rt.s3.deleted,['attempt-key','clean-key'])
 def test_ack_happens_only_after_upload_abort_and_full_sweep(self):
  rt=RT(True);drain_deletions(rt)
  self.assertEqual(rt.s3.aborted,['pending']);self.assertEqual(len(rt.s3.deleted),1)
  self.assertEqual(rt.calls[-1][0],'rpc/ack_lesson_video_deletion_sweep')
 def test_failed_sweep_leaves_marker_for_retry(self):
  rt=RT(True)
  def fail(**kw):raise RuntimeError('storage down')
  rt.s3.delete_object=fail;drain_deletions(rt)
  self.assertFalse(any('ack_' in x[0] for x in rt.calls))
if __name__=='__main__':unittest.main()
