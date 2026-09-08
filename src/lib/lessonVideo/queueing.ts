export function queueLessonRender(stage:string,updatedAt:string){
 return {status:'queued',stage,error:null,lease_token:null,lease_until:null,lease_reclaim_count:0,updated_at:updatedAt};
}
