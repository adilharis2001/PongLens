"""Transcript fixtures for the lesson pipeline's tests.

Every test that reaches create_edit used to hand it sections with no
utterances at all, because the transcript was only ever scenery: the
subject was the selection and merge logic further down. That stopped
being safe once the pipeline learned to refuse a lesson nobody was heard
in, and the tests were the first thing to notice, which is the right way
round. A section here holds ordinary, evenly spread speech, so a clip
proposed anywhere inside it has words under it.
"""

def audible_section(start,end,words_per_utterance=6,every=5.0):
 """One section of a lesson with somebody talking all the way through.

 Roughly seventy words a minute, near the quiet end of what a real lesson
 measured, so a fixture can never pass by being unrealistically talkative.
 """
 utterances=[]
 t=float(start)
 while t+every<=end:
  utterances.append({'start_s':round(t,3),'end_s':round(t+every,3),'speaker':None,
                     'text':' '.join(['word']*words_per_utterance)})
  t+=every
 return {'start_s':start,'end_s':end,'utterances':utterances}

def audible_transcript(sections,seconds=600):
 return [audible_section(i*seconds,(i+1)*seconds) for i in range(sections)]
