-- Runs an editor shares on the published viewer beside the reviewed one (for the compare page).
ALTER TABLE track ADD COLUMN shared INTEGER NOT NULL DEFAULT 0
