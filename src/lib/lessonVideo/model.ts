export const MAX_BYTES = 20 * 1024 ** 3;
export const MAX_SECONDS = 10800;
export const PART_SIZE = 64 * 1024 ** 2;
export interface LessonChapter { title: string; cues: string[]; start_s: number; end_s: number; summary_start_s?: number; summary_end_s?: number }
/** Up to five goals and six follow-ups; a lesson that stated neither has neither. */
export const MAX_GOALS=5;
export const MAX_WORK_ON=6;
export const MAX_FOCUS_LINE=180;
export interface LessonEdit { title: string; chapters: LessonChapter[]; themes: {name:string;points:string[]}[]; warning?:string; /** What the lesson set out to improve, shown on a card before the first clip. */ goals?:string[]; /** What to practise afterwards, shown on a card after the last clip. */ work_on?:string[] }
/** A lesson names the student it was made for, or the coach it was made with, never both. */
export interface LessonVideo {/** Can the other person see it today. From the API only; never stored. */shared?:boolean; id:string; owner_id:string; student_id:string|null; coach_ref_id:string|null; lesson_id:string|null; original_name:string;file_size:number;duration_s:number;status:string;stage:string|null;error:string|null;edit:LessonEdit|null;created_at:string;updated_at:string;revision:number }
export function validateImport(bytes:number, seconds:number):string|null {
 if (!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX_BYTES) return 'Choose a video up to 20 GB.';
 if (!Number.isFinite(seconds)||seconds<=0||seconds>MAX_SECONDS) return 'Choose a lesson up to three hours long.';
 return null;
}
function clean(value:unknown,max:number):string {return typeof value==='string'?value.trim().slice(0,max):'';}
export function validateEdit(input:unknown,duration:number):LessonEdit|null {
 if(!input||typeof input!=='object')return null;
 const e=input as Record<string,unknown>; const title=clean(e.title,100);
 if(!title||!Array.isArray(e.chapters)||!e.chapters.length||e.chapters.length>16)return null;
 const chapters:LessonChapter[]=[];let total=0;
 for(const raw of e.chapters){
  if(!raw||typeof raw!=='object')return null;
  const c=raw as Record<string,unknown>; const start=Number(c.start_s),end=Number(c.end_s);
  const name=clean(c.title,80); const cues=Array.isArray(c.cues)?c.cues.map(x=>clean(x,220)).filter(Boolean).slice(0,4):[];
  if(!name||!cues.length||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+.05||end<=start||end-start>120)return null;
  total+=end-start;if(total>900.1)return null;
  chapters.push({title:name,cues,start_s:start,end_s:end});
 }
 const themes:{name:string;points:string[]}[]=[];
 if(Array.isArray(e.themes)){
  if(e.themes.length>64)return null;
  for(const t of e.themes){
   const name=clean(t?.name,80);
   if(!Array.isArray(t?.points))continue;
   if(t.points.length>64)return null;
   const points=t.points.filter((p:unknown):p is string=>typeof p==='string').map((p:string)=>p.trim()).filter(Boolean);
   if(points.some((p:string)=>p.length>2000))return null;
   if(name&&points.length)themes.push({name,points});
  }
 }
 // The two lists that bracket the recap. Kept optional: a lesson that
 // never said what it was for gets no goals card rather than an invented
 // one, and the worker's own limits are mirrored here so what is saved is
 // what was on screen.
 const list=(value:unknown,limit:number)=>Array.isArray(value)
  ?value.map(x=>clean(x,MAX_FOCUS_LINE)).filter(Boolean).slice(0,limit)
  :[];
 const goals=list(e.goals,MAX_GOALS);
 const work_on=list(e.work_on,MAX_WORK_ON);
 return {title,chapters,themes,...(clean(e.warning,600)?{warning:clean(e.warning,600)}:{}),...(goals.length?{goals}:{}),...(work_on.length?{work_on}:{})};
}
/**
 * Who may open a recap, given the answer the database already worked out.
 *
 * `access` is the result of `lesson_video_access(id)`: 'owner', 'coach' for
 * the coach a player shared with, 'student' for the student a coach shared
 * with, or null for everybody else. Only the owner sees a recap that is
 * still rendering; the other two wait for it to finish, because a half-made
 * recap read as the finished one when this was decided in the route.
 */
export function canReadVideo(access:string|null,status:string):boolean {return access==='owner'||((access==='coach'||access==='student')&&status==='ready');}
export function publicVideo(row:Record<string,unknown>,isOwner:boolean):Record<string,unknown>{
 const fields=['id','owner_id','student_id','coach_ref_id','lesson_id','original_name','file_size','duration_s','status','stage','error','edit','created_at','updated_at','revision'];
 const out=Object.fromEntries(fields.filter(k=>k in row).map(k=>[k,row[k]]));
 if(!isOwner){delete out.error;delete out.stage;delete out.original_name;delete out.file_size;out.original_name='Lesson';out.file_size=0;}
 return out;
}
