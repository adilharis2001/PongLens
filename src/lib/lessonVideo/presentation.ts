import type {LessonChapter, LessonEdit} from './model';

export interface LessonReaderSection {
 number:number;
 title:string;
 cues:string[];
}

export function lessonReaderSections(edit:LessonEdit):LessonReaderSection[] {
 return edit.chapters.map((chapter,index)=>({
  number:index+1,
  title:chapter.title,
  cues:chapter.cues,
 }));
}

export function lessonChapterStart(chapters:LessonChapter[],index:number):number|null {
 if(!Number.isInteger(index)||index<0||index>=chapters.length)return null;
 const explicit=chapters[index].summary_start_s;
 if(typeof explicit==='number'&&Number.isFinite(explicit))return explicit;
 return chapters.slice(0,index).reduce((sum,chapter)=>sum+Math.max(0,chapter.end_s-chapter.start_s),0);
}

export function lessonChapterIndexAt(chapters:LessonChapter[],seconds:number):number {
 if(!Number.isFinite(seconds)||chapters.length===0)return 0;
 let active=0;
 chapters.forEach((_,index)=>{const start=lessonChapterStart(chapters,index);if(start!==null&&start<=seconds)active=index;});
 return active;
}

/**
 * Does this recap have somebody to share it with.
 *
 * A coach's import names the student it was made for; a player's import
 * names the coach it was made with. A lesson that names neither is private
 * and there is nobody to send it to. Asking about `student_id` alone left a
 * player's finished recap reading "Saved" with no way to share it.
 */
function hasRecipient(video:{student_id?:string|null;coach_ref_id?:string|null}):boolean {
 return !!video.student_id||!!video.coach_ref_id;
}

/**
 * One word for where a lesson video is, the same on every surface.
 *
 * `shared` is whether the other person can see it today, which is not the
 * same as `status === 'ready'`: the coach can take an entry back from the
 * student page, and a player can stop sharing their own recap, and the
 * video row does not change when either happens. Twin of
 * `LessonVideo.statusLabel` on iOS.
 */
export function lessonStatusLabel(
 video:{status:string;stage?:string|null;student_id?:string|null;coach_ref_id?:string|null},
 shared:boolean,
 /** Whether there is already a recap to watch. */
 hasRecap=false,
):string {
 // Correcting a word is not reprocessing the lesson, and it must not read
 // like it. A rebuild used to walk the same stages a first import does,
 // starting at "Downloading the lesson", over a page whose recap had just
 // disappeared, so a typo fix looked like the whole ninety minutes going
 // through again.
 if(hasRecap&&['queued','processing'].includes(video.status))return 'Updating your recap';
 switch(video.status){
  case 'review':return 'Ready to review';
  case 'ready':return hasRecipient(video)?(shared?'Shared':'Ready to share'):'Saved';
  case 'failed':return 'Needs attention';
  case 'uploading':return 'Uploading';
  case 'queued':return 'Waiting to process';
  default:return video.stage??'Preparing recap';
 }
}

/** The recap's length in whole minutes, from the clips that make it up. */
export function lessonRecapMinutes(edit:LessonEdit):number {
 return Math.round(edit.chapters.reduce((sum,chapter)=>sum+Math.max(0,chapter.end_s-chapter.start_s),0)/60);
}

/** m:ss, for a chapter's length. */
export function formatClipLength(seconds:number):string {
 const whole=Math.max(0,Math.round(Number.isFinite(seconds)?seconds:0));
 return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;
}

/**
 * Whether who taught this lesson can still be answered or corrected.
 *
 * Attribution is a fact about an afternoon that already happened, so it
 * is never too late to record it and never wrong to fix it. The importer
 * asks, but "no coach" is a real answer and an unanswered picker looks
 * exactly like one, so a recap could arrive naming nobody with no way
 * back: no route set the coach after the import, and a recap with nobody
 * on it can never be shared, which left the page reading "Saved" beside
 * no controls at all.
 *
 * A coach's own import is excluded. It names the student it was made
 * for, the database refuses both at once, and moving a delivered lesson
 * to a different student is not a correction, it is a different lesson.
 */
export function lessonCanSetCoach(
 video:{status:string;stage?:string|null;student_id?:string|null},
 isOwner:boolean,
):boolean {
 return isOwner&&!video.student_id&&video.stage!=='Deleting'&&['review','ready','failed'].includes(video.status);
}

/**
 * Whether the owner can press the share button now.
 *
 * Review is the first time; ready-but-unshared is the coach taking an
 * entry back from the student page and changing their mind, or a player
 * who kept their recap to themselves and has since decided to send it.
 * Neither had a button before.
 */
export function lessonCanShare(
 video:{status:string;student_id?:string|null;coach_ref_id?:string|null},
 isOwner:boolean,
 shared:boolean,
):boolean {
 if(!isOwner)return false;
 if(video.status==='review')return true;
 return video.status==='ready'&&hasRecipient(video)&&!shared;
}
