# How PongLens turns a match video into points

A self-contained explanation, written so that someone with no access to the
code can follow it. Everything below describes the "v2" card assembly, which
has cut every new upload since 17 August 2026.

---

## 1. The problem being solved

Someone films a table tennis match on a phone on a tripod, side-on to the
table, and uploads twenty to forty minutes of continuous video. Most of that
footage is not table tennis: players walk to pick the ball up, towel off,
argue about the score, drink water. A rally itself lasts about four seconds.

The product has to turn that single long file into a list of **points**. Each
point becomes a **card**: a start time, an end time, and a short clip cut out
of the original. Cards are what the player scores, watches, shares, and what
every later feature is built on — the scoreboard, the highlight reel, the
placement maps, the coach's review.

So the whole job is: **given a long video, decide where each rally begins and
ends.** A card that starts too late clips off the serve. A card that ends too
early cuts the rally in half. A card that swallows two rallies cannot be
scored at all, because the person scoring taps one winner per card.

---

## 2. What the assembler is given

Three inputs, all produced before assembly starts.

**The ball detections.** A neural network called BlurBall runs over every
frame and proposes up to four candidate ball positions per frame, each with a
confidence. It is run either on the full frame or on a crop around the table.
It is noisy: it finds balls on neighbouring tables, shoes, lights, and
sometimes nothing at all.

**The table corners.** A calibration step finds the four corners of the
playing surface in pixel coordinates, labelled A near-left, B near-right,
C far-right, D far-left, where "near" is the end closest to the camera. If no
table can be found the match still processes, but this assembler does not run.

**The frame rate and duration.**

Note what is *not* available: no pose estimation, no audio, no knowledge of
the score, no idea who the players are, and no ground truth of any kind. The
assembler sees a stream of maybe-ball positions and four corners.

---

## 3. Turning detections into evidence

Before any card exists, the assembler builds five things.

### 3.1 The ball track

The candidate clouds are walked into a single trajectory using a greedy
continuity chain. For each frame it predicts where the ball should be from a
constant-velocity extrapolation of the previous two positions, and takes the
nearest candidate to that prediction. A candidate more than 220 pixels away
(at 1920-wide; scaled for other sizes) is rejected as implausible — a smash
travels about 150 pixels per frame. After 8 consecutive frames with no
plausible successor the chain gives up and reseeds from the highest-confidence
candidate.

The result is a dictionary of frame → (x, y). **It has holes.** The ball
disappears behind a player, leaves the frame, blurs into the background, or
goes above the crop. These holes matter enormously later.

### 3.2 Table coordinates

The four corners give a homography — a projective transform that maps any
image point onto the plane of the table. Table coordinates are in metres:
`u` runs 0 to 1.525 across the table, `v` runs 0 to 2.74 along it, and the net
sits at v = 1.37.

This transform is only correct for points that are physically *on* the table
plane. A ball in the air projects to where its line of sight meets that
plane extended, so a high ball can project many metres beyond the end of the
table. That is a feature, not a bug — it is how the assembler notices a lob —
but it also means "table coordinates" of an airborne ball are not where the
ball is.

A "corridor" test accepts projections from −0.7 to 2.225 across and −1.5 to
4.24 along; anything outside is treated as not-the-ball-in-play.

### 3.3 Bounces

A bounce is found in image space, not table space: a local maximum in the
ball's y coordinate (the picture's downward axis) across a five-frame window,
where the ball has moved at least 3 pixels and reversed direction by at least
1 pixel on both sides. Each bounce is then projected. Bounces landing within
15 cm of the playing surface are marked as **on the table**; the rest are
floor bounces, neighbouring tables, or airborne artefacts.

### 3.4 Net crossings

A crossing is recorded when the ball is clearly on one side of the net — more
than 20 cm past it in table coordinates — and then clearly on the other, with
the new side confirmed by 2 consecutive samples. If the ball is unseen for
more than 0.35 seconds the side memory is cleared, because after a gap you
cannot know it did not cross and come back.

Crossings only count when the projection is inside the corridor. **A ball
lobbed high projects outside the corridor and produces no crossing.**

### 3.5 Serve motifs

