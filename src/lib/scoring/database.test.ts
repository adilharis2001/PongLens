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
      public.jobs, public.matches, auth.users cascade;
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

databaseTest("manual cutter publication atomically finalizes owner boundaries and score", () => {
  resetFixture();
  const job = "50000000-0000-0000-0000-000000000001";
  sql(`
    update public.matches set cut_source='manual',status='processing',job_id='${job}'
     where id='${MATCH}';
    insert into public.jobs(id,user_id,kind,status,options)
    values ('${job}','${OWNER}','hand_cut','processing',
      '{"match_id":"${MATCH}","processing_version_id":"${VERSION}"}');
    insert into public.hand_cut_drafts(match_id,user_id,marks,submitted_at)
    values ('${MATCH}','${OWNER}',
      '[{"t0":10.2,"t1":18.7,"tap":10.8,"rate":1,"fps":60,"w":"user","let":false},
        {"t0":24.4,"t1":31.1,"tap":25.0,"rate":0.5,"fps":30,"w":"opponent","let":false}]',
      now());
    insert into public.points(
      id,match_id,processing_version_id,idx,t0,t1,clip_path,confirmed_winner
    ) values
      ('30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,
       10.2,18.7,'r2://clips/01.mp4','user'),
      ('30000000-0000-0000-0000-000000000002','${MATCH}','${VERSION}',2,
       24.4,31.1,'r2://clips/02.mp4','opponent');
  `);

  const first = JSON.parse(sql(
    `select public.publish_hand_cut_v2('${MATCH}','${job}');`
  ));
  const retry = JSON.parse(sql(
    `select public.publish_hand_cut_v2('${MATCH}','${job}');`
  ));
  assert.deepEqual(retry, first, "duplicate delivery returns its first receipt");
  assert.equal(first.ok, true);
  assert.equal(first.pointCount, 2);
  assert.equal(first.observationCount, 4);
  assert.equal(first.missingClipCount, 0);
  assert.equal(first.scoreProjectionStatus, "current");
  assert.equal(
    sql(`select string_agg(confirmed_winner,',' order by timeline_ordinal)
           from public.point_score_state where match_id='${MATCH}';`),
    "user,opponent"
  );
  assert.equal(
    sql(`select count(*) from public.point_timing_observations
          where match_id='${MATCH}' and origin='manual_cutter'
            and authority_scope='owner_manual_boundary';`),
    "4"
  );
  assert.equal(
    sql(`select count(*) from public.match_score_mutations
          where match_id='${MATCH}' and action='publish_hand_cut';`),
    "1"
  );
});

databaseTest("manual cutter cut-only publication permits only explicit reclip gaps", () => {
  resetFixture();
  const job = "50000000-0000-0000-0000-000000000002";
  sql(`
    update public.matches set cut_source='manual',status='processing',job_id='${job}'
     where id='${MATCH}';
    insert into public.jobs(id,user_id,kind,status,options)
    values ('${job}','${OWNER}','hand_cut','processing',
      '{"match_id":"${MATCH}","processing_version_id":"${VERSION}"}');
    insert into public.hand_cut_drafts(match_id,user_id,marks,submitted_at)
    values ('${MATCH}','${OWNER}',
      '[{"t0":2.0,"t1":8.0,"tap":2.6,"rate":1,"w":null,"let":false}]',now());
    insert into public.points(
      id,match_id,processing_version_id,idx,t0,t1,clip_path,edited
    ) values (
      '30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,
      2,8,null,true
    );
  `);
  const receipt = JSON.parse(sql(
    `select public.publish_hand_cut_v2('${MATCH}','${job}');`
  ));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.missingClipCount, 1);
  assert.equal(
    sql(`select visible_point_count-answered_point_count-skipped_point_count
           from public.match_score_state where match_id='${MATCH}';`),
    "1"
  );

  resetFixture();
  sql(`
    update public.matches set cut_source='manual',status='processing',job_id='${job}'
     where id='${MATCH}';
    insert into public.jobs(id,user_id,kind,status,options)
    values ('${job}','${OWNER}','hand_cut','processing',
      '{"match_id":"${MATCH}","processing_version_id":"${VERSION}"}');
    insert into public.hand_cut_drafts(match_id,user_id,marks,submitted_at)
    values ('${MATCH}','${OWNER}',
      '[{"t0":2.0,"t1":8.0,"tap":2.6,"rate":1,"w":null,"let":false}]',now());
    insert into public.points(id,match_id,processing_version_id,idx,t0,t1)
    values ('30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,2,8);
  `);
  assert.throws(() => sql(
    `select public.publish_hand_cut_v2('${MATCH}','${job}');`
  ), /manual cut point clip is neither ready nor queued for reclip/i);
});

