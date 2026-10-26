-- Preserve existing restrictions and block only the red Kobe AF1 colorway.
INSERT INTO "settings" ("key", "value", "updated_at")
VALUES ('restricted', '["Nike Mind 001", "Nike Mind 002", "IB0018-600"]'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "value" = "settings"."value" || '["IB0018-600"]'::jsonb,
    "updated_at" = CURRENT_TIMESTAMP
WHERE jsonb_typeof("settings"."value") = 'array'
  AND NOT ("settings"."value" @> '["IB0018-600"]'::jsonb);