This is how a serve is recognised without any model of a serve. In table
tennis the serve is the only shot that must bounce on the server's own half
before crossing the net. So the assembler looks for a pair of bounces where:

1. both are on the playing surface (with a 45 cm tolerance),
2. they are on opposite halves of the net,
3. they are within 1.6 seconds of each other,
4. neither is within 20 cm of the net line,
5. the ball demonstrably rises between them (at least 8 pixels of apex),
   which rules out a ball being rolled back to the server,
6. it does not travel backwards on the way (at most 50 cm of backtrack),
   which rules out a bat touching it in between,
7. and **no rally was already running**: at most one net crossing in the 1.5
   seconds before the first bounce.

Pairs within 2.5 seconds of each other collapse to the earliest. The moment of
contact is taken as the first bounce minus 0.81 seconds, which is a physical
constant, not a tuned one.

Rule 7 is the only thing separating a serve from any ordinary stroke over the
net, and it depends entirely on crossings being detected. **On a camera placed
nearly behind the players, crossings barely fire, so ordinary strokes get read
as serves.**

### 3.6 The motion grid

Time is chopped into half-second bins. A bin is "dense" if at least 4 frames
in it show the ball moving at least 8 pixels between consecutive frames. A
window of ±0.2 seconds around every crossing is also marked dense. This gives
a coarse yes/no map of "was there fast ball motion here", sampled every tenth
of a second.

---

## 4. Building the cards

Ten steps, in this order.

### Step 1 — A card per detected serve

For each serve contact, the card opens 1.6 seconds before it, to include the
toss. The end is found by following the rally: walk forward through net
crossings, accepting each one that is within 3 seconds of the previous. That
chain gives the last moment the rally was seen. Then take the table bounces
between the serve and two seconds past that last crossing, and end the card
2.6 seconds after the final one, capped at 8.6 seconds past the last crossing.
The 2.6 seconds exist because a person scoring the match taps the winner about
1.45 seconds after the last bounce, and the tap must land inside the clip.

Two numbers are stored per card: this padded end, and the **evidence end** —
the last moment the rally was actually observed. A rally that runs past 40
seconds is cut off there as a runaway guard.

### Step 2 — Cards where no serve was found

Every stretch of dense ball motion not already inside a card, at least 0.6
seconds long, becomes a candidate. **Two such stretches less than 3.5 seconds
apart are merged into one**, up to a 30-second ceiling. Each surviving stretch
must show either a net crossing or at least one bounce on the table, or it is
discarded. Its start walks back to 3.2 seconds before its first crossing, and
its end is computed by the same rally-following rule as a serve card, or 1.6
seconds after the motion stops if there were no crossings at all.

This step is where fused cards are born. When serve detection fails — which is
routine on end-on cameras — two consecutive points separated by less than 3.5
seconds of stillness become a single card.

### Step 3 — The veto

A card with no serve and no net crossing is dropped unless it has at least 2
bounces or 3 seconds of moving ball. This removes cards built on a
neighbouring table's warm-up. The veto switches off entirely when the camera
is too square-on for crossings to mean anything (a foreshortening measure
below 0.60).

### Step 4 — Resolve

Sort the cards, remove overlaps, and force at least **1.2 seconds of dead
space** between consecutive cards — enough that two clips, each padded by 0.3
seconds at the front and 0.4 at the back, do not show the same footage twice.
When two cards collide, a card anchored on a detected serve wins and the other
gives ground; when both are anchored, the earlier one's tail is trimmed to
1.3 seconds before the later serve.

### Step 5 — Merge what is really one rally

If the last crossing of one card and the first crossing of the next are within
3 seconds of each other, nothing ended in between, so the two are joined. A
card that opens on a detected serve is never absorbed this way.

### Step 6 — Resolve again

### Step 7 — THE TWENTY-SECOND CAP

**Any card still longer than 20 seconds is cut in two.** The cut is placed at
the quietest moment in the middle half of the card, found by taking a moving
average of the motion grid and picking its minimum. The two halves are placed
1.2 seconds apart, and the second half loses its serve mark.

The reasoning recorded when this was written: a real point lasts 3.8 seconds,
5.7 at the 90th percentile, so a card past twenty seconds is holding more than
one of them — and a card with two points in it cannot be scored at all,
whereas a badly split one at least produces two scoreable cards.