databaseTest("manual cutter finalizer rejects mismatched, obsolete, and unprojectable publication", () => {
  resetFixture();
  const job = "50000000-0000-0000-0000-000000000003";
  sql(`
    update public.matches set cut_source='manual',status='processing',job_id='${job}'
     where id='${MATCH}';
    insert into public.jobs(id,user_id,kind,status,options)
    values ('${job}','${OWNER}','hand_cut','processing',
      '{"match_id":"${MATCH}","processing_version_id":"${VERSION}"}');
    insert into public.hand_cut_drafts(match_id,user_id,marks,submitted_at)
    values ('${MATCH}','${OWNER}',
      '[{"t0":2.0,"t1":8.0,"tap":2.6,"rate":1,"w":"user","let":false}]',now());
  `);
  assert.throws(() => sql(
    `select public.publish_hand_cut_v2('${MATCH}','${job}');`
  ), /manual cut mark\/point count mismatch/i);

  sql(`insert into public.points(
         id,match_id,processing_version_id,idx,t0,t1,clip_path,confirmed_winner
       ) values (
         '30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,
         2.2,8,'r2://clips/01.mp4','user'
       );`);
  assert.throws(() => sql(
    `select public.publish_hand_cut_v2('${MATCH}','${job}');`
  ), /manual cut mark\/point timing mismatch/i);

  sql(`update public.points set t0=2 where match_id='${MATCH}';
       update public.jobs set options=jsonb_set(options,'{processing_version_id}',
         '"20000000-0000-0000-0000-000000000099"') where id='${job}';`);
  assert.throws(() => sql(
    `select public.publish_hand_cut_v2('${MATCH}','${job}');`
  ), /manual cut processing version changed/i);

  sql(`update public.jobs set options=jsonb_set(options,'{processing_version_id}',
         '"${VERSION}"') where id='${job}';
       alter table public.point_score_state
         add constraint point_score_state_publish_failure check (false) not valid;`);
  try {
    assert.throws(() => sql(
      `select public.publish_hand_cut_v2('${MATCH}','${job}');`
    ));
    assert.equal(
      sql(`select count(*) from public.point_timing_observations where match_id='${MATCH}';`),
      "0",
      "projection failure rolls back normalized observations"
    );
    assert.equal(
      sql(`select count(*) from public.match_score_mutations where match_id='${MATCH}';`),
      "0",
      "projection failure publishes no receipt"
    );
  } finally {
    sql(`alter table public.point_score_state
         drop constraint if exists point_score_state_publish_failure;`);
  }
});

