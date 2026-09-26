/**
 * The schema, as an ordered list of migrations.
 *
 * Kept in TypeScript rather than in .sql files beside it, because a file read
 * at runtime is a file the bundler has to be told to ship, and forgetting that
 * is a deployment that boots and then fails its first query. A migration is
 * never edited once it has run anywhere; a change is a new entry at the end.
 */
export interface Migration {
  id: string;
  sql: string;
}

const TIME = `'^([01][0-9]|2[0-3]):[0-5][0-9]$'`;

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '001_initial',
    sql: `
      -- Company-wide settings that an admin changes in the app rather than in a
      -- deployment. One row per key.
      CREATE TABLE settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Who may sign in with an emailed link. Owning a mailbox on one of these
      -- is what makes somebody a colleague.
      CREATE TABLE allowed_domains (
        domain     TEXT PRIMARY KEY CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9.-]+\\.[a-z]{2,}$'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- A fixed list rather than free text: "IT", "BT" and "Bilgi Islem" typed
      -- by three people are three departments to the matcher, and the spread of
      -- departments at a table is half of what it optimises.
      CREATE TABLE departments (
        name       TEXT PRIMARY KEY CHECK (length(trim(name)) BETWEEN 1 AND 80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX departments_name_ci ON departments (lower(name));

      CREATE TABLE offices (
        id                 TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9-]{1,39}$'),
        name               TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
        address            TEXT NOT NULL DEFAULT '',
        meeting_point      TEXT NOT NULL DEFAULT '',
        -- An IANA name, never an offset: an offset is wrong for half the year
        -- anywhere that changes its clocks.
        time_zone          TEXT NOT NULL,
        opens_at           TEXT NOT NULL CHECK (opens_at ~ ${TIME}),
        match_lead_minutes INTEGER NOT NULL DEFAULT 180 CHECK (match_lead_minutes BETWEEN 30 AND 720),
        confirm_by         TEXT NOT NULL DEFAULT '10:00' CHECK (confirm_by ~ ${TIME}),
        reminder_at        TEXT NOT NULL DEFAULT '16:00' CHECK (reminder_at ~ ${TIME}),
        lunch_slots        TEXT[] NOT NULL DEFAULT ARRAY['12:00'] CHECK (cardinality(lunch_slots) BETWEEN 1 AND 6),
        -- ISO weekdays, 1 is Monday.
        working_days       SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[],
        min_table          SMALLINT NOT NULL DEFAULT 3,
        max_table          SMALLINT NOT NULL DEFAULT 4,
        location_keywords  TEXT[] NOT NULL DEFAULT '{}',
        active             BOOLEAN NOT NULL DEFAULT TRUE,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (min_table >= 2 AND max_table >= min_table AND max_table <= 8)
      );

      CREATE TABLE office_holidays (
        office_id TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE ON UPDATE CASCADE,
        date      DATE NOT NULL,
        name      TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (office_id, date)
      );

      CREATE TABLE employees (
        id              TEXT PRIMARY KEY,
        email           TEXT NOT NULL CHECK (email = lower(email)),
        display_name    TEXT NOT NULL DEFAULT '',
        title           TEXT NOT NULL DEFAULT '',
        department      TEXT REFERENCES departments (name) ON UPDATE CASCADE,
        team            TEXT NOT NULL DEFAULT '',
        seniority       TEXT CHECK (seniority IN ('intern','junior','mid','senior','lead','manager','director')),
        office_id       TEXT REFERENCES offices (id) ON DELETE SET NULL ON UPDATE CASCADE,
        languages       TEXT[] NOT NULL DEFAULT ARRAY['en'],
        interests       TEXT[] NOT NULL DEFAULT '{}',
        started_on      DATE,
        aliases         TEXT[] NOT NULL DEFAULT '{}',
        entra_object_id TEXT,
        slack_user_id   TEXT,
        source          TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self','entra','csv','seed')),
        active          BOOLEAN NOT NULL DEFAULT TRUE,
        -- Null until the person has said which office, department and level
        -- they are. Nobody is matched before that.
        onboarded_at    TIMESTAMPTZ,
        reminders       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at    TIMESTAMPTZ
      );
      CREATE UNIQUE INDEX employees_email ON employees (email);
      CREATE UNIQUE INDEX employees_entra ON employees (entra_object_id) WHERE entra_object_id IS NOT NULL;
      CREATE INDEX employees_aliases ON employees USING GIN (aliases);
      CREATE INDEX employees_office ON employees (office_id) WHERE active;

      -- Only a hash of the token is stored: a copy of this table is not a way in.
      CREATE TABLE sessions (
        id_hash          TEXT PRIMARY KEY,
        employee_id      TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        method           TEXT NOT NULL CHECK (method IN ('email','oidc','teams')),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        -- When the person last proved who they are, as opposed to when the
        -- cookie was last seen. The console asks for a recent one.
        authenticated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at       TIMESTAMPTZ NOT NULL,
        user_agent       TEXT NOT NULL DEFAULT '',
        ip               TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX sessions_employee ON sessions (employee_id);

      CREATE TABLE login_tokens (
        token_hash TEXT PRIMARY KEY,
        email      TEXT NOT NULL,
        next_path  TEXT NOT NULL DEFAULT '/',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        used_at    TIMESTAMPTZ,
        ip         TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX login_tokens_email ON login_tokens (email, created_at);

      CREATE TABLE rate_limit_events (
        key TEXT NOT NULL,
        at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX rate_limit_events_key ON rate_limit_events (key, at);

      -- A null office is every office.
      CREATE TABLE admin_grants (
        id          BIGSERIAL PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        office_id   TEXT REFERENCES offices (id) ON DELETE CASCADE ON UPDATE CASCADE,
        granted_by  TEXT NOT NULL,
        granted_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX admin_grants_unique ON admin_grants (employee_id, (coalesce(office_id, '')));

      CREATE TABLE audit_log (
        id          BIGSERIAL PRIMARY KEY,
        at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor_id    TEXT,
        actor_email TEXT NOT NULL DEFAULT '',
        action      TEXT NOT NULL,
        target      TEXT NOT NULL DEFAULT '',
        details     JSONB NOT NULL DEFAULT '{}'
      );
      CREATE INDEX audit_log_at ON audit_log (at DESC);

      -- "I will be in this office on this day and I want lunch." One per person
      -- per day: nobody is in two buildings at noon.
      CREATE TABLE lunch_requests (
        employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        date        DATE NOT NULL,
        office_id   TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE ON UPDATE CASCADE,
        -- Null is any of the office's lunch times.
        slot        TEXT,
        source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','weekly','teams')),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (employee_id, date)
      );
      CREATE INDEX lunch_requests_day ON lunch_requests (office_id, date);

      -- "Every Tuesday and Thursday", expanded when a day is planned, with
      -- request_skips for the weeks somebody is not coming.
      CREATE TABLE weekly_patterns (
        employee_id TEXT PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
        weekdays    SMALLINT[] NOT NULL,
        slot        TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE request_skips (
        employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        date        DATE NOT NULL,
        PRIMARY KEY (employee_id, date)
      );

      CREATE TABLE lunch_tables (
        id                   TEXT PRIMARY KEY,
        office_id            TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE ON UPDATE CASCADE,
        date                 DATE NOT NULL,
        slot                 TEXT NOT NULL,
        -- The instant, fixed when the table was made, so an office changing its
        -- zone later does not move a lunch people have already accepted.
        starts_at            TIMESTAMPTZ NOT NULL,
        time_zone            TEXT NOT NULL,
        score                DOUBLE PRECISION NOT NULL,
        relaxation           TEXT NOT NULL,
        common_languages     TEXT[] NOT NULL,
        cancelled            BOOLEAN NOT NULL DEFAULT FALSE,
        sequence             INTEGER NOT NULL DEFAULT 0,
        invites_sent_at      TIMESTAMPTZ,
        cancellation_sent_at TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX lunch_tables_day ON lunch_tables (office_id, date);

      CREATE TABLE table_seats (
        table_id    TEXT NOT NULL REFERENCES lunch_tables (id) ON DELETE CASCADE,
        employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        seat        SMALLINT NOT NULL,
        rsvp        TEXT NOT NULL DEFAULT 'pending' CHECK (rsvp IN ('pending','accepted','declined')),
        PRIMARY KEY (table_id, employee_id)
      );
      CREATE INDEX table_seats_employee ON table_seats (employee_id);

      CREATE TABLE unseated (
        office_id   TEXT NOT NULL REFERENCES offices (id) ON DELETE CASCADE ON UPDATE CASCADE,
        date        DATE NOT NULL,
        employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        reason      TEXT NOT NULL,
        PRIMARY KEY (office_id, date, employee_id)
      );

      -- Every scheduled job, once. dedupe_key makes a second run of the same
      -- job a no-op, which is what stops a retried cron mailing a building twice;
      -- manual runs leave it null and are simply recorded.
      CREATE TABLE job_runs (
        id          BIGSERIAL PRIMARY KEY,
        kind        TEXT NOT NULL,
        office_id   TEXT,
        run_key     TEXT NOT NULL,
        dedupe_key  TEXT UNIQUE,
        trigger     TEXT NOT NULL CHECK (trigger IN ('schedule','manual')),
        status      TEXT NOT NULL CHECK (status IN ('running','done','failed','skipped')),
        attempts    INTEGER NOT NULL DEFAULT 1,
        started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        summary     JSONB NOT NULL DEFAULT '{}',
        error       TEXT
      );
      CREATE INDEX job_runs_started ON job_runs (started_at DESC);

      CREATE TABLE notifications_sent (
        kind        TEXT NOT NULL,
        office_id   TEXT NOT NULL,
        date        DATE NOT NULL,
        employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, office_id, date, employee_id)
      );

      -- Mail the outbox transport keeps instead of sending, for development and
      -- for a deployment that has not been given a mail server yet.
      CREATE TABLE mail_outbox (
        id          BIGSERIAL PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        sender      TEXT NOT NULL,
        recipients  TEXT[] NOT NULL,
        subject     TEXT NOT NULL,
        text_body   TEXT NOT NULL,
        html_body   TEXT NOT NULL,
        attachments JSONB NOT NULL DEFAULT '[]'
      );

      -- Where the Teams bot can reach somebody, learned when they install it.
      CREATE TABLE teams_conversations (
        employee_id     TEXT PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        service_url     TEXT NOT NULL,
        tenant_id       TEXT NOT NULL DEFAULT '',
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- Office days read from somebody's Outlook calendar. A hint, never a
      -- request: being in the building is not wanting lunch.
      CREATE TABLE calendar_hints (
        employee_id TEXT NOT NULL REFERENCES employees (id) ON DELETE CASCADE,
        date        DATE NOT NULL,
        office_id   TEXT,
        PRIMARY KEY (employee_id, date)
      );
      CREATE TABLE calendar_fetches (
        employee_id TEXT PRIMARY KEY REFERENCES employees (id) ON DELETE CASCADE,
        from_date   DATE NOT NULL,
        to_date     DATE NOT NULL,
        fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
];
