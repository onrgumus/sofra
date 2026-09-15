-- Everything Sofra has to remember between restarts.
--
-- Reference data (people, offices) is injected rather than stored: it comes
-- from a directory in production and from the generator in the demo, and
-- copying it here would only create a second version to keep in sync.
--
-- Written for SQLite because it ships with Node and can therefore be tested for
-- real. Postgres needs TEXT -> TEXT, INTEGER -> BOOLEAN, and nothing else.

CREATE TABLE IF NOT EXISTS self_declared_attendance (
  employee_id TEXT NOT NULL,
  date        TEXT NOT NULL,
  office_id   TEXT NOT NULL,
  PRIMARY KEY (employee_id, date, office_id)
);

-- "The desk tool says I am in, but plans changed." We cannot edit their system,
-- so the override lives on our side.
CREATE TABLE IF NOT EXISTS suppressed_attendance (
  employee_id TEXT NOT NULL,
  date        TEXT NOT NULL,
  office_id   TEXT NOT NULL,
  PRIMARY KEY (employee_id, date, office_id)
);

CREATE TABLE IF NOT EXISTS opt_ins (
  employee_id TEXT NOT NULL,
  date        TEXT NOT NULL,
  office_id   TEXT NOT NULL,
  slot        TEXT NOT NULL,
  PRIMARY KEY (employee_id, date, office_id)
);
CREATE INDEX IF NOT EXISTS opt_ins_by_day ON opt_ins (date, office_id);

CREATE TABLE IF NOT EXISTS groups (
  id                    TEXT PRIMARY KEY,
  date                  TEXT NOT NULL,
  office_id             TEXT NOT NULL,
  slot                  TEXT NOT NULL,
  score                 REAL NOT NULL,
  relaxation            TEXT NOT NULL,
  common_languages      TEXT NOT NULL,
  cancelled             INTEGER NOT NULL DEFAULT 0,
  sequence              INTEGER NOT NULL DEFAULT 0,
  -- Null means the table has changed and the invite has not gone out yet. This
  -- is the field whose loss on restart mailed nine tables twice.
  invites_sent_at       TEXT,
  cancellation_sent_at  TEXT
);
CREATE INDEX IF NOT EXISTS groups_by_day ON groups (date, office_id);

CREATE TABLE IF NOT EXISTS group_members (
  group_id    TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  seat        INTEGER NOT NULL,
  rsvp        TEXT NOT NULL DEFAULT 'pending',
  PRIMARY KEY (group_id, employee_id)
);
CREATE INDEX IF NOT EXISTS group_members_by_employee ON group_members (employee_id);

CREATE TABLE IF NOT EXISTS unmatched (
  date        TEXT NOT NULL,
  office_id   TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  reason      TEXT NOT NULL,
  PRIMARY KEY (date, office_id, employee_id)
);

-- Lunches that happened before this database existed, or that have been cleared
-- from `groups`. Live groups contribute to history too; the store unions both.
CREATE TABLE IF NOT EXISTS past_matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  member_ids TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS past_matches_by_date ON past_matches (date);