databaseTest("automatic worker finalizes one 100-point active-version publication", () => {
  resetFixture();
  sql(`
    update public.matches set status='processing' where id='${MATCH}';
    insert into public.points(
      id,match_id,processing_version_id,idx,t0,t1,clip_path,
      confirmed_winner,server_override,game_end_override
    )
    select ('30000000-0000-0000-0001-' || lpad(n::text,12,'0'))::uuid,
           '${MATCH}','${VERSION}',n,n*10,n*10+5,
           'r2://clips/' || lpad(n::text,3,'0') || '.mp4',
           case when n=1 then 'user' end,
           case when n=1 then 'opponent' end,
           case when n=11 then 'end' end
      from generate_series(1,100) n;
  `);
  const first = JSON.parse(sql(
    `select public.finalize_worker_points_v2('${MATCH}','${VERSION}');`
  ));
  const retry = JSON.parse(sql(
    `select public.finalize_worker_points_v2('${MATCH}','${VERSION}');`
  ));
  assert.deepEqual(retry, first);
  assert.equal(first.ok, true);
  assert.equal(first.pointCount, 100);
  assert.equal(first.scoreProjectionStatus, "current");
  assert.equal(
    sql(`select first_server || '|' || first_server_source
           from public.matches where id='${MATCH}';`),
    "user|user",
    "worker publication never replaces owner first-server truth"
  );
  assert.equal(
    sql(`select confirmed_winner || '|' || server_override
           from public.points where match_id='${MATCH}' and idx=1;`),
    "user|opponent",
    "worker finalization never replaces owner point truth"
  );
  assert.equal(
    sql(`select count(*) from public.match_score_mutations
          where match_id='${MATCH}' and action='replace_worker_points'
            and authority_scope='worker_publication';`),
    "1"
  );
});

databaseTest("automatic finalizer rejects obsolete versions and projection failure", () => {
  resetFixture();
  sql(`
    update public.matches set status='processing' where id='${MATCH}';
    insert into public.points(
      id,match_id,processing_version_id,idx,t0,t1,clip_path
    ) values (
      '30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,
      1,2,'r2://clips/01.mp4'
    );
  `);
  assert.throws(() => sql(
    `select public.finalize_worker_points_v2(
      '${MATCH}','20000000-0000-0000-0000-000000000099');`
  ), /worker processing version changed/i);

  sql(`alter table public.point_score_state
       add constraint point_score_state_worker_publish_failure check (false) not valid;`);
  try {
    assert.throws(() => sql(
      `select public.finalize_worker_points_v2('${MATCH}','${VERSION}');`
    ));
    assert.equal(
      sql(`select count(*) from public.match_score_mutations
            where match_id='${MATCH}' and action='replace_worker_points';`),
      "0"
    );
  } finally {
    sql(`alter table public.point_score_state
         drop constraint if exists point_score_state_worker_publish_failure;`);
  }
});

