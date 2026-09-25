export function OvernightResults() {
 return <details className="mt-3 text-sm text-zinc-400">
  <summary className="min-h-11 cursor-pointer py-3">Experiment results</summary>
  <div className="max-w-2xl space-y-3 pb-3">
   <p>The goal is tighter cuts and winner predictions on 70% of points, aiming for 90% accuracy.</p>
   <p>On Terry’s recording, a wider table crop with a looser bounce rule improved winner predictions, but covered only 14 of 34 comparable points.</p>
   <p>Next review: mark the serve start and point end on the 12 “Cuts to review” points; every answer is optional.</p>
   <table className="w-full text-left text-xs sm:text-sm"><caption className="pb-2 text-left">Six recordings · 479 points · September 25</caption><thead><tr><th scope="col" className="py-2 pr-3 font-medium">Version</th><th scope="col" className="py-2 pr-3 font-medium">Coverage</th><th scope="col" className="py-2 font-medium">Accuracy</th></tr></thead><tbody>
    {[['Current suggestions','62.0% (297)','90.6% (269/297)'],['70% coverage test','70.1% (336)','89.6% (301/336)'],['Lower confidence cutoff','82.0% (393)','84.7% (333/393)'],['Lowest cutoff tested','97.7% (468)','80.8% (378/468)']].map(r=><tr key={r[0]} className="border-t border-edge">{r.map((v,i)=><td key={i} className="py-2 pr-3 tabular-nums">{v}</td>)}</tr>)}
   </tbody></table>
   <table className="w-full text-left text-xs sm:text-sm"><caption className="pb-2 text-left">Terry · 34 comparable points</caption><thead><tr><th scope="col" className="py-2 pr-3 font-medium">Version</th><th scope="col" className="py-2 pr-3 font-medium">Coverage</th><th scope="col" className="py-2 font-medium">Accuracy</th></tr></thead><tbody>
    {[['Existing detections','47.1% (16)','62.5% (10/16)'],['Fresh full frame','26.5% (9)','44.4% (4/9)'],['Full frame + looser bounces','38.2% (13)','53.8% (7/13)'],['Wider table crop','29.4% (10)','90.0% (9/10)'],['Wider crop + looser bounces','41.2% (14)','85.7% (12/14)'],['Tight crop','17.6% (6)','50.0% (3/6)'],['Tight crop + looser bounces','17.6% (6)','33.3% (2/6)']].map(r=><tr key={r[0]} className="border-t border-edge">{r.map((v,i)=><td key={i} className="py-2 pr-3 tabular-nums">{v}</td>)}</tr>)}
   </tbody></table>
   <table className="w-full text-left text-xs sm:text-sm"><caption className="pb-2 text-left">Cutting the clips</caption><tbody>
    {[['Both serve bounces found','30/60 → 40/60 points'],['Correct last bounce','54/94 → 57/94 points'],['Safe trimming improvement','Not established; timing review needed']].map(r=><tr key={r[0]} className="border-t border-edge"><th scope="row" className="py-2 pr-3 text-left font-normal">{r[0]}</th><td className="py-2 tabular-nums">{r[1]}</td></tr>)}
   </tbody></table>
   <details><summary className="min-h-11 cursor-pointer py-3">How to read these results</summary>
    <table className="w-full text-left text-xs sm:text-sm"><tbody>
     {[
      ['Coverage','Points with a prediction ÷ evaluated points'],
      ['Accuracy','Correct predictions ÷ predictions'],
      ['Six recordings','Each recording excluded from its model and cutoff selection; familiar data'],
      ['Terry sample','34 comparable points out of 44 scored; wider crop + looser bounces covers 14/44 (31.8%) overall'],
      ['Terry reliability','One small recording; best of several tests, requiring confirmation elsewhere'],
      ['Crop comparison','Compare with fresh full frame using the same bounce rule; existing detections also differ through reprocessing'],
      ['Tight crop','Coordinates corrected; stretched appearance and original tracker choices remain'],
      ['Other checks','Alternative tracking did not beat the wider crop; full frame recovered more missing bounces in the earlier 11-point pilot'],
      ['Cut checks','60 points with two serve labels; 94 last-bounce targets matched within two frames, not point-end timing'],
      ['Confidence','Experimental score, not a measured probability'],
      ['Your review','Labels, clips and existing suggestions unchanged']
     ].map(r=><tr key={r[0]} className="border-t border-edge"><th scope="row" className="py-2 pr-3 align-top font-normal text-zinc-300">{r[0]}</th><td className="py-2">{r[1]}</td></tr>)}
    </tbody></table>
   </details>
  </div>
 </details>;
}
