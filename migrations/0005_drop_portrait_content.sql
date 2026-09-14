UPDATE sync_rev SET value = value + 1 WHERE id = 1;

UPDATE articles
SET content = NULL,
    rev = (SELECT value FROM sync_rev WHERE id = 1)
WHERE content IS NOT NULL
  AND content NOT LIKE '<!--readable:%'
  AND (content LIKE '%/Profiles/%' OR content LIKE '%rounded-full%' OR content LIKE '%gravatar%');