databaseTest("old worker row publication remains compatible without a v2 receipt", () => {
  resetFixture();
  sql(`
    update public.matches set status='processing' where id='${MATCH}';
    insert into public.points(
      id,match_id,processing_version_id,idx,t0,t1,clip_path,server
    ) values (
      '30000000-0000-0000-0000-000000000001','${MATCH}','${VERSION}',1,
      1,2,'r2://clips/01.mp4','opponent'
    );
    update public.matches set status='ready' where id='${MATCH}';
  `);
  assert.equal(
    sql(`select score_revision=score_projection_revision and
                score_projection_status='current'
           from public.matches where id='${MATCH}';`),
    "t"
  );
  assert.equal(
    sql(`select count(*) from public.point_score_state where match_id='${MATCH}';`),
    "1"
  );
  assert.equal(
    sql(`select count(*) from public.match_score_mutations
          where match_id='${MATCH}' and action='replace_worker_points';`),
    "0",
    "additive triggers do not require an old package to emit a receipt"
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
  assert.match(authenticated(ADMIN, `select 'RESULT:' || public.canonical_score_commands_enabled();`), /RESULT:false/);

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

databaseTest("visibility command removes and restores a point without discarding its truth", () => {
  resetFixture();
  enableCommands();
  const point = "30000000-0000-0000-0000-000000000001";
  sql(`insert into public.points(
         id,match_id,processing_version_id,idx,t0,t1,confirmed_winner,
         server_override,game_end_override,game_winner_override
       ) values (
         '${point}','${MATCH}','${VERSION}',1,1,2,'user','opponent','end','user'
       );
       insert into public.point_timing_observations(
         match_id,point_id,kind,source_s,origin,authority_scope,timing_revision,
         media_kind,eligible_for_training
       ) values (
         '${MATCH}','${point}','point_end',2,'manual_cutter',
         'owner_manual_boundary',0,'source',true
       );`);
  let revision = scoreRevision();
  const hideRequest = "40000000-0000-0000-0000-000000000300";
  let result = command(OWNER, `public.set_point_visibility_v2(
    '${MATCH}','${point}',false,'${hideRequest}',${revision}
  )`);
  assert.equal(result.ok, true);
  const hiddenResult = result;
  assert.deepEqual(command(OWNER, `public.set_point_visibility_v2(
    '${MATCH}','${point}',false,'${hideRequest}',${revision}
  )`), hiddenResult);
  revision = Number(result.revision);
  assert.equal(
    sql(`select deleted || '|' || confirmed_winner || '|' || server_override || '|' ||
                game_end_override || '|' || game_winner_override
           from public.points where id='${point}';`),
    "true|user|opponent|end|user"
  );
  assert.equal(sql(`select visible_point_count from public.match_score_state where match_id='${MATCH}';`), "0");
  assert.equal(sql(`select invalidated_at is null from public.point_timing_observations where point_id='${point}';`), "t");

  result = command(OWNER, `public.set_point_visibility_v2(
    '${MATCH}','${point}',true,gen_random_uuid(),${revision}
  )`);
  assert.equal(result.ok, true);
  assert.equal(sql(`select not deleted from public.points where id='${point}';`), "t");
  assert.equal(sql(`select visible_point_count from public.match_score_state where match_id='${MATCH}';`), "1");
});

databaseTest("reset score clears one selected segment atomically and keeps its boundary", () => {
  resetFixture();
  enableCommands();
  insertScorePoints();
  sql(`update public.points set
         confirmed_winner='user', confirmed_how='forced_error',
         scored_at_cut_s=t1, server_override='opponent',
         game_end_override='end', game_winner_override='user',
         serve_spin='topspin', serve_sidespin=true, serve_length='short',
         direction='wide', loss_reasons=array['late'], misread_kind='type'
       where match_id='${MATCH}';`);
  const revision = scoreRevision();
  const request = "40000000-0000-0000-0000-000000000390";
  const expression = `public.reset_match_score_v2(
    '${MATCH}',array[
      '30000000-0000-0000-0000-000000000001'::uuid,
      '30000000-0000-0000-0000-000000000002'::uuid
    ],array['30000000-0000-0000-0000-000000000002'::uuid],false,
    '${request}',${revision}
  )`;
  const result = command(OWNER, expression);
  assert.equal(result.ok, true);
  assert.deepEqual(command(OWNER, expression), result);
  assert.equal(
    sql(`select idx || '|' || coalesce(confirmed_winner,'null') || '|' ||
                coalesce(confirmed_how,'null') || '|' || is_let || '|' ||
                coalesce(server_override,'null') || '|' ||
                coalesce(game_end_override,'null') || '|' ||
                coalesce(game_winner_override,'null') || '|' ||
                coalesce(scored_at_cut_s::text,'null') || '|' ||
                coalesce(serve_spin,'null') || '|' ||
                coalesce(array_length(loss_reasons,1),0)
           from public.points where match_id='${MATCH}' order by idx;`),
    [
      "1|null|null|false|null|end|user|null|null|0",
      "2|null|null|false|null|end|user|null|null|0",
      "3|user|forced_error|false|opponent|end|user|6|topspin|1",
    ].join("\n"),
  );
  assert.equal(
    command(COACH, `public.reset_match_score_v2(
      '${MATCH}',array['30000000-0000-0000-0000-000000000001'::uuid],
      '{}'::uuid[],false,gen_random_uuid(),${result.revision}
    )`).code,
    "not_owner",
  );
});

databaseTest("multi-marker split and unsplit are atomic and restore the exact parent", () => {
  resetFixture();
  enableCommands();
  const parent = "30000000-0000-0000-0000-000000000001";
  const later = "30000000-0000-0000-0000-000000000002";
  sql(`insert into public.points(
         id,match_id,processing_version_id,idx,t0,t1,cut_t0,confirmed_winner,
         edited,tight_start,tight_end
       ) values
       ('${parent}','${MATCH}','${VERSION}',1,0,9,10,'user',false,false,false),
       ('${later}','${MATCH}','${VERSION}',2,10,12,20,null,false,false,false);
       update public.points set server_override='user' where id='${later}';
       update public.points set game_end_override='end',game_winner_override='user',
         scored_at_cut_s=18,rally_end_cut_s=17.5 where id='${parent}';`);
  const original = sql(`select (to_jsonb(p)-'timing_revision')::text
                          from public.points p where id='${parent}';`);
  const splitRequest = "40000000-0000-0000-0000-000000000301";
  const base = scoreRevision();
  const split = command(OWNER, `public.split_point_v2(
    '${MATCH}','${parent}',array[3,6]::numeric[],array[13,16]::numeric[],
    array['user','opponent','let']::text[],'${splitRequest}',${base}
  )`);
  assert.equal(split.ok, true);
  assert.deepEqual(command(OWNER, `public.split_point_v2(
    '${MATCH}','${parent}',array[3,6]::numeric[],array[13,16]::numeric[],
    array['user','opponent','let']::text[],'${splitRequest}',${base}
  )`), split);
  assert.equal(
    sql(`select string_agg(t0 || '-' || t1 || ':' || coalesce(confirmed_winner,
                case when is_let then 'skip' else 'clear' end),',' order by t0)
           from public.points where match_id='${MATCH}' and not deleted and t0<9;`),
    "0-3:user,3-6:opponent,6-9:skip"
  );
  assert.equal(
    sql(`select coalesce(game_end_override,'null') || ':' ||
                coalesce(game_winner_override,'null') || ':' ||
                coalesce(scored_at_cut_s::text,'null')
           from public.points where match_id='${MATCH}' and not deleted and t0<9
          order by t0;`),
    "null:null:null\nnull:null:null\nend:user:null"
  );
  assert.equal(sql(`select server_override is null from public.points where id='${later}';`), "t");

  const unsplitRequest = "40000000-0000-0000-0000-000000000302";
  const unsplit = command(OWNER, `public.unsplit_point_v2(
    '${MATCH}','${splitRequest}','${unsplitRequest}',${split.revision}
  )`);
  assert.equal(unsplit.ok, true);
  assert.deepEqual(command(OWNER, `public.unsplit_point_v2(
    '${MATCH}','${splitRequest}','${unsplitRequest}',${split.revision}
  )`), unsplit);
  assert.equal(sql(`select count(*) from public.points where match_id='${MATCH}';`), "2");
  assert.equal(sql(`select (to_jsonb(p)-'timing_revision')::text
                     from public.points p where id='${parent}';`), original);
  assert.equal(sql(`select server_override from public.points where id='${later}';`), "user");

  const invalidBase = scoreRevision();
  const invalid = command(OWNER, `public.split_point_v2(
    '${MATCH}','${parent}',array[3,8.9]::numeric[],array[13,18.9]::numeric[],
    array['clear','clear','clear']::text[],gen_random_uuid(),${invalidBase}
  )`);
  assert.equal(invalid.code, "invalid_input");
  assert.equal(sql(`select count(*) from public.points where match_id='${MATCH}';`), "2");
  assert.equal(sql(`select (to_jsonb(p)-'timing_revision')::text
                     from public.points p where id='${parent}';`), original);
  const nullOutcome = command(OWNER, `public.split_point_v2(
    '${MATCH}','${parent}',array[3]::numeric[],array[13]::numeric[],
    array['user',null]::text[],gen_random_uuid(),${invalidBase}
  )`);
  assert.equal(nullOutcome.code, "invalid_input");
});

databaseTest("merge archives joined rows and timing evidence while preserving one explicit outcome", () => {
  resetFixture();
  enableCommands();
  const ids = [1, 2, 3, 4].map((n) => `30000000-0000-0000-0000-${String(n).padStart(12, "0")}`);
  sql(`insert into public.points(id,match_id,processing_version_id,idx,t0,t1,confirmed_winner)
       values
       ('${ids[0]}','${MATCH}','${VERSION}',1,0,3,'user'),
       ('${ids[1]}','${MATCH}','${VERSION}',2,3,6,'opponent'),
       ('${ids[2]}','${MATCH}','${VERSION}',3,6,9,'user'),
       ('${ids[3]}','${MATCH}','${VERSION}',4,10,12,null);
       update public.points set server_override='opponent' where id='${ids[3]}';
       update public.points set game_end_override='end',game_winner_override='user',
         scored_at_cut_s=8.8,rally_end_cut_s=8.5 where id='${ids[2]}';
       insert into public.point_timing_observations(
         match_id,point_id,kind,source_s,origin,authority_scope,timing_revision,media_kind
       ) values
       ('${MATCH}','${ids[0]}','point_end',3,'manual_cutter','owner_manual_boundary',0,'source'),
       ('${MATCH}','${ids[1]}','serve_start',3,'manual_cutter','owner_manual_boundary',0,'source');`);
  const mergeRequest = "40000000-0000-0000-0000-000000000303";
  const mergeBase = scoreRevision();
  const result = command(OWNER, `public.merge_points_v2(
    '${MATCH}',array['${ids[0]}'::uuid,'${ids[1]}'::uuid,'${ids[2]}'::uuid],
    'opponent','${mergeRequest}',${mergeBase}
  )`);
  assert.equal(result.ok, true);
  assert.deepEqual(command(OWNER, `public.merge_points_v2(
    '${MATCH}',array['${ids[0]}'::uuid,'${ids[1]}'::uuid,'${ids[2]}'::uuid],
    'opponent','${mergeRequest}',${mergeBase}
  )`), result);
  assert.equal(
    sql(`select t0 || '-' || t1 || '|' || confirmed_winner || '|' ||
                (not tight_end) || '|' || edited || '|' || end_authority
           from public.points where id='${ids[0]}';`),
    "0-9|opponent|true|true|manual"
  );
  assert.equal(
    sql(`select game_end_override || '|' || game_winner_override || '|' ||
                scored_at_cut_s || '|' || rally_end_cut_s
           from public.points where id='${ids[0]}';`),
    "end|user|8.8|8.5"
  );
  assert.equal(
    sql(`select string_agg(id::text || ':' || deleted,',' order by id)
           from public.points where id in ('${ids[1]}','${ids[2]}');`),
    `${ids[1]}:true,${ids[2]}:true`
  );
  assert.equal(sql(`select bool_and(invalidated_at is not null) from public.point_timing_observations;`), "t");
  assert.equal(sql(`select server_override is null from public.points where id='${ids[3]}';`), "t");
});

databaseTest("adjust invalidates only observations for edges that actually moved", () => {
  resetFixture();
  enableCommands();
  const point = "30000000-0000-0000-0000-000000000001";
  sql(`insert into public.points(id,match_id,processing_version_id,idx,t0,t1,cut_t0)
       values ('${point}','${MATCH}','${VERSION}',1,10,20,9);
       insert into public.point_timing_observations(
         match_id,point_id,kind,source_s,origin,authority_scope,timing_revision,media_kind
       ) values
       ('${MATCH}','${point}','serve_start',10,'manual_cutter','owner_manual_boundary',0,'source'),
       ('${MATCH}','${point}','point_end',20,'manual_cutter','owner_manual_boundary',0,'source');`);
  const adjustRequest = "40000000-0000-0000-0000-000000000304";
  const adjustBase = scoreRevision();
  let result = command(OWNER, `public.adjust_point_v2(
    '${MATCH}','${point}',11,20,true,false,null,null,'${adjustRequest}',${adjustBase}
  )`);
  assert.equal(result.ok, true);
  assert.deepEqual(command(OWNER, `public.adjust_point_v2(
    '${MATCH}','${point}',11,20,true,false,null,null,'${adjustRequest}',${adjustBase}
  )`), result);
  assert.equal(
    sql(`select string_agg(kind || ':' || (invalidated_at is not null),',' order by kind)
           from public.point_timing_observations where point_id='${point}';`),
    "point_end:false,serve_start:true"
  );
  result = command(OWNER, `public.adjust_point_v2(
    '${MATCH}','${point}',11,21,true,true,null,null,gen_random_uuid(),${result.revision}
  )`);
  assert.equal(result.ok, true);
  assert.equal(
    sql(`select bool_and(invalidated_at is not null) from public.point_timing_observations where point_id='${point}';`),
    "t"
  );
});

databaseTest("insert trims overlapping neighbours, invalidates moved-edge evidence, and clears later anchors", () => {
  resetFixture();
  enableCommands();
  const prev = "30000000-0000-0000-0000-000000000001";
  const next = "30000000-0000-0000-0000-000000000002";
  sql(`insert into public.points(id,match_id,processing_version_id,idx,t0,t1,cut_t0)
       values
       ('${prev}','${MATCH}','${VERSION}',1,0,5,0),
       ('${next}','${MATCH}','${VERSION}',2,7,12,7);
       update public.points set server_override='user' where id='${next}';
       insert into public.point_timing_observations(
         match_id,point_id,kind,source_s,origin,authority_scope,timing_revision,media_kind
       ) values
       ('${MATCH}','${prev}','point_end',5,'manual_cutter','owner_manual_boundary',0,'source'),
       ('${MATCH}','${next}','serve_start',7,'manual_cutter','owner_manual_boundary',0,'source');`);
  const insertRequest = "40000000-0000-0000-0000-000000000305";
  const insertBase = scoreRevision();
  const result = command(OWNER, `public.insert_point_v2(
    '${MATCH}','${prev}','${next}',4,8,4,'user','${insertRequest}',${insertBase}
  )`);
  assert.equal(result.ok, true);
  assert.deepEqual(command(OWNER, `public.insert_point_v2(
    '${MATCH}','${prev}','${next}',4,8,4,'user','${insertRequest}',${insertBase}
  )`), result);
  assert.equal(sql(`select t1 || '|' || tight_end from public.points where id='${prev}';`), "4|true");
  assert.equal(sql(`select t0 || '|' || tight_start from public.points where id='${next}';`), "8|true");
  assert.equal(sql(`select bool_and(invalidated_at is not null) from public.point_timing_observations;`), "t");
  assert.equal(sql(`select server_override is null from public.points where id='${next}';`), "t");
  assert.equal(
    sql(`select confirmed_winner || '|' || end_authority from public.points
          where match_id='${MATCH}' and id not in ('${prev}','${next}');`),
    "user|manual"
  );
});

databaseTest("all structural commands reject non-owners and stale revisions without writes", () => {
  resetFixture();
  enableCommands();
  insertScorePoints();
  const p1 = "30000000-0000-0000-0000-000000000001";
  const p2 = "30000000-0000-0000-0000-000000000002";
  const revision = scoreRevision();
  const calls = [
    `public.set_point_visibility_v2('${MATCH}','${p1}',false,gen_random_uuid(),${revision})`,
    `public.split_point_v2('${MATCH}','${p1}',array[1.3]::numeric[],array[1.3]::numeric[],array['clear']::text[],gen_random_uuid(),${revision})`,
    `public.unsplit_point_v2('${MATCH}',gen_random_uuid(),gen_random_uuid(),${revision})`,
    `public.merge_points_v2('${MATCH}',array['${p1}'::uuid,'${p2}'::uuid],'clear',gen_random_uuid(),${revision})`,
    `public.adjust_point_v2('${MATCH}','${p1}',1,2,false,false,null,null,gen_random_uuid(),${revision})`,
    `public.insert_point_v2('${MATCH}','${p1}','${p2}',1.5,3.5,1.5,'clear',gen_random_uuid(),${revision})`,
  ];
  for (const call of calls) assert.equal(command(STRANGER, call).code, "not_owner");
  for (const call of calls) {
    const staleCall = call.replace(`,${revision})`, `,${revision - 1})`);
    assert.equal(command(OWNER, staleCall).code, "score_conflict");
  }
  assert.equal(sql(`select count(*) from public.match_score_mutations;`), "0");
});

databaseTest("a multi-write split rolls back completely when canonical projection fails", () => {
  resetFixture();
  enableCommands();
  const parent = "30000000-0000-0000-0000-000000000001";
  sql(`insert into public.points(
         id,match_id,processing_version_id,idx,t0,t1,cut_t0,confirmed_winner
       ) values ('${parent}','${MATCH}','${VERSION}',1,0,9,10,'user');`);
  const revision = scoreRevision();
  const before = sql(`select to_jsonb(p)::text from public.points p where id='${parent}';`);
  sql(`alter table public.point_score_state
       add constraint point_score_state_structural_failure check (false) not valid;`);
  const failed = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-At",
     "-U", "postgres", "-d", DATABASE],
    {
      input: `begin; set local role authenticated;
        select set_config('request.jwt.claim.sub','${OWNER}',true);
        select public.split_point_v2(
          '${MATCH}','${parent}',array[3,6]::numeric[],array[13,16]::numeric[],
          array['user','opponent','let']::text[],gen_random_uuid(),${revision}
        ); commit;`,
      encoding: "utf8",
    }
  );
  assert.notEqual(failed.status, 0);
  assert.equal(sql(`select count(*) from public.points where match_id='${MATCH}';`), "1");
  assert.equal(sql(`select to_jsonb(p)::text from public.points p where id='${parent}';`), before);
  assert.equal(sql(`select count(*) from public.match_score_mutations;`), "0");
  sql(`alter table public.point_score_state
       drop constraint point_score_state_structural_failure;`);
});

databaseTest("only the worker can read the sealed canonical publication contract", () => {
  const output = sql(`begin;
      set local role ponglens_worker;
      select public.canonical_worker_contract_v1()::text;
      rollback;`);
  const contractLine = output.split("\n").find((line) => line.startsWith("{"));
  assert.ok(contractLine, output);
  const contract = JSON.parse(contractLine);
  assert.deepEqual(contract, {
    minimumMigration: "20260916120000",
    canonicalPublicationContract: 1,
  });

  const denied = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-At",
     "-U", "postgres", "-d", DATABASE],
    {
      input: "set role authenticated; select public.canonical_worker_contract_v1();",
      encoding: "utf8",
    }
  );
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /permission denied for function canonical_worker_contract_v1/i);
});

