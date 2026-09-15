import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const enabled = process.env.SCORING_STATE_LOCAL_DB_TEST === "1";
const databaseTest = enabled ? test : test.skip;
const CONTAINER = "ponglens-canonical-score-test";
const DATABASE = "ponglens_test";

function sql(statement: string, tuplesOnly = true): string {
  const args = ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) args.push("-At");
  args.push("-U", "postgres", "-d", DATABASE);
  const result = spawnSync("docker", args, {
    input: statement,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

const OWNER = "00000000-0000-0000-0000-000000000001";
const COACH = "00000000-0000-0000-0000-000000000002";
const STRANGER = "00000000-0000-0000-0000-000000000003";
const ADMIN = "00000000-0000-0000-0000-000000000004";
const MATCH = "10000000-0000-0000-0000-000000000001";
const VERSION = "20000000-0000-0000-0000-000000000001";

function resetFixture(): void {
  sql(`
    truncate public.point_timing_observations, public.match_score_mutations,
      public.point_score_state, public.match_score_state, public.hand_cut_drafts,
      public.fullmatch_labels, public.points, public.coach_links,
      public.matches, auth.users cascade;
    insert into auth.users(id,email) values
      ('${OWNER}','owner@example.test'),
      ('${COACH}','coach@example.test'),
      ('${STRANGER}','stranger@example.test'),
      ('${ADMIN}','admin@example.test');
    insert into public.matches(
      id,user_id,first_server,first_server_source,active_processing_version_id
    ) values ('${MATCH}','${OWNER}','user','user','${VERSION}');
  `);
}

databaseTest("SQL projector matches literal score, boundary, serve, and revision facts", () => {
  resetFixture();
  sql(`
    begin;
    insert into public.points(
      id,match_id,processing_version_id,idx,t0,t1,confirmed_winner
    )
    select ('30000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
           '${MATCH}','${VERSION}',n,n*10,n*10+5,
           case when n <= 11 then 'user' end
      from generate_series(1,12) n;
    commit;
  `);

  const rows = sql(`
    select display_number || '|' || game_number || '|' ||
           score_user_before || '-' || score_opponent_before || '|' ||
           score_user_after || '-' || score_opponent_after || '|' ||
           coalesce(resolved_server,'null') || '|' || ends_game
      from public.point_score_state
     where match_id='${MATCH}'
       and display_number in (1,2,3,11,12)
     order by display_number;
  `);
  assert.equal(
    rows,
    [
      "1|1|0-0|1-0|user|false",
      "2|1|1-0|2-0|user|false",
      "3|1|2-0|3-0|opponent|false",
      "11|1|10-0|11-0|opponent|true",
      "12|2|0-0|0-0|opponent|false",
    ].join("\n")
  );
  assert.equal(
    sql(`select games_user || '|' || current_game_number || '|' ||
                current_score_user || '-' || current_score_opponent || '|' ||
                visible_point_count || '|' || score_revision
           from public.match_score_state where match_id='${MATCH}';`),
    "1|2|0-0|12|12"
  );
  assert.equal(
    sql(`select score_revision=score_projection_revision and
                score_projection_status='current'
           from public.matches where id='${MATCH}';`),
    "t"
  );
});

databaseTest("one missing source time forces whole-match legacy idx ordering", () => {
  resetFixture();
  sql(`
    begin;
    insert into public.points(id,match_id,processing_version_id,idx,t0,t1)
    values
      ('30000000-0000-0000-0000-000000000003','${MATCH}','${VERSION}',3,5,6),
      ('30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,20,21),
      ('30000000-0000-0000-0000-000000000002','${MATCH}','${VERSION}',2,null,null);
    commit;
  `);
  assert.equal(
    sql(`select string_agg(p.idx::text,',' order by s.timeline_ordinal)
           from public.point_score_state s join public.points p on p.id=s.point_id
          where s.match_id='${MATCH}';`),
    "1,2,3"
  );
  assert.equal(
    sql(`select ordering from public.match_score_state where match_id='${MATCH}';`),
    "legacy_idx"
  );
});

databaseTest("RLS exposes projections to owner and accepted coach but not stranger or anon", () => {
  resetFixture();
  sql(`
    insert into public.coach_links(player_id,coach_id,status,all_matches)
    values ('${OWNER}','${COACH}','accepted',true);
    insert into public.points(id,match_id,processing_version_id,idx,t0,t1)
    values ('30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,1,2);
  `);

  for (const actor of [OWNER, COACH]) {
    assert.equal(
      sql(`begin; set local role authenticated;
           select set_config('request.jwt.claim.sub','${actor}',true);
           select 'COUNT:' || count(*) from public.point_score_state where match_id='${MATCH}';
           rollback;`).split("\n").find((line) => line.startsWith("COUNT:")),
      "COUNT:1"
    );
  }
  assert.equal(
    sql(`begin; set local role authenticated;
         select set_config('request.jwt.claim.sub','${STRANGER}',true);
         select 'COUNT:' || count(*) from public.point_score_state where match_id='${MATCH}';
         rollback;`).split("\n").find((line) => line.startsWith("COUNT:")),
    "COUNT:0"
  );

  const anon = spawnSync(
    "docker",
    [
      "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1",
      "-At", "-U", "postgres", "-d", DATABASE,
    ],
    {
      input: `set role anon; select count(*) from public.point_score_state;`,
      encoding: "utf8",
    }
  );
  assert.notEqual(anon.status, 0);
  assert.match(anon.stderr, /permission denied/i);
});

databaseTest("manual cutter normalization is idempotent source-clock ground truth", () => {
  resetFixture();
  sql(`
    update public.matches set cut_source='manual' where id='${MATCH}';
    insert into public.hand_cut_drafts(match_id,user_id,marks,submitted_at)
    values ('${MATCH}','${OWNER}',
      '[{"t0":10.2,"t1":18.7,"tap":10.8,"rate":1,"w":"user","let":false}]',
      now());
    insert into public.points(
      id,match_id,processing_version_id,idx,t0,t1,confirmed_winner
    ) values (
      '30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,
      10.2,18.7,'user'
    );
    select public.normalize_manual_cut_observations('${MATCH}');
    select public.normalize_manual_cut_observations('${MATCH}');
  `);

  assert.equal(
    sql(`select string_agg(kind || ':' || source_s || ':' || origin || ':' ||
                          authority_scope,',' order by kind)
           from public.point_timing_observations where match_id='${MATCH}';`),
    "point_end:18.7:manual_cutter:owner_manual_boundary,serve_start:10.2:manual_cutter:owner_manual_boundary"
  );
  assert.equal(
    sql(`select count(*) || '|' || bool_and(eligible_for_training) || '|' ||
                bool_and(eligible_for_playback)
           from public.point_timing_observations where match_id='${MATCH}';`),
    "2|true|true"
  );
});

databaseTest("shadow projection failure preserves the legacy write and records health", () => {
  resetFixture();
  sql(`alter table public.point_score_state
       add constraint point_score_state_test_failure check (false) not valid;`);
  try {
    sql(`insert into public.points(
           id,match_id,processing_version_id,idx,t0,t1,confirmed_winner
         ) values (
           '30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,
           1,2,'user'
         );`);

    assert.equal(
      sql(`select (select count(*) from public.points where match_id='${MATCH}') || '|' ||
                  score_revision || '|' || score_projection_revision || '|' ||
                  score_projection_status || '|' || (score_projection_error is not null)
             from public.matches where id='${MATCH}';`),
      "1|1|0|error|true"
    );
  } finally {
    sql(`alter table public.point_score_state
         drop constraint if exists point_score_state_test_failure;`);
  }
});

databaseTest("admin research labels never change owner projection revision", () => {
  resetFixture();
  const before = sql(`select score_revision from public.matches where id='${MATCH}';`);
  sql(`
    insert into public.fullmatch_labels(match_key,kind,t_s)
    values ('research-only','serve',3.2);
    update public.fullmatch_labels set t_s=3.3 where match_key='research-only';
    delete from public.fullmatch_labels where match_key='research-only';
  `);
  const after = sql(`select score_revision from public.matches where id='${MATCH}';`);
  assert.equal(after, before);
});
