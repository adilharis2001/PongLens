"""Pure validation tests. Never open a database or read credentials."""
import copy
import importlib.util
from pathlib import Path
import unittest

SCRIPT=Path(__file__).with_name('import-point-ending-suggestions.py')

class ImportSuggestionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if SCRIPT.exists():
            spec=importlib.util.spec_from_file_location('import_suggestions',SCRIPT)
            cls.m=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.m)

    def setUp(self):
        if not SCRIPT.exists(): self.fail('Safe importer has not been implemented')
        self.row=dict(id='11111111-1111-4111-8111-111111111111',source={'start':1,'end':2},label={'reason':None,'custom':'','note':''},revision=0,reviewed_at=None)
        guess=lambda value:dict(value=value,confidence='tentative' if value is not None else 'uncertain',detail='Review this suggestion.')
        self.payload=dict(version=1,runId=self.m.RUN_ID,reason=guess('net'),lastRallyContact=guess('near'),lastBounce=guess('detected:0'),events=[dict(id='detected:0',kind='table',side='near',confidence='tentative',detail='Review this marker.')])
        self.evidence=dict(bounces=[dict(t=1,x=.4,y=.2)])

    def test_untouched_empty_review_is_eligible(self):
        self.assertFalse(self.m.touched(self.row))
        self.row['label']['bounceReview']=dict(version=1,events=[],lastBounce=None)
        self.assertFalse(self.m.touched(self.row))

    def test_every_partial_human_answer_and_cleared_revision_is_protected(self):
        for field,value in [('reason','long'),('custom','custom'),('note','note'),('lastRallyContact','unsure'),('bounceReview',dict(version=1,events=[],lastBounce='detected:0')),('bounceReview',dict(version=1,events=[dict(id='detected:0',kind='floor')],lastBounce=None)),('suggestionReview',dict(runId='x',fields=['reason']))]:
            with self.subTest(field=field,value=value):
                row=copy.deepcopy(self.row);row['label'][field]=value;self.assertTrue(self.m.touched(row))
        for field,value in [('revision',1),('reviewed_at','2026-09-22T00:00:00Z')]:
            row=copy.deepcopy(self.row);row[field]=value;self.assertTrue(self.m.touched(row))

    def test_whitespace_and_unknown_answer_are_preserved(self):
        self.row['label']['note']=' ';self.assertTrue(self.m.touched(self.row))
        self.row['label']['note']='';self.row['label']['futureField']='yes';self.assertTrue(self.m.touched(self.row))

    def test_original_annotations_protect_an_empty_mapped_label(self):
        for annotations in [{'legacy_reason':'edge'},['earlier human answer'],'earlier human answer']:
            with self.subTest(annotations=annotations):
                row=copy.deepcopy(self.row);row['original_annotations']=annotations
                self.assertTrue(self.m.touched(row))
        for annotations in [None,{},[],'']:
            row=copy.deepcopy(self.row);row['original_annotations']=annotations
            self.assertFalse(self.m.touched(row))

    def test_imported_source_protects_an_empty_mapped_label(self):
        self.row['source']['imported']=True
        self.assertTrue(self.m.touched(self.row))
        self.row['source']['imported']=False
        self.assertFalse(self.m.touched(self.row))

    def test_payload_accepts_exact_detected_references(self):
        self.m.validate_payload(self.payload,1)

    def test_payload_rejects_duplicates_missing_events_bad_kinds_and_notes(self):
        for change in ['duplicate','missing','unknown_kind','wrong_last','wrong_last_kind','notes','long_detail','extra','invalid_confidence']:
            with self.subTest(change=change):
                p=copy.deepcopy(self.payload)
                if change=='duplicate':p['events']*=2
                if change=='missing':p['events']=[]
                if change=='unknown_kind':p['events'][0]['kind']='madeup'
                if change=='wrong_last':p['lastBounce']['value']='detected:1'
                if change=='wrong_last_kind':p['events'][0]['kind']='floor'
                if change=='notes':p['note']='machine note'
                if change=='long_detail':p['reason']['detail']='x'*241
                if change=='extra':p['events'][0]['rawTime']=123
                if change=='invalid_confidence':p['reason']['confidence']='certain'
                with self.assertRaises(ValueError):self.m.validate_payload(p,1)

    def test_bundle_requires_complete_unique_snapshot_coverage(self):
        snapshot=dict(rows=[self.row],evidence={self.row['id']:self.evidence})
        predictions=[dict(point_id=self.row['id'],payload=self.payload)]
        self.m.validate_bundle(snapshot,predictions)
        for bad in [[],predictions*2,[dict(point_id='other',payload=self.payload)]]:
            with self.assertRaises(ValueError):self.m.validate_bundle(snapshot,bad)

    def test_source_digest_is_stable_but_changes_with_evidence(self):
        a=self.m.source_digest({'a':1,'b':2},self.evidence)
        self.assertEqual(a,self.m.source_digest({'b':2,'a':1},self.evidence))
        e=copy.deepcopy(self.evidence);e['bounces'][0]['t']=2
        self.assertNotEqual(a,self.m.source_digest({'a':1,'b':2},e))

    def test_live_alignment_rejects_changed_source_or_bounce(self):
        self.m.validate_live(self.row,self.evidence,self.row,self.evidence)
        changed=copy.deepcopy(self.row);changed['source']['start']=1.1
        with self.assertRaises(ValueError):self.m.validate_live(changed,self.evidence,self.row,self.evidence)
        e=copy.deepcopy(self.evidence);e['bounces'].reverse();e['bounces'][0]['x']=.8
        with self.assertRaises(ValueError):self.m.validate_live(self.row,e,self.row,self.evidence)

    def test_idempotence_never_replaces_a_conflicting_payload(self):
        existing=dict(payload=copy.deepcopy(self.payload),source_sha256='a'*64,source_revision=0)
        self.m.validate_existing(existing,self.payload,'a'*64,0)
        existing['payload']['reason']['value']='long'
        with self.assertRaises(ValueError):self.m.validate_existing(existing,self.payload,'a'*64,0)

    def test_batch_plan_skips_human_rows_and_is_idempotent(self):
        self.assertTrue(hasattr(self.m,'plan_import'),'Bulk import must validate all conflicts before insertion')
        point_id=self.row['id'];rows={point_id:self.row};evidence={point_id:self.evidence}
        predictions=[dict(point_id=point_id,payload=self.payload)]
        inserts,expected,counts=self.m.plan_import(rows,predictions,rows,evidence,{})
        self.assertEqual(len(inserts),1);self.assertEqual(counts['eligible'],1)
        inserts,_,counts=self.m.plan_import(rows,predictions,rows,evidence,expected)
        self.assertEqual(inserts,[]);self.assertEqual(counts['already_present'],1)
        live=copy.deepcopy(rows);live[point_id]['original_annotations']={'old':'human answer'}
        inserts,expected,counts=self.m.plan_import(rows,predictions,live,evidence,{})
        self.assertEqual(inserts,[]);self.assertEqual(expected,{})
        self.assertEqual(counts['skipped_touched'],1)

    def test_batch_plan_rejects_late_conflict_before_any_write(self):
        self.assertTrue(hasattr(self.m,'plan_import'),'Bulk import must validate all conflicts before insertion')
        row2=copy.deepcopy(self.row);row2['id']='22222222-2222-4222-8222-222222222222'
        rows={self.row['id']:self.row,row2['id']:row2}
        evidence={point_id:self.evidence for point_id in rows}
        predictions=[dict(point_id=point_id,payload=self.payload) for point_id in rows]
        existing={row2['id']:dict(payload=copy.deepcopy(self.payload),source_revision=0,source_sha256=self.m.source_digest(row2['source'],self.evidence))}
        existing[row2['id']]['payload']['reason']['value']='long'
        original=copy.deepcopy([rows,evidence,predictions,existing])
        with self.assertRaises(ValueError):self.m.plan_import(rows,predictions,rows,evidence,existing)
        self.assertEqual([rows,evidence,predictions,existing],original)

    def test_migration_registration_requires_the_same_reviewed_ddl(self):
        self.assertTrue(hasattr(self.m,'validate_migration_registration'))
        self.m.validate_migration_registration(('point_ending_suggestions',['reviewed ddl']),'reviewed ddl')
        for registration in [None,('other',['reviewed ddl']),('point_ending_suggestions',['different ddl'])]:
            with self.subTest(registration=registration):
                with self.assertRaises(ValueError):self.m.validate_migration_registration(registration,'reviewed ddl')

if __name__=='__main__':unittest.main()