databaseTest("admin score diagnostic exposes sanitized health and denies every non-admin", () => {
  resetFixture();
  insertScorePoints();
  const result = JSON.parse(
    authenticated(ADMIN, `select public.admin_canonical_score_diagnostic('${MATCH}')::text;`)
      .split("\n")
      .find((line) => line.startsWith("{")) ?? "null"
  );
  assert.deepEqual(Object.keys(result).sort(), [
    "answered_points", "last_action", "last_result_revision",
    "projection_error_code", "projection_revision", "score_revision",
    "skipped_points", "status", "visible_points",
  ]);
  assert.equal(result.status, "current");
  assert.equal(result.score_revision, result.projection_revision);
  assert.equal(result.visible_points, 3);

  for (const actor of [OWNER, COACH, STRANGER]) {
    const denied = spawnSync(
      "docker",
      ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-At",
       "-U", "postgres", "-d", DATABASE],
      {
        input: `begin; set local role authenticated;
          select set_config('request.jwt.claim.sub','${actor}',true);
          select public.admin_canonical_score_diagnostic('${MATCH}'); commit;`,
        encoding: "utf8",
      }
    );
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /not authorized/i);
  }

  const anonDenied = spawnSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-v", "ON_ERROR_STOP=1", "-At",
     "-U", "postgres", "-d", DATABASE],
    { input: `set role anon; select public.admin_canonical_score_diagnostic('${MATCH}');`, encoding: "utf8" }
  );
  assert.notEqual(anonDenied.status, 0);
  assert.match(anonDenied.stderr, /permission denied for function admin_canonical_score_diagnostic/i);
});
