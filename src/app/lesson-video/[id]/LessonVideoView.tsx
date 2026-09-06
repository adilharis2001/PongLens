'use client';

import { useEffect, useRef, useState } from 'react';
import { LessonPlayback } from './LessonPlayback';
import { UpLink } from '@/components/UpLink';
import type { LessonEdit, LessonVideo } from '@/lib/lessonVideo/model';
import {
  formatClipLength,
  lessonCanShare,
  lessonChapterStart,
  lessonReaderSections,
  lessonRecapMinutes,
  lessonStatusLabel,
} from '@/lib/lessonVideo/presentation';

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
 * "Manage" replaces the More menu: the same four actions, as rows in a
 * card, which is how every other coach page offers its secondary actions.
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
  summaryUrl?: string;
  playbackUrl?: string;
  posterUrl?: string;
}

function Label({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{children}</h2>;
}

const chevron = (
  <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" />
  </svg>
);

export function LessonVideoView({ id, up }: { id: string; up: LessonUp | null }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<LessonEdit | null>(null);
  const [, setChapter] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [watching, setWatching] = useState(false);
  const [reading, setReading] = useState(false);
  const resumeTime = useRef(0);

  const active = useRef(true);
  const editingRevision = useRef(0);
  const linkBorn = useRef(0);

  async function load(force = false) {
    const r = await fetch('/api/lesson-video?id=' + id);
    const d: Detail & { error?: string } = await r.json();
    if (!r.ok) throw new Error(d.error);
    if (!active.current) return;
    setDetail((previous) => {
      // Signed links last four hours; keep the one that is playing unless
      // the recap itself changed, so a poll never restarts the video.
      if (
        !force &&
        previous?.video.revision === d.video.revision &&
        previous?.video.status === d.video.status &&
        previous?.playbackUrl &&
        Date.now() - linkBorn.current < 3 * 3600 * 1000
      ) {
        return { ...d, playbackUrl: previous.playbackUrl, posterUrl: previous.posterUrl ?? d.posterUrl };
      }
      linkBorn.current = Date.now();
      return d;
    });
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

  // Owners go up to the student or the list; a student came from their journal.
  const back=detail?.isOwner?(up?.href??(v?.student_id?'/coaching/students/'+v.student_id:'/coaching/videos')):'/journal';
  const upLabel = detail?.isOwner ? (up?.label ?? (v?.student_id ? 'Student' : 'Lesson videos')) : 'Journal';

  // Older responses do not say; until they do, ready-with-a-student means shared.
  const shared = detail?.shared ?? (v?.status === 'ready' && !!v?.student_id);
  const owner = !!detail?.isOwner;
  const watchable = !!detail?.playbackUrl && !!edit;
  const canShare = !!v && lessonCanShare(v, owner, shared);
  const canRetry = owner && v?.status === 'failed';
  const canEdit = owner && !!edit && !!v && ['review', 'ready', 'failed'].includes(v.status);
  const canDelete = owner && !!v && !['queued', 'processing', 'uploading'].includes(v.status);
  const hasManage = canEdit || !!detail?.summaryUrl || (owner && !!detail?.sourceUrl) || canDelete;

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
  function openEditor() {
    editingRevision.current = v!.revision;
    setEditing(structuredClone(edit!));
  }
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
        {v && <p className="text-sm font-medium text-zinc-400">{lessonStatusLabel(v, shared)}</p>}
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
          onCancel={() => setEditing(null)}
          className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-edge bg-surface p-5 text-zinc-100 backdrop:bg-black/75"
        >
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Edit recap</h2>
            <button className={button} onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
          <label className="mt-5 block text-sm">
            Title
            <input autoFocus className={field} value={editing.title} maxLength={100} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </label>
          {editing.chapters.map((ch, i) => (
            <div className="mt-6 border-t border-edge pt-5" key={i}>
              <label className="text-sm text-zinc-400">
                Chapter {i + 1}
                <input
                  aria-label={`Chapter ${i + 1} title`}
                  className={field}
                  value={ch.title}
                  maxLength={80}
                  onChange={(e) => setEditing({ ...editing, chapters: editing.chapters.map((c, n) => (n === i ? { ...c, title: e.target.value } : c)) })}
                />
              </label>
              {ch.cues.map((cue, j) => (
                <textarea
                  key={j}
                  aria-label={`Chapter ${i + 1} reminder ${j + 1}`}
                  rows={3}
                  className={field}
                  value={cue}
                  maxLength={220}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      chapters: editing.chapters.map((c, n) => (n === i ? { ...c, cues: c.cues.map((x, m) => (m === j ? e.target.value : x)) } : c)),
                    })
                  }
                />
              ))}
              {editing.chapters.length > 1 && (
                <button className={button + ' mt-3'} onClick={() => setEditing({ ...editing, chapters: editing.chapters.filter((_, n) => n !== i) })}>
                  Remove chapter
                </button>
              )}
            </div>
          ))}
          <button disabled={busy} className={primary + ' mt-6'} onClick={() => void action('edit', { edit: editing, expectedRevision: editingRevision.current })}>
            Save and rebuild
          </button>
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
          <h2 className="text-xl font-semibold">Delete this lesson video?</h2>
          <p className="mt-4 text-sm leading-relaxed text-zinc-400">The original, recap, and linked lesson entry will be deleted. This cannot be undone.</p>
          <div className="mt-5 flex gap-3">
            <button className={button + ' text-amber-300'} disabled={busy} onClick={() => void action('delete')}>
              Delete
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
    return (
      <>
        <div className="rounded-2xl border border-edge bg-surface p-5">
          {canShare && (
            <button className={primary + ' w-full'} disabled={busy} onClick={() => void action('share')}>
              {busy ? 'Saving…' : v.student_id ? 'Share with student' : 'Save recap'}
            </button>
          )}
          {canRetry && (
            <button className={button + ' w-full'} disabled={busy} onClick={() => void action('retry')}>
              Retry processing
            </button>
          )}
          {owner && shared && v.student_id && (
            <p className="text-sm leading-relaxed text-zinc-400">
              Shared with {up?.label ?? 'your student'}. It is in their journal, and any edit you make here goes to them once you share it again.
            </p>
          )}
          {!owner && <p className="text-sm leading-relaxed text-zinc-400">Shared with you by your coach.</p>}
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
              {canEdit && (
                <button type="button" className={row} disabled={busy} onClick={openEditor}>
                  Edit recap
                  {chevron}
                </button>
              )}
              {detail?.summaryUrl && (
                <a className={row} href={detail.summaryUrl} target="_blank" rel="noreferrer">
                  Video with text
                  {chevron}
                </a>
              )}
              {owner && detail?.sourceUrl && (
                <a className={row} href={detail.sourceUrl} target="_blank" rel="noreferrer">
                  Original recording
                  {chevron}
                </a>
              )}
              {canDelete && (
                <button type="button" className={row + ' text-red-300'} disabled={busy} onClick={() => setConfirmDelete(true)}>
                  Delete lesson video
                  {chevron}
                </button>
              )}
            </div>
          </section>
        )}
      </>
    );
  }
}
