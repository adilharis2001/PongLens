export function OvernightResults() {
 return <details className="mt-3 text-sm text-zinc-400">
  <summary className="min-h-11 cursor-pointer py-3">Experiment results</summary>
  <div className="max-w-2xl space-y-3 pb-3">
   <p>The goal is tighter cuts and correct winner predictions on 70% of points. These tests use 479 points from six recordings, holding each recording out of its model’s training.</p>
   <table className="w-full text-left text-xs sm:text-sm"><caption className="pb-2 text-left">Winner tests · September 25</caption><thead><tr><th className="py-2 pr-3 font-medium">Version</th><th className="py-2 pr-3 font-medium">Points scored</th><th className="py-2 font-medium">Correct</th></tr></thead><tbody>
    {[['Current suggestions','62.0% (297)','90.6% (269/297)'],['Wider threshold test','70.1% (336)','89.6% (301/336)']].map(r=><tr key={r[0]} className="border-t border-edge">{r.map((v,i)=><td key={i} className="py-2 pr-3 tabular-nums">{v}</td>)}</tr>)}
   </tbody></table>
   <p>The wider threshold is an offline test. The suggestions on this page have not changed, and these results do not establish accuracy on new recordings.</p>
   <p>Next review: mark the serve start and point end on 12 selected points using “Cuts to review.” No need to label every bounce.</p>
  </div>
 </details>;
}
