-- Create "context_variables" table
CREATE TABLE "public"."context_variables" (
  "id" bigserial NOT NULL,
  "created_at" timestamptz NULL,
  "updated_at" timestamptz NULL,
  "deleted_at" timestamptz NULL,
  "name" text NOT NULL,
  "value_encrypted" text NULL,
  "is_secret" boolean NOT NULL DEFAULT false,
  "repo_id" bigint NULL,
  "organisation_id" bigint NOT NULL,
  "project_name_filter" text NULL,
  "project_directory_filter" text NULL,
  PRIMARY KEY ("id"),
  CONSTRAINT "fk_context_variables_repo" FOREIGN KEY ("repo_id") REFERENCES "public"."repos" ("id") ON UPDATE NO ACTION ON DELETE CASCADE,
  CONSTRAINT "fk_context_variables_organisation" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations" ("id") ON UPDATE NO ACTION ON DELETE CASCADE
);
-- Create index "idx_context_variables_deleted_at" to table: "context_variables"
CREATE INDEX "idx_context_variables_deleted_at" ON "public"."context_variables" ("deleted_at");
-- Create index "idx_context_variables_repo_id" to table: "context_variables"
CREATE INDEX "idx_context_variables_repo_id" ON "public"."context_variables" ("repo_id");
-- Create index "idx_context_variables_organisation_id" to table: "context_variables"
CREATE INDEX "idx_context_variables_organisation_id" ON "public"."context_variables" ("organisation_id");
