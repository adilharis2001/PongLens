import type {LessonChapter, LessonEdit} from './model';

/**
 * The recap editor's working copy.
 *
 * A chapter's cues are edited as a list of lines, added and removed one
 * at a time, so each needs a key that survives its text changing and two
 * blank lines being on screen at once. The draft carries those ids; the
 * saved edit never does. Same shape as the journal editor's DraftTheme /
 * DraftPoint, for the same reason.
 */

/** How many points a chapter may carry in the editor. The rendered video
 *  panel has room for three; the server still accepts four, so an older
 *  recap with four is left as it is until somebody removes one. */
export const MAX_DRAFT_CUES=3;
export const MAX_CUE_LENGTH=220;
export const MAX_CHAPTER_TITLE_LENGTH=80;
export const MAX_RECAP_TITLE_LENGTH=100;

export interface DraftCue {id:string;text:string}
export interface DraftChapter extends Omit<LessonChapter,'cues'> {id:string;cues:DraftCue[]}
/** The two lists that bracket the recap are always present on a draft, empty
 *  when the lesson stated none, because an editor needs somewhere to add the
 *  first line. `editFromDraft` drops an empty one again, so a recap that
 *  names no goals still saves without a goals card. */
export interface EditDraft extends Omit<LessonEdit,'chapters'|'goals'|'work_on'> {chapters:DraftChapter[];goals:DraftCue[];work_on:DraftCue[]}

let uid=0;
export const nextDraftId=():string=>`c${++uid}`;

const draftLines=(lines:string[]|undefined):DraftCue[]=>(lines??[]).map((text)=>({id:nextDraftId(),text}));

export function draftFromEdit(edit:LessonEdit):EditDraft {
 return {
  ...edit,
  goals:draftLines(edit.goals),
  work_on:draftLines(edit.work_on),
  chapters:edit.chapters.map((chapter)=>({
   ...chapter,
   id:nextDraftId(),
   cues:chapter.cues.map((text)=>({id:nextDraftId(),text})),
  })),
 };
}

/** The draft as it will be saved: text trimmed, blank lines dropped,
 *  ids gone. Themes and the warning ride through untouched. */
export function editFromDraft(draft:EditDraft):LessonEdit {
 const {goals:draftGoals,work_on:draftWorkOn,...rest}=draft;
 const lines=(list:DraftCue[]):string[]=>list.map((line)=>line.text.trim()).filter(Boolean);
 const goals=lines(draftGoals);
 const work_on=lines(draftWorkOn);
 return {
  ...rest,
  title:draft.title.trim(),
  chapters:draft.chapters.map(({id:_id,...chapter})=>({
   ...chapter,
   title:chapter.title.trim(),
   cues:chapter.cues.map((cue)=>cue.text.trim()).filter(Boolean),
  })),
  // Emptied on purpose is a real answer here: a coach who removes the last
  // goal means the recap has no goals card, so the key goes rather than
  // riding along as [].
  ...(goals.length?{goals}:{}),
  ...(work_on.length?{work_on}:{}),
 };
}

/** What "unsaved changes" compares. Built on the saved shape, so an
 *  added-then-abandoned blank line is not a change worth guarding. */
export function draftSnapshot(draft:EditDraft):string {
 return JSON.stringify(editFromDraft(draft));
}

/**
 * Why Save is shut, or null when it may fire. Said here as well as on the
 * server so an emptied line fails the moment it is emptied rather than
 * after a round trip and a rebuild that never starts.
 */
export function draftBlocker(draft:EditDraft):string|null {
 if(!draft.title.trim())return 'The recap needs a title.';
 if(draft.chapters.some((chapter)=>!chapter.title.trim()))return 'Every chapter needs a title.';
 if(draft.chapters.some((chapter)=>!chapter.cues.some((cue)=>cue.text.trim())))return 'Every chapter needs at least one point.';
 return null;
}

/** Whether "Add a point" is offered on this chapter. */
export function canAddCue(chapter:DraftChapter):boolean {
 return chapter.cues.length<MAX_DRAFT_CUES;
}

/** Whether this chapter's cues may lose one. A chapter keeps its last
 *  line, so the row cannot be removed into a state Save refuses. */
export function canRemoveCue(chapter:DraftChapter):boolean {
 return chapter.cues.length>1;
}

/** Whether another line may be added to one of the two bracketing lists.
 *  The limits are the server's own (MAX_GOALS, MAX_WORK_ON) and are passed
 *  in, so this file keeps its import of the model type-only. Unlike a
 *  chapter's points these lists may go all the way to empty, so there is
 *  no matching remove guard. */
export function canAddLine(lines:DraftCue[],limit:number):boolean {
 return lines.length<limit;
}
