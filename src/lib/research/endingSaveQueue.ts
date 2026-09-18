import type {EndingLabel} from './pointEndings';
/** One writer per point. A response may advance the revision but never replace
 * a newer draft. Ambiguous network failures retry the same idempotent write. */
export class EndingSaveQueue {
  revision:number;
  private wanted:EndingLabel|null=null;
  private running=false;
  private stopped=false;
  private send:(label:EndingLabel,revision:number)=>Promise<{revision:number}>;
  private state:(status:'saving'|'saved'|'error',message?:string)=>void;
  constructor(revision:number,send:EndingSaveQueue['send'],state:EndingSaveQueue['state']){this.revision=revision;this.send=send;this.state=state;}
  get pending(){return this.wanted!==null || this.running;}
  set(label:EndingLabel){this.wanted={...label};if(!this.stopped)void this.flush();}
  retry(){this.stopped=false;void this.flush();}
  private async flush(){
    if(this.running || !this.wanted)return;
    this.running=true;this.state('saving');
    while(this.wanted){
      const sent=this.wanted;
      try{const result=await this.send(sent,this.revision);this.revision=result.revision;if(this.wanted===sent)this.wanted=null;}
      catch(error){this.stopped=true;this.running=false;this.state('error',error instanceof Error?error.message:'Could not save');return;}
    }
    this.running=false;this.state('saved');
  }
}
