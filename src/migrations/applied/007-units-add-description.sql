ALTER TABLE "units" ADD COLUMN "description" VARCHAR;

UPDATE "units" SET "description" = 'No description provided' WHERE "description" IS NULL;