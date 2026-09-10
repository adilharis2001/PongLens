'use client';

import { useEffect, useRef, useState } from 'react';
import { LessonPlayback } from './LessonPlayback';
import { UpLink } from '@/components/UpLink';
import { AutoTextarea } from '@/components/AutoTextarea';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { LessonVideo } from '@/lib/lessonVideo/model';
import {
  canAddCue,
  canRemoveCue,
  draftBlocker,
  draftFromEdit,
  draftSnapshot,
  editFromDraft,
  MAX_CHAPTER_TITLE_LENGTH,
  MAX_CUE_LENGTH,
  MAX_RECAP_TITLE_LENGTH,
  nextDraftId,
  type EditDraft,
} from '@/lib/lessonVideo/editDraft';
import {
  formatClipLength,
  lessonCanSetCoach,
  lessonCanShare,
  lessonChapterStart,
  lessonReaderSections,
  lessonRecapMinutes,
  lessonStatusLabel,
  sameMediaTarget,
} from '@/lib/lessonVideo/presentation';
import {
  shareFileCanPrepare,
  shareFileDownloadable,
  shareFileSize,
  type ShareFileState,
} from '@/lib/lessonVideo/shareFile';

/**
 * One lesson video: the recap to watch, its chapters, and what the coach
 * can do with it.
 *
 * Laid out like the rest of the coach pages rather than like a phone
 * screen stretched across a desktop. On a wide screen the recap and its
 * chapter list take the left, and the actions sit in a column on the
 * right, the way the profile editor and the match page split. On a phone
 * the same pieces stack: recap, actions, chapters, manage.
 *
 * The chapters are listed on the page itself, not only inside the player:
 * a coach checking a recap wants to see what is in it before pressing
 * play, and a student coming back for one point wants to land on that
 * point. Tapping a chapter opens playback there.
 *
 * "Manage" replaces the More menu: the secondary actions as rows in a card,
 * which is how every other coach page offers them.
 *
 * Two of those rows open a dialog rather than doing something at once, and
 * they borrow the match page's words for it. "Share" on its own never says
 * whether you get a link, a file or a permission, so the row that mints a
 * public URL is "Share a link" and the row that hands you a file is
 * "Export". The downloadable copy with the words painted into the picture
 * lives inside Export, where somebody looking for a file will look.
 */

const button =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-edge px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-cyan-glow/50 hover:text-white disabled:opacity-40';
const primary =
  'glow-cta inline-flex min-h-12 items-center justify-center rounded-full bg-cyan-glow px-6 py-2.5 text-sm font-semibold text-ink disabled:opacity-40';
const field =
  'mt-2 block w-full rounded-xl border border-edge bg-ink p-3 text-sm text-zinc-100 focus:border-cyan-glow focus:outline-none';
const card = 'divide-y divide-edge/60 overflow-hidden rounded-2xl border border-edge bg-surface';
const row =
  'flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-surface-2 disabled:opacity-40';
/** The page has one modal treatment. Every dialog on it uses this shell. */
const dialogShell =
  'm-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-edge bg-surface p-5 text-zinc-100 backdrop:bg-black/75';
/** What a Manage row says on its right: the state, not a second label. */
const rowState = 'shrink-0 text-xs text-zinc-500';

export interface LessonUp {
  href: string;
  label: string;
}

interface Detail {
  video: LessonVideo;
  isOwner: boolean;
  /** Whether the linked student can see it today. Absent from older responses. */
  shared?: boolean;
  sourceUrl?: string;
  playbackUrl?: string;
  posterUrl?: string;
  /**
   * The downloadable copy with the words painted into the picture, and how
   * far along it is. `stage` and `error` are the owner's only. Absent from
   * older responses, which is read as "there is no file".
   */
  file?: {
    state: ShareFileState;
    stage: string | null;
    error: string | null;
    bytes: number | null;
    url: string | null;
  };
  /** The public link to this recap, owner only. Null when there is none. */
  link?: string | null;
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{children}</h2>;
}

const chevron = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
  </svg>
);

