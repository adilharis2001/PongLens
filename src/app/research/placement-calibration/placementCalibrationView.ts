import {
  TABLE_LENGTH_M,
  TABLE_WIDTH_M,
  type PlacementCalibrationProposal,
  type PlacementPoint,
} from "../../../lib/research/placementCalibration.ts";

interface PlayerNames {
  userName: string;
  opponentName: string;
}

interface PhysicalPlayerNames {
  nearName: string;
  farName: string;
}

function possessive(name: string) {
  return name.toLowerCase() === "you" ? "Your" : `${name}'s`;
}

function playerForSide(
  side: "near" | "far",
  proposal: PlacementCalibrationProposal,
  names: PlayerNames,
) {
  return side === proposal.user_side ? names.userName : names.opponentName;
}

export function eventInstruction(
  proposal: PlacementCalibrationProposal,
  names: PlayerNames,
) {
  const receiver = playerForSide(proposal.receiver_side, proposal, names);
  const receiverSide =
    receiver.toLowerCase() === "you" ? "your side" : `${receiver}'s side`;

  if (proposal.phase === "serve") {
    const server =
      proposal.scored_server === "user" ? names.userName : names.opponentName;
    return `${possessive(server)} serve — mark the second bounce on ${receiverSide}`;
  }

  const hitter = playerForSide(proposal.hitter_side, proposal, names);
  const shot =
    proposal.phase === "return"
      ? `${possessive(hitter)} return`
      : `${possessive(hitter)} shot ${proposal.shot_seq}`;
  return `${shot} — mark the first table bounce after contact on ${receiverSide}`;
}

export function tablePointToSvg(point: PlacementPoint) {
  return {
    x: Number((35 + (point.u / TABLE_WIDTH_M) * 180).toFixed(2)),
    y: Number((325 - (point.v / TABLE_LENGTH_M) * 300).toFixed(2)),
  };
}

export function svgPointToTable(x: number, y: number): PlacementPoint | null {
  if (x < 35 || x > 215 || y < 25 || y > 325) return null;
  return {
    u: Number((((x - 35) / 180) * TABLE_WIDTH_M).toFixed(4)),
    v: Number((((325 - y) / 300) * TABLE_LENGTH_M).toFixed(4)),
  };
}

export function describePlacementMark(
  point: PlacementPoint,
  names: PhysicalPlayerNames,
) {
  const isNear = point.v < TABLE_LENGTH_M / 2;
  const player = isNear ? names.nearName : names.farName;
  const playerSide =
    player.toLowerCase() === "you" ? "your side" : `${player}'s side`;
  const distanceFromEnd = isNear ? point.v : TABLE_LENGTH_M - point.v;
  const depth =
    distanceFromEnd < TABLE_LENGTH_M / 6
      ? "deep"
      : distanceFromEnd < TABLE_LENGTH_M / 3
        ? "medium"
        : "short";
  const horizontal =
    point.u < TABLE_WIDTH_M / 3
      ? "camera-left"
      : point.u > (TABLE_WIDTH_M * 2) / 3
        ? "camera-right"
        : "middle";
  return `Marked on ${playerSide}, ${depth} ${horizontal}`;
}
