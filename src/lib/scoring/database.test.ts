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
    update public.app_config set value='off'
     where key='canonical_score_commands';
    insert into public.matches(
      id,user_id,first_server,first_server_source,active_processing_version_id
    ) values ('${MATCH}','${OWNER}','user','user','${VERSION}');
  `);
}

function authenticated(actor: string, statement: string): string {
  return sql(`begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${actor}',true);
    ${statement}
    rollback;`);
}

function command(actor: string, expression: string): Record<string, unknown> {
  const output = sql(`begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${actor}',true);
    select 'RESULT:' || (${expression})::text;
    commit;`);
  const line = output.split("\n").find((candidate) => candidate.startsWith("RESULT:"));
  assert.ok(line, output);
  return JSON.parse(line.slice("RESULT:".length));
}

function enableCommands(): void {
  sql(`update public.app_config set value='user:${OWNER}'
        where key='canonical_score_commands';`);
}

function insertScorePoints(): void {
  sql(`insert into public.points(id,match_id,processing_version_id,idx,t0,t1)
       values
       ('30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,1,2),
       ('30000000-0000-0000-0000-000000000002','${MATCH}','${VERSION}',2,3,4),
       ('30000000-0000-0000-0000-000000000003','${MATCH}','${VERSION}',3,5,6);`);
}

function scoreRevision(): number {
  return Number(sql(`select score_revision from public.matches where id='${MATCH}';`));
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

databaseTest("canonical command capability is private and follows the account rollout", () => {
  resetFixture();
  assert.match(authenticated(OWNER, `select 'RESULT:' || public.canonical_score_commands_enabled();`), /RESULT:false/);

  sql(`update public.app_config set value='user:${OWNER}'
        where key='canonical_score_commands';`);
  assert.match(authenticated(OWNER, `select 'RESULT:' || public.canonical_score_commands_enabled();`), /RESULT:true/);
  assert.match(authenticated(STRANGER, `select 'RESULT:' || public.canonical_score_commands_enabled();`), /RESULT:false/);
  assert.match(authenticated(ADMIN, `select 'RESULT:' || public.canonical_score_commands_enabled();`), /RESULT:true/);

  const denied = spawnSync(
    "docker",
    [
      "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1",
      "-At", "-U", "postgres", "-d", DATABASE,
    ],
    {
      input: `set role anon; select public.canonical_score_commands_enabled();`,
      encoding: "utf8",
    }
  );
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /permission denied/i);
});

databaseTest("command context locks one current snapshot and reports conflicts without writing", () => {
  resetFixture();
  sql(`
    update public.app_config set value='user:${OWNER}'
      where key='canonical_score_commands';
    insert into public.points(id,match_id,processing_version_id,idx,t0,t1,confirmed_winner)
    values ('30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,1,2,'user');
  `);

  const fresh = JSON.parse(sql(`
    select set_config('request.jwt.claim.sub','${OWNER}',false);
    select public._canonical_score_command_context(
      '${MATCH}','40000000-0000-0000-0000-000000000001',1,'set_point_outcome'
    );
  `).split("\n").at(-1)!);
  assert.deepEqual(fresh, {
    state: "new",
    matchId: MATCH,
    baseRevision: 1,
  });

  const conflict = JSON.parse(sql(`
    select set_config('request.jwt.claim.sub','${OWNER}',false);
    select public._canonical_score_command_context(
      '${MATCH}','40000000-0000-0000-0000-000000000002',0,'set_point_outcome'
    );
  `).split("\n").at(-1)!);
  assert.equal(conflict.state, "score_conflict");
  assert.equal(conflict.response.code, "score_conflict");
  assert.equal(conflict.response.revision, 1);
  assert.equal(conflict.response.snapshot.revision, 1);
  assert.equal(conflict.response.snapshot.points[0].confirmedWinner, "user");
  assert.equal(
    sql(`select count(*) from public.match_score_mutations where match_id='${MATCH}';`),
    "0"
  );
});

databaseTest("authenticated clients cannot execute private command helpers", () => {
  resetFixture();
  for (const statement of [
    `select public._canonical_score_snapshot('${MATCH}');`,
    `select public._canonical_score_command_context(
      '${MATCH}','40000000-0000-0000-0000-000000000001',0,'set_point_outcome'
    );`,
  ]) {
    const denied = spawnSync(
      "docker",
      [
        "exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1",
        "-At", "-U", "postgres", "-d", DATABASE,
      ],
      {
        input: `set role authenticated; ${statement}`,
        encoding: "utf8",
      }
    );
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /permission denied/i);
  }
});

databaseTest("point outcome command is atomic, idempotent, revisioned, and preserves score-tap rules", () => {
  resetFixture();
  enableCommands();
  insertScorePoints();
  const point = "30000000-0000-0000-0000-000000000001";
  const request = "40000000-0000-0000-0000-000000000101";
  const base = scoreRevision();

  const won = command(OWNER, `public.set_point_outcome_v2(
    '${MATCH}','${point}','user','${request}',${base},null,1.75
  )`);
  assert.equal(won.ok, true);
  assert.equal(won.requestId, request);
  assert.equal(won.revision, base + 1);
  assert.equal(
    sql(`select confirmed_winner || '|' || is_let || '|' || scored_at_cut_s
           from public.points where id='${point}';`),
    "user|false|1.75"
  );

  const duplicate = command(OWNER, `public.set_point_outcome_v2(
    '${MATCH}','${point}','user','${request}',${base},null,1.75
  )`);
  assert.deepEqual(duplicate, won);
  assert.equal(
    sql(`select count(*) from public.match_score_mutations where request_id='${request}';`),
    "1"
  );

  const stale = command(OWNER, `public.set_point_outcome_v2(
    '${MATCH}','${point}','opponent',
    '40000000-0000-0000-0000-000000000102',${base},null,null
  )`);
  assert.equal(stale.code, "score_conflict");
  assert.equal(stale.revision, base + 1);
  assert.equal(sql(`select confirmed_winner from public.points where id='${point}';`), "user");

  const corrected = command(OWNER, `public.set_point_outcome_v2(
    '${MATCH}','${point}','opponent',gen_random_uuid(),${won.revision},null,1.95
  )`);
  assert.equal(corrected.ok, true);
  assert.equal(
    sql(`select confirmed_winner || '|' || scored_at_cut_s
           from public.points where id='${point}';`),
    "opponent|1.75"
  );

  let revision = Number(corrected.revision);
  for (const skip of ["let", "misrecorded", "other"]) {
    const result = command(OWNER, `public.set_point_outcome_v2(
      '${MATCH}','${point}','${skip}',gen_random_uuid(),${revision},'${skip}',null
    )`);
    assert.equal(result.ok, true);
    revision = Number(result.revision);
    assert.equal(
      sql(`select confirmed_winner is null || '|' || is_let || '|' || confirmed_how
             from public.points where id='${point}';`),
      `true|true|${skip}`
    );
  }

  const cleared = command(OWNER, `public.set_point_outcome_v2(
    '${MATCH}','${point}','clear',gen_random_uuid(),${revision},null,null
  )`);
  assert.equal(cleared.ok, true);
  assert.equal(
    sql(`select confirmed_winner is null || '|' || (not is_let) || '|' ||
                (confirmed_how is null) || '|' || (scored_at_cut_s is null)
           from public.points where id='${point}';`),
    "true|true|true|true"
  );
});

databaseTest("first-server, server-anchor, and game-boundary commands preserve coupled behavior", () => {
  resetFixture();
  enableCommands();
  insertScorePoints();
  const p1 = "30000000-0000-0000-0000-000000000001";
  const p2 = "30000000-0000-0000-0000-000000000002";
  const p3 = "30000000-0000-0000-0000-000000000003";
  let revision = scoreRevision();

  const firstServerRequest = "40000000-0000-0000-0000-000000000201";
  let result = command(OWNER, `public.set_first_server_v2(
    '${MATCH}','opponent','${firstServerRequest}',${revision}
  )`);
  assert.equal(result.ok, true);
  const firstServerResult = result;
  assert.deepEqual(
    command(OWNER, `public.set_first_server_v2(
      '${MATCH}','opponent','${firstServerRequest}',${revision}
    )`),
    firstServerResult
  );
  revision = Number(result.revision);
  assert.equal(
    sql(`select first_server || '|' || first_server_source from public.matches where id='${MATCH}';`),
    "opponent|user"
  );

  sql(`update public.points set server_override='user' where id in ('${p2}','${p3}');`);
  revision = scoreRevision();
  const serverRequest = "40000000-0000-0000-0000-000000000202";
  result = command(OWNER, `public.set_server_override_v2(
    '${MATCH}','${p1}','opponent','${serverRequest}',${revision}
  )`);
  assert.equal(result.ok, true);
  const serverResult = result;
  assert.deepEqual(
    command(OWNER, `public.set_server_override_v2(
      '${MATCH}','${p1}','opponent','${serverRequest}',${revision}
    )`),
    serverResult
  );
  revision = Number(result.revision);
  assert.equal(
    sql(`select string_agg(idx || ':' || coalesce(server_override,'null'),',' order by idx)
           from public.points where match_id='${MATCH}';`),
    "1:opponent,2:null,3:null"
  );

  const boundaryRequest = "40000000-0000-0000-0000-000000000203";
  result = command(OWNER, `public.set_game_boundary_v2(
    '${MATCH}','${p2}','end','opponent','${boundaryRequest}',${revision},null
  )`);
  assert.equal(result.ok, true);
  const boundaryResult = result;
  assert.deepEqual(
    command(OWNER, `public.set_game_boundary_v2(
      '${MATCH}','${p2}','end','opponent','${boundaryRequest}',${revision},null
    )`),
    boundaryResult
  );
  revision = Number(result.revision);
  assert.equal(
    sql(`select game_end_override || '|' || game_winner_override from public.points where id='${p2}';`),
    "end|opponent"
  );

  result = command(OWNER, `public.set_game_boundary_v2(
    '${MATCH}','${p3}','end','user',gen_random_uuid(),${revision},'${p2}'
  )`);
  assert.equal(result.ok, true);
  revision = Number(result.revision);
  assert.equal(
    sql(`select string_agg(idx || ':' || coalesce(game_end_override,'null') || ':' ||
                          coalesce(game_winner_override,'null'),',' order by idx)
           from public.points where match_id='${MATCH}';`),
    "1:null:null,2:null:null,3:end:user"
  );

  result = command(OWNER, `public.set_game_boundary_v2(
    '${MATCH}','${p3}','continue',null,gen_random_uuid(),${revision},null
  )`);
  assert.equal(result.ok, true);
  revision = Number(result.revision);
  assert.equal(
    sql(`select game_end_override || '|' || (game_winner_override is null)
           from public.points where id='${p3}';`),
    "continue|true"
  );

  result = command(OWNER, `public.set_first_server_v2(
    '${MATCH}',null,gen_random_uuid(),${revision}
  )`);
  assert.equal(result.ok, true);
  assert.equal(
    sql(`select (first_server is null) || '|' || (first_server_source is null)
           from public.matches where id='${MATCH}';`),
    "true|true"
  );
});

databaseTest("all score commands reject non-owners, stale revisions, and request reuse", () => {
  resetFixture();
  enableCommands();
  insertScorePoints();
  sql(`insert into public.coach_links(player_id,coach_id,status,all_matches)
       values ('${OWNER}','${COACH}','accepted',true);`);
  const point = "30000000-0000-0000-0000-000000000001";
  const revision = scoreRevision();
  const calls = [
    `public.set_point_outcome_v2('${MATCH}','${point}','user',gen_random_uuid(),${revision},null,null)`,
    `public.set_first_server_v2('${MATCH}','opponent',gen_random_uuid(),${revision})`,
    `public.set_server_override_v2('${MATCH}','${point}','opponent',gen_random_uuid(),${revision})`,
    `public.set_game_boundary_v2('${MATCH}','${point}','end','user',gen_random_uuid(),${revision},null)`,
  ];
  for (const actor of [COACH, STRANGER]) {
    for (const call of calls) assert.equal(command(actor, call).code, "not_owner");
  }
  for (const call of calls) {
    const staleCall = call.replace(`,${revision}`, `,${revision - 1}`);
    assert.equal(command(OWNER, staleCall).code, "score_conflict");
  }

  const request = "40000000-0000-0000-0000-000000000199";
  const first = command(OWNER, `public.set_first_server_v2(
    '${MATCH}','opponent','${request}',${revision}
  )`);
  assert.equal(first.ok, true);
  const reused = command(OWNER, `public.set_server_override_v2(
    '${MATCH}','${point}','user','${request}',${revision}
  )`);
  assert.equal(reused.code, "invalid_input");
});

databaseTest("every score command fails closed when canonical projection fails", () => {
  const cases = [
    (revision: number) => `public.set_point_outcome_v2('${MATCH}',
      '30000000-0000-0000-0000-000000000001','user',gen_random_uuid(),${revision},null,null)`,
    (revision: number) => `public.set_first_server_v2('${MATCH}',
      'opponent',gen_random_uuid(),${revision})`,
    (revision: number) => `public.set_server_override_v2('${MATCH}',
      '30000000-0000-0000-0000-000000000001','opponent',gen_random_uuid(),${revision})`,
    (revision: number) => `public.set_game_boundary_v2('${MATCH}',
      '30000000-0000-0000-0000-000000000001','end','user',gen_random_uuid(),${revision},null)`,
  ];

  for (const makeCall of cases) {
    resetFixture();
    enableCommands();
    insertScorePoints();
    const revision = scoreRevision();
    const before = sql(`select row_to_json(p)::text from public.points p
                         where id='30000000-0000-0000-0000-000000000001';`);
    const matchBefore = sql(`select first_server || '|' || score_revision
                               from public.matches where id='${MATCH}';`);
    sql(`alter table public.point_score_state
         add constraint point_score_state_command_failure check (false) not valid;`);
    const failed = spawnSync(
      "docker",
      ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-At",
       "-U", "postgres", "-d", DATABASE],
      {
        input: `begin; set local role authenticated;
          select set_config('request.jwt.claim.sub','${OWNER}',true);
          select ${makeCall(revision)}; commit;`,
        encoding: "utf8",
      }
    );
    assert.notEqual(failed.status, 0);
    assert.equal(
      sql(`select row_to_json(p)::text from public.points p
            where id='30000000-0000-0000-0000-000000000001';`),
      before
    );
    assert.equal(
      sql(`select first_server || '|' || score_revision
             from public.matches where id='${MATCH}';`),
      matchBefore
    );
    assert.equal(sql(`select count(*) from public.match_score_mutations;`), "0");
    sql(`alter table public.point_score_state
         drop constraint point_score_state_command_failure;`);
  }
});
