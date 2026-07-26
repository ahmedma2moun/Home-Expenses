/**
 * No auth flow for now — every request resolves to this single seeded user (see prisma/seed.ts).
 * Swap this back for real JWT-derived userId resolution when auth comes back.
 */
export const DEV_USER_ID = "dev-user";
