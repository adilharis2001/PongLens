/** Synthetic input for local component rendering only; never loaded by the production route. */
import {COMPARISON_BATCH,type ComparisonRow} from './matchComparison.ts';
export const MATCH_COMPARISON_FIXTURE:ComparisonRow={
 id:'00000000-0000-4000-8000-000000000001',match_id:'00000000-0000-4000-8000-000000000002',sequence:1,revision:0,
 label:{reason:null,custom:'',note:''},
 source:{schema:'match-comparison-v1',runId:COMPARISON_BATCH,matchName:'Local fixture',number:1,game:1,fps:30,duration:60,preview:{start:8,end:22},original:{start:10,end:20},proposed:{start:9.8,end:20},players:{near:'Player A',far:'Player B'},predictedWinner:{side:'near',name:'Player A',decisionScore:.8,threshold:.7,branch:'hybrid'},savedWinner:{side:'far',name:'Player B',basis:'Synthetic local reference'},flags:['Synthetic fixture for layout checks.'],referencePointIds:['00000000-0000-4000-8000-000000000003'],machinePointIds:['1'],lineage:'Synthetic local fixture. No match results.'}
};
