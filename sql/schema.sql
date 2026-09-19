-- Keep VARCHAR for semantic reasons
CREATE TABLE IF NOT EXISTS attempts (
    id                INTEGER        PRIMARY KEY,
    player_id         VARCHAR(50)    NOT NULL,
    username          VARCHAR(50)    NOT NULL,
    score             REAL           NOT NULL,
    submitted_at      VARCHAR(20)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_date    VARCHAR(20)    AS (date(submitted_at)) STORED
);

CREATE VIEW IF NOT EXISTS leaderboard AS
    SELECT submitted_date, player_id, username, MIN(score) AS best_score
    FROM attempts
    GROUP BY submitted_date, player_id;

CREATE INDEX IF NOT EXISTS idx_attempts_date_player_score
    ON attempts (submitted_date, player_id, score);