export function LessonVideoView({
  id,
  up,
  coaches = [],
}: {
  id: string;
  up: LessonUp | null;
  /** The player's own coaches, for answering who taught this lesson. */
  coaches?: { id: string; display_name: string }[];
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A line added by hand should be ready to type into. The id is claimed
  // by "Add a point" and spent by the field's ref the moment it mounts.
  const [focusId, setFocusId] = useState<string | null>(null);
  const [, setChapter] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [watching, setWatching] = useState(false);
  const [reading, setReading] = useState(false);
  // The two Manage dialogs. One at a time, so they share a busy flag and an
  // error line; both are rendered outside Actions() so the modal never
  // escapes the hidden half of the responsive layout.
  const [linking, setLinking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState('');
  const [copied, setCopied] = useState(false);
  // Read after mount: this component renders on the server too, where
  // navigator does not exist.
  const [canNativeShare, setCanNativeShare] = useState(false);
  const resumeTime = useRef(0);
  const linkField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  const active = useRef(true);
  const editingRevision = useRef(0);
  // The recap as it read when the editor opened, for the discard guard.
  const editingOriginal = useRef('');
  const linkBorn = useRef(0);
  const savedOnOpen = useRef(false);

  async function load(force = false) {
    const r = await fetch('/api/lesson-video?id=' + id);
    const d: Detail & { error?: string } = await r.json();
    if (!r.ok) throw new Error(d.error);
    if (!active.current) return;
    setDetail((previous) => {
      // Signed links last four hours; keep the one that is playing while it
      // still points at the same file, so a poll never restarts the video.
      // This used to compare the revision and the status instead, which said
      // "changed" on a text edit that leaves the video untouched, and the
      // picture blinked while a coach typed.
      if (
        !force &&
        previous?.playbackUrl &&
        sameMediaTarget(previous.playbackUrl, d.playbackUrl) &&
        Date.now() - linkBorn.current < 3 * 3600 * 1000
      ) {
        return {
          ...d,
          playbackUrl: previous.playbackUrl,
          posterUrl: sameMediaTarget(previous.posterUrl, d.posterUrl) ? previous.posterUrl : d.posterUrl,
        };
      }
      linkBorn.current = Date.now();
      return d;
    });
    // A player's finished recap saves itself to their journal the first
    // time they open it, unshared. Adil, 2026-09-07: "the prepared recap
    // should just save to my profile, and that's it." There is no review
    // step for a lesson somebody had, only for one a coach made for a
    // student, and a Save recap button that had to be pressed before the
    // share switch meant anything was the button that read as
    // reprocessing. The ref keeps the ten-second poll from asking twice.
    if (d.isOwner && !d.video.student_id && d.video.status === 'review' && !savedOnOpen.current) {
      savedOnOpen.current = true;
      await action('share', { share: false });
    }
  }
  useEffect(() => {
    active.current = true;
    void load().catch((e) => setError(e.message));
    const timer = setInterval(() => {
      void load().catch(() => {});
    }, 10000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const v = detail?.video;
  const edit = v?.edit;
  useEffect(() => {
    setChapter((index) => Math.min(index, Math.max(0, (edit?.chapters.length ?? 1) - 1)));
  }, [edit?.chapters.length]);

  // Owners go up to the student, the coach, or the list. A reader came
  // from the room the recap was shared into: a student's journal for a
  // coach's recap, the coaching workspace for a student's.
  const back=detail?.isOwner?(up?.href??(v?.student_id?'/coaching/students/'+v.student_id:v?.coach_ref_id?'/coaching':'/coaching/videos')):'/coaching';
  const upLabel = detail?.isOwner ? (up?.label ?? (v?.student_id ? 'Student' : 'Lesson videos')) : 'Coaching';

  /* Whose recap this is, which decides every sentence below. A coach made
     it FOR a student; a player made it WITH a coach. Same recap, opposite
     halves of the relationship, and the page used to only know one. */
  const forStudent = !!v?.student_id;
  const withCoach = !!v?.coach_ref_id;
  const otherName = up?.label ?? (forStudent ? 'your student' : 'your coach');

  // Older responses do not say; until they do, ready-with-a-recipient
  // means shared.
  const shared = detail?.shared ?? false;
  const owner = !!detail?.isOwner;
  const watchable = !!detail?.playbackUrl && !!edit;
  const canShare = !!v && forStudent && lessonCanShare(v, owner, shared);
  const canRetry = owner && v?.status === 'failed';
  // A rebuild over a recap that can still be watched. The old recap stays
  // on the page while the worker makes the new one.
  const updating = watchable && !!v && ['queued', 'processing'].includes(v.status);
  const canEdit = owner && !!edit && !!v && ['review', 'ready', 'failed'].includes(v.status);
  // The Edit row stays where it was while the rebuild runs, shut rather
  // than gone: a row that vanishes reads as the menu breaking.
  const editLocked = owner && updating;
  const canDelete = owner && !!v && !['queued', 'processing'].includes(v.status);
  // An upload that has stalled is the one thing a coach most needs to be
  // able to get rid of, and it is the case that used to be refused.
  const cancellingUpload = v?.status === 'uploading';

  // The public link and the downloadable copy. Both are the owner's to
  // decide; a coach shared with may read the recap in the app and nothing
  // more, which is what the two routes behind these already enforce.
  const link = detail?.link ?? null;
  const file = detail?.file;
  const fileState: ShareFileState = file?.state ?? 'none';
  const fileUrl = file?.url ?? null;
  const fileSize = shareFileSize(file?.bytes);
  const canDownloadFile = shareFileDownloadable(fileState) && !!fileUrl;
  // The file is cut from the finished recap, so the database refuses to
  // start one while the recap itself is being made again. Offering a button
  // that can only come back with an error is worse than not offering it.
  const recapSettled = !!v && ['review', 'ready'].includes(v.status);
  const canPrepareFile = owner && watchable && recapSettled && shareFileCanPrepare(fileState);
  const prepareWaiting = owner && watchable && !recapSettled && shareFileCanPrepare(fileState);
  const canLink = owner && watchable;
  // A student sees the file entry only when there is a file to take. The
  // owner sees it whenever there is a recap, because they can ask for one.
  const showFileEntry = watchable && (owner || canDownloadFile);
  const showSource = owner && !!detail?.sourceUrl;
  const hasExport = showFileEntry || showSource;
  const hasManage = canEdit || editLocked || canLink || hasExport || canDelete;
  const editDirty = !!editing && draftSnapshot(editing) !== editingOriginal.current;
  const editBlocker = editing ? draftBlocker(editing) : null;

  async function action(name: string, extra: object = {}) {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/lesson-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: name, id, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (name === 'delete') {
        location.href = back;
        return;
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function post(url: string, body: object) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'That did not work. Try again.');
    return d;
  }
  /** Anything a Manage dialog does: its own busy flag and its own error
   *  line, because a modal sits in the top layer and the page's error
   *  message is behind the backdrop where nobody can read it. */
  async function manage(run: () => Promise<void>) {
    setManageBusy(true);
    setManageError('');
    try {
      await run();
      await load();
    } catch (e) {
      setManageError((e as Error).message);
    } finally {
      setManageBusy(false);
    }
  }
  function openLinking() {
    setManageError('');
    setCopied(false);
    setLinking(true);
  }
  function openExport() {
    setManageError('');
    setExporting(true);
  }
  const createLink = () => manage(async () => { await post('/api/share', { lessonVideoId: id }); });
  const stopSharing = () =>
    manage(async () => {
      // Revoking needs the link row's id and only the create call answers
      // with it. That call is idempotent, so asking for the link we already
      // have returns the same row rather than minting a second one.
      const made = await post('/api/share', { lessonVideoId: id });
      await post('/api/share/revoke', { id: made.id });
    });
  const prepareFile = () => manage(async () => { await post('/api/lesson-video', { action: 'prepare-file', id }); });
  async function copyLink() {
    if (!link) return;
    setManageError('');
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission. Select the link so one keystroke takes it.
      linkField.current?.select();
      setManageError('Copy the selected link with your keyboard.');
    }
  }
  async function shareLink() {
    if (!link) return;
    try {
      await navigator.share({ url: link });
    } catch {
      // The person closed the system share sheet. The link is still there.
    }
  }
  function openEditor() {
    editingRevision.current = v!.revision;
    const draft = draftFromEdit(edit!);
    editingOriginal.current = draftSnapshot(draft);
    setFocusId(null);
    setConfirmDiscard(false);
    setEditing(draft);
  }
  function closeEditor() {
    setConfirmDiscard(false);
    setEditing(null);
  }
  /** Cancel, Escape and the backdrop all come through here, so unsaved
   *  work is never dropped without asking. */
  function attemptCloseEditor() {
    if (busy) return;
    if (editDirty) setConfirmDiscard(true);
    else closeEditor();
  }
  function updateDraft(change: (draft: EditDraft) => EditDraft) {
    setEditing((draft) => (draft ? change(draft) : draft));
  }
  function updateChapter(chapterId: string, change: (chapter: EditDraft['chapters'][number]) => EditDraft['chapters'][number]) {
    updateDraft((draft) => ({ ...draft, chapters: draft.chapters.map((c) => (c.id === chapterId ? change(c) : c)) }));
  }
  function addCue(chapterId: string) {
    const id = nextDraftId();
    updateChapter(chapterId, (c) => (canAddCue(c) ? { ...c, cues: [...c.cues, { id, text: '' }] } : c));
    setFocusId(id);
  }
  function removeCue(chapterId: string, cueId: string) {
    updateChapter(chapterId, (c) => (canRemoveCue(c) ? { ...c, cues: c.cues.filter((cue) => cue.id !== cueId) } : c));
  }
  function removeChapter(chapterId: string) {
    updateDraft((draft) => (draft.chapters.length > 1 ? { ...draft, chapters: draft.chapters.filter((c) => c.id !== chapterId) } : draft));
  }

  // Escape goes through the same guard as Cancel. Stopping the keydown's
  // default keeps the browser's own close-on-Escape from running ahead of
  // the question. No dependency list: the guard reads state that changes
  // on every keystroke, and a stale closure here would discard work.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || confirmDiscard) return;
      e.preventDefault();
      e.stopPropagation();
      attemptCloseEditor();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });
  function watchFrom(index: number) {
    if (!edit) return;
    resumeTime.current = lessonChapterStart(edit.chapters, index) ?? 0;
    setChapter(index);
    setWatching(true);
  }

  return (
    <>
      <UpLink href={back} label={upLabel} />
      <header className="mt-4">
        {v && <p className="text-sm font-medium text-zinc-400">{lessonStatusLabel(v, shared, !!detail?.playbackUrl)}</p>}
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          {edit?.title ?? v?.original_name ?? 'Lesson video'}
        </h1>
      </header>
      {error && (
        <p role="alert" className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-950/30 p-4 text-sm text-amber-200">
          {error}
        </p>
      )}
      {!v ? (
        <p className="mt-6 text-sm text-zinc-400">{error ? '' : 'Loading lesson…'}</p>
      ) : (
        <div className="mt-6 lg:flex lg:items-start lg:gap-8">
          <div className="min-w-0 lg:flex-1">
            {watchable ? (
              <>
                <button
                  aria-label="Play"
                  className="group relative block aspect-video w-full overflow-hidden rounded-2xl bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-glow"
                  onClick={() => setWatching(true)}
                >
                  {detail?.posterUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={detail.posterUrl} alt="Lesson video preview" className="absolute inset-0 h-full w-full object-cover" />
                  )}
                  <span className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/20" />
                  <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md">
                    <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 4.5v15l12-7.5z" />
                    </svg>
                  </span>
                </button>
                <div className="mt-3 flex items-center justify-between text-sm text-zinc-400">
                  <span>{edit!.chapters.length} chapters</span>
                  <span>{lessonRecapMinutes(edit!)} min recap</span>
                </div>
                {/* The rebuild, in the worker's own words. The ten-second
                    poll keeps the stage current; the old recap above keeps
                    playing until the new one replaces it. */}
                {updating && (
                  <div role="status" className="mt-4 rounded-2xl border border-edge bg-surface p-5">
                    <p className="font-medium">Updating your recap</p>
                    <p className="mt-1 text-sm text-zinc-300">{v.status === 'processing' && v.stage ? v.stage : 'Waiting to start'}</p>
                    <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                      Your current recap stays until the new one is ready. This usually takes 15 to 20 minutes.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div role="status" className="rounded-2xl border border-edge bg-surface p-5">
                <p className="font-medium">{v.status === 'failed' ? 'The recap needs another try' : v.stage ?? 'Waiting for the upload'}</p>
                <p className="mt-3 text-sm text-zinc-400">{v.error ?? 'Your lesson will be here when it is ready.'}</p>
              </div>
            )}

            <aside className="mt-6 lg:hidden">
              <Actions />
            </aside>

            {edit && edit.chapters.length > 0 && (
              <section className="mt-8" aria-label="Chapters">
                <Label>Chapters</Label>
                <div className={card}>
                  {edit.chapters.map((chapter, index) => (
                    <button
                      key={index}
                      type="button"
                      disabled={!watchable}
                      className="flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-60 disabled:hover:bg-transparent"
                      onClick={() => watchFrom(index)}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-zinc-400">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium leading-snug text-zinc-100">{chapter.title}</span>
                      <span className="shrink-0 text-xs tabular-nums text-zinc-500">{formatClipLength(chapter.end_s - chapter.start_s)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="hidden lg:block lg:w-[340px] lg:shrink-0">
            <Actions />
          </aside>
        </div>
      )}

      {watching && detail?.playbackUrl && edit && (
        <LessonPlayback
          src={detail.playbackUrl}
          poster={detail.posterUrl}
          edit={edit}
          initialTime={resumeTime.current}
          onClose={(time, index) => {
            resumeTime.current = time;
            setChapter(index);
            setWatching(false);
          }}
          onRetry={() => load(true)}
        />
      )}
      {reading && edit && (
        <dialog
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={() => setReading(false)}
          className="m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto border-0 bg-ink p-0 text-zinc-100 backdrop:bg-black/80 sm:m-auto sm:h-auto sm:max-h-[85dvh] sm:w-[calc(100%-3rem)] sm:max-w-3xl sm:rounded-2xl sm:border sm:border-edge sm:bg-surface"
        >
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-edge bg-ink/95 px-5 py-4 backdrop-blur sm:bg-surface/95">
            <h2 className="text-xl font-semibold">Lesson notes</h2>
            <button autoFocus className={button} onClick={() => setReading(false)}>
              Close
            </button>
          </div>
          <div className="px-5 pb-12 pt-7 sm:px-8">
            <p className="text-2xl font-bold tracking-tight">{edit.title}</p>
            <div className="mt-8 divide-y divide-edge">
              {lessonReaderSections(edit).map((section) => (
                <section key={section.number} className="py-7 first:pt-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-cyan-glow">Chapter {section.number}</p>
                  <h3 className="mt-2 text-xl font-semibold leading-snug">{section.title}</h3>
                  <div className="mt-4 space-y-3">
                    {section.cues.map((cue, index) => (
                      <p key={index} className="text-base leading-relaxed text-zinc-300">
                        {cue}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </dialog>
      )}
      {editing && (
        <dialog
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={(e) => {
            // The browser's own Escape. Held open here so the discard
            // question is asked; the keydown guard above usually gets
            // there first.
            e.preventDefault();
            if (!confirmDiscard) attemptCloseEditor();
          }}
          onClose={(e) => {
            // A close the page did not ask for (a browser that would not
            // hold the dialog open). Unsaved work comes back with the
            // question rather than vanishing.
            if (editDirty) {
              e.currentTarget.showModal();
              setConfirmDiscard(true);
            } else closeEditor();
          }}
          className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-edge bg-surface p-5 text-zinc-100 backdrop:bg-black/75"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Edit recap</h2>
            <button type="button" className={button} disabled={busy} onClick={attemptCloseEditor}>
              Cancel
            </button>
          </div>
          <label className="mt-5 block text-sm">
            Title
            <input
              autoFocus
              className={field}
              value={editing.title}
              maxLength={MAX_RECAP_TITLE_LENGTH}
              onChange={(e) => updateDraft((draft) => ({ ...draft, title: e.target.value }))}
            />
          </label>
          {editing.chapters.map((ch, i) => (
            <div className="mt-6 border-t border-edge pt-5" key={ch.id}>
              <label className="block text-sm text-zinc-400">
                Chapter {i + 1}
                <input
                  aria-label={`Chapter ${i + 1} title`}
                  className={field}
                  value={ch.title}
                  maxLength={MAX_CHAPTER_TITLE_LENGTH}
                  onChange={(e) => updateChapter(ch.id, (c) => ({ ...c, title: e.target.value }))}
                />
              </label>
              <ul className="mt-3 space-y-1.5">
                {ch.cues.map((cue, j) => (
                  <li key={cue.id} className="flex gap-2">
                    {/* The same bullet the journal editor draws, measured
                        onto the centre of the field's first line. */}
                    <span className="mt-[18px] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
                    <AutoTextarea
                      value={cue.text}
                      onChange={(e) => {
                        const text = e.target.value.slice(0, MAX_CUE_LENGTH);
                        updateChapter(ch.id, (c) => ({ ...c, cues: c.cues.map((x) => (x.id === cue.id ? { ...x, text } : x)) }));
                      }}
                      rows={1}
                      maxLength={MAX_CUE_LENGTH}
                      placeholder="One short reminder"
                      aria-label={`Chapter ${i + 1} point ${j + 1}`}
                      ref={(el) => {
                        if (el && focusId === cue.id) {
                          el.focus();
                          setFocusId(null);
                        }
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-transparent bg-surface-2/40 px-2 py-1.5 text-[15px] text-zinc-200 outline-none hover:border-edge focus:border-cyan-glow/50 focus:bg-surface-2/60"
                    />
                    {canRemoveCue(ch) && (
                      <button
                        type="button"
                        onClick={() => removeCue(ch.id, cue.id)}
                        aria-label="Remove this point"
                        title="Remove this point"
                        className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-surface-2 hover:text-amber-300"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {canAddCue(ch) && (
                  <button
                    type="button"
                    onClick={() => addCue(ch.id)}
                    className="rounded-full border border-edge px-3.5 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-cyan-glow/50 hover:text-white"
                  >
                    Add a point
                  </button>
                )}
                {editing.chapters.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeChapter(ch.id)}
                    className="rounded-full border border-edge px-3.5 py-1.5 text-sm font-medium text-zinc-300 transition-colors hover:border-amber-300/50 hover:text-amber-300"
                  >
                    Remove chapter
                  </button>
                )}
              </div>
            </div>
          ))}
          <div className="mt-6 border-t border-edge pt-5">
            <button
              type="button"
              disabled={busy || !!editBlocker}
              className={primary + ' w-full sm:w-auto'}
              onClick={() => void action('edit', { edit: editFromDraft(editing), expectedRevision: editingRevision.current })}
            >
              {busy ? 'Saving…' : 'Save and rebuild'}
            </button>
            {editBlocker && <p className="mt-3 text-sm text-zinc-400">{editBlocker}</p>}
            {error && (
              <p role="alert" className="mt-3 text-sm text-amber-300">
                {error}
              </p>
            )}
          </div>
          {/* Inside the dialog on purpose: a modal dialog sits in the top
              layer, and anything rendered outside it is behind the
              backdrop and cannot be pressed. */}
          <ConfirmDialog
            open={confirmDiscard}
            title="Discard your changes?"
            confirmLabel="Discard"
            onCancel={() => setConfirmDiscard(false)}
            onConfirm={closeEditor}
          />
        </dialog>
      )}
      {linking && (
        <dialog
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={() => setLinking(false)}
          className={dialogShell}
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Share a link</h2>
            <button type="button" className={button} onClick={() => setLinking(false)}>
              Close
            </button>
          </div>
          {link ? (
            <>
              <div className="mt-4">
                <input
                  ref={linkField}
                  readOnly
                  aria-label="Link to this recap"
                  className={field}
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button type="button" className={primary + ' w-full sm:w-auto'} onClick={() => void copyLink()}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                {canNativeShare && (
                  <button type="button" className={button + ' w-full sm:w-auto'} onClick={() => void shareLink()}>
                    Share
                  </button>
                )}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className={button + ' w-full text-amber-300 sm:w-auto'}
                  disabled={manageBusy}
                  onClick={() => void stopSharing()}
                >
                  {manageBusy ? 'Stopping…' : 'Stop sharing'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm leading-relaxed text-zinc-400">
                Anyone with the link can watch this recap. They do not need a PongLens account.
              </p>
              <button
                type="button"
                className={primary + ' mt-4 w-full sm:w-auto'}
                disabled={manageBusy}
                onClick={() => void createLink()}
              >
                {manageBusy ? 'Creating…' : 'Create a link'}
              </button>
            </>
          )}
          {manageError && (
            <p role="alert" className="mt-3 text-sm text-amber-300">
              {manageError}
            </p>
          )}
        </dialog>
      )}
      {exporting && (
        <dialog
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={() => setExporting(false)}
          className={dialogShell}
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Export</h2>
            <button type="button" className={button} onClick={() => setExporting(false)}>
              Close
            </button>
          </div>
          {showFileEntry && (
            <section className="mt-5">
              <h3 className="text-sm font-semibold text-zinc-100">Video with text</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                {fileState === 'none'
                  ? 'The video with your words on it has not been made yet.'
                  : fileState === 'queued' || fileState === 'processing'
                    ? (file?.stage ?? 'Waiting to start')
                    : fileState === 'ready'
                      ? fileSize
                        ? 'Ready. ' + fileSize + '.'
                        : 'Ready.'
                      : fileState === 'behind'
                        ? 'This file still shows your earlier wording.'
                        : (file?.error ?? 'The video could not be made.')}
              </p>
              {(canPrepareFile || canDownloadFile) && (
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  {canPrepareFile && (
                    <button
                      type="button"
                      className={primary + ' w-full sm:w-auto'}
                      disabled={manageBusy}
                      onClick={() => void prepareFile()}
                    >
                      {manageBusy
                        ? 'Starting…'
                        : fileState === 'behind'
                          ? 'Prepare it again'
                          : fileState === 'failed'
                            ? 'Try again'
                            : 'Prepare the video'}
                    </button>
                  )}
                  {canDownloadFile && (
                    <a
                      className={(canPrepareFile ? button : primary) + ' w-full sm:w-auto'}
                      href={fileUrl!}
                    >
                      {canPrepareFile ? 'Download anyway' : 'Download'}
                    </a>
                  )}
                </div>
              )}
              {canPrepareFile && (
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  This takes a few minutes. You can keep using PongLens while it runs.
                </p>
              )}
              {prepareWaiting && (
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                  You can make it once the update finishes.
                </p>
              )}
            </section>
          )}
          {showSource && (
            <section className={'mt-5' + (showFileEntry ? ' border-t border-edge pt-5' : '')}>
              <h3 className="text-sm font-semibold text-zinc-100">Original recording</h3>
              <a
                className={button + ' mt-4 w-full sm:w-auto'}
                href={detail!.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            </section>
          )}
          {manageError && (
            <p role="alert" className="mt-3 text-sm text-amber-300">
              {manageError}
            </p>
          )}
        </dialog>
      )}
      {confirmDelete && (
        <dialog
          ref={(node) => {
            if (node && !node.open) node.showModal();
          }}
          onCancel={() => setConfirmDelete(false)}
          className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-edge bg-surface p-6 text-zinc-100 backdrop:bg-black/75"
        >
          <h2 className="text-xl font-semibold">{cancellingUpload ? 'Cancel this upload?' : 'Delete this lesson video?'}</h2>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">
            {cancellingUpload
              ? 'The part of the video that has been sent so far will be thrown away. The video on your phone is untouched, and you can import it again.'
              : 'The original, recap, and linked lesson entry will be deleted. This cannot be undone.'}
          </p>
          <div className="mt-5 flex gap-3">
            <button className={button + ' text-amber-300'} disabled={busy} onClick={() => void action('delete')}>
              {cancellingUpload ? 'Cancel the upload' : 'Delete'}
            </button>
            <button className={button} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </dialog>
      )}
    </>
  );

  /**
   * The actions column. Rendered twice in the tree, once for each layout,
   * with only one visible at a time; it reads the same state either way.
   */
  function Actions() {
    if (!v) return null;
    const anyPrimary = canShare || canRetry;
    const canAttribute = lessonCanSetCoach(v, owner);
    return (
      <>
        {canAttribute && (
          <div className="mb-6 rounded-2xl border border-edge bg-surface p-5">
            <label className="block text-sm text-zinc-400">
              Who taught it?
              <select
                className={field}
                disabled={busy}
                value={v.coach_ref_id ?? ''}
                onChange={(e) =>
                  void action('recipient', { coachRefId: e.target.value || null })
                }
              >
                <option value="">No coach</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name}
                  </option>
                ))}
              </select>
            </label>
            {/* The share switch IS the share control, shown once the recap
                is saved, which is when there is something to share. It used
                to sit as three buttons in the card below — Share, Keep it to
                myself, Stop sharing — two of which did nothing on a recap
                that was already saved. Same markup as the journal's. */}
            {v.coach_ref_id && v.status === 'ready' && (
              <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={shared}
                  disabled={busy}
                  onChange={(e) => void action(e.target.checked ? 'share' : 'unshare', e.target.checked ? { share: true } : {})}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-cyan-glow,#22d3ee)]"
                />
                <span>Share this recap with {otherName}</span>
              </label>
            )}
            {v.coach_ref_id && (
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Changing who taught it stops sharing, so you choose again who sees it.
              </p>
            )}
          </div>
        )}
        <div className="rounded-2xl border border-edge bg-surface p-5">
          {canShare && (
            <button
              className={primary + ' w-full'}
              disabled={busy}
              onClick={() => void action('share')}
            >
              {busy ? 'Saving…' : 'Share with student'}
            </button>
          )}
          {canRetry && (
            <button className={button + ' w-full'} disabled={busy} onClick={() => void action('retry')}>
              Retry processing
            </button>
          )}
          {owner && shared && forStudent && (
            <p className="text-sm leading-relaxed text-zinc-400">
              Shared with {otherName}. It is in their journal, and any edit you make here goes to them once you share it again.
            </p>
          )}
          {!owner && <p className="text-sm leading-relaxed text-zinc-400">Shared with you.</p>}
          {error && (
            <p role="alert" className="mt-3 text-sm text-amber-300">
              {error}
            </p>
          )}
          {edit && (
            <button className={button + ' w-full' + (anyPrimary || shared || !owner ? ' mt-3' : '')} onClick={() => setReading(true)}>
              Read lesson notes
            </button>
          )}
        </div>
        {hasManage && (
          <section className="mt-6" aria-label="Manage">
            <Label>Manage</Label>
            <div className={card}>
              {(canEdit || editLocked) && (
                <button
                  type="button"
                  className={row + (editLocked ? ' cursor-not-allowed opacity-50 disabled:opacity-50 disabled:hover:bg-transparent' : '')}
                  disabled={busy || editLocked}
                  onClick={openEditor}
                >
                  Edit recap
                  {chevron}
                </button>
              )}
              {canLink && (
                <button type="button" className={row} onClick={openLinking}>
                  Share a link
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={rowState}>{link ? '1 link' : 'Not shared'}</span>
                    {chevron}
                  </span>
                </button>
              )}
              {hasExport && (
                <button type="button" className={row} onClick={openExport}>
                  Export
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={rowState}>Video files</span>
                    {chevron}
                  </span>
                </button>
              )}
              {canDelete && (
                <button type="button" className={row + ' text-red-300'} disabled={busy} onClick={() => setConfirmDelete(true)}>
                  {cancellingUpload ? 'Cancel this upload' : 'Delete lesson video'}
                  {chevron}
                </button>
              )}
            </div>
            {editLocked && <p className="mt-3 text-sm text-zinc-400">Editing is available when the update finishes.</p>}
          </section>
        )}
      </>
    );
  }
}
