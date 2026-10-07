CREATE TABLE "creator_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"week_id" integer NOT NULL,
	"creator_name" text NOT NULL,
	"recipient_wallet" text,
	"score" integer NOT NULL,
	"amount_wei" text NOT NULL,
	"status" text DEFAULT 'final_allocation' NOT NULL,
	"tx_hash" text,
	CONSTRAINT "creator_allocations_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "creator_weeks" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"week_end" date NOT NULL,
	"balance_wei" text NOT NULL,
	"pool_wei" text NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"actor" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_wallet_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"session_hash" text NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"origin" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "creator_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"main_user_id" integer,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"wallet" text,
	"status" text DEFAULT 'not_applied' NOT NULL,
	"x_handle" text DEFAULT '' NOT NULL,
	"telegram_handle" text DEFAULT '' NOT NULL,
	"x_verified" boolean DEFAULT false NOT NULL,
	"telegram_verified" boolean DEFAULT false NOT NULL,
	"verification_code" text NOT NULL,
	"badge" boolean DEFAULT false NOT NULL,
	"group_status" text DEFAULT 'not_requested' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"channels" text DEFAULT '' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"points_allocated" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"task_id" text NOT NULL,
	"task_title" text NOT NULL,
	"platform" text NOT NULL,
	"content_url" text NOT NULL,
	"content_key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"evidence_url" text DEFAULT '' NOT NULL,
	"activity_date" date NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"proposed_score" integer NOT NULL,
	"rule_version" integer NOT NULL,
	"daily_limit" integer DEFAULT 1 NOT NULL,
	"weekly_cap" integer DEFAULT 0 NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	"appeal_note" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_tasks" (
	"row_id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"platform" text NOT NULL,
	"score" integer NOT NULL,
	"daily_limit" integer DEFAULT 1 NOT NULL,
	"weekly_cap" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"campaign_title" text NOT NULL,
	"campaign_url" text NOT NULL,
	"evidence_hint" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"program_key" text,
	"session_hash" text NOT NULL,
	"wallet" text,
	"expires_at" timestamp with time zone NOT NULL,
	"primary_member_id" integer,
	"points_finalized" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_workspaces_program_key_unique" UNIQUE("program_key"),
	CONSTRAINT "creator_workspaces_session_hash_unique" UNIQUE("session_hash")
);
--> statement-breakpoint
ALTER TABLE "creator_allocations" ADD CONSTRAINT "creator_allocations_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_allocations" ADD CONSTRAINT "creator_allocations_member_id_creator_memberships_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."creator_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_allocations" ADD CONSTRAINT "creator_allocations_week_id_creator_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."creator_weeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_weeks" ADD CONSTRAINT "creator_weeks_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_audit" ADD CONSTRAINT "creator_audit_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_wallet_challenges" ADD CONSTRAINT "creator_wallet_challenges_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_memberships" ADD CONSTRAINT "creator_memberships_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_memberships" ADD CONSTRAINT "creator_memberships_main_user_id_users_id_fk" FOREIGN KEY ("main_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_sessions" ADD CONSTRAINT "creator_sessions_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_sessions" ADD CONSTRAINT "creator_sessions_member_id_creator_memberships_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."creator_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_submissions" ADD CONSTRAINT "creator_submissions_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_submissions" ADD CONSTRAINT "creator_submissions_member_id_creator_memberships_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."creator_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD CONSTRAINT "creator_tasks_workspace_id_creator_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."creator_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_allocation_unique" ON "creator_allocations" USING btree ("week_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_week_scope" ON "creator_weeks" USING btree ("workspace_id","week_start");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_membership_main_user" ON "creator_memberships" USING btree ("workspace_id","main_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_unique_activity" ON "creator_submissions" USING btree ("workspace_id","content_key","task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_task_scope" ON "creator_tasks" USING btree ("workspace_id","id");