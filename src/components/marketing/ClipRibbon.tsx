import Image from "next/image";
/** Consecutive frames from the already-public walkthrough; a decorative filmstrip, not new point data. */
export function ClipRibbon() {
  return <div className="clip-ribbon" aria-hidden="true">
    <div className="clip-rail" />
    {Array.from({length:5},(_,i)=><div className="clip-cell" key={i} style={{"--clip-index":i} as React.CSSProperties}>
      <Image src={`/showcase/cinematic/rally-${i}.jpg`} alt="" width={320} height={180} sizes="140px" className="clip-image" />
      <span className="clip-cell-line" />
    </div>)}
  </div>;
}
