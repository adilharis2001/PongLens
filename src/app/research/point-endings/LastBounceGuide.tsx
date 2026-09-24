export function LastBounceGuide(){
 return <details className="text-xs text-zinc-400">
  <summary className="min-h-11 cursor-pointer py-3 text-zinc-300">Which bounce should I mark?</summary>
  <p className="pb-3">Mark the last legal table bounce while the point was still in play, using the cases below. This is a bounce reference, not the moment the point ended.</p>
  <dl className="space-y-3 pb-3">
   <div><dt className="font-medium text-zinc-200">Long or wide</dt><dd>The table bounce on the hitter’s side before they hit the ball out. For a serve that misses the receiver’s side, mark its first bounce on the server’s side.</dd></div>
   <div><dt className="font-medium text-zinc-200">Failed shot into the net</dt><dd>The table bounce before the failed shot. Ignore contact with the net and the little dead bounces afterward. A net clip that crosses and lands legally can still be in play.</dd></div>
   <div><dt className="font-medium text-zinc-200">Winner or missed return</dt><dd>The winning shot’s first table bounce on the receiver’s side. If it bounces there twice without a return, mark the first, not the second.</dd></div>
   <div><dt className="font-medium text-zinc-200">No playable table bounce</dt><dd>Use “No live table bounce occurred” if none happened, such as a serve that missed the table entirely. Use “Cannot tell from this footage” if the bounce may have happened but you cannot locate it.</dd></div>
  </dl>
  <p className="pb-2">Paddle, floor, ceiling, other-table and non-rally contacts do not count. If the real bounce is missing from the markers, add it at that frame.</p>
 </details>;
}
