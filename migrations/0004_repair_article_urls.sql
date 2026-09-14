UPDATE sync_rev SET value = value + 1 WHERE id = 1;

UPDATE articles
SET url = guid,
    rev = (SELECT value FROM sync_rev WHERE id = 1)
WHERE url IS NULL AND (guid LIKE 'http://%' OR guid LIKE 'https://%');
