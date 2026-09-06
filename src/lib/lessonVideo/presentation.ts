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
 * One word for where a lesson video is, the same on every surface.
 *
 * `shared` is whether the student can see it today, which is not the same
 * as `status === 'ready'`: the coach can take an entry back from the
 * student page, and the video row does not change when they do. Twin of
 * `LessonVideo.statusLabel` on iOS.
 */
export function lessonStatusLabel(
 video:{status:string;stage?:string|null;student_id?:string|null},
 shared:boolean,
):string {
 switch(video.status){
  case 'review':return 'Ready to review';
  case 'ready':return video.student_id?(shared?'Shared':'Ready to share'):'Saved';
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
 * Whether the owner can press the share button now.
 *
 * Review is the first time; ready-but-unshared is the coach taking an
 * entry back from the student page and changing their mind, which the
 * page used to have no button for.
 */
export function lessonCanShare(
 video:{status:string;student_id?:string|null},
 isOwner:boolean,
 shared:boolean,
):boolean {
 if(!isOwner)return false;
 if(video.status==='review')return true;
 return video.status==='ready'&&!!video.student_id&&!shared;
}
