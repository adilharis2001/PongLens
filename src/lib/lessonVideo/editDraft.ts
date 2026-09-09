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
export interface EditDraft extends Omit<LessonEdit,'chapters'> {chapters:DraftChapter[]}

let uid=0;
export const nextDraftId=():string=>`c${++uid}`;

export function draftFromEdit(edit:LessonEdit):EditDraft {
 return {
  ...edit,
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
 return {
  ...draft,
  title:draft.title.trim(),
  chapters:draft.chapters.map(({id:_id,...chapter})=>({
   ...chapter,
   title:chapter.title.trim(),
   cues:chapter.cues.map((cue)=>cue.text.trim()).filter(Boolean),
  })),
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
