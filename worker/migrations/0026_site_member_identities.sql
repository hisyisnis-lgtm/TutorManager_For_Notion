-- Login methods belong to an existing canonical member; account data never moves.
CREATE TABLE IF NOT EXISTS site_member_identities (
  provider TEXT NOT NULL CHECK(provider IN ('email','google','kakao')),
  provider_subject TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES site_members(id),
  email TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(provider,provider_subject),
  UNIQUE(member_id,provider)
);

-- Link purpose is separate from ordinary signup/login proof and browser-bound.
CREATE TABLE IF NOT EXISTS site_member_link_intents (
  -- HMAC of the proof identifier and the creating session's CSRF hash.
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('email','google','kakao')),
  member_id TEXT NOT NULL REFERENCES site_members(id),
  session_id TEXT NOT NULL REFERENCES site_sessions(id) ON DELETE CASCADE,
  oauth_state_hash TEXT UNIQUE REFERENCES site_oauth_states(state_hash) ON DELETE CASCADE,
  email_challenge_id TEXT UNIQUE REFERENCES site_email_challenges(id) ON DELETE CASCADE,
  registration_token_hash TEXT UNIQUE REFERENCES site_registration_tokens(token_hash) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  consumption_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK((provider='email' AND email_challenge_id IS NOT NULL AND oauth_state_hash IS NULL)
    OR (provider IN ('google','kakao') AND oauth_state_hash IS NOT NULL AND email_challenge_id IS NULL))
);

-- Preserve legacy ownership and never resolve a collision by transferring it.
INSERT OR IGNORE INTO site_member_identities(provider,provider_subject,member_id,email,created_at)
SELECT provider,CASE WHEN provider='email' THEN lower(trim(email)) ELSE provider_subject END,id,email,created_at
FROM site_members WHERE (provider='email' AND email IS NOT NULL AND length(trim(email))>0)
  OR (provider IN ('google','kakao') AND provider_subject IS NOT NULL AND length(provider_subject)>0);