This is the weakest rule in the assembler and the one under active review. It
uses length as a proxy for "this card is fused", and length is a poor proxy
for the players who matter most: a defender or a lobber can rally for thirty
seconds. Measured across 17 scored matches, this rule fired 97 times; judged
against the owner's own scoring, it correctly separated two points about 70%
of the time and cut a single live rally in half about 17% of the time.

An attempt to replace it — splitting only where the ball demonstrably stopped
being in play for some number of seconds — was measured and failed. The reason
is worth understanding: **inside these long cards the ball frequently goes
untracked for four or five seconds while the rally is still being played**, so
silence in the evidence means "the detector lost the ball", not "the point
ended". The quiet stretch at a correct split (median 6.0 seconds) and at a
wrong one (median 4.7 seconds) overlap almost completely.

### Step 8 — Resolve a third time

### Step 9 — Drop cards that never touched this table

Any card with no bounce on the user's own playing surface is discarded. This
is what stops a neighbouring table's rally becoming a point.

### Step 10 — Hand off

The surviving cards are sorted, disjoint, at least 1.2 seconds apart, and each
carries its start, end, serve time if known, and evidence end. Everything
downstream inherits these boundaries: the clips, the placement maps, the
winner suggestions, the scoreboard and the highlight reel.

---

## 5. Two things about the order

**The cap runs after serve detection.** In a corpus of nine matches, 30 of the
32 cards that reached the twenty-second cap had no detected serve. The cap is
therefore not really a rule about long rallies; it is a cleanup for failed
serve detection, and it fires almost exclusively where the serve anchor was
missing.

**The cap runs before the routing decision.** After assembly, if the match
looks end-on (judged by how many serves per minute were found), a completely
different assembler rebuilds the cards from player motion instead, and the
twenty-second cap does not exist on that path. So on those matches this rule's
output can be discarded moments after it is computed.

---

## 6. Glossary of every constant

| name | value | what it governs |
| --- | --- | --- |
| table width / length | 1.525 m / 2.74 m | table coordinates |
| net position | 1.37 m | halfway along the table |
| max jump | 220 px/frame | how far the tracker will follow the ball |
| reseed gap | 8 frames | when the tracker gives up and restarts |
| bounce reversal / motion | 1 px / 3 px | what counts as a bounce |
| net margin | 0.20 m | how far past the net counts as "the other side" |
| dwell | 2 samples | confirmation needed for a crossing |
| teleport reset | 0.35 s | unseen for longer and the side memory clears |
| serve pair window | 1.60 s | how close a serve's two bounces must be |
| serve surface pad | 0.45 m | tolerance for "on the table" |
| serve apex | 8 px | the ball must rise between the two bounces |
| serve backtrack | 0.50 m | tolerated backward travel |
| prior crossings allowed | 1 in 1.5 s | the "no rally already running" test |
| serve cluster | 2.5 s | duplicate serve readings collapse |
| contact lookback | 0.81 s | first bounce back to bat-on-ball |
| motion bin | 0.5 s, 4 frames, 8 px | what counts as dense ball motion |
| head lead | 1.6 s | how long before the serve a card opens |
| head lead from a crossing | 3.2 s | the same, for an unanchored card |
| tail after last bounce | 2.6 s | how long a card runs past the rally |
| tail ceiling | 8.6 s | past the last crossing |
| rally crossing gap | 3.0 s | longer, and the rally is over |
| max rally | 40 s | runaway guard on a serve card |
| unclaimed run | 0.6 s | shortest motion burst that can become a card |
| fallback merge | 3.5 s | two bursts closer than this become one card |
| fallback ceiling | 30 s | runaway guard |
| veto thresholds | 2 bounces or 3.0 s | to keep a card with no crossing |
| foreshortening floor | 0.60 | below this the veto switches off |
| min card | 0.4 s | shortest card allowed |
| dead space | 1.2 s | minimum gap between two cards |
| squeeze floor / head | 0.95 s / 0.35 s | when two serve cards collide |
| **max card** | **20 s** | **the cap under review** |
| clip pads | 0.3 s / 0.4 s | context added when the clip is cut |
