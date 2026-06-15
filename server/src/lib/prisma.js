// Shared Prisma client (single instance across the app).
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
