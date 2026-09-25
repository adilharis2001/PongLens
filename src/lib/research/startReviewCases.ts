import 'server-only';
import {START_REVIEW_RUN_ID,type StartReviewCase} from './startReview';

// Private, frozen pair_ball_pose candidates from boundary-followthrough-20260925/
// cuts-results.json. These are padded clip starts, not structural model peaks.
// Three current-mark disagreements plus two older direct-prediction/tap disagreements.
// Only the admin-authorized page serializes them; never import this module in a client.
export const START_REVIEW_CASES:readonly StartReviewCase[]=Object.freeze([
 {pointId:'49b563c7-f6f1-4983-ac0d-2f63fcb0bc71',runId:START_REVIEW_RUN_ID,proposedStart:432.95924999999994,recordedServeTap:null},
 {pointId:'b4c6006f-dedd-4f3d-a594-0e23d5535e77',runId:START_REVIEW_RUN_ID,proposedStart:326.53954166666665,recordedServeTap:null},
 {pointId:'b1f039e3-ba57-49c9-9066-806313408ad7',runId:START_REVIEW_RUN_ID,proposedStart:430.1716666666667,recordedServeTap:null},
 {pointId:'d8f5e064-90e5-4962-a1f2-0a2bb935fcfe',runId:START_REVIEW_RUN_ID,proposedStart:227.2185946441833,recordedServeTap:220.72000000000003},
 {pointId:'04608d39-326e-4846-87b6-f8187bfd9ed0',runId:START_REVIEW_RUN_ID,proposedStart:336.4063436888985,recordedServeTap:336.18},
].map(item=>Object.freeze(item)));
