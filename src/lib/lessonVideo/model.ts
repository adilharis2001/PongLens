export const MAX_BYTES = 20 * 1024 ** 3;
export const MAX_SECONDS = 10800;
export const PART_SIZE = 64 * 1024 ** 2;
export interface LessonChapter { title: string; cues: string[]; start_s: number; end_s: number; summary_start_s?: number; summary_end_s?: number }
export interface LessonEdit { title: string; chapters: LessonChapter[]; themes: {name:string;points:string[]}[]; warning?:string }
export interface LessonVideo { id:string; owner_id:string; student_id:string|null; lesson_id:string|null; original_name:string;file_size:number;duration_s:number;status:string;stage:string|null;error:string|null;edit:LessonEdit|null;created_at:string;updated_at:string;revision:number }
export function validateImport(bytes:number, seconds:number):string|null {
 if (!Number.isSafeInteger(bytes)||bytes<=0||bytes>MAX_BYTES) return 'Choose a video up to 20 GB.';
 if (!Number.isFinite(seconds)||seconds<=0||seconds>MAX_SECONDS) return 'Choose a lesson up to three hours long.';
 return null;
}
function clean(value:unknown,max:number):string {return typeof value==='string'?value.trim().slice(0,max):'';}
export function validateEdit(input:unknown,duration:number):LessonEdit|null {
 if(!input||typeof input!=='object')return null;
 const e=input as Record<string,unknown>; const title=clean(e.title,100);
 if(!title||!Array.isArray(e.chapters)||!e.chapters.length||e.chapters.length>10)return null;
 const chapters:LessonChapter[]=[];let total=0;
 for(const raw of e.chapters){
  if(!raw||typeof raw!=='object')return null;
  const c=raw as Record<string,unknown>; const start=Number(c.start_s),end=Number(c.end_s);
  const name=clean(c.title,80); const cues=Array.isArray(c.cues)?c.cues.map(x=>clean(x,220)).filter(Boolean).slice(0,4):[];
  if(!name||!cues.length||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>duration+.05||end<=start||end-start>120)return null;
  total+=end-start;if(total>420.1)return null;
  chapters.push({title:name,cues,start_s:start,end_s:end});
 }
 const themes=Array.isArray(e.themes)?e.themes.slice(0,16).map(t=>({name:clean(t?.name,80),points:Array.isArray(t?.points)?t.points.map((p:unknown)=>clean(p,400)).filter(Boolean).slice(0,16):[]})).filter(t=>t.name&&t.points.length):[];
 return {title,chapters,themes,...(clean(e.warning,600)?{warning:clean(e.warning,600)}:{})};
}
export function canReadVideo(viewer:string,owner:string,status:string,shared:boolean):boolean {return viewer===owner||(status==='ready'&&shared);}
export function publicVideo(row:Record<string,unknown>,isOwner:boolean):Record<string,unknown>{
 const fields=['id','owner_id','student_id','lesson_id','original_name','file_size','duration_s','status','stage','error','edit','created_at','updated_at','revision'];
 const out=Object.fromEntries(fields.filter(k=>k in row).map(k=>[k,row[k]]));
 if(!isOwner){delete out.error;delete out.stage;delete out.original_name;delete out.file_size;out.original_name='Lesson';out.file_size=0;}
 return out;
}
