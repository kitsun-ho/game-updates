CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-TW',
  official_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL UNIQUE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('html-news-list', 'steam-news')),
  url TEXT NOT NULL,
  fetch_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  last_item_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS updates (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT,
  title TEXT NOT NULL,
  summary TEXT,
  category TEXT NOT NULL DEFAULT 'news',
  published_at TEXT,
  source_url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (game_id, canonical_url)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  upserted_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_updates_game_published
  ON updates (game_id, published_at DESC, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_updates_published
  ON updates (published_at DESC, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_game_enabled
  ON sources (game_id, enabled);
CREATE INDEX IF NOT EXISTS idx_sync_runs_source_started
  ON sync_runs (source_id, started_at DESC);

INSERT OR IGNORE INTO games (id, name, locale, official_url, sort_order) VALUES
  ('genshin', '原神', 'zh-TW', 'https://genshin.hoyoverse.com/zh-tw/news', 10),
  ('wuthering', '鳴潮', 'zh-TW', 'https://wutheringwaves.kurogames.com/zh-tw/main/news', 20),
  ('girls-frontline-2', '少女前線 2：追放', 'zh-TW', 'https://gf2.haoplay.com/tw/', 30),
  ('endfield', '明日方舟：終末地', 'zh-TW', 'https://endfield.gryphline.com/zh-tw/news', 40);

INSERT OR IGNORE INTO sources (source_key, game_id, name, adapter, url, fetch_url) VALUES
  ('genshin-zh-tw', 'genshin', 'HoYoverse 官方公告', 'html-news-list', 'https://genshin.hoyoverse.com/zh-tw/news', 'https://genshin.hoyoverse.com/zh-tw/news'),
  ('wuthering-zh-tw', 'wuthering', '鳴潮官方公告', 'html-news-list', 'https://wutheringwaves.kurogames.com/zh-tw/main/news', 'https://wutheringwaves.kurogames.com/zh-tw/main/news'),
  ('girls-frontline-2-steam', 'girls-frontline-2', 'Steam 官方消息', 'steam-news', 'https://store.steampowered.com/news/app/3308670', 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=3308670&count=30&maxlength=600'),
  ('endfield-zh-tw', 'endfield', '終末地官方公告', 'html-news-list', 'https://endfield.gryphline.com/zh-tw/news', 'https://endfield.gryphline.com/zh-tw/news');
