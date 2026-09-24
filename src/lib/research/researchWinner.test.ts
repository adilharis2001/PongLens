import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchPlayers,winnerSummary} from './researchWinner.ts';
import type {RallyPrediction} from './rallyPredictions.ts';
const prediction=(side:'near'|'far'|null,score:number|null,baseline:'near'|'far'|null=null):RallyPrediction=>({version:1,runId:'test',lastBounce:null,baselineWinner:baseline,winner:{side,score,threshold:score===null?null:.7}});
test('names follow the audited starting side and changes between games',()=>{
 assert.deepEqual(researchPlayers('7e02fbb9-a3af-4686-84bc-d4b961ab9fed',1,11),{near:'Julian',far:'Adil'});
 assert.deepEqual(researchPlayers('7e02fbb9-a3af-4686-84bc-d4b961ab9fed',2,25),{near:'Adil',far:'Julian'});
});
test('Yu Yu Lin switches ends at the observed point, not an assumed score',()=>{
 assert.deepEqual(researchPlayers('89b35ee0-01f9-4c01-a966-6305b6e96d4a',5,80),{near:'Adil',far:'Yu Yu Lin'});
 assert.deepEqual(researchPlayers('89b35ee0-01f9-4c01-a966-6305b6e96d4a',5,81),{near:'Yu Yu Lin',far:'Adil'});
 assert.equal(researchPlayers('unknown',1,1),null);
});
test('winner name and score belong to the predicted side',()=>{
 const p=prediction('far',.882);
 assert.deepEqual(winnerSummary(p,{near:'Julian',far:'Adil'}),{name:'Adil',side:'far',score:.882,source:'model'});
});
test('net rule retains priority without borrowing an opposing model score',()=>{
 assert.deepEqual(winnerSummary(prediction('near',.9,'far'),{near:'Adil',far:'Lester'}),{name:'Lester',side:'far',score:null,source:'rule'});
 assert.equal(winnerSummary(prediction('far',.9,'far'),null).score,.9);
});
test('abstention never invents a winner from confidence or the saved score',()=>{
 assert.deepEqual(winnerSummary(prediction(null,.65),null),{name:null,side:null,score:.65,source:'none'});
 assert.deepEqual(winnerSummary(prediction(null,null),null),{name:null,side:null,score:null,source:'none'});
 assert.equal(winnerSummary(prediction('near',.9),null).name,'Player nearer the camera');
});
