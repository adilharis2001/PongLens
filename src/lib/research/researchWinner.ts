import {physicalSideForGame,otherSide,type Side} from '../../app/match/[id]/sides.ts';
import type {RallyPrediction} from './rallyPredictions.ts';
export type ResearchPlayers={near:string;far:string};
// Frozen identities for this research corpus, from the September 16 side audit.
// Starting sides were checked against serve footage; Yu Yu Lin's deciding-game
// swap was observed between displayed points 80 and 81. Never use winner labels
// to assign identities, and never apply this research map to ordinary matches.
const corpus:Record<string,{opponent:string;start:Side;games:number;swapAt?:number}>={
 '77fc4dee-3de6-47d6-a2df-df85e239535c':{opponent:'Lester',start:'near',games:6},
 '9e15ed10-f595-4efc-85c8-74cce08eb9c5':{opponent:'Prabhas',start:'near',games:3},
 'd59d7610-d087-42ec-a1a6-b532fb4cac96':{opponent:'Ishan',start:'near',games:4},
 'ec6490f4-b835-4d82-882a-8fb2f1abc2e5':{opponent:'Chris',start:'near',games:5},
 '7e02fbb9-a3af-4686-84bc-d4b961ab9fed':{opponent:'Julian',start:'far',games:4},
 '89b35ee0-01f9-4c01-a966-6305b6e96d4a':{opponent:'Yu Yu Lin',start:'near',games:5,swapAt:81},
};
export function researchPlayers(matchId:string,game:number,number:number):ResearchPlayers|null {
 const m=corpus[matchId];if(!m||!Number.isInteger(game)||game<1||game>m.games||!Number.isInteger(number)||number<1)return null;
 let owner=physicalSideForGame(m.start,game-1);
 if(m.swapAt&&game===5&&number>=m.swapAt)owner=otherSide(owner);
 return owner==='near'?{near:'Adil',far:m.opponent}:{near:m.opponent,far:'Adil'};
}
export function winnerSummary(p:RallyPrediction,players:ResearchPlayers|null){
 const side=p.baselineWinner??p.winner.side;
 const source=p.baselineWinner?'rule':side?'model':'none';
 // A model score cannot describe an opposing rule-based decision.
 const score=source==='rule'&&p.winner.side!==side?null:p.winner.score;
 const name=side?(players?.[side]??(side==='near'?'Player nearer the camera':'Player farther from the camera')):null;
 return {name,side,score,source};
}
