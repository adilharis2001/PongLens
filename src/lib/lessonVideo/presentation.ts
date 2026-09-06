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
