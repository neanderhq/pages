// Conventional Drizzle inputs consumed by the managed migration profile.
export default { schema: "./server/schema.ts", out: "./drizzle", dialect: "postgresql", dbCredentials: { url: process.env.DATABASE_URL! } };
