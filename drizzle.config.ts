import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Load .env explicitly so `drizzle-kit push` targets the same database the app
// uses, instead of the hard-coded credentials the JSON config shipped with.
config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
  verbose: true,
});
