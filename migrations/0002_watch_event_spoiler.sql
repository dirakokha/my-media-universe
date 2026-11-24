-- A watch event can be marked as a spoiler independently of the item's journal.
-- The flag was already collected by the "add viewing" form but had nowhere to live.
ALTER TABLE watch_events ADD COLUMN is_spoiler INTEGER NOT NULL DEFAULT 0;
